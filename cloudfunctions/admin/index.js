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

async function requireAdmin(openid) {
  const r = await db.collection('users').where({ openid, isAdmin: true }).limit(1).get()
  if (!r.data.length) throw Object.assign(new Error('无权访问'), { code: 'forbidden' })
  return r.data[0]
}
