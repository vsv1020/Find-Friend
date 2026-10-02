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

/** 「10 月 3 日」 */
function dayText(iso) {
  const d = toLocal(iso)
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`
}

/** 「15:00」 */
function clockText(iso) {
  const d = toLocal(iso)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** 「周六」 */
function weekdayText(iso) {
  return WEEKDAYS[toLocal(iso).getUTCDay()]
}

const SCENE_GLYPH = { coffee: '☕', art: '🎨', bar: '🍸' }
function sceneGlyph(sceneType) { return SCENE_GLYPH[sceneType] || '·' }

/**
 * 座位点:到位的实心、空的虚心。最多画到人数上限(硬顶 10),一眼看出「还差几个」。
 * 依然只是计数的可视化 —— 不对应任何具体的人。
 */
function seatDots(event) {
  const max = Math.min(event.capacityMax || SCENE_RULES[event.sceneType].capacityMaxDefault, 10)
  const on = Math.min(event.confirmedCount || 0, max)
  return Array.from({ length: max }, (_, i) => i < on)
}

/** 是否已达最低成团人数 */
function isFormed(event) {
  return (event.confirmedCount || 0) >= SCENE_RULES[event.sceneType].capacityMin
}

/** 页面展示用的字段一次算齐,列表与详情共用 */
function decorate(event) {
  return {
    ...event,
    startText: formatStart(event.startAt),
    dayText: dayText(event.startAt),
    clockText: clockText(event.startAt),
    weekdayText: weekdayText(event.startAt),
    sceneText: sceneLabel(event.sceneType),
    sceneGlyph: sceneGlyph(event.sceneType),
    shortByText: shortByText(event),
    seats: seatDots(event),
    formed: isFormed(event),
  }
}

module.exports = { formatStart, sceneLabel, shortByText, toLocal, dayText, clockText, weekdayText, sceneGlyph, seatDots, isFormed, decorate }
