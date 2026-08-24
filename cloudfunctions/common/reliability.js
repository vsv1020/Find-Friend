/**
 * 爬约计数与处罚 —— 见 docs/04 D10
 *
 * 记录只对局主可见(报名者列表中显示靠谱度),不向其他参与者公开 ——
 * 公开会制造评判感,与产品调性冲突。
 */
const { NO_SHOW, EVENT_STATUS, RELIABILITY_MARK } = require('./rules')

const HOUR = 3600 * 1000

/**
 * 判断一次取消是否计为爬约。
 * open 状态下取消不算 —— 鼓励尽早取消,把位置让出来。
 * @param {string} eventStatus 取消发生时该局的状态
 */
function cancellationCounts(eventStatus) {
  if (eventStatus === EVENT_STATUS.OPEN) return NO_SHOW.countCancelBeforeFormed
  if (eventStatus === EVENT_STATUS.FORMED) return NO_SHOW.countCancelAfterFormed
  return false
}

/** 局主活动后标记「未到场」是否计为爬约 */
function markCounts(mark) {
  return mark === RELIABILITY_MARK.NO_SHOW && NO_SHOW.countNoShow
}

/**
 * 根据累计爬约次数计算用户状态。
 * @param {number} count 累计爬约次数
 * @param {string|Date} now
 * @returns {{status:string, restrictedUntil:string|null, needsManualReview:boolean}}
 */
function applyPenalty(count, now) {
  const needsManualReview = count >= NO_SHOW.manualReviewThreshold
  if (count >= NO_SHOW.restrictThreshold) {
    const until = new Date(new Date(now).getTime() + NO_SHOW.restrictDays * 24 * HOUR)
    return { status: 'restricted', restrictedUntil: until.toISOString(), needsManualReview }
  }
  return { status: 'active', restrictedUntil: null, needsManualReview }
}

module.exports = { cancellationCounts, markCounts, applyPenalty }
