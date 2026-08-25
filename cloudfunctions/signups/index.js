/**
 * 云函数 signups —— 报名 / 取消 / 我的局
 *
 * 名额与候补的判断全部委托给 common/signup.js 的纯函数,
 * 本文件只负责事务、计数与副作用,规则本身有单元测试覆盖。
 */
const cloud = require('wx-server-sdk')
const { evaluate, canCancelSignup } = require('./common/signup')
const { attemptJoin, attemptCancel, makeTcbOps } = require('./common/atomic')
const { cancellationCounts, applyPenalty } = require('./common/reliability')
const { SIGNUP_STATUS } = require('./common/rules')
const { interpret, onError, needsCheck, ACTION } = require('./common/moderation')
const { isBlocked } = require('./common/report')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ok = d => ({ ok: true, data: d })
const fail = (code, message) => ({ ok: false, code, message })

const REJECT_MESSAGE = {
  not_open: '这个局已经不接受报名了',
  closed: '报名已截止',
  duplicate: '你已经报名了',
  restricted: '你有未完成的爬约记录,暂时无法报名',
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    switch (event.action) {
      case 'join':   return ok(await join(event, OPENID))
      case 'cancel': return ok(await cancelSignup(event, OPENID))
      case 'mine':   return ok(await mine(OPENID))
      default:       return fail('unknown_action', `未知操作: ${event.action}`)
    }
  } catch (e) {
    console.error('[signups]', event.action, e)
    return fail(e.code || 'internal', e.message)
  }
}

async function join({ eventId, profile }, openid) {
  const now = new Date().toISOString()
  const user = await upsertUser(openid, profile)
  // 封禁检查走单一出口 —— 各云函数共用,避免有的入口忘了查
  if (isBlocked(user, 'signup', now).blocked) {
    throw Object.assign(new Error('当前账号无法报名'), { code: 'blocked' })
  }
  const e = (await db.collection('events').doc(eventId).get()).data

  // evaluate 只做前置快速失败(未开放/已截止/限制中/重复的预检)。
  // ⚠️ 名额判断不在这里 —— 并发下这里读到的 confirmedCount 是旧的,
  //    满员与否由 attemptJoin 里的条件自增(reserveSlot)原子决定。
  const verdict = evaluate({
    event: { ...e, confirmedCount: 0 },      // 归零让 evaluate 永不做名额判断
    user, gender: profile.gender,
    alreadySignedUp: false,                  // 重复报名由唯一索引权威判定
    now,
  })
  if (!verdict.allowed) {
    throw Object.assign(new Error(REJECT_MESSAGE[verdict.reason] || '无法报名'), { code: verdict.reason })
  }

  // 临界区走 common/atomic(与对撞测试同一段代码)
  const r = await attemptJoin(makeTcbOps(db), {
    eventId, userId: user._id, gender: profile.gender, now,
  })
  if (r.status === 'duplicate') {
    throw Object.assign(new Error(REJECT_MESSAGE.duplicate), { code: 'duplicate' })
  }
  return { status: r.status }
}

/**
 * 取消报名。
 * D10:open 状态下取消不计爬约 —— 鼓励尽早取消把位置让出来;formed 后取消计 1 次。
 * 取消后自动从候补递补,并通知被递补者。
 */
async function cancelSignup({ eventId }, openid) {
  const now = new Date().toISOString()
  const user = await getUser(openid)
  const s = (await db.collection('signups')
    .where({ eventId, userId: user._id, status: _.in([SIGNUP_STATUS.CONFIRMED, SIGNUP_STATUS.WAITLIST]) })
    .limit(1).get()).data[0]
  if (!s) throw Object.assign(new Error('没有找到报名记录'), { code: 'not_found' })
  if (!canCancelSignup({ signup: s })) {
    throw Object.assign(new Error('你是局主,要取消请取消整个局'), { code: 'host_cannot_leave' })
  }

  const e = (await db.collection('events').doc(eventId).get()).data

  // 临界区走 common/atomic:CAS 取消 + 原子递补(与对撞测试同一段代码)
  const r = await attemptCancel(makeTcbOps(db), {
    signupId: s._id, eventId, gender: s.gender, now,
  })
  if (!r.cancelled) return { cancelled: false, penalty: null }   // 已被处理,幂等返回

  let penalty = null
  if (r.wasConfirmed && cancellationCounts(e.status)) {
    const count = (user.noShowCount || 0) + 1
    penalty = applyPenalty(count, now)
    await db.collection('users').doc(user._id).update({
      data: { noShowCount: count, status: penalty.status, restrictedUntil: penalty.restrictedUntil },
    })
  }
  if (r.promoted) await enqueueNotification(r.promoted.userId, eventId, 'waitlist_promoted')
  return { cancelled: true, penalty }
}

async function mine(openid) {
  const user = await getUser(openid)
  const list = (await db.collection('signups')
    .where({ userId: user._id, status: _.neq(SIGNUP_STATUS.CANCELLED) })
    .orderBy('createdAt', 'desc').limit(50).get()).data
  const ids = [...new Set(list.map(s => s.eventId))]
  const events = ids.length
    ? (await db.collection('events').where({ _id: _.in(ids) }).get()).data
    : []
  const byId = Object.fromEntries(events.map(e => [e._id, e]))
  return list.map(s => ({ ...s, event: byId[s.eventId] })).filter(s => s.event)
}

// ---- helpers ----

/**
 * 首次报名时创建账号。
 * ⚠️ phone 来自 getPhoneNumber,是微信绑定号(多为 +86),仅作账号唯一性锚点,
 *    不作通知通道 —— 见 docs/03 §4。
 */
async function upsertUser(openid, profile) {
  const r = await db.collection('users').where({ openid }).limit(1).get()
  if (r.data.length) return r.data[0]

  // T28:昵称属于 UGC,必须过内容安全 —— 不接会被微信审核打回
  if (needsCheck(profile.nickname)) {
    let check
    try {
      check = interpret(await cloud.openapi.security.msgSecCheck({
        content: profile.nickname, version: 2, scene: 1, openid,   // scene 1 = 资料
      }))
    } catch (err) {
      check = onError(err)
    }
    // 昵称与聊天消息不同:它会长期展示给所有同行者,所以 risky 一律拒绝
    if (check.action === ACTION.REJECT) {
      throw Object.assign(new Error('这个昵称不能用,换一个'), { code: 'nickname_risky' })
    }
  }

  let phone = null
  if (profile.phoneCode) {
    const res = await cloud.openapi.phonenumber.getPhoneNumber({ code: profile.phoneCode })
    phone = res.phoneInfo && res.phoneInfo.phoneNumber
  }
  const now = new Date().toISOString()
  const doc = {
    openid, phone,
    notifyPhone: null,          // 可选的泰国本地号,V1.0 才启用
    nickname: (profile.nickname || '').slice(0, 20),
    gender: profile.gender,     // D08 必填,V1 仅供人工审核参考(D07 未启用自动配比)
    isHost: false,              // D14 局主权限,由管理员授予
    isAdmin: false,
    reliability: 100,
    noShowCount: 0,
    status: 'active',
    restrictedUntil: null,
    createdAt: now,
  }
  const added = await db.collection('users').add({ data: doc })
  return { _id: added._id, ...doc }
}

async function getUser(openid) {
  const r = await db.collection('users').where({ openid }).limit(1).get()
  if (!r.data.length) throw Object.assign(new Error('账号不存在'), { code: 'no_user' })
  return r.data[0]
}

async function enqueueNotification(userId, eventId, templateKey) {
  await db.collection('notifications').add({
    data: { userId, eventId, templateKey, channel: 'wx_subscribe', status: 'pending', createdAt: new Date().toISOString() },
  })
}
