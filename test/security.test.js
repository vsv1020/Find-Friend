/**
 * 安全测试 —— 锁住审计中修复的每一条,防止回归
 * 审计记录见 docs/08-安全审计.md
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const v = require('../cloudfunctions/common/validate')
const { publicEvent, PUBLIC_EVENT_FIELDS, FORBIDDEN_EVENT_FIELDS } = require('../cloudfunctions/common/projection')
const { PII_FIELDS } = require('../cloudfunctions/common/anonymize')

const NOW = '2026-08-25T00:00:00.000Z'
const goodPayload = {
  sceneType: 'coffee',
  startAt: '2026-08-29T08:00:00.000Z',
  venue: { name: 'Sarnies', address: 'Charoen Krung Rd', lat: 13.72, lng: 100.51 },
  capacityMax: 4, priceEstTHB: 200, description: '一起喝咖啡',
}

describe('S1 字段注入:gender 拼进 genderCounts.${gender} 字段路径', () => {
  const attacks = ['male.hack', '__proto__', 'constructor', 'a]:1},x:{y', '', '  ', 'MALE', 'nonbinary']
  for (const g of attacks) {
    test(`注入串被拒: ${JSON.stringify(g)}`, () => {
      assert.strictEqual(v.validGender(g), null)
    })
  }

  test('非字符串类型被拒(对象/数组/数字)', () => {
    for (const g of [{ toString: () => 'male' }, ['male'], 1, null, undefined]) {
      assert.strictEqual(v.validGender(g), null)
    }
  })

  test('合法枚举放行', () => {
    for (const g of ['male', 'female', 'other']) assert.strictEqual(v.validGender(g), g)
  })

  test('validateProfile 整体拒绝坏 gender —— 报名入口的实际防线', () => {
    const r = v.validateProfile({ nickname: '小王', gender: '__proto__' })
    assert.strictEqual(r.ok, false)
    assert.ok(r.errors.includes('gender'))
  })
})

describe('S2 时间注入:startAt 决定成团引擎的行为', () => {
  test('垃圾字符串被拒 —— NaN 会让成团引擎对该局永远静默跳过', () => {
    for (const bad of ['garbage', '2026-13-99', 12345, null, {}, '']) {
      const r = v.validateEventPayload({ ...goodPayload, startAt: bad }, NOW)
      assert.strictEqual(r.ok, false, JSON.stringify(bad))
      assert.ok(r.errors.includes('startAt'))
    }
  })

  test('过近的时间被拒 —— 发出去就会被判定解散', () => {
    const soon = new Date(Date.parse(NOW) + 3 * 3600 * 1000).toISOString()
    const r = v.validateEventPayload({ ...goodPayload, startAt: soon }, NOW)
    assert.ok(r.errors.includes('startAt_too_soon'))
  })

  test('过去的时间被拒', () => {
    const r = v.validateEventPayload({ ...goodPayload, startAt: '2020-01-01T00:00:00Z' }, NOW)
    assert.ok(r.errors.includes('startAt_too_soon'))
  })

  test('过远的时间被拒(60 天上限)', () => {
    const far = new Date(Date.parse(NOW) + 90 * 24 * 3600 * 1000).toISOString()
    const r = v.validateEventPayload({ ...goodPayload, startAt: far }, NOW)
    assert.ok(r.errors.includes('startAt_too_far'))
  })

  test('合法载荷通过,返回清洗后的 value', () => {
    const r = v.validateEventPayload(goodPayload, NOW)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.value.startAt, '2026-08-29T08:00:00.000Z')
  })
})

describe('S3 类型混淆:capacityMax / priceEst / venue', () => {
  test('capacityMax 非数值退回场景默认值,而不是变成 NaN', () => {
    const r = v.validateEventPayload({ ...goodPayload, capacityMax: 'lots' }, NOW)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.value.capacityMax, 4)   // coffee 默认
  })

  test('capacityMax 超出硬顶退回默认 —— 不允许 100 人咖啡局', () => {
    const r = v.validateEventPayload({ ...goodPayload, capacityMax: 100 }, NOW)
    assert.strictEqual(r.value.capacityMax, 4)
  })

  test('capacityMax 在合法区间内取整生效', () => {
    const r = v.validateEventPayload({ ...goodPayload, capacityMax: 5.9 }, NOW)
    assert.strictEqual(r.value.capacityMax, 5)
  })

  test('坐标越界被拒(lat 91 / lng -200)', () => {
    for (const venue of [
      { ...goodPayload.venue, lat: 91 },
      { ...goodPayload.venue, lng: -200 },
      { ...goodPayload.venue, lat: 'Infinity' },
    ]) {
      const r = v.validateEventPayload({ ...goodPayload, venue }, NOW)
      assert.strictEqual(r.ok, false, JSON.stringify(venue))
    }
  })

  test('场地名超长被拒;负价格被安全化', () => {
    const long = { ...goodPayload.venue, name: '字'.repeat(61) }
    assert.strictEqual(v.validateEventPayload({ ...goodPayload, venue: long }, NOW).ok, false)
    const neg = v.validateEventPayload({ ...goodPayload, priceEstTHB: -5 }, NOW)
    assert.strictEqual(neg.value.priceEstTHB, 200)   // 退回默认,不入库负数
  })

  test('未知场景被拒', () => {
    assert.strictEqual(v.validateEventPayload({ ...goodPayload, sceneType: 'hotel' }, NOW).ok, false)
  })
})

describe('S4 泄露防线:局的对外投影白名单', () => {
  test('带满敏感字段的文档,投影后只剩白名单键', () => {
    const full = {
      _id: 'e1', sceneType: 'coffee', startAt: NOW, venue: {}, status: 'open',
      capacityMin: 2, capacityMax: 4, priceEstTHB: 200, description: '', confirmedCount: 1,
      shareCode: 'ABCD2345', durationMin: 120,
      // 以下全部不得泄露
      hostId: 'u1', genderCounts: { male: 1 }, qrcodeFileID: 'cloud://x',
      reviewedBy: 'admin', reviewNote: '内部备注', takedownBy: null,
      isOfficial: true, adminFilledIn: true, rallyNoticeSentAt: NOW,
      publishedAt: NOW, formedAt: null,
    }
    const out = publicEvent(full)
    for (const k of Object.keys(out)) {
      assert.ok(PUBLIC_EVENT_FIELDS.includes(k), `投影泄露了白名单外的键: ${k}`)
    }
    for (const k of FORBIDDEN_EVENT_FIELDS) {
      assert.strictEqual(out[k], undefined, `敏感字段泄露: ${k}`)
    }
  })

  test('白名单与禁止名单不相交 —— 防止有人把敏感字段加进白名单', () => {
    for (const k of FORBIDDEN_EVENT_FIELDS) {
      assert.ok(!PUBLIC_EVENT_FIELDS.includes(k), `${k} 同时出现在两个名单里`)
    }
  })

  test('注销抹除的 PII 字段与投影禁止名单共同覆盖 hostId 路径', () => {
    // 投影挡 hostId,注销抹 openid/phone —— 两道防线锁死「从局反查到人」
    assert.ok(FORBIDDEN_EVENT_FIELDS.includes('hostId'))
    assert.ok(PII_FIELDS.includes('openid') && PII_FIELDS.includes('phone'))
  })
})

describe('S5 查询条件注入:chat.list 的 since', () => {
  test('对象/数组/数字被 validISO 归零为 null', () => {
    for (const bad of [{ $gt: '' }, ['2026'], 12345, true]) {
      assert.strictEqual(v.validISO(bad), null, JSON.stringify(bad))
    }
  })

  test('合法 ISO 归一化后放行', () => {
    assert.strictEqual(v.validISO('2026-08-29T08:00:00.000Z'), '2026-08-29T08:00:00.000Z')
  })
})

describe('S6 资源上限', () => {
  test('局主标记数组有上限,防超大数组拖垮循环', () => {
    assert.strictEqual(v.LIMITS.attendanceMarksMax, 20)
  })

  test('昵称限长 20 字符', () => {
    assert.strictEqual(v.validString('字'.repeat(21), v.LIMITS.nickname), null)
    assert.strictEqual(v.validString('小王', v.LIMITS.nickname), '小王')
  })
})
