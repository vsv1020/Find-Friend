const { test, describe } = require('node:test')
const assert = require('node:assert')
const r = require('../cloudfunctions/common/report')

const base = {
  reason: r.REPORT_REASON.HARASSMENT, targetType: r.REPORT_TARGET.EVENT,
  isSelfTarget: false, alreadyReported: false, todayCount: 0,
}

describe('举报校验', () => {
  test('正常举报通过', () => {
    assert.strictEqual(r.canReport(base).allowed, true)
  })

  test('类别是固定枚举,自由类别被拒', () => {
    assert.strictEqual(r.canReport({ ...base, reason: 'ugly' }).reason, r.REPORT_REJECT.BAD_REASON)
  })

  test('目标类型受限', () => {
    assert.strictEqual(r.canReport({ ...base, targetType: 'venue' }).reason, r.REPORT_REJECT.BAD_TARGET)
  })

  test('不能举报自己的内容', () => {
    assert.strictEqual(r.canReport({ ...base, isSelfTarget: true }).reason, r.REPORT_REJECT.SELF)
  })

  test('同一人对同一目标只记一次 —— 防刷举报数', () => {
    assert.strictEqual(r.canReport({ ...base, alreadyReported: true }).reason, r.REPORT_REJECT.DUPLICATE)
  })

  test('单人单日上限 —— 防举报轰炸', () => {
    assert.strictEqual(r.canReport({ ...base, todayCount: r.DAILY_LIMIT }).reason, r.REPORT_REJECT.RATE_LIMITED)
    assert.strictEqual(r.canReport({ ...base, todayCount: r.DAILY_LIMIT - 1 }).allowed, true)
  })

  test('描述超长被拒,按字符数计', () => {
    assert.strictEqual(r.canReport({ ...base, detail: '字'.repeat(201) }).reason, r.REPORT_REJECT.DETAIL_TOO_LONG)
    assert.strictEqual(r.canReport({ ...base, detail: '字'.repeat(200) }).allowed, true)
  })

  test('去重键包含举报人 —— 不同人举报同一目标各算一次', () => {
    const a = r.dedupeKey({ reporterId: 'u1', targetType: 'event', targetId: 'e1' })
    const b = r.dedupeKey({ reporterId: 'u2', targetType: 'event', targetId: 'e1' })
    assert.notStrictEqual(a, b)
  })
})

describe('封禁判定(单一出口,各云函数共用)', () => {
  const NOW = '2026-08-29T08:00:00Z'

  test('banned 用户全部动作被阻止', () => {
    const u = { status: 'banned' }
    for (const action of r.BANNED_BLOCKED_ACTIONS) {
      assert.strictEqual(r.isBlocked(u, action, NOW).blocked, true, action)
    }
  })

  test('restricted(爽约限制)只阻止报名,不牵连其他行为', () => {
    const u = { status: 'restricted', restrictedUntil: '2026-09-12T00:00:00Z' }
    assert.strictEqual(r.isBlocked(u, 'signup', NOW).blocked, true)
    assert.strictEqual(r.isBlocked(u, 'send_message', NOW).blocked, false)
    assert.strictEqual(r.isBlocked(u, 'rate', NOW).blocked, false)
  })

  test('限制期已过则放行', () => {
    const u = { status: 'restricted', restrictedUntil: '2026-01-01T00:00:00Z' }
    assert.strictEqual(r.isBlocked(u, 'signup', NOW).blocked, false)
  })

  test('正常用户不受影响;空用户不崩', () => {
    assert.strictEqual(r.isBlocked({ status: 'active' }, 'signup', NOW).blocked, false)
    assert.strictEqual(r.isBlocked(null, 'signup', NOW).blocked, false)
  })
})
