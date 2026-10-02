/**
 * 云函数 report —— 举报入口(T22)
 *
 * 举报门槛低(一次点击),处理门槛高(只有管理员能封禁,在 admin 云函数里)。
 * 校验逻辑在 common/report.js(纯函数,有测试)。
 */
const cloud = require('wx-server-sdk')
const { canReport, dedupeKey, isBlocked, REPORT_TARGET, REPORT_REJECT } = require('./common/report')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ok = d => ({ ok: true, data: d })
const fail = (code, message) => ({ ok: false, code, message })

const REJECT_MESSAGE = {
  [REPORT_REJECT.BAD_REASON]: '请选择举报原因',
  [REPORT_REJECT.BAD_TARGET]: '无法举报该对象',
  [REPORT_REJECT.SELF]: '不能举报自己的内容',
  [REPORT_REJECT.DUPLICATE]: '你已经举报过了,我们会处理',
  [REPORT_REJECT.RATE_LIMITED]: '今天举报次数已达上限',
  [REPORT_REJECT.DETAIL_TOO_LONG]: '描述太长了',
  banned: '当前账号无法执行该操作',
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    if (event.action !== 'create') return fail('unknown_action', `未知操作: ${event.action}`)
    return ok(await create(event, OPENID))
  } catch (e) {
    console.error('[report]', e)
    return fail(e.code || 'internal', e.message)
  }
}

async function create({ targetType, targetId, reason, detail }, openid) {
  const now = new Date().toISOString()
  const me = await getUser(openid)

  const block = isBlocked(me, 'report', now)
  if (block.blocked) throw reject('banned')

  // 解析目标归属,用于判定「举报自己」与后台展示上下文
  const target = await resolveTarget(targetType, targetId)
  if (!target) throw reject(REPORT_REJECT.BAD_TARGET)

  const key = dedupeKey({ reporterId: me._id, targetType, targetId })
  const [dup, today] = await Promise.all([
    db.collection('reports').where({ dedupeKey: key }).count(),
    db.collection('reports').where({
      reporterId: me._id,
      createdAt: _.gt(new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    }).count(),
  ])

  const verdict = canReport({
    reason, targetType, detail,
    isSelfTarget: target.ownerId === me._id,
    alreadyReported: dup.total > 0,
    todayCount: today.total,
  })
  if (!verdict.allowed) throw reject(verdict.reason)

  const doc = {
    reporterId: me._id, targetType, targetId,
    targetOwnerId: target.ownerId || null,
    reason, detail: String(detail || '').slice(0, 400),
    context: target.context,          // 快照:被举报时的内容,防事后修改毁证
    status: 'open',                   // open | resolved | dismissed
    dedupeKey: key, createdAt: now,
  }
  const added = await db.collection('reports').add({ data: doc })

  // 同步进统一复核队列,和内容安全命中、重复爽约走同一个后台入口
  await db.collection('reviewQueue').add({
    data: { type: 'user_report', reportId: added._id, targetType, targetId,
            reason, createdAt: now },
  }).catch(() => {})

  return { reported: true }
}

/** 取目标的归属者与内容快照。找不到返回 null。 */
async function resolveTarget(targetType, targetId) {
  if (targetType === REPORT_TARGET.EVENT) {
    const e = (await db.collection('events').doc(targetId).get().catch(() => ({ data: null }))).data
    if (!e) return null
    return { ownerId: e.hostId, context: { description: e.description, venue: e.venue && e.venue.name, startAt: e.startAt } }
  }
  if (targetType === REPORT_TARGET.MESSAGE) {
    const m = (await db.collection('messages').doc(targetId).get().catch(() => ({ data: null }))).data
    if (!m) return null
    return { ownerId: m.userId, context: { content: m.content, eventId: m.eventId } }
  }
  if (targetType === REPORT_TARGET.USER) {
    const u = (await db.collection('users').doc(targetId).get().catch(() => ({ data: null }))).data
    if (!u) return null
    return { ownerId: u._id, context: { nickname: u.nickname } }
  }
  return null
}

async function getUser(openid) {
  const r = await db.collection('users').where({ openid }).limit(1).get()
  if (!r.data.length) throw Object.assign(new Error('账号不存在'), { code: 'no_user' })
  return r.data[0]
}

function reject(reason) {
  return Object.assign(new Error(REJECT_MESSAGE[reason] || '无法举报'), { code: reason })
}
