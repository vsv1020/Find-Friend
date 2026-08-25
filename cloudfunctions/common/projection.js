/**
 * 局的对外投影 —— 泄露防线的单一出口
 *
 * 白名单显式列出:将来给 events 加任何字段(审核痕迹、内部标记、
 * 小程序码 fileID)都**默认不泄露**,除非有意加进这里。
 * 有安全测试锁住:投影结果不得出现白名单以外的键。
 */
const PUBLIC_EVENT_FIELDS = [
  '_id', 'sceneType', 'startAt', 'durationMin', 'venue',
  'capacityMin', 'capacityMax', 'priceEstTHB', 'description',
  'status', 'confirmedCount', 'shareCode',
]

/** 明确不得出现在投影里的敏感字段(测试用断言清单,防白名单被误扩) */
const FORBIDDEN_EVENT_FIELDS = [
  'hostId',            // 局主身份 —— 顺着它就能标识用户
  'genderCounts',      // 报名者构成 —— 泄露会诱发「看人报名」
  'qrcodeFileID', 'reviewedBy', 'reviewNote', 'takedownBy',
  'isOfficial', 'adminFilledIn',   // 指标去噪标记,不是给用户看的
]

function publicEvent(e) {
  const out = {}
  for (const k of PUBLIC_EVENT_FIELDS) {
    if (e[k] !== undefined) out[k] = e[k]
  }
  if (out.confirmedCount === undefined) out.confirmedCount = 0
  return out
}

module.exports = { publicEvent, PUBLIC_EVENT_FIELDS, FORBIDDEN_EVENT_FIELDS }
