const { test, describe } = require('node:test')
const assert = require('node:assert')
const f = require('../cloudfunctions/common/formation')
const { STATUS } = require('../cloudfunctions/common/state-machine')

// 基准:2026-08-29(周六)15:00 曼谷时间 = 08:00 UTC 的咖啡局
const START = '2026-08-29T08:00:00.000Z'
const at = hoursBefore => new Date(new Date(START).getTime() - hoursBefore * 3600 * 1000).toISOString()

const ev = (over = {}) => ({
  status: STATUS.OPEN, sceneType: 'coffee', startAt: START, confirmedCount: 0, ...over,
})

describe('成团判定(D04 判定时点 = 开始前 6 小时)', () => {
  test('D02 咖啡局 2 人成团(含局主)', () => {
    assert.strictEqual(f.capacityMin('coffee'), 2)
    assert.strictEqual(f.capacityMin('art'), 3)
    assert.strictEqual(f.capacityMin('bar'), 4)
  })

  test('恰好达标 —— 咖啡局 2 人成团', () => {
    assert.strictEqual(f.judge(ev({ confirmedCount: 2 }), at(6)).action, 'form')
  })

  test('差 1 人 —— 解散', () => {
    assert.strictEqual(f.judge(ev({ confirmedCount: 1 }), at(6)).action, 'cancel_low')
  })

  test('边界:恰好 6 小时整,应当判定而非跳过', () => {
    assert.strictEqual(f.judge(ev({ confirmedCount: 2 }), at(6)).action, 'form')
  })

  test('边界:6 小时零 1 分钟前,尚未到判定时点', () => {
    assert.strictEqual(f.judge(ev({ confirmedCount: 1 }), at(6.02)).action, 'none')
  })

  test('任务曾失败导致晚于判定时点 —— 照样判,不让局悬空', () => {
    assert.strictEqual(f.judge(ev({ confirmedCount: 1 }), at(1)).action, 'cancel_low')
    assert.strictEqual(f.judge(ev({ confirmedCount: 3 }), at(0)).action, 'form')
  })

  test('酒馆局 4 人才成团 —— 3 人解散', () => {
    const bar = ev({ sceneType: 'bar', confirmedCount: 3 })
    assert.strictEqual(f.judge(bar, at(6)).action, 'cancel_low')
    assert.strictEqual(f.judge({ ...bar, confirmedCount: 4 }, at(6)).action, 'form')
  })

  test('幂等:已成团的局重复扫描不再产生动作', () => {
    const formed = ev({ status: STATUS.FORMED, confirmedCount: 2 })
    assert.strictEqual(f.judge(formed, at(6)).action, 'none')
    assert.strictEqual(f.judge(formed, at(1)).action, 'none')
  })

  test('幂等:已解散的局不再产生动作', () => {
    assert.strictEqual(f.judge(ev({ status: STATUS.CANCELLED_LOW }), at(1)).action, 'none')
  })
})

describe('催报名通知(D04 的配套缓解,开始前 24 小时)', () => {
  test('开始前 24 小时且还差人 —— 发催报名', () => {
    const r = f.judge(ev({ confirmedCount: 1 }), at(24))
    assert.strictEqual(r.action, 'rally')
    assert.strictEqual(r.shortBy, 1)
  })

  test('已够人则不催', () => {
    assert.strictEqual(f.judge(ev({ confirmedCount: 2 }), at(24)).action, 'none')
  })

  test('幂等:已发过就不再发', () => {
    const sent = ev({ confirmedCount: 1, rallyNoticeSentAt: at(24) })
    assert.strictEqual(f.judge(sent, at(20)).action, 'none')
  })

  test('25 小时前还不到催报名时点', () => {
    assert.strictEqual(f.judge(ev({ confirmedCount: 1 }), at(25)).action, 'none')
  })

  test('防通知打架:距判定不足 2 小时时不再补发催报名', () => {
    // 7 小时前:判定(6h)尚未触发,但催报名只剩 1 小时提前量,发了也来不及 —— 应跳过
    assert.strictEqual(f.judge(ev({ confirmedCount: 1 }), at(7)).action, 'none')
    // 8 小时前:恰好满足最小提前量,可以催
    assert.strictEqual(f.judge(ev({ confirmedCount: 1 }), at(8)).action, 'rally')
  })
})

describe('报名截止与活动结束', () => {
  test('D05 开始前 2 小时截止报名', () => {
    assert.strictEqual(f.isSignupClosed(ev(), at(2.5)), false)
    assert.strictEqual(f.isSignupClosed(ev(), at(2)), true)
    assert.strictEqual(f.isSignupClosed(ev(), at(0)), true)
  })

  test('咖啡局默认时长 120 分钟后算结束', () => {
    assert.strictEqual(f.isEnded(ev(), at(-1)), false)   // 开始后 1 小时,未结束
    assert.strictEqual(f.isEnded(ev(), at(-2)), true)    // 开始后 2 小时,结束
  })

  test('跨日:周日 01:00 开始的局,判定落在周六 19:00', () => {
    const late = ev({ startAt: '2026-08-30T18:00:00.000Z', confirmedCount: 2 })
    assert.strictEqual(f.judge(late, '2026-08-30T12:00:00.000Z').action, 'form')
    assert.strictEqual(f.judge(late, '2026-08-30T11:00:00.000Z').action, 'none')
  })
})
