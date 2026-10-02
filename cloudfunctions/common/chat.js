/**
 * 行前沟通(T17)—— 见 docs/06-群聊技术方案.md
 *
 * 【这不是一个「群」】
 * 数据库里没有群这张表。所谓群 = 同一个 eventId 下所有消息的集合,
 * 是查询的结果,不是需要创建的对象。因此「成团后自动建群」在实现上
 * 等于「把已经存在的空间对该局成员放出来」,零成本。
 *
 * 【定位是行前对齐工具,不是社交场】
 * 只在成团后开放,活动结束 48 小时后转只读,不提供加好友入口。
 * 见 PRD §4.1 与 §5、以及 docs/03 §7 的类目缓解措施。
 */
const { EVENT_STATUS, SIGNUP_STATUS } = require('./rules')

/** 消息长度上限。行前沟通不需要长文,超长的多半是复制粘贴的推广。 */
const MAX_LENGTH = 500

/** 单次拉取上限 */
const PAGE_SIZE = 50

/** 群聊已开放的局状态 —— 成团之后才开 */
const CHAT_OPEN_STATES = [EVENT_STATUS.FORMED, EVENT_STATUS.DONE, EVENT_STATUS.ARCHIVED]

const CHAT_REJECT = {
  NOT_FORMED: 'not_formed',
  NOT_MEMBER: 'not_member',
  ARCHIVED: 'archived',
  EMPTY: 'empty',
  TOO_LONG: 'too_long',
}

/**
 * 能否进入(读)。
 * 归档后依然可读 —— 历史要留给参与者,只是不能再发言。
 */
function canEnter({ event, signupStatus }) {
  if (!CHAT_OPEN_STATES.includes(event.status)) {
    return { allowed: false, reason: CHAT_REJECT.NOT_FORMED }
  }
  // 候补的进不去 —— 他们还不确定能不能来,提前进群会造成困扰
  if (signupStatus !== SIGNUP_STATUS.CONFIRMED && signupStatus !== SIGNUP_STATUS.ATTENDED) {
    return { allowed: false, reason: CHAT_REJECT.NOT_MEMBER }
  }
  return { allowed: true, reason: 'ok' }
}

/**
 * 能否发言。= 能进入 + 尚未归档。
 * 归档由 formation 云函数在活动结束 48 小时后写入 chatArchivedAt,
 * 这里只需读该字段,不需要额外的定时任务。
 */
function canSend({ event, signupStatus }) {
  const enter = canEnter({ event, signupStatus })
  if (!enter.allowed) return enter
  if (event.chatArchivedAt) return { allowed: false, reason: CHAT_REJECT.ARCHIVED }
  return { allowed: true, reason: 'ok' }
}

/**
 * 规范化并校验消息内容。
 * @returns {{ok:boolean, content?:string, reason?:string}}
 */
function normalizeContent(raw) {
  const content = String(raw == null ? '' : raw).trim()
  if (!content) return { ok: false, reason: CHAT_REJECT.EMPTY }
  if ([...content].length > MAX_LENGTH) return { ok: false, reason: CHAT_REJECT.TOO_LONG }
  return { ok: true, content }
}

// ---------------- 轮询退避 ----------------
// V1 用轮询而非 db.watch,理由见 docs/06 §3。
// 退避的目的:没人说话时别空转,有人说话时立刻跟上。

const POLL = {
  activeMs: 4000,      // 有人在聊时的间隔
  idleMs: 10000,       // 冷场时退避到的间隔
  idleAfterEmpty: 5,   // 连续几次空结果后进入冷场
}

/**
 * 计算下一次轮询的间隔与状态。纯函数,便于测试。
 * @param {{emptyStreak:number}} state
 * @param {number} newMessageCount 本次拉到的新消息数
 */
function nextPoll(state, newMessageCount) {
  // 一有新消息就立刻回到活跃节奏 —— 冷场退避不能拖慢正在进行的对话
  if (newMessageCount > 0) return { emptyStreak: 0, intervalMs: POLL.activeMs }
  const emptyStreak = state.emptyStreak + 1
  return {
    emptyStreak,
    intervalMs: emptyStreak >= POLL.idleAfterEmpty ? POLL.idleMs : POLL.activeMs,
  }
}

module.exports = {
  canEnter, canSend, normalizeContent, nextPoll,
  CHAT_OPEN_STATES, CHAT_REJECT, MAX_LENGTH, PAGE_SIZE, POLL,
}
