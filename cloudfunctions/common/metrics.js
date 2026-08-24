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
const { METRICS } = require('./rules')

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

module.exports = { formationRate, northStar, isCounted, isFormed, isOrganic }
