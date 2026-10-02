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
const { interpret, onError, needsCheck, ACTION } = require('./common/moderation')
const { hostInitialSignup } = require('./common/signup')
const { isBlocked } = require('./common/report')
const { publicEvent, viewerOf } = require('./common/projection')
const { validateEventPayload, validString, LIMITS } = require('./common/validate')
const reviewer = require('./common/reviewer')
const { REVIEW } = require('./common/rules')
const ADAPTERS = { deepseek: require('./adapters/deepseek'), jev: require('./adapters/jev') }

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ok = data => ({ ok: true, data })
const fail = (code, message) => ({ ok: false, code, message })


exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action } = event
  try {
    switch (action) {
      case 'list':     return ok(await list(event))
      case 'detail':   return ok(await detail(event, OPENID))
      case 'create':   return ok(await create(event, OPENID))
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
async function detail({ eventId: rawId, shareCode: rawCode }, openid) {
  const shareCode = validString(rawCode, LIMITS.id)
  const eventId = validString(rawId, LIMITS.id)
  let doc = null
  if (shareCode) {
    const r = await db.collection('events').where({ shareCode }).limit(1).get()
    doc = r.data[0] || null
  } else if (eventId) {
    const r = await db.collection('events').doc(eventId).get().catch(() => null)
    doc = (r && r.data) || null
  }
  if (!doc) throw Object.assign(new Error('活动不存在'), { code: 'not_found' })
  // viewer 拼在白名单投影之外,只对调用者本人有意义
  const viewer = await viewerFor(doc, openid)
    .catch(() => viewerOf({ user: null, event: doc, signup: null }))
  // 待审/被拒的局对报名者完全不可见(D06),按「不存在」处理;
  // 但局主本人必须能看到「审核中」,否则不知道自己的局为什么没出现
  if (!PUBLISHED.includes(doc.status) && !viewer.isHost) {
    throw Object.assign(new Error('活动不存在'), { code: 'not_found' })
  }
  return { ...publicEvent(doc), viewer }
}

/** 未登录/无账号不是错误 —— 局详情必须未登录可浏览 */
async function viewerFor(doc, openid) {
  if (!openid) return viewerOf({ user: null, event: doc, signup: null })
  const user = (await db.collection('users').where({ openid }).limit(1)
    .field({ _id: true }).get()).data[0] || null
  if (!user) return viewerOf({ user: null, event: doc, signup: null })
  const signup = (await db.collection('signups').where({ eventId: doc._id, userId: user._id })
    .limit(1).field({ status: true }).get()).data[0] || null
  return viewerOf({ user, event: doc, signup })
}

/** 发局。初始状态由 D06 的全局开关与 D14 的局主免审白名单共同决定。 */
async function create(payload, openid) {
  const user = await getUser(openid)
  if (isBlocked(user, 'create_event', new Date().toISOString()).blocked) {
    throw Object.assign(new Error('当前账号无法发布活动'), { code: 'blocked' })
  }
  // 载荷先过校验;此后只允许使用清洗后的 checked.value(见 common/validate.js)
  const checked = validateEventPayload(payload, new Date().toISOString())
  if (!checked.ok) {
    throw Object.assign(new Error(`参数无效: ${checked.errors.join(', ')}`), { code: 'bad_payload' })
  }
  const clean = checked.value
  const rules = SCENE_RULES[clean.sceneType]

  // T28:发局文案会出现在公开列表页,传播面大于群聊消息 ——
  // 因此这里 risky 直接拒绝,不走群聊那套「放行并标记」的降级(见 common/moderation.js 的说明)
  if (needsCheck(clean.description)) {
    let check
    try {
      check = interpret(await cloud.openapi.security.msgSecCheck({
        content: clean.description, version: 2, scene: 4, openid,   // scene 4 = 社交日志
      }))
    } catch (err) {
      check = onError(err)
    }
    if (check.action === ACTION.REJECT) {
      throw Object.assign(new Error('这段说明不能发布,改一下'), { code: 'description_risky' })
    }
  }

  const settings = await getSettings()
  const status = resolveInitialStatus({ isHost: user.isHost, autoApprove: settings.autoApprove })
  const now = new Date().toISOString()

  const doc = {
    hostId: user._id,
    shareCode: generateShareCode(),   // 小程序码用;数据库加唯一索引兜底碰撞
    sceneType: clean.sceneType,
    venue: clean.venue,              // 已校验:name/address 限长,lat/lng 数值范围
    startAt: clean.startAt,          // 已校验:ISO、未过近、未过远
    durationMin: rules.durationMinDefault,
    capacityMin: rules.capacityMin,  // D02 系统固定,不接受局主传入
    capacityMax: clean.capacityMax,
    priceEstTHB: clean.priceEstTHB,
    description: clean.description,
    status,
    isOfficial: Boolean(user.isAdmin),
    adminFilledIn: false,
    // 从 1 起:局主本人算一个。D02 的最低成团人数含局主。
    confirmedCount: 1,
    genderCounts: { [user.gender]: 1 },
    // D01:只有真正公开过的局才计入成团率分母
    publishedAt: status === STATUS.OPEN ? now : null,
    createdAt: now,
  }
  const r = await db.collection('events').add({ data: doc })
  // 局主自己的报名记录 —— 见 common/signup.js hostInitialSignup 的说明
  await db.collection('signups').add({
    data: hostInitialSignup({ eventId: r._id, hostId: user._id, gender: user.gender, now }),
  })
  await logStatus(r._id, transition(STATUS.DRAFT, status, { reason: '发布', at: now }))

  // AI 辅助预审(docs/09):顾问不是法官。任何失败都降级为未评审,不影响发布主流程。
  const finalStatus = await aiPrecheck(r._id, clean, status, settings, now)
  return { eventId: r._id, status: finalStatus }
}

/**
 * 模式取 settings.global.aiPrecheck,运营后台可切,不需要发版。
 * provider 并行调用(DeepSeek 主评、Jev 第二意见),结果经 reviewer.combine 合并:不一致即交人工。
 * advisory:只把建议写进 reviewQueue;gate:合并结果高置信 pass 且局正待审时自动放行。
 * 任何模式下模型的 reject 都只是进队列 —— reviewer.decide 里没有让它生效的路径。
 */
async function aiPrecheck(eventId, clean, status, settings, now) {
  const mode = settings.aiPrecheck || REVIEW.aiPrecheck
  if (mode === reviewer.MODE.OFF) return status

  const active = REVIEW.aiProviders.map(n => ADAPTERS[n]).filter(a => a && a.available())
  if (!active.length) {
    console.warn('[events] AI 预审已开启但没有可用 provider(缺少密钥),跳过')
    return status
  }

  const entries = await Promise.all(active.map(async adapter => {
    try {
      const opts = { timeoutMs: REVIEW.aiPrecheckTimeoutMs }
      const result = adapter.name === 'jev'
        ? reviewer.interpretJev(await adapter.review(reviewer.buildJevQuestions(clean), opts))
        : reviewer.interpret(await adapter.review(reviewer.buildReviewInput(clean), opts))
      return { provider: adapter.name, result }
    } catch (err) {
      console.warn(`[events] ${adapter.name} 预审失败,降级为未评审`, err && err.message)
      return { provider: adapter.name, result: reviewer.onError(err) }
    }
  }))

  const merged = reviewer.combine(entries)
  const action = reviewer.decide(merged, mode)

  await db.collection('reviewQueue').add({
    data: { type: 'ai_precheck', eventId, mode, action,
            verdict: merged.verdict, riskFlags: merged.riskFlags, reasons: merged.reasons,
            confidence: merged.confidence, agreement: merged.agreement, providers: merged.providers,
            createdAt: now },
  }).catch(() => {})
  await db.collection('events').doc(eventId).update({
    data: { aiReview: { verdict: merged.verdict, riskFlags: merged.riskFlags,
                        confidence: merged.confidence, agreement: merged.agreement, at: now } },
  }).catch(() => {})

  if (action === 'publish' && status === STATUS.PENDING_REVIEW) {
    const rec = transition(STATUS.PENDING_REVIEW, STATUS.OPEN, { reason: '[AI gate] 双模型高置信通过', at: now })
    // CAS:只在仍待审时放行,防止与管理员手动审核并发
    const upd = await db.collection('events').where({ _id: eventId, status: STATUS.PENDING_REVIEW })
      .update({ data: { status: rec.status, publishedAt: now } })
    if (upd.stats.updated) { await logStatus(eventId, rec); return STATUS.OPEN }
  }
  return status
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
