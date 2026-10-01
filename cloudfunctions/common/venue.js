/**
 * 推荐场地(T24)—— 纯逻辑
 *
 * D09 改为自由输入后,场地列表降级为「推荐」而非「白名单」:
 * 降低填写成本,但不限制。热度不靠名称匹配(同一家店会被写成三种名字),
 * 靠坐标 geohash 聚合 —— 这正是 D09 要求「必须保存坐标」的原因。
 */
const { VENUE, SCENE } = require('./rules')

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

/** 标准 geohash 编码。precision 6 ≈ ±0.6km,足以把同一家店的多次选点聚到一起 */
function geohash(lat, lng, precision = VENUE.heatmapGeohashPrecision) {
  let latRange = [-90, 90], lngRange = [-180, 180]
  let hash = '', bit = 0, ch = 0, even = true
  while (hash.length < precision) {
    if (even) {
      const mid = (lngRange[0] + lngRange[1]) / 2
      if (lng >= mid) { ch = (ch << 1) | 1; lngRange[0] = mid } else { ch <<= 1; lngRange[1] = mid }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2
      if (lat >= mid) { ch = (ch << 1) | 1; latRange[0] = mid } else { ch <<= 1; latRange[1] = mid }
    }
    even = !even
    if (++bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0 }
  }
  return hash
}

/**
 * 按 geohash 统计热度:每个格子里公开过的局数、成团数、最近一次出现的名称。
 * @param {object[]} events 需含 venue{lat,lng,name,address}、publishedAt、status
 */
function heatByCell(events) {
  const cells = new Map()
  for (const e of events) {
    const v = e.venue
    if (!e.publishedAt || !v || typeof v.lat !== 'number' || typeof v.lng !== 'number') continue
    const key = geohash(v.lat, v.lng)
    const c = cells.get(key) || { geohash: key, published: 0, formed: 0, names: new Map(), sample: v }
    c.published++
    if (['formed', 'done', 'archived'].includes(e.status)) c.formed++
    c.names.set(v.name, (c.names.get(v.name) || 0) + 1)
    cells.set(key, c)
  }
  return [...cells.values()].map(c => ({
    geohash: c.geohash, published: c.published, formed: c.formed,
    // 最常用的写法作为代表名称,方便后台一键收录
    name: [...c.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
    sample: c.sample,
  }))
}

/** 两点间距离(米),haversine */
function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6371000, toRad = d => d * Math.PI / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * 某个推荐场地的热度:半径内公开过的局数与成团数。
 * ⚠️ 这里不用 geohash 格子:靠近格边的店会被劈到两个格子里,热度被低估一半。
 *    按距离算精确且不受格边影响;场地 ≤200 × 局 ≤1000 的量级,直接双重循环即可。
 */
function venueHeat(venue, events, radiusM = VENUE.heatRadiusM) {
  let published = 0, formed = 0
  for (const e of events) {
    const v = e.venue
    if (!e.publishedAt || !v || typeof v.lat !== 'number' || typeof v.lng !== 'number') continue
    if (distanceM(venue.lat, venue.lng, v.lat, v.lng) > radiusM) continue
    published++
    if (['formed', 'done', 'archived'].includes(e.status)) formed++
  }
  return { published, formed }
}

/**
 * 发局时的推荐排序:场景匹配优先 → 热度(成团数,再公开数)→ 名称。
 * @param {object[]} venues 推荐场地(含 lat/lng、sceneTypes、isActive)
 * @param {object[]} events 已公开的局(含 venue 坐标与 status)
 * @param {string} sceneType
 */
function rankSuggestions(venues, events, sceneType, limit = VENUE.suggestLimit) {
  return venues
    .filter(v => v.isActive !== false)
    .map(v => {
      const h = venueHeat(v, events)
      const sceneMatch = !sceneType || !v.sceneTypes || !v.sceneTypes.length || v.sceneTypes.includes(sceneType)
      return { ...v, published: h.published, formed: h.formed, sceneMatch }
    })
    .sort((a, b) => (b.sceneMatch - a.sceneMatch) || (b.formed - a.formed) || (b.published - a.published) || a.name.localeCompare(b.name, 'zh'))
    .slice(0, limit)
}

/**
 * 后台「未收录的热点」:有热度但附近没有推荐场地的格子,供一键收录。
 * 这里用 geohash 粗聚合即可 —— 格边劈分最多让某个热点少算一点,不影响「值不值得收录」的判断;
 * 「附近是否已有推荐场地」按距离判,避免同一家店因格边被重复推荐收录。
 */
function unlistedHotspots(venues, heat, minPublished = VENUE.hotspotMinPublished) {
  return heat
    .filter(h => h.published >= minPublished)
    .filter(h => !venues.some(v => typeof v.lat === 'number' && distanceM(v.lat, v.lng, h.sample.lat, h.sample.lng) <= VENUE.heatRadiusM))
    .sort((a, b) => b.published - a.published)
}

/** 推荐场地的对外投影(发局表单用):只给填表需要的字段 */
function suggestionEntry(v) {
  return { _id: v._id, name: v.name, address: v.address, lat: v.lat, lng: v.lng, formed: v.formed || 0, published: v.published || 0 }
}

/** 校验并清洗后台录入的场地 */
function normalizeVenue(input) {
  const i = input || {}
  const name = typeof i.name === 'string' ? i.name.trim().slice(0, 60) : ''
  const address = typeof i.address === 'string' ? i.address.trim().slice(0, 120) : ''
  const lat = Number(i.lat), lng = Number(i.lng)
  const sceneTypes = Array.isArray(i.sceneTypes) ? i.sceneTypes.filter(s => Object.values(SCENE).includes(s)) : []
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { name, address, lat, lng, sceneTypes, geohash: geohash(lat, lng), isActive: i.isActive !== false }
}

module.exports = { geohash, distanceM, venueHeat, heatByCell, rankSuggestions, unlistedHotspots, suggestionEntry, normalizeVenue }
