/**
 * 局主工具包(T23)—— 名单 / 群发 / 改期 / 取消 的纯规则
 *
 * 护城河边界:局主只能看**自己局**的报名者,且只看昵称 + 靠谱度 + 爬约次数(D10)。
 * 名单输出由 rosterEntry 白名单构造,不从 user 文档展开 —— 将来 users 加字段也不会漏出去。
 */
const { HOST_TOOLS, EVENT_STATUS: S, SIGNUP_STATUS: SS } = require('./rules')
const { validISO, startAtWindowError } = require('./validate')
const { SCORE_MAX } = require('./reliability')

const MINUTE = 60 * 1000

/** 名单包含的报名状态:已取消的人不再与这个局有关,不展示 */
const ROSTER_STATUSES = [SS.CONFIRMED, SS.WAITLIST, SS.ATTENDED, SS.NO_SHOW]

const ROSTER_FIELDS = ['userId', 'nickname', 'status', 'reliability', 'noShowCount', 'isHostSignup']

/** 群发 / 改期只对仍在进行中的局有意义 */
const ACTIVE_STATES = [S.OPEN, S.FORMED]

const HOST_REJECT = {
  FORBIDDEN: 'forbidden',
  BAD_STATUS: 'bad_status',
  COOLDOWN: 'cooldown',
  BAD_TIME: 'bad_time',
  TOO_SOON: 'startAt_too_soon',
  TOO_FAR: 'startAt_too_far',
  SAME_TIME: 'same_time',
  FORMED_EARLIER: 'formed_earlier',
  RESCHEDULE_COOLDOWN: 'reschedule_cooldown',
}

/** 调用者能否操作该局:局主本人或管理员 */
function isHostOf(user, event) {
  return Boolean(user && event && user._id && (event.hostId === user._id || user.isAdmin))
}

/**
 * 名单单项投影。user 可能缺失(已注销去标识化),此时给默认值而不是整行丢掉 ——
 * 局主需要知道那个座位上有人。
 */
function rosterEntry(user, signup) {
  const u = user || {}
  return {
    userId: signup.userId,
    nickname: u.nickname || '这位朋友',
    status: signup.status,
    reliability: typeof u.reliability === 'number' ? u.reliability : SCORE_MAX,
    noShowCount: u.noShowCount || 0,
    isHostSignup: Boolean(signup.isHostSignup),
  }
}

const STATUS_ORDER = [SS.CONFIRMED, SS.ATTENDED, SS.NO_SHOW, SS.WAITLIST]

/** 局主在最前,其余按状态、再按报名先后 —— 候补排在最后且按递补顺序 */
function buildRoster(signups, users) {
  const byId = Object.fromEntries((users || []).map(u => [u._id, u]))
  return signups
    .filter(s => ROSTER_STATUSES.includes(s.status))
    .slice()
    .sort((a, b) =>
      Number(Boolean(b.isHostSignup)) - Number(Boolean(a.isHostSignup)) ||
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(s => rosterEntry(byId[s.userId], s))
}

/**
 * 群发频控。恰好满冷却时长即放行。
 * @param {object} p
 * @param {string|null} p.lastBroadcastAt
 * @param {string} p.now
 * @param {string} [p.status] 传入时同时校验局状态
 * @returns {{allowed:boolean, reason:string, nextAllowedAt?:string}}
 */
function canBroadcast({ lastBroadcastAt, now, status }) {
  if (status !== undefined && !ACTIVE_STATES.includes(status)) {
    return { allowed: false, reason: HOST_REJECT.BAD_STATUS }
  }
  const last = lastBroadcastAt ? new Date(lastBroadcastAt).getTime() : NaN
  if (Number.isNaN(last)) return { allowed: true, reason: 'ok' }
  const next = last + HOST_TOOLS.broadcastCooldownMinutes * MINUTE
  if (new Date(now).getTime() < next) {
    return { allowed: false, reason: HOST_REJECT.COOLDOWN, nextAllowedAt: new Date(next).toISOString() }
  }
  return { allowed: true, reason: 'ok' }
}

/**
 * 群发去重键。精确到分钟:同一分钟内的重试(网络抖动重放)只落一条,
 * 而冷却本身保证了正常的两次群发不会落在同一分钟。
 */
function broadcastDedupeKey({ userId, eventId, now }) {
  return `${userId}:${eventId}:broadcast:${Math.floor(new Date(now).getTime() / MINUTE)}`
}

/**
 * 改期规则。
 *
 * formed 的局只允许往后改:状态机没有 formed → open,
 * 若往前改,已确认的人被迫提前赴约,取消又会按 D10 记爬约 —— 等于局主替别人制造违约。
 *
 * @returns {{allowed:boolean, reason:string, startAt?:string, status?:string}}
 *          放行时 startAt 为归一化后的新时间,status 为改期后的状态(恒等于原状态)
 */
function canReschedule({ event, newStartAt, now }) {
  if (!ACTIVE_STATES.includes(event.status)) return { allowed: false, reason: HOST_REJECT.BAD_STATUS }
  // 每改一次全员收一条通知,反复改期就是骚扰 —— 冷却是硬限制
  if (event.rescheduledAt && now &&
      new Date(now).getTime() - new Date(event.rescheduledAt).getTime() < HOST_TOOLS.rescheduleCooldownMinutes * MINUTE) {
    return { allowed: false, reason: HOST_REJECT.RESCHEDULE_COOLDOWN }
  }
  const startAt = validISO(newStartAt)
  if (!startAt) return { allowed: false, reason: HOST_REJECT.BAD_TIME }

  const windowError = startAtWindowError(startAt, now)
  if (windowError) return { allowed: false, reason: windowError }

  const oldMs = new Date(event.startAt).getTime()
  const newMs = new Date(startAt).getTime()
  if (newMs === oldMs) return { allowed: false, reason: HOST_REJECT.SAME_TIME }
  if (event.status === S.FORMED && newMs < oldMs) {
    return { allowed: false, reason: HOST_REJECT.FORMED_EARLIER }
  }
  return { allowed: true, reason: 'ok', startAt, status: event.status }
}

/**
 * 改期的状态日志。状态本身不变,但改期决定了成团判定时点,排障时必须能看到。
 */
function rescheduleLog({ event, newStartAt, now }) {
  return {
    from: event.status, status: event.status,
    reason: `局主改期 ${event.startAt} → ${newStartAt}`,
    changedAt: now,
  }
}

/** 通知对象:按状态筛选、按人去重,并排除操作者本人(自己发的不用再通知自己) */
function notifyTargets(signups, statuses, excludeUserId) {
  const seen = new Set()
  const out = []
  for (const s of signups) {
    if (!statuses.includes(s.status) || s.userId === excludeUserId || seen.has(s.userId)) continue
    seen.add(s.userId)
    out.push(s.userId)
  }
  return out
}

module.exports = {
  isHostOf, rosterEntry, buildRoster,
  canBroadcast, broadcastDedupeKey,
  canReschedule, rescheduleLog, notifyTargets,
  ROSTER_STATUSES, ROSTER_FIELDS, ACTIVE_STATES, HOST_REJECT,
}
