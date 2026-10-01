/**
 * 云函数 venues —— 推荐场地(T24),对所有用户开放的只读接口
 * 后台维护走 admin 云函数。热度由已发布局的坐标聚合,逻辑在 common/venue.js。
 */
const cloud = require('wx-server-sdk')
const { rankSuggestions, suggestionEntry } = require('./common/venue')
const { VENUE } = require('./common/rules')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  try {
    if (event.action !== 'suggest') return { ok: false, code: 'unknown_action', message: `未知操作: ${event.action}` }
    const sceneType = typeof event.sceneType === 'string' ? event.sceneType : null
    const [venues, events] = await Promise.all([
      db.collection('venues').where({ isActive: true }).limit(200).get().then(r => r.data),
      db.collection('events').where({ publishedAt: _.neq(null) }).orderBy('publishedAt', 'desc')
        .field({ venue: true, status: true, publishedAt: true }).limit(VENUE.heatFetchLimit).get().then(r => r.data),
    ])
    return { ok: true, data: rankSuggestions(venues, events, sceneType).map(suggestionEntry) }
  } catch (e) {
    console.error('[venues]', e)
    return { ok: false, code: 'internal', message: e.message }
  }
}
