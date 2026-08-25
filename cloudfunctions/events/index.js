/**
 * 云函数 events —— 局的读写统一出口
 *
 * 【产品护城河的技术落点】
 * 本函数不提供、也永远不得提供任何「按人检索」的接口。
 * detail/list 一律只返回参与人数计数,绝不返回参与者身份 ——
 * 这是 PRD §5「只匹配活动不匹配人」在数据层的强制实现,
 * 不能靠前端不显示来保证。
 */
const cloud = require('wx-server-sdk')
const { STATUS, resolveInitialStatus, transition, PUBLISHED } = require('./common/state-machine')
const { SCENE_RULES } = require('./common/rules')
const { generate: generateShareCode } = require('./common/sharecode')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ok = data => ({ ok: true, data })
const fail = (code, message) => ({ ok: false, code, message })

/** 对外暴露的局字段白名单 —— 显式列出,防止将来加字段时误泄露 */
function publicEvent(e) {
  return {
    _id: e._id, sceneType: e.sceneType, startAt: e.startAt, durationMin: e.durationMin,
    venue: e.venue, capacityMin: e.capacityMin, capacityMax: e.capacityMax,
    shareCode: e.shareCode,
    priceEstTHB: e.priceEstTHB, description: e.description, status: e.status,
    confirmedCount: e.confirmedCount || 0,
    // 注意:此处没有、也不应有 signups / hostId / 参与者昵称头像等任何身份信息
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event
  try {
    switch (action) {
      case 'list':     return ok(await list(event))
      case 'detail':   return ok(await detail(event))
      case 'create':   return ok(await create(event, OPENID))
      case 'cancel':   return ok(await cancel(event, OPENID))
      case 'recommend':return ok(await recommend(event))
      case 'track':    return ok(await track(event, OPENID))
      default:         return fail('unknown_action', `未知操作: ${action}`)
    }
  } catch (e) {
    console.error('[events]', action, e)
    return fail(e.code || 'internal', e.message)
  }
}

/** 只返回已公开且未开始的局。待审/被拒的局对报名者完全不可见(D06)。 */
async function list() {
  const r = await db.collection('events')
    .where({ status: _.in([STATUS.OPEN, STATUS.FORMED]), startAt: _.gt(new Date().toISOString()) })
    .orderBy('startAt', 'asc').limit(50).get()
  return r.data.map(publicEvent)
}

/**
 * 按 _id 或分享短码取详情。
 * 小程序码扫入时带的是短码(scene 有 32 字符上限,放不下 _id),因此两种都要支持。
 */
async function detail({ eventId, shareCode }) {
  let doc = null
  if (shareCode) {
    const r = await db.collection('events').where({ shareCode }).limit(1).get()
    doc = r.data[0] || null
  } else if (eventId) {
    const r = await db.collection('events').doc(eventId).get().catch(() => null)
    doc = (r && r.data) || null
  }
  // 待审/被拒的局一律按「不存在」处理 —— 审核对报名者完全不可见(D06)
  if (!doc || !PUBLISHED.includes(doc.status)) {
    throw Object.assign(new Error('活动不存在'), { code: 'not_found' })
  }
  return publicEvent(doc)
}

/** 发局。初始状态由 D06 的全局开关与 D14 的局主免审白名单共同决定。 */
async function create(payload, openid) {
  const user = await getUser(openid)
  const rules = SCENE_RULES[payload.sceneType]
  if (!rules) throw Object.assign(new Error('未知场景类型'), { code: 'bad_scene' })

  const capacityMax = clamp(payload.capacityMax || rules.capacityMaxDefault, rules.capacityMin, rules.capacityHardMax)
  const settings = await getSettings()
  const status = resolveInitialStatus({ isHost: user.isHost, autoApprove: settings.autoApprove })
  const now = new Date().toISOString()

  const doc = {
    hostId: user._id,
    shareCode: generateShareCode(),   // 小程序码用;数据库加唯一索引兜底碰撞
    sceneType: payload.sceneType,
    venue: payload.venue,            // D09 自由输入:{name, address, lat, lng}
    startAt: payload.startAt,
    durationMin: rules.durationMinDefault,
    capacityMin: rules.capacityMin,  // D02 系统固定,不接受局主传入
    capacityMax,
    priceEstTHB: payload.priceEstTHB || rules.priceEstDefaultTHB,
    description: (payload.description || '').slice(0, 200),
    status,
    isOfficial: Boolean(user.isAdmin),
    adminFilledIn: false,
    confirmedCount: 0,
    // D01:只有真正公开过的局才计入成团率分母
    publishedAt: status === STATUS.OPEN ? now : null,
    createdAt: now,
  }
  const r = await db.collection('events').add({ data: doc })
  await logStatus(r._id, transition(STATUS.DRAFT, status, { reason: '发布', at: now }))
  return { eventId: r._id, status }
}

/** 局主取消。D01:计入成团率分母且算未成团,不给刷分留口子。 */
async function cancel({ eventId }, openid) {
  const user = await getUser(openid)
  const e = (await db.collection('events').doc(eventId).get()).data
  if (e.hostId !== user._id && !user.isAdmin) throw Object.assign(new Error('无权取消'), { code: 'forbidden' })
  const now = new Date().toISOString()
  const rec = transition(e.status, STATUS.CANCELLED_HOST, { reason: '局主取消', at: now })
  await db.collection('events').doc(eventId).update({ data: { status: rec.status, cancelledAt: now } })
  await logStatus(eventId, rec)
  return { status: rec.status }
}

/**
 * 报名成功页的推荐位(PRD §6 的留存关键动作)。
 * 排序:同场景 > 同时段 > 还差人数最少 —— 差得越少越容易促成。
 */
async function recommend({ eventId }) {
  const src = (await db.collection('events').doc(eventId).get()).data
  const r = await db.collection('events')
    .where({ _id: _.neq(eventId), status: STATUS.OPEN, startAt: _.gt(new Date().toISOString()) })
    .orderBy('startAt', 'asc').limit(20).get()

  const scored = r.data.map(e => {
    const short = Math.max(0, e.capacityMin - (e.confirmedCount || 0))
    const sameScene = e.sceneType === src.sceneType ? 0 : 1
    const sameDay = e.startAt.slice(0, 10) === src.startAt.slice(0, 10) ? 0 : 1
    return { e, key: [sameScene, sameDay, short] }
  })
  scored.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
  return scored.slice(0, 4).map(s => publicEvent(s.e))
}

/** 埋点。未登录也要记(anonId),否则算不出「链接打开→报名」转化率。 */
async function track({ name, props, anonId }, openid) {
  await db.collection('analyticsEvents').add({
    data: { name, props: props || {}, anonId: anonId || null, openid: openid || null, createdAt: new Date().toISOString() },
  })
  return { recorded: true }
}

// ---- helpers ----
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }

async function getUser(openid) {
  const r = await db.collection('users').where({ openid }).limit(1).get()
  if (!r.data.length) throw Object.assign(new Error('请先完成报名以创建账号'), { code: 'no_user' })
  return r.data[0]
}

async function getSettings() {
  const r = await db.collection('settings').doc('global').get().catch(() => null)
  return (r && r.data) || {}
}

async function logStatus(eventId, rec) {
  await db.collection('eventStatusLog').add({ data: { eventId, ...rec } })
}
