const { SCENE_RULES } = require('../config/rules')

/** 曼谷时间 UTC+7 —— 用户全部在曼谷,统一按该时区展示 */
const TZ_OFFSET_HOURS = 7
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function toLocal(iso) {
  return new Date(new Date(iso).getTime() + TZ_OFFSET_HOURS * 3600 * 1000)
}

/** 「周六 15:00」 */
function formatStart(iso) {
  const d = toLocal(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${WEEKDAYS[d.getUTCDay()]} ${hh}:${mm}`
}

function sceneLabel(sceneType) {
  return (SCENE_RULES[sceneType] || {}).label || sceneType
}

/**
 * 「还差 2 人」/「已成团」
 * ⚠️ 只显示计数,绝不显示参与者头像或昵称 —— PRD §5「只匹配活动不匹配人」的界面约束。
 */
function shortByText(event) {
  const min = SCENE_RULES[event.sceneType].capacityMin
  const short = min - event.confirmedCount
  if (short > 0) return `还差 ${short} 人`
  return event.confirmedCount >= (event.capacityMax || SCENE_RULES[event.sceneType].capacityMaxDefault)
    ? '已满,可加候补' : '已成团,仍可加入'
}

module.exports = { formatStart, sceneLabel, shortByText, toLocal }
