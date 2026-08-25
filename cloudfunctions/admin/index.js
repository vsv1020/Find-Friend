/**
 * 云函数 admin —— 运营后台
 *
 * 目标(PRD §9「前三个月本质是人肉运营」):把每日操作压到 15 分钟内。
 * 所有接口都做管理员校验;审核结果对报名者不可见(D06)。
 */
const cloud = require('wx-server-sdk')
const { STATUS, transition } = require('./common/state-machine')
const { northStar } = require('./common/metrics')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ok = d => ({ ok: true, data: d })
const fail = (code, message) => ({ ok: false, code, message })

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const admin = await requireAdmin(OPENID)
    switch (event.action) {
      case 'pendingReviews':  return ok(await pendingReviews())
      case 'review':          return ok(await review(event, admin))
      case 'setAutoApprove':  return ok(await setAutoApprove(event))
      case 'setHost':         return ok(await setHost(event))
      case 'metrics':         return ok(await metrics())
      case 'openReports':     return ok(await openReports())
      case 'resolveReport':   return ok(await resolveReport(event, admin))
      case 'banUser':         return ok(await banUser(event, admin))
      case 'unbanUser':       return ok(await unbanUser(event))
      case 'takedownEvent':   return ok(await takedownEvent(event, admin))
      default:                return fail('unknown_action', `未知操作: ${event.action}`)
    }
  } catch (e) {
    console.error('[admin]', event.action, e)
    return fail(e.code || 'internal', e.message)
  }
}

async function pendingReviews() {
  return (await db.collection('events')
    .where({ status: STATUS.PENDING_REVIEW })
    .orderBy('createdAt', 'asc').limit(50).get()).data
}

/** 审核一个局 ≤ 3 次点击的后端支撑:一次调用完成流转 + 公开时间戳 */
async function review({ eventId, approved, note }, admin) {
  const e = (await db.collection('events').doc(eventId).get()).data
  const now = new Date().toISOString()
  const target = approved ? STATUS.OPEN : STATUS.REJECTED
  const rec = transition(e.status, target, { reason: note || (approved ? '审核通过' : '审核拒绝'), at: now })

  await db.collection('events').doc(eventId).update({
    data: {
      status: rec.status,
      reviewedBy: admin._id, reviewedAt: now, reviewNote: note || '',
      // D01:只有真正公开才写 publishedAt,被拒的局不计入成团率分母
      ...(approved ? { publishedAt: now } : {}),
    },
  })
  await db.collection('eventStatusLog').add({ data: { eventId, ...rec } })
  return { status: rec.status }
}

/** D06 全局自动审核开关 —— 运行时切换,不需要发版 */
async function setAutoApprove({ on }) {
  await db.collection('settings').doc('global')
    .set({ data: { autoApprove: Boolean(on), updatedAt: new Date().toISOString() } })
  return { autoApprove: Boolean(on) }
}

/** D14「给权限不给钱」:授予/回收局主权限。权限可回收,比追回补贴容易。 */
async function setHost({ userId, isHost }) {
  await db.collection('users').doc(userId).update({ data: { isHost: Boolean(isHost) } })
  return { userId, isHost: Boolean(isHost) }
}

/** D12 双指标看板 */
async function metrics() {
  const events = (await db.collection('events').where({ publishedAt: _.neq(null) }).limit(1000).get()).data
  const settings = await db.collection('settings').doc('global').get().catch(() => null)
  return {
    ...northStar(events),
    autoApprove: Boolean(settings && settings.data && settings.data.autoApprove),
  }
}

/** 待处理的举报,含被举报时的内容快照 */
async function openReports() {
  return (await db.collection('reports')
    .where({ status: 'open' }).orderBy('createdAt', 'asc').limit(50).get()).data
}

/**
 * 处理举报:resolved(成立,已处置)或 dismissed(不成立)。
 * 处置动作(封禁/下架)是独立操作 —— 一次举报可能触发多个处置,也可能只是记录在案。
 */
async function resolveReport({ reportId, outcome, note }, admin) {
  if (!['resolved', 'dismissed'].includes(outcome)) {
    throw Object.assign(new Error('outcome 必须是 resolved 或 dismissed'), { code: 'bad_outcome' })
  }
  await db.collection('reports').doc(reportId).update({
    data: { status: outcome, handledBy: admin._id, handledAt: new Date().toISOString(), handleNote: note || '' },
  })
  return { reportId, outcome }
}

/**
 * 封禁:账号级,全部动作被阻止(common/report.js isBlocked 的单一出口)。
 * 保留个人信息(处理纠纷需要)—— 删除个人信息走注销,是用户自己的权利。
 * 同时取消其未开始的报名与未开始的局,不让被封的人还挂在别人的局里。
 */
async function banUser({ userId, note }, admin) {
  const now = new Date().toISOString()
  await db.collection('users').doc(userId).update({
    data: { status: 'banned', bannedBy: admin._id, bannedAt: now, banNote: note || '' },
  })

  // 取消其未开始的报名
  const upcoming = (await db.collection('signups')
    .where({ userId, status: _.in(['confirmed', 'waitlist']) }).limit(100).get()).data
  for (const s of upcoming) {
    const e = (await db.collection('events').doc(s.eventId).get().catch(() => ({ data: null }))).data
    if (!e || new Date(e.startAt) <= new Date(now)) continue
    if (s.isHostSignup) continue   // 他当局主的局走下面整体下架
    await db.collection('signups').doc(s._id).update({ data: { status: 'cancelled', cancelledAt: now } })
    if (s.status === 'confirmed') {
      await db.collection('events').doc(s.eventId).update({ data: { confirmedCount: _.inc(-1) } })
    }
  }

  // 下架其未开始的局
  const hisEvents = (await db.collection('events')
    .where({ hostId: userId, status: _.in([STATUS.OPEN, STATUS.FORMED, STATUS.PENDING_REVIEW]) })
    .limit(50).get()).data
  for (const e of hisEvents) {
    await doTakedown(e, admin, `局主被封禁: ${note || ''}`, now)
  }
  return { userId, banned: true, cancelledSignups: upcoming.length, takedownEvents: hisEvents.length }
}

async function unbanUser({ userId }) {
  await db.collection('users').doc(userId).update({
    data: { status: 'active', unbannedAt: new Date().toISOString() },
  })
  return { userId, banned: false }
}

/** 下架一个局(虚假活动、钓鱼地址等)。参与者会收到解散通知。 */
async function takedownEvent({ eventId, note }, admin) {
  const e = (await db.collection('events').doc(eventId).get()).data
  await doTakedown(e, admin, note || '管理员下架', new Date().toISOString())
  return { eventId, takedown: true }
}

async function doTakedown(e, admin, reason, now) {
  const target = e.status === STATUS.PENDING_REVIEW ? STATUS.REJECTED : STATUS.CANCELLED_HOST
  const rec = transition(e.status, target, { reason: `[下架] ${reason}`, at: now })
  await db.collection('events').doc(e._id).update({
    data: { status: rec.status, cancelledAt: now, takedownBy: admin._id },
  })
  await db.collection('eventStatusLog').add({ data: { eventId: e._id, ...rec } })
  // 通知已报名者(复用解散模板)
  const signups = (await db.collection('signups')
    .where({ eventId: e._id, status: _.in(['confirmed', 'waitlist']) }).limit(100).get()).data
  for (const s of signups) {
    await db.collection('notifications').add({
      data: { userId: s.userId, eventId: e._id, templateKey: 'event_cancelled_low',
              channel: 'wx_subscribe', status: 'pending',
              dedupeKey: `${s.userId}:${e._id}:takedown`, createdAt: now },
    }).catch(() => {})
  }
}

async function requireAdmin(openid) {
  const r = await db.collection('users').where({ openid, isAdmin: true }).limit(1).get()
  if (!r.data.length) throw Object.assign(new Error('无权访问'), { code: 'forbidden' })
  return r.data[0]
}
