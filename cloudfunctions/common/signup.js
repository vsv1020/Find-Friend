/**
 * 报名校验与候补递补 —— 见 docs/04 D03 / D05 / D07 / D08
 *
 * D05:成团后不锁定,继续开放报名至人数上限或开始前 2 小时。
 * D07:V1 不做性别配比校验。代码路径保留,由 GENDER_RATIO.enabled 控制,V2 打开即生效。
 */
const { SCENE_RULES, GENDER_RATIO, SIGNUP_STATUS, GENDER } = require('./rules')
const { SIGNUP_OPEN_STATES } = require('./state-machine')
const { isSignupClosed } = require('./formation')

const REJECT = {
  NOT_OPEN: 'not_open',
  CLOSED: 'closed',
  DUPLICATE: 'duplicate',
  RESTRICTED: 'restricted',
}

/**
 * 评估一次报名请求。
 * @param {object} p
 * @param {object} p.event            {status, sceneType, startAt, capacityMax, confirmedCount, genderCounts}
 * @param {object} p.user             {restrictedUntil}
 * @param {string} p.gender           本次报名者性别(D08 必填)
 * @param {boolean} p.alreadySignedUp
 * @param {string|Date} p.now
 * @returns {{allowed:boolean, status?:string, reason:string}}
 *          status 为 CONFIRMED 或 WAITLIST。被拒时 allowed=false。
 */
function evaluate({ event, user = {}, gender, alreadySignedUp = false, now }) {
  if (!SIGNUP_OPEN_STATES.includes(event.status)) {
    return { allowed: false, reason: REJECT.NOT_OPEN }
  }
  if (isSignupClosed(event, now)) {
    return { allowed: false, reason: REJECT.CLOSED }
  }
  if (alreadySignedUp) {
    return { allowed: false, reason: REJECT.DUPLICATE }
  }
  // D10:累计爬约达阈值后限制报名
  if (user.restrictedUntil && new Date(now) < new Date(user.restrictedUntil)) {
    return { allowed: false, reason: REJECT.RESTRICTED }
  }

  const max = event.capacityMax || SCENE_RULES[event.sceneType].capacityMaxDefault
  if (event.confirmedCount >= max) {
    return { allowed: true, status: SIGNUP_STATUS.WAITLIST, reason: 'capacity_full' }
  }

  // D07:V1 关闭。打开后为软拦截 —— 超配性别转候补,绝不直接拒绝。
  if (GENDER_RATIO.enabled && isGenderOverQuota({ event, gender })) {
    return { allowed: true, status: SIGNUP_STATUS.WAITLIST, reason: 'gender_quota_full' }
  }

  return { allowed: true, status: SIGNUP_STATUS.CONFIRMED, reason: 'ok' }
}

/**
 * 性别配比校验(V2)。「不便透露」计入总人数但不参与比例计算(D08)。
 * 仅在报名人数达到 minSignupsToApply 后生效 —— 否则 2 人局两个同性即 100%,规则会锁死。
 */
function isGenderOverQuota({ event, gender }) {
  if (gender === GENDER.OTHER) return false
  const counts = event.genderCounts || {}
  const total = (counts[GENDER.MALE] || 0) + (counts[GENDER.FEMALE] || 0) + (counts[GENDER.OTHER] || 0)
  if (total + 1 < GENDER_RATIO.minSignupsToApply) return false
  const after = (counts[gender] || 0) + 1
  return after / (total + 1) > GENDER_RATIO.maxSingleGenderRatio
}

/**
 * 有人取消后从候补递补。返回应被提升为 confirmed 的候补记录(按报名先后)。
 * @param {object[]} waitlist 按 createdAt 升序
 * @param {number} slots 可用名额数
 */
function promoteFromWaitlist(waitlist, slots) {
  if (slots <= 0) return []
  return waitlist.slice(0, slots)
}

/**
 * 局主自己的报名记录。
 *
 * ⚠️ D02 的最低成团人数**含局主**(咖啡局 2 人 = 局主 + 1 名报名者)。
 * 而 confirmedCount 是数 signups 得来的,所以发局时必须同时为局主建一条 confirmed 记录,
 * 否则会出现三个连锁问题:
 *   1. 成团门槛凭空高一位 —— 咖啡局实际需要 3 个人;
 *   2. 局主进不了自己局的行前沟通(canEnter 要求 confirmed 记录);
 *   3. 局主不出现在待评价列表里,标记到场的入口根本打不开。
 */
function hostInitialSignup({ eventId, hostId, gender, now }) {
  return {
    eventId, userId: hostId, status: SIGNUP_STATUS.CONFIRMED,
    gender, isHostSignup: true, createdAt: now,
  }
}

/** 局主不能单独退出自己的局 —— 要走「取消整个局」,否则局会没有主人 */
function canCancelSignup({ signup }) {
  return !signup.isHostSignup
}

module.exports = {
  evaluate, isGenderOverQuota, promoteFromWaitlist,
  hostInitialSignup, canCancelSignup, REJECT,
}
