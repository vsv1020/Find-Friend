/**
 * 云函数 host —— 局主工具包(T23)
 *
 * 所有 action 先校验调用者是该局局主或管理员。
 * 规则在 common/host.js(纯函数,有单元测试),本文件只负责取数、CAS 落库与通知入队。
 *
 * 【护城河】roster 是全产品唯一「列出多个用户」的出口,因此它:
 *   1. 只接受 eventId,只能列**自己局**的报名者,不存在按人检索的入参;
 *   2. 输出经 rosterEntry 白名单构造,不含 phone / gender / openid;
 *   3. 靠谱度只在这里露出(D10:仅局主可见)。
 */
const cloud = require('wx-server-sdk')
const { SIGNUP_STATUS, HOST_TOOLS } = require('./common/rules')
const { STATUS, transition, canTransition } = require('./common/state-machine')
const { interpret, onError, needsCheck, ACTION } = require('./common/moderation')
const { isBlocked } = require('./common/report')
const { validString, LIMITS } = require('./common/validate')
const host = require('./common/host')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ok = d => ({ ok: true, data: d })
const fail = (code, message) => ({ ok: false, code, message })

const REJECT_MESSAGE = {
  [host.HOST_REJECT.FORBIDDEN]: '只有局主可以操作',
  [host.HOST_REJECT.BAD_STATUS]: '这个局当前状态不能这样操作',
  [host.HOST_REJECT.COOLDOWN]: `群发太频繁了,${HOST_TOOLS.broadcastCooldownMinutes} 分钟内只能发一次`,
  [host.HOST_REJECT.BAD_TIME]: '时间格式不对',
  [host.HOST_REJECT.TOO_SOON]: '新时间太近了,来不及成团',
  [host.HOST_REJECT.TOO_FAR]: '新时间太远了',
  [host.HOST_REJECT.SAME_TIME]: '和原时间一样',
  [host.HOST_REJECT.FORMED_EARLIER]: '已成团的局只能往后改',
  bad_params: '参数无效',
  bad_content: `内容不能为空,且不超过 ${HOST_TOOLS.broadcastMaxLength} 字`,
  bad_reason: `原因不超过 ${HOST_TOOLS.cancelReasonMaxLength} 字`,
  risky: '这条内容不能发出',
  conflict: '局的状态刚刚变了,刷新后再试',
  blocked: '当前账号无法使用局主工具',
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    switch (event.action) {
      case 'roster':     return ok(await roster(event, OPENID))
      case 'broadcast':  return ok(await broadcast(event, OPENID))
      case 'reschedule': return ok(await reschedule(event, OPENID))
      case 'cancel':     return ok(await cancel(event, OPENID))
      default:           return fail('unknown_action', `未知操作: ${event.action}`)
    }
  } catch (e) {
    console.error('[host]', event.action, e)
    return fail(e.code || 'internal', e.message)
  }
}

/** 报名者名单:昵称 + 状态 + 靠谱度 + 爬约次数 */
async function roster({ eventId }, openid) {
  const { e } = await hostContext(eventId, openid)
  const signups = (await db.collection('signups')
    .where({ eventId: e._id, status: _.in(host.ROSTER_STATUSES) })
    .orderBy('createdAt', 'asc').limit(HOST_TOOLS.rosterQueryLimit).get()).data
  const ids = [...new Set(signups.map(s => s.userId))]
  // 查询层就只取需要的字段 —— phone/openid 连云函数内存都不进
  const users = ids.length
    ? (await db.collection('users').where({ _id: _.in(ids) })
      .field({ _id: true, nickname: true, reliability: true, noShowCount: true }).get()).data
    : []
  return {
    lastBroadcastAt: e.lastBroadcastAt || null,
    cooldownMinutes: HOST_TOOLS.broadcastCooldownMinutes,
    roster: host.buildRoster(signups, users),
  }
}

/** 群发:通知全部 confirmed 报名者,并作为一条消息落进群聊 */
async function broadcast({ eventId, content: raw }, openid) {
  const { me, e } = await hostContext(eventId, openid)
  const content = validString(raw, HOST_TOOLS.broadcastMaxLength)
  if (!content) throw reject('bad_content')

  const now = new Date().toISOString()
  const gate = host.canBroadcast({ lastBroadcastAt: e.lastBroadcastAt, now, status: e.status })
  if (!gate.allowed) throw reject(gate.reason)

  // 先审再占冷却:被拒的内容不该吃掉局主 10 分钟的额度
  const check = await moderate(content, openid)
  if (check.action === ACTION.REJECT) throw reject('risky')

  // 占冷却用 CAS:并发的两次群发都通过了 canBroadcast,只有一个能改写 lastBroadcastAt
  const claimed = await db.collection('events')
    .where({ _id: e._id, lastBroadcastAt: e.lastBroadcastAt ? e.lastBroadcastAt : _.eq(null) })
    .update({ data: { lastBroadcastAt: now } })
  if (!claimed.stats.updated) throw reject(host.HOST_REJECT.COOLDOWN)

  const msg = { eventId: e._id, userId: me._id, content, isBroadcast: true, createdAt: now }
  if (check.action === ACTION.FLAG) {
    msg.moderation = { suggest: check.suggest, label: check.label || null, error: check.error || null }
  }
  const added = await db.collection('messages').add({ data: msg })
  if (check.action === ACTION.FLAG) {
    await db.collection('reviewQueue').add({
      data: { type: 'message_flagged', messageId: added._id, eventId: e._id, userId: me._id,
              suggest: check.suggest, createdAt: now },
    }).catch(() => {})
  }

  const targets = await targetsOf(e._id, [SIGNUP_STATUS.CONFIRMED], me._id)
  for (const userId of targets) {
    await enqueue({
      userId, eventId: e._id, templateKey: 'host_broadcast', payload: { content },
      dedupeKey: host.broadcastDedupeKey({ userId, eventId: e._id, now }), now,
    })
  }
  const next = host.canBroadcast({ lastBroadcastAt: now, now })
  return { sent: targets.length, messageId: added._id, nextAllowedAt: next.nextAllowedAt }
}

/** 改期:状态不变,但成团判定时点随之移动,催报名重新计时 */
async function reschedule({ eventId, startAt }, openid) {
  const { me, e } = await hostContext(eventId, openid)
  const now = new Date().toISOString()
  const verdict = host.canReschedule({ event: e, newStartAt: startAt, now })
  if (!verdict.allowed) throw reject(verdict.reason)

  // CAS 于状态 + 原时间:防止与成团判定、另一次改期并发时覆盖对方的结果
  const r = await db.collection('events')
    .where({ _id: e._id, status: e.status, startAt: e.startAt })
    .update({ data: { startAt: verdict.startAt, rallyNoticeSentAt: null, rescheduledAt: now } })
  if (!r.stats.updated) throw reject('conflict')

  await logStatus(e._id, host.rescheduleLog({ event: e, newStartAt: verdict.startAt, now }))

  const targets = await targetsOf(e._id, [SIGNUP_STATUS.CONFIRMED, SIGNUP_STATUS.WAITLIST], me._id)
  for (const userId of targets) {
    await enqueue({
      userId, eventId: e._id, templateKey: 'event_rescheduled',
      payload: { oldStartAt: e.startAt, newStartAt: verdict.startAt },
      // 键里带新时间:同一个局改两次期,两次都必须通知到
      dedupeKey: `${userId}:${e._id}:event_rescheduled:${verdict.startAt}`, now,
    })
  }
  return { startAt: verdict.startAt, status: verdict.status, notified: targets.length }
}

/**
 * 局主取消整个局。语义同 events.cancel(D01:计入成团率分母且算未成团,由状态本身保证),
 * 补上原实现漏掉的参与者通知。
 * 封禁的局主仍可取消 —— 取消只会减少风险,拦住反而让可疑的局继续挂着。
 */
async function cancel({ eventId, reason: rawReason }, openid) {
  const { me, e } = await hostContext(eventId, openid, { allowBlocked: true })
  let reason = '局主取消'
  if (rawReason !== undefined && rawReason !== null && rawReason !== '') {
    const clean = validString(rawReason, HOST_TOOLS.cancelReasonMaxLength)
    if (!clean) throw reject('bad_reason')
    reason = `局主取消:${clean}`
  }
  if (!canTransition(e.status, STATUS.CANCELLED_HOST)) throw reject(host.HOST_REJECT.BAD_STATUS)

  const now = new Date().toISOString()
  const rec = transition(e.status, STATUS.CANCELLED_HOST, { reason, at: now })
  const r = await db.collection('events')
    .where({ _id: e._id, status: e.status })
    .update({ data: { status: rec.status, cancelledAt: now } })
  if (!r.stats.updated) throw reject('conflict')
  await logStatus(e._id, rec)

  const targets = await targetsOf(e._id, [SIGNUP_STATUS.CONFIRMED, SIGNUP_STATUS.WAITLIST], me._id)
  for (const userId of targets) {
    // 原因是局主自由文本,未过内容安全,只进日志不进通知
    await enqueue({
      userId, eventId: e._id, templateKey: 'event_cancelled_low', payload: { cause: 'host_cancel' },
      dedupeKey: `${userId}:${e._id}:host_cancel`, now,
    })
  }
  return { status: rec.status, notified: targets.length }
}

// ---- helpers ----

async function hostContext(eventId, openid, { allowBlocked = false } = {}) {
  const id = validString(eventId, LIMITS.id)
  if (!id) throw reject('bad_params')
  const me = await getUser(openid)
  if (!allowBlocked && isBlocked(me, 'host_tools', new Date().toISOString()).blocked) {
    throw reject('blocked')
  }
  const e = (await db.collection('events').doc(id).get().catch(() => ({ data: null }))).data
  if (!e) throw Object.assign(new Error('活动不存在'), { code: 'not_found' })
  if (!host.isHostOf(me, e)) throw reject(host.HOST_REJECT.FORBIDDEN)
  return { me, e }
}

async function targetsOf(eventId, statuses, excludeUserId) {
  const signups = (await db.collection('signups')
    .where({ eventId, status: _.in(statuses) })
    .limit(HOST_TOOLS.rosterQueryLimit).get()).data
  return host.notifyTargets(signups, statuses, excludeUserId)
}

async function enqueue({ userId, eventId, templateKey, payload, dedupeKey, now }) {
  await db.collection('notifications').add({
    data: {
      userId, eventId, templateKey, payload,
      channel: 'wx_subscribe', status: 'pending',
      dedupeKey, createdAt: now,
    },
  }).catch(() => { /* 唯一索引冲突即已入队,忽略 */ })
}

/** 同 chat 云函数:risky 拒绝,review/调用失败放行留痕 */
async function moderate(content, openid) {
  if (!needsCheck(content)) return { action: ACTION.PASS }
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content, version: 2, scene: 2, openid,   // scene 2 = 评论/聊天
    })
    return interpret(res)
  } catch (err) {
    console.warn('[host] msgSecCheck 调用失败,按降级策略放行并留痕', err && err.message)
    return onError(err)
  }
}

async function getUser(openid) {
  const r = await db.collection('users').where({ openid }).limit(1).get()
  if (!r.data.length) throw Object.assign(new Error('账号不存在'), { code: 'no_user' })
  return r.data[0]
}

async function logStatus(eventId, rec) {
  await db.collection('eventStatusLog').add({ data: { eventId, ...rec } })
}

function reject(code) {
  return Object.assign(new Error(REJECT_MESSAGE[code] || '无法操作'), { code })
}
