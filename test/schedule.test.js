const { test, describe } = require('node:test')
const assert = require('node:assert')
const s = require('../cloudfunctions/common/schedule')

/** 构造「曼谷当地某天某点」的 UTC 时刻,让用例读起来是当地时间 */
const bkk = (y, m, d, h) => new Date(Date.UTC(y, m - 1, d, h) - 7 * 3600 * 1000).toISOString()

describe('曼谷时区换算', () => {
  test('不依赖运行环境时区 —— 曼谷 2026-08-29 15:00 = UTC 08:00', () => {
    assert.strictEqual(bkk(2026, 8, 29, 15), '2026-08-29T08:00:00.000Z')
    const p = s.bangkokParts('2026-08-29T08:00:00.000Z')
    assert.strictEqual(p.hour, 15)
    assert.strictEqual(p.weekday, 6, '应为周六')
  })

  test('跨日边界:UTC 前一天深夜等于曼谷次日凌晨', () => {
    const p = s.bangkokParts('2026-08-28T18:00:00.000Z')
    assert.strictEqual(p.day, 29)
    assert.strictEqual(p.hour, 1)
  })
})

describe('周末快捷时段(支撑 30 秒填完发局)', () => {
  test('周三发局 —— 给出本周六、本周日', () => {
    const r = s.weekendSlots(bkk(2026, 8, 26, 10), 'coffee', 2)
    assert.strictEqual(r[0].label, '本周六 15:00')
    assert.strictEqual(r[1].label, '本周日 15:00')
    assert.strictEqual(r[0].startAt, bkk(2026, 8, 29, 15))
  })

  test('周六上午发局 —— 当天下午仍来得及,照样给出', () => {
    const r = s.weekendSlots(bkk(2026, 8, 29, 6), 'coffee', 2)
    assert.strictEqual(r[0].label, '本周六 15:00')
  })

  test('D04 边界:距开始不足判定提前量的时段不给 —— 发出去就会被判解散', () => {
    // 周六 11:00 发局,当天 15:00 只剩 4 小时 < 判定提前量 6h + 1h 缓冲
    const r = s.weekendSlots(bkk(2026, 8, 29, 11), 'coffee', 2)
    assert.ok(!r.some(x => x.startAt === bkk(2026, 8, 29, 15)), '本周六下午不应出现')
    assert.strictEqual(r[0].label, '本周日 15:00')
  })

  test('周日深夜发局 —— 本周末已过,顺延到下周', () => {
    const r = s.weekendSlots(bkk(2026, 8, 30, 22), 'coffee', 2)
    assert.strictEqual(r[0].label, '下周六 15:00')
    assert.strictEqual(r[1].label, '下周日 15:00')
  })

  test('周日凌晨发局 —— 当天仍算本周日', () => {
    const r = s.weekendSlots(bkk(2026, 8, 30, 1), 'coffee', 1)
    assert.strictEqual(r[0].label, '本周日 15:00')
  })

  test('场景决定默认时间:酒馆 20:00,展览 14:00', () => {
    assert.strictEqual(s.weekendSlots(bkk(2026, 8, 26, 10), 'bar', 1)[0].label, '本周六 20:00')
    assert.strictEqual(s.weekendSlots(bkk(2026, 8, 26, 10), 'art', 1)[0].label, '本周六 14:00')
  })

  test('始终返回请求的数量,不会因为跨周而变少', () => {
    assert.strictEqual(s.weekendSlots(bkk(2026, 8, 30, 22), 'coffee', 3).length, 3)
  })
})
