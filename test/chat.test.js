const { test, describe } = require('node:test')
const assert = require('node:assert')
const chat = require('../cloudfunctions/common/chat')
const { EVENT_STATUS: S, SIGNUP_STATUS: SS } = require('../cloudfunctions/common/rules')

const ev = (o = {}) => ({ status: S.FORMED, chatArchivedAt: null, ...o })

describe('进入行前沟通', () => {
  test('成团后,已确认的报名者可进', () => {
    assert.strictEqual(chat.canEnter({ event: ev(), signupStatus: SS.CONFIRMED }).allowed, true)
  })

  test('尚未成团时不开 —— 可能会解散,先别让人聊起来', () => {
    assert.strictEqual(
      chat.canEnter({ event: ev({ status: S.OPEN }), signupStatus: SS.CONFIRMED }).reason,
      chat.CHAT_REJECT.NOT_FORMED)
  })

  test('已解散的局进不去', () => {
    assert.strictEqual(
      chat.canEnter({ event: ev({ status: S.CANCELLED_LOW }), signupStatus: SS.CONFIRMED }).reason,
      chat.CHAT_REJECT.NOT_FORMED)
  })

  test('候补进不去 —— 还不确定能不能来,提前进群造成困扰', () => {
    assert.strictEqual(
      chat.canEnter({ event: ev(), signupStatus: SS.WAITLIST }).reason,
      chat.CHAT_REJECT.NOT_MEMBER)
  })

  test('没报名的进不去', () => {
    assert.strictEqual(chat.canEnter({ event: ev(), signupStatus: null }).reason, chat.CHAT_REJECT.NOT_MEMBER)
    assert.strictEqual(chat.canEnter({ event: ev(), signupStatus: SS.CANCELLED }).reason, chat.CHAT_REJECT.NOT_MEMBER)
  })

  test('归档后仍可读 —— 历史要留给参与者', () => {
    const archived = ev({ status: S.ARCHIVED, chatArchivedAt: '2026-09-01T00:00:00Z' })
    assert.strictEqual(chat.canEnter({ event: archived, signupStatus: SS.ATTENDED }).allowed, true)
  })
})

describe('发言权限', () => {
  test('成团后可发言', () => {
    assert.strictEqual(chat.canSend({ event: ev(), signupStatus: SS.CONFIRMED }).allowed, true)
  })

  test('活动结束但未归档时仍可发言 —— 约后续、道个别', () => {
    assert.strictEqual(
      chat.canSend({ event: ev({ status: S.DONE }), signupStatus: SS.ATTENDED }).allowed, true)
  })

  test('归档后不可发言 —— 这是「不沉淀关系链」的落点', () => {
    const archived = ev({ status: S.ARCHIVED, chatArchivedAt: '2026-09-01T00:00:00Z' })
    assert.strictEqual(
      chat.canSend({ event: archived, signupStatus: SS.ATTENDED }).reason, chat.CHAT_REJECT.ARCHIVED)
  })

  test('归档判定只看 chatArchivedAt,不需要额外定时任务', () => {
    // formation 云函数在结束满 48 小时后写入该字段,这里只读
    const doneButArchived = ev({ status: S.DONE, chatArchivedAt: '2026-09-01T00:00:00Z' })
    assert.strictEqual(chat.canSend({ event: doneButArchived, signupStatus: SS.ATTENDED }).reason,
      chat.CHAT_REJECT.ARCHIVED)
  })
})

describe('消息校验', () => {
  test('去掉首尾空白', () => {
    assert.deepStrictEqual(chat.normalizeContent('  我到了  '), { ok: true, content: '我到了' })
  })

  test('纯空白视为空', () => {
    assert.strictEqual(chat.normalizeContent('   ').reason, chat.CHAT_REJECT.EMPTY)
    assert.strictEqual(chat.normalizeContent('').reason, chat.CHAT_REJECT.EMPTY)
    assert.strictEqual(chat.normalizeContent(null).reason, chat.CHAT_REJECT.EMPTY)
  })

  test('超长拒绝 —— 行前沟通不需要长文,超长多半是复制粘贴的推广', () => {
    assert.strictEqual(chat.normalizeContent('字'.repeat(501)).reason, chat.CHAT_REJECT.TOO_LONG)
    assert.strictEqual(chat.normalizeContent('字'.repeat(500)).ok, true)
  })

  test('按字符数而非字节数计长度 —— 中文不该被腰斩', () => {
    assert.strictEqual(chat.normalizeContent('中'.repeat(400)).ok, true)
  })
})

describe('轮询退避', () => {
  test('有新消息立刻回到活跃节奏', () => {
    const r = chat.nextPoll({ emptyStreak: 10 }, 3)
    assert.strictEqual(r.intervalMs, chat.POLL.activeMs)
    assert.strictEqual(r.emptyStreak, 0)
  })

  test('连续空结果未达阈值时保持活跃节奏', () => {
    let st = { emptyStreak: 0 }
    for (let i = 0; i < chat.POLL.idleAfterEmpty - 1; i++) st = chat.nextPoll(st, 0)
    assert.strictEqual(st.intervalMs, chat.POLL.activeMs)
  })

  test('达到阈值后退避到冷场节奏', () => {
    let st = { emptyStreak: 0 }
    for (let i = 0; i < chat.POLL.idleAfterEmpty; i++) st = chat.nextPoll(st, 0)
    assert.strictEqual(st.intervalMs, chat.POLL.idleMs)
  })

  test('冷场中一有人说话就立刻恢复 —— 退避不能拖慢正在进行的对话', () => {
    let st = { emptyStreak: 0 }
    for (let i = 0; i < 20; i++) st = chat.nextPoll(st, 0)
    assert.strictEqual(st.intervalMs, chat.POLL.idleMs)
    st = chat.nextPoll(st, 1)
    assert.strictEqual(st.intervalMs, chat.POLL.activeMs)
  })
})
