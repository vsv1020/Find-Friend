const { test, describe } = require('node:test')
const assert = require('node:assert')
const su = require('../cloudfunctions/common/signup')
const { STATUS } = require('../cloudfunctions/common/state-machine')
const { SIGNUP_STATUS, GENDER } = require('../cloudfunctions/common/rules')

const START = '2026-08-29T08:00:00.000Z'
const at = h => new Date(new Date(START).getTime() - h * 3600 * 1000).toISOString()
const ev = (o = {}) => ({
  status: STATUS.OPEN, sceneType: 'coffee', startAt: START,
  capacityMax: 4, confirmedCount: 0, genderCounts: {}, ...o,
})

describe('报名校验', () => {
  test('正常报名进 confirmed', () => {
    const r = su.evaluate({ event: ev(), gender: GENDER.MALE, now: at(48) })
    assert.strictEqual(r.allowed, true)
    assert.strictEqual(r.status, SIGNUP_STATUS.CONFIRMED)
  })

  test('D05 成团后仍可报名 —— 这是不锁定的核心行为', () => {
    const r = su.evaluate({ event: ev({ status: STATUS.FORMED, confirmedCount: 2 }), gender: GENDER.MALE, now: at(10) })
    assert.strictEqual(r.allowed, true)
    assert.strictEqual(r.status, SIGNUP_STATUS.CONFIRMED)
  })

  test('D03 满员转候补而非拒绝', () => {
    const r = su.evaluate({ event: ev({ confirmedCount: 4 }), gender: GENDER.MALE, now: at(48) })
    assert.strictEqual(r.allowed, true)
    assert.strictEqual(r.status, SIGNUP_STATUS.WAITLIST)
    assert.strictEqual(r.reason, 'capacity_full')
  })

  test('D05 开始前 2 小时后截止报名', () => {
    const r = su.evaluate({ event: ev(), gender: GENDER.MALE, now: at(1) })
    assert.strictEqual(r.allowed, false)
    assert.strictEqual(r.reason, su.REJECT.CLOSED)
  })

  test('已解散的局不能报名', () => {
    const r = su.evaluate({ event: ev({ status: STATUS.CANCELLED_LOW }), gender: GENDER.MALE, now: at(48) })
    assert.strictEqual(r.reason, su.REJECT.NOT_OPEN)
  })

  test('待审核的局不能报名 —— 审核对报名者完全不可见(D06)', () => {
    const r = su.evaluate({ event: ev({ status: STATUS.PENDING_REVIEW }), gender: GENDER.MALE, now: at(48) })
    assert.strictEqual(r.reason, su.REJECT.NOT_OPEN)
  })

  test('重复报名被拒', () => {
    const r = su.evaluate({ event: ev(), gender: GENDER.MALE, alreadySignedUp: true, now: at(48) })
    assert.strictEqual(r.reason, su.REJECT.DUPLICATE)
  })

  test('D10 处于限制期的用户不能报名', () => {
    const r = su.evaluate({
      event: ev(), gender: GENDER.MALE, now: at(48),
      user: { restrictedUntil: '2026-09-30T00:00:00.000Z' },
    })
    assert.strictEqual(r.allowed, false)
    assert.strictEqual(r.reason, su.REJECT.RESTRICTED)
  })

  test('限制期已过的用户可以报名', () => {
    const r = su.evaluate({
      event: ev(), gender: GENDER.MALE, now: at(48),
      user: { restrictedUntil: '2026-01-01T00:00:00.000Z' },
    })
    assert.strictEqual(r.allowed, true)
  })
})

describe('D07 性别配比:V1 关闭', () => {
  test('全男报名也照常通过 —— V1 不做自动拦截', () => {
    const e = ev({ confirmedCount: 3, genderCounts: { male: 3, female: 0, other: 0 } })
    const r = su.evaluate({ event: e, gender: GENDER.MALE, now: at(48) })
    assert.strictEqual(r.status, SIGNUP_STATUS.CONFIRMED)
  })

  test('配比算法本身正确,V2 打开即可用 —— 4 人局第 4 个男性超配', () => {
    const e = ev({ genderCounts: { male: 3, female: 0, other: 0 } })
    assert.strictEqual(su.isGenderOverQuota({ event: e, gender: GENDER.MALE }), true)
    assert.strictEqual(su.isGenderOverQuota({ event: e, gender: GENDER.FEMALE }), false)
  })

  test('D07 原方案的数学锁死已规避 —— 不足 4 人时规则不生效', () => {
    const twoMen = ev({ genderCounts: { male: 2, female: 0, other: 0 } })
    assert.strictEqual(su.isGenderOverQuota({ event: twoMen, gender: GENDER.MALE }), false,
      '3 人局第 3 个男性不应被拦 —— 这正是原规则锁死的场景')
  })

  test('D08「不便透露」计入总数但不参与比例计算', () => {
    const e = ev({ genderCounts: { male: 3, female: 0, other: 1 } })
    assert.strictEqual(su.isGenderOverQuota({ event: e, gender: GENDER.OTHER }), false)
  })
})

describe('候补递补', () => {
  const wl = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  test('按报名先后递补', () => {
    assert.deepStrictEqual(su.promoteFromWaitlist(wl, 2), [{ id: 'a' }, { id: 'b' }])
  })

  test('无空位时不递补', () => {
    assert.deepStrictEqual(su.promoteFromWaitlist(wl, 0), [])
    assert.deepStrictEqual(su.promoteFromWaitlist(wl, -1), [])
  })

  test('空位多于候补时全部递补,不越界', () => {
    assert.strictEqual(su.promoteFromWaitlist(wl, 10).length, 3)
  })
})
