/**
 * 云函数 poster —— 生成带参小程序码
 *
 * 【为什么单独一个云函数】
 * wxacode.getUnlimited 有**每日调用配额**,而同一个局的码内容永不变化。
 * 因此首次生成后存入云存储并把 fileID 写回 events,后续直接复用 ——
 * 不做缓存的话,一个局被分享十次就白白消耗十次配额。
 *
 * 海报本身在小程序端合成(见 miniprogram/utils/poster.js),
 * 云函数只负责小程序码 —— 避免在云函数里装 node-canvas 这类二进制依赖。
 */
const cloud = require('wx-server-sdk')
const { toScene } = require('./common/sharecode')
const { PUBLISHED } = require('./common/state-machine')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ok = d => ({ ok: true, data: d })
const fail = (code, message) => ({ ok: false, code, message })

exports.main = async (event) => {
  try {
    if (event.action !== 'qrcode') return fail('unknown_action', `未知操作: ${event.action}`)
    return ok(await qrcode(event.eventId))
  } catch (e) {
    console.error('[poster]', e)
    return fail(e.code || 'internal', e.message)
  }
}

async function qrcode(eventId) {
  const e = (await db.collection('events').doc(eventId).get()).data
  if (!e || !PUBLISHED.includes(e.status)) {
    throw Object.assign(new Error('活动不存在'), { code: 'not_found' })
  }
  // 命中缓存直接返回,不消耗配额
  if (e.qrcodeFileID) return { fileID: e.qrcodeFileID, cached: true }

  const res = await cloud.openapi.wxacode.getUnlimited({
    scene: toScene(e.shareCode),        // 8 位短码,远低于 scene 的 32 字符上限
    page: 'pages/event-detail/index',
    checkPath: false,                   // 体验版/未发布时 page 尚不存在,必须关掉校验
    width: 430,
    autoColor: false,
    lineColor: { r: 26, g: 26, b: 26 },
    isHyaline: false,
  })

  const up = await cloud.uploadFile({
    cloudPath: `qrcode/${e.shareCode}.png`,
    fileContent: res.buffer,
  })
  await db.collection('events').doc(eventId).update({ data: { qrcodeFileID: up.fileID } })
  return { fileID: up.fileID, cached: false }
}
