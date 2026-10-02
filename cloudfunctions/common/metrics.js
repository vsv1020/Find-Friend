/**
 * 指标计算 —— 见 docs/04 D01 / D12
 *
 * D01 口径:
 *   分母 = 审核通过并公开过的局(以 publishedAt 是否存在判定,排除 draft/pending_review/rejected)
 *   分子 = 判定时点报名数达标的局(formed / done / archived)
 *   局主自行取消(cancelled_host)计入分母且算未成团 —— 否则可以靠取消刷高成团率
 *
 * D12 双指标:
 *   保健指标 = 整体成团率(含官方局)
 *   真北极星 = 非官方局成团率(isOfficial=false 且管理员未补位)
 */
const { FORMED_STATES } = require('./state-machine')
const { METRICS, SIGNUP_STATUS } = require('./rules')
const { bangkokParts } = require('./schedule')

/** 是否计入成团率分母 */
function isCounted(event) {
  return Boolean(event.publishedAt)
}

/** 是否算作已成团 */
function isFormed(event) {
  return FORMED_STATES.includes(event.status)
}

/** 是否为「自然局」:非官方发起,且管理员未作为报名者补位 */
function isOrganic(event) {
  return event.isOfficial !== true && event.adminFilledIn !== true
}

/**
 * @param {object[]} events
 * @param {{organicOnly?:boolean}} opts
 * @returns {{total:number, formed:number, rate:number|null}} 无样本时 rate 为 null,不返回 0 以免误读
 */
function formationRate(events, { organicOnly = false } = {}) {
  const pool = events.filter(e => isCounted(e) && (!organicOnly || isOrganic(e)))
  const formed = pool.filter(isFormed).length
  return { total: pool.length, formed, rate: pool.length ? formed / pool.length : null }
}

/** D12 双指标快照,直接供运营看板使用 */
function northStar(events) {
  const overall = formationRate(events)
  const organic = formationRate(events, { organicOnly: true })
  return {
    overall: { ...overall, target: METRICS.formationRateTarget,
               met: overall.rate !== null && overall.rate >= METRICS.formationRateTarget },
    organic: { ...organic, target: METRICS.organicFormationRateTarget,
               met: organic.rate !== null && organic.rate >= METRICS.organicFormationRateTarget },
  }
}

/* ───────────── PRD §8 运营看板 ───────────── */

const DAY_MS = 24 * 3600 * 1000
const DAYS_PER_WEEK = 7

/** 与 miniprogram/utils/track.js 的 EVENTS 保持一致,改名必须两边同步 */
const FUNNEL = {
  VIEW: 'event_detail_view',
  START: 'signup_start',
  SUCCESS: 'signup_success',
}

const toMs = t => new Date(t).getTime()

/** 曼谷自然日序号(自 1970-01-01 起的天数)。换算复用 schedule.js,不依赖运行环境时区 */
function bangkokDay(t) {
  const p = bangkokParts(t)
  return Date.UTC(p.year, p.month, p.day) / DAY_MS
}

/** 所在周(周一起始)的周一日序号 —— 中文语境下周日是一周的最后一天 */
function bangkokWeekStartDay(t) {
  const mondayIndex = (bangkokParts(t).weekday + 6) % DAYS_PER_WEEK
  return bangkokDay(t) - mondayIndex
}

const dayToDate = day => new Date(day * DAY_MS).toISOString().slice(0, 10)

const withTarget = (metric, value, target) => ({ ...metric, target, met: value !== null && value >= target })

/**
 * 访客去重键:优先 openid,否则 anonId。
 *
 * ⚠️ 已知口径:同一个人若先以 anonId 记录、后以 openid 记录,会被算作两个访客,
 *    因为埋点里没有 anonId↔openid 的映射。小程序内调用云函数时 OPENID 总会被注入,
 *    所以实际上绝大多数埋点都带 openid,anonId 只是兜底。
 */
function visitorKey(ev) {
  if (ev.openid) return `o:${ev.openid}`
  if (ev.anonId) return `a:${ev.anonId}`
  return null
}

/**
 * 报名漏斗:详情页浏览 → 开始报名 → 报名成功,按去重访客计。
 *
 * 后两级只要求「浏览过」,不要求经过上一级:signup_start 是即发即弃的埋点,
 * 丢一条就会把一次真实报名从核心转化率里抹掉。要求浏览过是为了让比率不超过 1 ——
 * 否则窗口外浏览、窗口内报名的访客只进分子不进分母。
 *
 * @param {{name:string, anonId?:string, openid?:string}[]} analyticsEvents
 * @returns {{views:number, starts:number, successes:number, viewToSignupRate:number|null}}
 */
function signupFunnel(analyticsEvents) {
  const seen = { [FUNNEL.VIEW]: new Set(), [FUNNEL.START]: new Set(), [FUNNEL.SUCCESS]: new Set() }
  for (const ev of analyticsEvents) {
    const key = visitorKey(ev)
    if (key && seen[ev.name]) seen[ev.name].add(key)
  }
  const views = seen[FUNNEL.VIEW]
  const countViewed = set => [...set].filter(k => views.has(k)).length
  const successes = countViewed(seen[FUNNEL.SUCCESS])
  return {
    views: views.size,
    starts: countViewed(seen[FUNNEL.START]),
    successes,
    viewToSignupRate: views.size ? successes / views.size : null,
  }
}

/**
 * 30 天二次参加率:首次 attended 后 windowDays 个曼谷自然日内(含第 windowDays 天)再次 attended。
 *
 * 首次参加距今还不满窗口的用户记为 pending、不进分母 —— 他们的结果还没揭晓,
 * 计入分母会让新用户多的阶段系统性偏低;只把已复购的提前计入分子又会偏高。
 *
 * @param {{userId:string, status:string, createdAt:string}[]} signups
 * @returns {{users:number, repeaters:number, pending:number, rate:number|null}}
 */
function repeatParticipation(signups, { now = new Date(), windowDays = METRICS.repeatWindowDays } = {}) {
  const nowMs = toMs(now)
  const byUser = new Map()
  for (const s of signups) {
    if (s.status !== SIGNUP_STATUS.ATTENDED || !s.userId || !(s.attendedAt || s.createdAt)) continue
    // 复购看的是「参加」间隔,不是「报名」间隔:attendedAt 在局主标记或归档兜底时写入;
    // 老数据没有该字段时退回报名时间,误差最多是报名到活动的几天
    const t = toMs(s.attendedAt || s.createdAt)
    if (t > nowMs) continue
    if (!byUser.has(s.userId)) byUser.set(s.userId, [])
    byUser.get(s.userId).push(t)
  }

  const today = bangkokDay(nowMs)
  let users = 0, repeaters = 0, pending = 0
  for (const times of byUser.values()) {
    times.sort((a, b) => a - b)
    const firstDay = bangkokDay(times[0])
    if (today - firstDay <= windowDays) { pending++; continue }
    users++
    if (times.slice(1).some(t => bangkokDay(t) - firstDay <= windowDays)) repeaters++
  }
  return { users, repeaters, pending, rate: users ? repeaters / users : null }
}

/**
 * 最近 N 周(曼谷时间,周一起始)的局数趋势,按时间升序。
 *
 * 按活动开始时间归周(缺失时退回 publishedAt):周末局的「公开」和「成团」
 * 可能跨周发生,按同一个时间归档才能让同一行的 formed/published 可比。
 * organic = 非官方发起的局(isOfficial !== true),与 organicHostShare 同口径,不剔除补位。
 * 本周的局多数尚未到判定时点,formed 偏低是正常的。
 *
 * @returns {{weekStart:string, published:number, formed:number, organic:number}[]}
 */
function weeklyEventCounts(events, { weeks = METRICS.trendWeeks, now = new Date() } = {}) {
  const firstWeek = bangkokWeekStartDay(now) - (weeks - 1) * DAYS_PER_WEEK
  const rows = Array.from({ length: weeks }, (_, i) => ({
    weekStart: dayToDate(firstWeek + i * DAYS_PER_WEEK), published: 0, formed: 0, organic: 0,
  }))
  for (const e of events) {
    if (!isCounted(e)) continue
    const at = e.startAt || e.publishedAt
    const idx = (bangkokWeekStartDay(at) - firstWeek) / DAYS_PER_WEEK
    if (idx < 0 || idx >= weeks) continue
    const row = rows[idx]
    row.published++
    if (isFormed(e)) row.formed++
    if (e.isOfficial !== true) row.organic++
  }
  return rows
}

/**
 * 非官方局占比(docs/02 §7「非 Victor 发起的局占比」)。
 * 分母同 D01 只算公开过的局;这里衡量的是「谁在发局」,所以管理员补位的局仍算非官方。
 */
function organicHostShare(events) {
  const pool = events.filter(isCounted)
  const organic = pool.filter(e => e.isOfficial !== true).length
  return { total: pool.length, organic, share: pool.length ? organic / pool.length : null }
}

/** PRD §8 四个指标 + 趋势。只输出聚合数字,不含任何用户标识。 */
function dashboard({ events = [], signups = [], analyticsEvents = [], now = new Date() } = {}) {
  const since = toMs(now) - METRICS.funnelLookbackDays * DAY_MS
  const recent = analyticsEvents.filter(ev => ev.createdAt && toMs(ev.createdAt) >= since)

  const funnel = signupFunnel(recent)
  const repeat = repeatParticipation(signups, { now })
  const share = organicHostShare(events)
  return {
    ...northStar(events),
    funnel: { ...withTarget(funnel, funnel.viewToSignupRate, METRICS.signupConversionRateTarget),
              lookbackDays: METRICS.funnelLookbackDays },
    repeat: { ...withTarget(repeat, repeat.rate, METRICS.repeatParticipationRateTarget),
              windowDays: METRICS.repeatWindowDays },
    organicHostShare: withTarget(share, share.share, METRICS.organicHostShareTarget),
    weekly: weeklyEventCounts(events, { now }),
  }
}

module.exports = {
  formationRate, northStar, isCounted, isFormed, isOrganic,
  signupFunnel, repeatParticipation, weeklyEventCounts, organicHostShare, dashboard,
  FUNNEL,
}
