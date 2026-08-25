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

// ============================================================
// 靠谱度评价(T18)—— 见 docs/04 D10、PRD §5 结构层第四条
// ============================================================

/**
 * ⚠️ 必须分清的两件事,混在一起会出大问题:
 *
 *   【事实认定】局主活动后标记「到场 / 未到场」
 *       → 影响 noShowCount 与限制报名(D10 的处罚阶梯)
 *       → 权威来源唯一:局主。因为只有他在现场。
 *
 *   【主观评价】参与者之间互评「准时 / 迟到 / 放鸽子」
 *       → 只影响 reliability 分数,**绝不触发任何处罚**
 *       → 若让互评也能触发封禁,两个人互相报复评价就能把对方送进人工复核
 *
 * 这条边界写在代码里,不靠人记住。
 */

/** 各评价对靠谱度分的影响。准时给正分,让长期靠谱的人能把分数养回来。 */
const SCORE_DELTA = {
  [RELIABILITY_MARK.ON_TIME]: +2,
  [RELIABILITY_MARK.LATE]: -5,
  [RELIABILITY_MARK.NO_SHOW]: -20,
}

const SCORE_MIN = 0
const SCORE_MAX = 100

/** 活动结束后多久内可以评价。过期不可评 —— 隔太久的记忆不可靠,也避免翻旧账。 */
const RATING_WINDOW_DAYS = 7

/** 单条评价对分数的影响 */
function scoreDelta(mark) {
  return SCORE_DELTA[mark] || 0
}

/**
 * 应用一批评价,得到新的靠谱度分。
 * @param {number} current 当前分数
 * @param {string[]} marks
 */
function applyMarks(current, marks) {
  const raw = marks.reduce((acc, m) => acc + scoreDelta(m), current)
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, raw))
}

const RATE_REJECT = {
  NOT_ENDED: 'not_ended',
  WINDOW_CLOSED: 'window_closed',
  SELF: 'self',
  NOT_PARTICIPANT: 'not_participant',
  DUPLICATE: 'duplicate',
  BAD_MARK: 'bad_mark',
}

/**
 * 能否评价。
 * @param {object} p
 * @param {object} p.event        {status, endedAt}
 * @param {boolean} p.raterAttended  评价者本人是否参加了该局
 * @param {boolean} p.rateeInEvent   被评价者是否在该局
 * @param {boolean} p.alreadyRated
 * @param {boolean} p.isSelf
 * @param {string} p.mark
 * @param {string} p.now
 */
function canRate({ event, raterAttended, rateeInEvent, alreadyRated, isSelf, mark, now }) {
  if (!SCORE_DELTA[mark]) return { allowed: false, reason: RATE_REJECT.BAD_MARK }
  if (isSelf) return { allowed: false, reason: RATE_REJECT.SELF }
  // 只有真正结束的局才能评 —— 解散的局没人见过面,无从评起
  if (!event.endedAt) return { allowed: false, reason: RATE_REJECT.NOT_ENDED }
  if (!raterAttended || !rateeInEvent) return { allowed: false, reason: RATE_REJECT.NOT_PARTICIPANT }
  if (alreadyRated) return { allowed: false, reason: RATE_REJECT.DUPLICATE }

  const deadline = new Date(event.endedAt).getTime() + RATING_WINDOW_DAYS * 24 * HOUR
  if (new Date(now).getTime() > deadline) return { allowed: false, reason: RATE_REJECT.WINDOW_CLOSED }

  return { allowed: true, reason: 'ok' }
}

/**
 * 局主未做任何标记时的默认处理。
 *
 * 默认**全部视为到场**,不扣任何人的分。
 * 宁可漏判不误判 —— 早期用户基数小,错封一个人的代价远大于放过一次爽约。
 */
function defaultAttendance(signups) {
  return signups.map(s => ({ userId: s.userId, mark: RELIABILITY_MARK.ON_TIME, defaulted: true }))
}

module.exports = Object.assign(module.exports, {
  scoreDelta, applyMarks, canRate, defaultAttendance,
  SCORE_DELTA, SCORE_MIN, SCORE_MAX, RATING_WINDOW_DAYS, RATE_REJECT,
})
