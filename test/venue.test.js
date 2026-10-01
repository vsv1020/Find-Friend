const { test, describe } = require('node:test')
const assert = require('node:assert')
const v = require('../cloudfunctions/common/venue')

describe('geohash', () => {
  test('与标准实现一致:(0,0)=s00000,维基示例 (42.6,-5.6) 前 5 位 ezs42', () => {
    assert.strictEqual(v.geohash(0, 0, 6), 's00000')
    assert.strictEqual(v.geohash(42.6, -5.6, 5), 'ezs42')
  })
  test('同一家店的多次选点(百米内)落在同一格;两公里外不同格', () => {
    const a = v.geohash(13.7230, 100.5140), b = v.geohash(13.7235, 100.5146), c = v.geohash(13.7400, 100.5300)
    assert.strictEqual(a, b)
    assert.notStrictEqual(a, c)
  })
})

const ev = (name, lat, lng, status = 'formed', publishedAt = 'x') => ({ venue: { name, lat, lng, address: '' }, status, publishedAt })

describe('距离热度(推荐场地用,不受格边影响)', () => {
  test('靠近 geohash 格边的店:三个点分属两个格子,但按距离全算进去', () => {
    const pts = [[13.7230, 100.5140], [13.7231, 100.5141], [13.7232, 100.5139]]
    assert.ok(new Set(pts.map(([a, b]) => v.geohash(a, b))).size > 1, '前提:这些点确实跨格')
    const h = v.venueHeat({ lat: 13.7231, lng: 100.5140 }, pts.map(([a, b], i) => ev('S', a, b, i === 2 ? 'cancelled_low' : 'formed')))
    assert.deepStrictEqual(h, { published: 3, formed: 2 })
  })
  test('250 米外不算', () => {
    const h = v.venueHeat({ lat: 13.7231, lng: 100.5140 }, [ev('远', 13.7260, 100.5140)])
    assert.deepStrictEqual(h, { published: 0, formed: 0 })
  })
  test('haversine:曼谷两点距离量级正确(约 1.1km)', () => {
    const d = v.distanceM(13.7230, 100.5140, 13.7330, 100.5140)
    assert.ok(d > 1050 && d < 1150, String(d))
  })
})

describe('热度聚合(后台热点用)', () => {
  test('同一格子里的多种写法聚成一个,代表名取最常用的', () => {
    const heat = v.heatByCell([ev('Sarnies', 13.7230, 100.5140), ev('Sarnies Bangkok', 13.7231, 100.5141), ev('Sarnies Bangkok', 13.7230, 100.5141, 'cancelled_low')])
    assert.strictEqual(heat.length, 1)
    assert.strictEqual(heat[0].published, 3)
    assert.strictEqual(heat[0].formed, 2)
    assert.strictEqual(heat[0].name, 'Sarnies Bangkok')
  })
  test('未公开过或缺坐标的局不计', () => {
    const heat = v.heatByCell([ev('A', 13.7, 100.5, 'formed', null), { venue: { name: 'B' }, status: 'formed', publishedAt: 'x' }])
    assert.strictEqual(heat.length, 0)
  })
})

describe('推荐排序', () => {
  const venues = [
    { _id: '1', name: '咖啡馆甲', lat: 13.72, lng: 100.51, geohash: v.geohash(13.72, 100.51), sceneTypes: ['coffee'] },
    { _id: '2', name: '酒吧乙', lat: 13.74, lng: 100.53, geohash: v.geohash(13.74, 100.53), sceneTypes: ['bar'] },
    { _id: '3', name: '咖啡馆丙', lat: 13.76, lng: 100.55, geohash: v.geohash(13.76, 100.55), sceneTypes: ['coffee'] },
    { _id: '4', name: '已下架', lat: 13.70, lng: 100.50, geohash: v.geohash(13.70, 100.50), sceneTypes: ['coffee'], isActive: false },
  ]
  const near = (vn, n, status = 'formed') => Array.from({ length: n }, () => ev(vn.name, vn.lat + 0.0005, vn.lng, status))
  const events = [...near(venues[2], 4), ...near(venues[2], 1, 'cancelled_low'), ...near(venues[1], 9)]
  test('场景匹配优先于热度:酒吧再热也排在咖啡局推荐的后面', () => {
    const r = v.rankSuggestions(venues, events, 'coffee')
    assert.deepStrictEqual(r.map(x => x.name), ['咖啡馆丙', '咖啡馆甲', '酒吧乙'])
  })
  test('下架的不出现', () => {
    assert.ok(!v.rankSuggestions(venues, events, 'coffee').some(x => x.name === '已下架'))
  })
  test('limit 生效', () => {
    assert.strictEqual(v.rankSuggestions(venues, events, 'coffee', 1).length, 1)
  })
  test('投影只含填表需要的字段', () => {
    const e = v.suggestionEntry({ ...venues[0], createdBy: 'admin', geohash: 'x', isActive: true })
    assert.deepStrictEqual(Object.keys(e).sort(), ['_id', 'address', 'formed', 'lat', 'lng', 'name', 'published'])
  })
})

describe('未收录热点', () => {
  test('附近已有推荐场地的不算;达到门槛且附近没有的被找出来', () => {
    const venues = [{ lat: 13.7230, lng: 100.5140 }]
    const heat = [
      { geohash: 'a', published: 5, sample: { lat: 13.7231, lng: 100.5141 } },   // 紧挨着已有场地
      { geohash: 'b', published: 3, sample: { lat: 13.7400, lng: 100.5300 } },   // 远处,够门槛
      { geohash: 'c', published: 1, sample: { lat: 13.7600, lng: 100.5500 } },   // 远处,不够门槛
    ]
    assert.deepStrictEqual(v.unlistedHotspots(venues, heat).map(h => h.geohash), ['b'])
  })
})

describe('录入校验', () => {
  test('合法输入被清洗并补 geohash', () => {
    const r = v.normalizeVenue({ name: ' Sarnies ', address: 'Charoen Krung', lat: '13.72', lng: 100.51, sceneTypes: ['coffee', 'hotel'] })
    assert.strictEqual(r.name, 'Sarnies')
    assert.deepStrictEqual(r.sceneTypes, ['coffee'])
    assert.strictEqual(r.geohash.length, 6)
  })
  test('缺名或坐标越界 → null', () => {
    assert.strictEqual(v.normalizeVenue({ name: '', lat: 1, lng: 1 }), null)
    assert.strictEqual(v.normalizeVenue({ name: 'x', lat: 91, lng: 1 }), null)
  })
})
