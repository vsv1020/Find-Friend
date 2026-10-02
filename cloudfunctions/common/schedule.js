/**
 * 周末时段计算 —— 支撑 PRD §4.1「三十秒内填完发局」
 *
 * 发局表单 6 个字段里,「日期时间」是最费神的一个。给出「本周六下午」这类快捷选项,
 * 局主点一下就完事,不用开日期选择器。
 *
 * 用户全部在曼谷,统一按 UTC+7 计算,不依赖运行环境时区
 * (云函数跑在国内,本地时区是 UTC+8,直接用 Date 的本地方法会算错一小时)。
 */
const { SCENE, FORMATION } = require('./rules')

const TZ_OFFSET_MS = 7 * 3600 * 1000
const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 各场景的默认开始时间(曼谷当地小时) */
const DEFAULT_HOUR = {
  [SCENE.COFFEE]: 15,  // 下午咖啡局
  [SCENE.ART]: 14,     // 展览/市集,留足逛的时间
  [SCENE.BAR]: 20,     // 晚间小酒馆
}

/** 把 UTC 时刻换算成曼谷当地的日期部件 */
function bangkokParts(iso) {
  const d = new Date(new Date(iso).getTime() + TZ_OFFSET_MS)
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(),
    weekday: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes(),
  }
}

/** 构造「曼谷当地某天某点」对应的 UTC ISO 串 */
function bangkokTimeToISO({ year, month, day, hour }) {
  return new Date(Date.UTC(year, month, day, hour, 0, 0) - TZ_OFFSET_MS).toISOString()
}

/**
 * 生成周末快捷时段。
 *
 * 只返回「仍来得及成团」的时段 —— 若某个时段距现在已不足判定提前量(D04 的 6 小时),
 * 发出去也会被立刻判定解散,不如不给这个选项。
 *
 * @param {string|Date} now
 * @param {string} sceneType
 * @param {number} count 返回几个选项
 * @returns {{label:string, startAt:string}[]}
 */
function weekendSlots(now, sceneType = SCENE.COFFEE, count = 3) {
  const hour = DEFAULT_HOUR[sceneType] || 15
  const p = bangkokParts(now)
  const base = Date.UTC(p.year, p.month, p.day)   // 曼谷当地的今天零点
  // 发出去就被判定解散的时段没有意义,至少要留出判定提前量 + 1 小时缓冲
  const minLeadMs = (FORMATION.judgeBeforeStartHours + 1) * HOUR
  const nowMs = new Date(now).getTime()

  const out = []
  // 向后扫两周,足以覆盖「周日深夜发局」这类边界
  for (let offset = 0; offset <= 14 && out.length < count; offset++) {
    const d = new Date(base + offset * DAY)
    const weekday = d.getUTCDay()
    if (weekday !== 0 && weekday !== 6) continue   // 只给周末

    const startAt = bangkokTimeToISO({
      year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour,
    })
    if (new Date(startAt).getTime() - nowMs < minLeadMs) continue

    out.push({ label: `${weekLabel(offset, p.weekday)}${WEEKDAY_NAMES[weekday]} ${pad(hour)}:00`, startAt })
  }
  return out
}

/**
 * 「本周六」还是「下周六」
 *
 * ⚠️ 中文语境下「本周」是周一到周日,周日是本周的**最后一天**;
 *    而 JS 的 getDay() 里周日是 0(第一天)。直接用 getDay() 算会让周日发局时
 *    把下周六误标成「本周六」。因此先换算成周一起始的序号。
 */
function weekLabel(dayOffset, todayWeekday) {
  const mondayIndex = (todayWeekday + 6) % 7        // 周一=0 … 周日=6
  const daysLeftThisWeek = 6 - mondayIndex
  return dayOffset <= daysLeftThisWeek ? '本' : '下'
}

function pad(n) { return String(n).padStart(2, '0') }

module.exports = { weekendSlots, bangkokParts, bangkokTimeToISO, DEFAULT_HOUR, WEEKDAY_NAMES }
