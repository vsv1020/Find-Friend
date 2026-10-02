const { test, describe } = require('node:test')
const assert = require('node:assert')
const m = require('../cloudfunctions/common/metrics')
const { STATUS } = require('../cloudfunctions/common/state-machine')

const e = (status, o = {}) => ({ status, publishedAt: '2026-08-20T00:00:00Z', isOfficial: false, ...o })

describe('D01 成团率口径', () => {
  test('未公开过的局不计入分母', () => {
    const r = m.formationRate([
      e(STATUS.FORMED),
      { status: STATUS.DRAFT, publishedAt: null },
      { status: STATUS.PENDING_REVIEW, publishedAt: null },
      { status: STATUS.REJECTED, publishedAt: null },
    ])
    assert.strictEqual(r.total, 1)
    assert.strictEqual(r.rate, 1)
  })

  test('局主自行取消计入分母且算未成团 —— 堵住靠取消刷分的口子', () => {
    const r = m.formationRate([e(STATUS.FORMED), e(STATUS.CANCELLED_HOST)])
    assert.strictEqual(r.total, 2)
    assert.strictEqual(r.formed, 1)
    assert.strictEqual(r.rate, 0.5)
  })

  test('done 与 archived 都算已成团', () => {
    const r = m.formationRate([e(STATUS.DONE), e(STATUS.ARCHIVED), e(STATUS.CANCELLED_LOW)])
    assert.strictEqual(r.formed, 2)
  })

  test('无样本时 rate 为 null 而非 0 —— 避免把「还没数据」误读成「成团率 0%」', () => {
    assert.strictEqual(m.formationRate([]).rate, null)
  })
})

describe('D12 双指标', () => {
  const events = [
    e(STATUS.FORMED, { isOfficial: true }),                          // 官方局,成团
    e(STATUS.FORMED, { isOfficial: true }),                          // 官方局,成团
    e(STATUS.FORMED, { isOfficial: false, adminFilledIn: true }),    // 自然局但管理员补位 -> 不算自然
    e(STATUS.FORMED, { isOfficial: false }),                         // 自然局,成团
    e(STATUS.CANCELLED_LOW, { isOfficial: false }),                  // 自然局,解散
  ]

  test('整体成团率含官方局', () => {
    assert.strictEqual(m.formationRate(events).rate, 4 / 5)
  })

  test('真北极星剔除官方局与管理员补位的局', () => {
    const r = m.formationRate(events, { organicOnly: true })
    assert.strictEqual(r.total, 2, '只剩两个真正的自然局')
    assert.strictEqual(r.rate, 0.5)
  })

  test('冷启动期的失真场景 —— 整体达标但真北极星未达标', () => {
    const ns = m.northStar(events)
    assert.strictEqual(ns.overall.met, true, '整体 80% 达标(被官方局保送)')
    assert.strictEqual(ns.organic.met, true, '自然局 50% 高于 40% 目标')
    // 再造一组:官方局全成团,自然局全黄
    const skewed = [
      e(STATUS.FORMED, { isOfficial: true }), e(STATUS.FORMED, { isOfficial: true }),
      e(STATUS.FORMED, { isOfficial: true }), e(STATUS.CANCELLED_LOW, { isOfficial: false }),
    ]
    const s = m.northStar(skewed)
    assert.strictEqual(s.overall.met, true,  '整体 75% 看起来达标')
    assert.strictEqual(s.organic.met, false, '但自然局 0% —— 产品其实没跑通')
  })
})
