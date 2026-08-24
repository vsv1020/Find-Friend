/**
 * 局(Event)状态机 —— 见 docs/02 §4
 *
 * 所有状态变更必须经过本模块,并写入 eventStatusLog 便于排障。
 * 纯函数,不依赖云环境,可直接单元测试。
 */
const { EVENT_STATUS: S, REVIEW } = require('./rules')

/** 允许的状态流转。key = 起始状态,value = 可到达的状态集合。 */
const TRANSITIONS = {
  [S.DRAFT]:          [S.PENDING_REVIEW, S.OPEN],
  [S.PENDING_REVIEW]: [S.OPEN, S.REJECTED],
  [S.REJECTED]:       [],
  [S.OPEN]:           [S.FORMED, S.CANCELLED_LOW, S.CANCELLED_HOST],
  [S.FORMED]:         [S.DONE, S.CANCELLED_HOST],
  [S.CANCELLED_LOW]:  [],
  [S.CANCELLED_HOST]: [],
  [S.DONE]:           [S.ARCHIVED],
  [S.ARCHIVED]:       [],
}

/** 终态:不可再流转 */
const TERMINAL = [S.REJECTED, S.CANCELLED_LOW, S.CANCELLED_HOST, S.ARCHIVED]

/** 曾经对用户公开过的状态 —— 成团率分母的判定依据(见 D01) */
const PUBLISHED = [S.OPEN, S.FORMED, S.CANCELLED_LOW, S.CANCELLED_HOST, S.DONE, S.ARCHIVED]

/** 已成团的状态 —— 成团率分子 */
const FORMED_STATES = [S.FORMED, S.DONE, S.ARCHIVED]

/** 仍可报名的状态(D05:成团后不锁定) */
const SIGNUP_OPEN_STATES = [S.OPEN, S.FORMED]

/**
 * D06 决定新局的初始状态。
 * 局主白名单(isHost)免审优先于全局开关 —— 这同时是 D14「给权限不给钱」的载体。
 * @returns {string} S.OPEN 或 S.PENDING_REVIEW
 */
function resolveInitialStatus({ isHost = false, autoApprove = REVIEW.autoApprove } = {}) {
  if (isHost && REVIEW.hostBypassReview) return S.OPEN
  return autoApprove ? S.OPEN : S.PENDING_REVIEW
}

function isTerminal(status) {
  return TERMINAL.includes(status)
}

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to)
}

/**
 * 执行状态流转。非法流转抛错而非静默忽略 —— 定时任务的幂等性依赖调用方先查状态。
 * @returns {{status:string, changedAt:string, from:string, reason:string}} 供写入 eventStatusLog
 */
function transition(from, to, { reason = '', at } = {}) {
  if (!TRANSITIONS[from]) throw new Error(`未知的局状态: ${from}`)
  if (!canTransition(from, to)) throw new Error(`非法状态流转: ${from} -> ${to}`)
  return { from, status: to, reason, changedAt: at }
}

module.exports = {
  STATUS: S,
  TRANSITIONS,
  TERMINAL,
  PUBLISHED,
  FORMED_STATES,
  SIGNUP_OPEN_STATES,
  resolveInitialStatus,
  isTerminal,
  canTransition,
  transition,
}
