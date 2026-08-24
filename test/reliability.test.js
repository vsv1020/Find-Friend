const { test, describe } = require('node:test')
const assert = require('node:assert')
const rel = require('../cloudfunctions/common/reliability')
const { STATUS } = require('../cloudfunctions/common/state-machine')
const { RELIABILITY_MARK } = require('../cloudfunctions/common/rules')

const NOW = '2026-08-29T08:00:00.000Z'

describe('D10 爬约判定', () => {
  test('成团前取消不算爬约 —— 鼓励尽早取消把位置让出来', () => {
    assert.strictEqual(rel.cancellationCounts(STATUS.OPEN), false)
  })

  test('成团后取消算 1 次', () => {
    assert.strictEqual(rel.cancellationCounts(STATUS.FORMED), true)
  })

  test('局主标记未到场算 1 次,迟到与准时不算', () => {
    assert.strictEqual(rel.markCounts(RELIABILITY_MARK.NO_SHOW), true)
    assert.strictEqual(rel.markCounts(RELIABILITY_MARK.LATE), false)
    assert.strictEqual(rel.markCounts(RELIABILITY_MARK.ON_TIME), false)
  })
})

describe('D10 处罚阶梯', () => {
  test('1 次不处罚', () => {
    const r = rel.applyPenalty(1, NOW)
    assert.strictEqual(r.status, 'active')
    assert.strictEqual(r.restrictedUntil, null)
    assert.strictEqual(r.needsManualReview, false)
  })

  test('2 次限制报名 14 天', () => {
    const r = rel.applyPenalty(2, NOW)
    assert.strictEqual(r.status, 'restricted')
    assert.strictEqual(r.restrictedUntil, '2026-09-12T08:00:00.000Z')
    assert.strictEqual(r.needsManualReview, false)
  })

  test('3 次进人工复核,且仍处于限制中', () => {
    const r = rel.applyPenalty(3, NOW)
    assert.strictEqual(r.status, 'restricted')
    assert.strictEqual(r.needsManualReview, true)
  })
})
