/**
 * 入口参数校验(安全审计的落点)
 *
 * 原则:**云函数的每个入参在使用前必须过这里**,尤其是会拼进
 * 字段路径、查询条件或存进库的值。前端校验只是体验,不是防线。
 *
 * 审计中发现的真实漏洞(本模块修复):
 * 1. 字段注入 —— genderCounts.${gender} 里的 gender 是用户输入且未校验,
 *    传 "male.x" / "__proto__" 会注入任意字段路径;
 * 2. 时间注入 —— startAt 未校验,过去的时间会被立刻判定解散,
 *    垃圾字符串产生 NaN 会让成团引擎对该局永远静默跳过;
 * 3. 类型混淆 —— capacityMax 传非数值时 clamp(NaN) 得 NaN,名额判断恒 false。
 */
const { GENDER, SCENE_RULES, FORMATION } = require('./rules')

const HOUR = 3600 * 1000

/** 发局最远可到多少天后 —— 太远的局密度必然不够,也放大排期攻击面 */
const MAX_DAYS_AHEAD = 60

const LIMITS = {
  nickname: 20,
  venueName: 60,
  venueAddress: 120,
  description: 200,
  priceMax: 100000,
  /** 局主一次标记的人数上限(防超大数组拖垮循环) */
  attendanceMarksMax: 20,
}

/** 性别必须是枚举之一 —— 这是字段注入的防线,不是格式洁癖 */
function validGender(g) {
  return Object.values(GENDER).includes(g) ? g : null
}

/** 非空字符串,裁剪并限长;非字符串返回 null */
function validString(v, maxLen) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || [...s].length > maxLen) return null
  return s
}

/** 有限数值且在闭区间内 */
function validNumber(v, min, max) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return n
}

/** 合法 ISO 时间串(存库统一用 ISO,查询条件按字符串比较,类型必须干净) */
function validISO(v) {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString()
}

/**
 * 发局载荷校验。返回 {ok, errors[], value} —— value 是清洗后的安全版本,
 * 云函数只允许使用 value,不允许回头碰原始 payload。
 */
function validateEventPayload(payload, now) {
  const errors = []
  const p = payload || {}

  const rules = SCENE_RULES[p.sceneType]
  if (!rules) errors.push('sceneType')

  const startAt = validISO(p.startAt)
  if (!startAt) errors.push('startAt')
  else {
    const nowMs = new Date(now).getTime()
    const startMs = new Date(startAt).getTime()
    // 距开始必须留出判定提前量 + 1 小时缓冲,否则发出去就被判解散(与发局表单口径一致)
    if (startMs - nowMs < (FORMATION.judgeBeforeStartHours + 1) * HOUR) errors.push('startAt_too_soon')
    if (startMs - nowMs > MAX_DAYS_AHEAD * 24 * HOUR) errors.push('startAt_too_far')
  }

  const venue = p.venue || {}
  const venueName = validString(venue.name, LIMITS.venueName)
  const venueAddress = validString(venue.address, LIMITS.venueAddress)
  const lat = validNumber(venue.lat, -90, 90)
  const lng = validNumber(venue.lng, -180, 180)
  if (!venueName || !venueAddress || lat === null || lng === null) errors.push('venue')

  let capacityMax = null
  if (rules) {
    const n = validNumber(p.capacityMax, rules.capacityMin, rules.capacityHardMax)
    capacityMax = n === null ? rules.capacityMaxDefault : Math.floor(n)
  }
  const priceEstTHB = (() => {
    const n = validNumber(p.priceEstTHB, 0, LIMITS.priceMax)
    return n === null ? (rules ? rules.priceEstDefaultTHB : 0) : Math.round(n)
  })()

  // 说明选填:给了但超长/非字符串按空处理,不因选填字段拒掉整个发布
  const description = typeof p.description === 'string'
    ? [...p.description.trim()].slice(0, LIMITS.description).join('')
    : ''

  if (errors.length) return { ok: false, errors }
  return {
    ok: true, errors: [],
    value: {
      sceneType: p.sceneType, startAt,
      venue: { name: venueName, address: venueAddress, lat, lng },
      capacityMax, priceEstTHB, description,
    },
  }
}

/** 报名资料校验。gender 是字段注入防线,必须严格。 */
function validateProfile(profile) {
  const p = profile || {}
  const nickname = validString(p.nickname, LIMITS.nickname)
  const gender = validGender(p.gender)
  const errors = []
  if (!nickname) errors.push('nickname')
  if (!gender) errors.push('gender')
  if (errors.length) return { ok: false, errors }
  return { ok: true, errors: [], value: { nickname, gender, phoneCode: typeof p.phoneCode === 'string' ? p.phoneCode : null } }
}

module.exports = {
  validGender, validString, validNumber, validISO,
  validateEventPayload, validateProfile,
  LIMITS, MAX_DAYS_AHEAD,
}
