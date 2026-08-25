/**
 * 举报与封禁(T22)—— 线下社交产品的必答题,上线阻塞项
 *
 * 设计原则:
 * 1. 举报门槛要低(一次点击 + 可选描述),处理门槛要高(只有管理员能封禁);
 * 2. 举报本身也可能被滥用 —— 同一人对同一目标只记一次,单人单日有上限;
 * 3. 封禁是账号级的:banned 用户不能报名、不能发局、不能发言,
 *    但历史记录保留(处理纠纷需要),且不删除其个人信息(注销才删)。
 */

/** 举报类别 —— 固定枚举,不接受自由类别(自由文本放 detail 里) */
const REPORT_REASON = {
  HARASSMENT: 'harassment',       // 骚扰/越界言行
  SCAM: 'scam',                   // 诈骗/推销/引流
  FAKE_EVENT: 'fake_event',       // 虚假活动/钓鱼地址
  DATING: 'dating',               // 把产品当约会软件用(风气风险的直接信号)
  SAFETY: 'safety',               // 人身安全问题
  OTHER: 'other',
}

/** 可举报的目标类型 */
const REPORT_TARGET = {
  EVENT: 'event',
  MESSAGE: 'message',
  USER: 'user',
}

/** 单人单日举报上限 —— 防举报轰炸 */
const DAILY_LIMIT = 10

/** 自由描述长度上限 */
const DETAIL_MAX_LENGTH = 200

const REPORT_REJECT = {
  BAD_REASON: 'bad_reason',
  BAD_TARGET: 'bad_target',
  SELF: 'self',
  DUPLICATE: 'duplicate',
  RATE_LIMITED: 'rate_limited',
  DETAIL_TOO_LONG: 'detail_too_long',
}

/**
 * 校验一次举报。
 * @param {object} p
 * @param {string} p.reason
 * @param {string} p.targetType
 * @param {boolean} p.isSelfTarget   举报对象是否是自己(的内容)
 * @param {boolean} p.alreadyReported 同一举报人对同一目标是否已有记录
 * @param {number} p.todayCount      举报人今日已提交的举报数
 * @param {string} [p.detail]
 */
function canReport({ reason, targetType, isSelfTarget, alreadyReported, todayCount, detail }) {
  if (!Object.values(REPORT_REASON).includes(reason)) {
    return { allowed: false, reason: REPORT_REJECT.BAD_REASON }
  }
  if (!Object.values(REPORT_TARGET).includes(targetType)) {
    return { allowed: false, reason: REPORT_REJECT.BAD_TARGET }
  }
  if (isSelfTarget) return { allowed: false, reason: REPORT_REJECT.SELF }
  if (alreadyReported) return { allowed: false, reason: REPORT_REJECT.DUPLICATE }
  if (todayCount >= DAILY_LIMIT) return { allowed: false, reason: REPORT_REJECT.RATE_LIMITED }
  if (detail && [...String(detail)].length > DETAIL_MAX_LENGTH) {
    return { allowed: false, reason: REPORT_REJECT.DETAIL_TOO_LONG }
  }
  return { allowed: true, reason: 'ok' }
}

/** 同一举报人对同一目标的去重键 */
function dedupeKey({ reporterId, targetType, targetId }) {
  return `${reporterId}:${targetType}:${targetId}`
}

// ---------------- 封禁 ----------------

/**
 * 封禁是**人工决定**,不是自动触发的。
 * 代码里只提供"被封后哪些事做不了"的判定 —— 单一出口,各云函数共用,
 * 避免有的入口记得检查、有的忘了。
 */
const BANNED_BLOCKED_ACTIONS = ['signup', 'create_event', 'send_message', 'rate', 'report']

/**
 * 用户当前是否被阻止执行某动作。
 * banned:全部阻止。restricted(爽约限制):只阻止报名 —— 其他行为不受牵连。
 */
function isBlocked(user, action, now) {
  if (!user) return { blocked: false }
  if (user.status === 'banned') {
    return { blocked: true, reason: 'banned' }
  }
  if (action === 'signup' && user.status === 'restricted' &&
      user.restrictedUntil && new Date(now) < new Date(user.restrictedUntil)) {
    return { blocked: true, reason: 'restricted' }
  }
  return { blocked: false }
}

module.exports = {
  canReport, dedupeKey, isBlocked,
  REPORT_REASON, REPORT_TARGET, REPORT_REJECT,
  DAILY_LIMIT, DETAIL_MAX_LENGTH, BANNED_BLOCKED_ACTIONS,
}
