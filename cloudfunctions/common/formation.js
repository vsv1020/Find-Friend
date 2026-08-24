/**
 * 成团判定 —— 见 docs/04 D04 / D05
 *
 * ⚠️ 必须幂等:定时任务每 15 分钟扫描一次,重复执行不得重复发通知、不得重复流转。
 * 幂等性由「先查当前状态 + rallyNoticeSentAt 标记」保证,本模块只做纯判断。
 */
const { FORMATION, SCENE_RULES } = require('./rules')
const { STATUS, SIGNUP_OPEN_STATES } = require('./state-machine')

const HOUR = 3600 * 1000

/** 该场景的最低成团人数(含局主,见 D02) */
function capacityMin(sceneType) {
  const r = SCENE_RULES[sceneType]
  if (!r) throw new Error(`未知场景类型: ${sceneType}`)
  return r.capacityMin
}

/** 报名是否已截止:开始前 2 小时(D05) */
function isSignupClosed(event, now) {
  const start = new Date(event.startAt).getTime()
  const t = new Date(now).getTime()
  return t >= start - FORMATION.signupCloseBeforeStartHours * HOUR
}

/**
 * 判断此刻应对该局采取什么动作。
 *
 * 返回的 action:
 *   'none'        —— 无需处理
 *   'rally'       —— 发催报名通知(D04 的配套缓解,开始前 24h,只发一次)
 *   'form'        —— 达到最低人数,流转 formed 并发成团通知
 *   'cancel_low'  —— 未达最低人数,流转 cancelled_low 并发解散通知(附带其他局推荐)
 *
 * @param {{status:string, sceneType:string, startAt:string, confirmedCount:number, rallyNoticeSentAt?:string}} event
 * @param {string|Date} now
 */
function judge(event, now) {
  if (!SIGNUP_OPEN_STATES.includes(event.status)) return { action: 'none', reason: '非可判定状态' }

  const start = new Date(event.startAt).getTime()
  const t = new Date(now).getTime()
  const hoursToStart = (start - t) / HOUR

  // 已成团的局不再重复判定,但仍需在活动结束后由另一个任务流转 done
  if (event.status === STATUS.FORMED) return { action: 'none', reason: '已成团' }

  // 判定时点:开始前 6 小时(D04)。晚于该时点仍未判定的(如任务曾失败)照样判,避免局悬空。
  if (hoursToStart <= FORMATION.judgeBeforeStartHours) {
    const min = capacityMin(event.sceneType)
    return event.confirmedCount >= min
      ? { action: 'form', reason: `报名 ${event.confirmedCount} 人,达到最低 ${min} 人` }
      : { action: 'cancel_low', reason: `报名 ${event.confirmedCount} 人,未达最低 ${min} 人` }
  }

  // 催报名:开始前 24 小时内、距判定仍有足够提前量、尚未发过、且还差人。
  // 下界(judgeBefore + rallyMinLead)防止补发一条来不及起作用的催报名,
  // 否则用户会先收到「还差 1 人」再立刻收到「已解散」。
  const rallyFloor = FORMATION.judgeBeforeStartHours + FORMATION.rallyMinLeadHours
  if (hoursToStart <= FORMATION.rallyNoticeBeforeStartHours &&
      hoursToStart >= rallyFloor &&
      !event.rallyNoticeSentAt) {
    const min = capacityMin(event.sceneType)
    if (event.confirmedCount < min) {
      return { action: 'rally', reason: `还差 ${min - event.confirmedCount} 人`, shortBy: min - event.confirmedCount }
    }
  }

  return { action: 'none', reason: '未到判定时点' }
}

/** 活动是否已结束(用于 formed -> done) */
function isEnded(event, now) {
  const start = new Date(event.startAt).getTime()
  const duration = (event.durationMin || SCENE_RULES[event.sceneType].durationMinDefault) * 60 * 1000
  return new Date(now).getTime() >= start + duration
}

module.exports = { judge, isSignupClosed, isEnded, capacityMin, HOUR }
