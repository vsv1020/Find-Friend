const { test, describe } = require('node:test')
const assert = require('node:assert')
const a = require('../cloudfunctions/common/anonymize')

const NOW = '2026-08-29T08:00:00.000Z'
const user = {
  _id: 'u1', openid: 'o_abc', phone: '+8613800000000', notifyPhone: '+66812345678',
  nickname: '小王', gender: 'male', avatarUrl: 'https://x/y.png',
  reliability: 80, noShowCount: 2, restrictedUntil: '2026-09-12T00:00:00Z',
  isHost: true, isAdmin: false, createdAt: '2026-08-01T00:00:00Z',
}

describe('账号注销的去标识化', () => {
  test('全部标识符被抹除,没有遗漏', () => {
    const patch = a.anonymizeUser(user, NOW)
    for (const f of a.PII_FIELDS) {
      assert.strictEqual(patch[f], null, `${f} 未被抹除 —— 这是合规事故`)
    }
  })

  test('手机号与泰国通知号都要抹 —— 两个字段都是敏感信息', () => {
    const patch = a.anonymizeUser(user, NOW)
    assert.strictEqual(patch.phone, null)
    assert.strictEqual(patch.notifyPhone, null)
  })

  test('性别也必须抹 —— 它在清单里被标为敏感', () => {
    assert.strictEqual(a.anonymizeUser(user, NOW).gender, null)
  })

  test('靠谱度与限制状态一并清零 —— 账号已不可登录,保留仍具画像性质', () => {
    const patch = a.anonymizeUser(user, NOW)
    assert.strictEqual(patch.reliability, null)
    assert.strictEqual(patch.noShowCount, null)
    assert.strictEqual(patch.restrictedUntil, null)
  })

  test('局主与管理员权限被收回', () => {
    const patch = a.anonymizeUser(user, NOW)
    assert.strictEqual(patch.isHost, false)
    assert.strictEqual(patch.isAdmin, false)
  })

  test('保留墓碑标记,使历史 signups 外键不悬空', () => {
    const patch = a.anonymizeUser(user, NOW)
    assert.strictEqual(patch.status, 'deleted')
    assert.strictEqual(patch.deletedAt, NOW)
  })

  test('verifyAnonymized 能抓出残留 —— 这是上线前自查的依据', () => {
    const clean = { ...user, ...a.anonymizeUser(user, NOW) }
    assert.deepStrictEqual(a.verifyAnonymized(clean), { clean: true, leaked: [] })

    const leaky = { ...clean, phone: '+8613800000000' }
    const r = a.verifyAnonymized(leaky)
    assert.strictEqual(r.clean, false)
    assert.deepStrictEqual(r.leaked, ['phone'])
  })

  test('把补丁应用到原文档后确实干净 —— 防止只改了补丁没改文档', () => {
    const after = { ...user, ...a.anonymizeUser(user, NOW) }
    assert.ok(a.verifyAnonymized(after).clean)
    assert.strictEqual(after.nickname, null)
  })
})
