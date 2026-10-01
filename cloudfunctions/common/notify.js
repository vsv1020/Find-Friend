/**
 * 通知发送的纯逻辑(发送端在 cloudfunctions/notify)
 *
 * 【为什么以前没有发送端】
 * 各云函数只把通知写进 notifications 队列(带 dedupeKey 保证不重发),
 * 但从未有人消费这个队列 —— 成团通知实际上发不出去。这是上线前最后一个功能缺口。
 *
 * 本模块负责:模板解析、订阅消息 data 字段组装、错误分类(重试 / 放弃 / 用户拒收)。
 * 不含任何网络调用,可完整测试。
 */
const { NOTIFY } = require('./rules')

/** 订阅消息 thing 类字段上限 20 字,超长会被微信拒绝 */
const THING_MAX = 20

function clip(text, max = THING_MAX) {
  const chars = [...String(text == null ? '' : text)]
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…'
}

/** 解析模板:返回 {templateId, title};缺 ID 返回 null(调用方标 skipped) */
function resolveTemplate(templateKey, env = process.env) {
  const t = NOTIFY.templates[templateKey]
  if (!t) return null
  const templateId = env[t.envKey]
  if (!templateId) return null
  return { templateId, title: t.title, page: 'pages/event-detail/index' }
}

/**
 * 组装订阅消息 data。字段名按常见模板约定(thing1 标题 / thing2 内容 / time3 时间),
 * ⚠️ 部署时按你在微信后台实际选的模板调整键名 —— 这是唯一必须对照后台的地方。
 */
function buildData(notification, event, template) {
  const payload = notification.payload || {}
  const venue = event && event.venue && event.venue.name
  const body = ({
    event_formed:        () => `${venue || '活动'} 人齐了,准时见`,
    event_cancelled_low: () => `${venue || '活动'} 没凑齐,看看别的局`,
    event_rally:         () => `还差 ${payload.shortBy || 1} 人,转发给朋友`,
    event_rescheduled:   () => `改到 ${payload.newStartText || '新时间'}`,
    waitlist_promoted:   () => `${venue || '活动'} 有位置了`,
    review_invite:       () => '花 10 秒评一下同行者',
    host_broadcast:      () => payload.content || '局主有新消息',
  }[notification.templateKey] || (() => ''))()

  return {
    thing1: { value: clip(template.title) },
    thing2: { value: clip(body) },
    time3: { value: event && event.startAt ? formatTime(event.startAt) : '-' },
  }
}

/** 曼谷时间 「2026-08-29 15:00」,订阅消息 time 类字段要求的格式 */
function formatTime(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000)
  const p = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

const OUTCOME = {
  SENT: 'sent',
  REFUSED: 'failed_refused',     // 用户未授权/已拒收:不重试,这是用户的选择
  RETRY: 'pending',              // 临时错误:留在队列
  FAILED: 'failed',              // 超过重试上限或永久错误
  SKIPPED: 'skipped_no_template',
}

/**
 * 把微信接口的错误码映射成队列动作。
 * 43101 = 用户拒绝接收;43104/43107 = 模板问题(永久);45009/-1 = 限流/系统繁忙(临时)
 */
function classifyError(errCode, attempts) {
  const code = Number(errCode)
  if (code === 43101) return OUTCOME.REFUSED
  if (code === 43104 || code === 43107 || code === 47003) return OUTCOME.FAILED
  return attempts + 1 >= NOTIFY.maxAttempts ? OUTCOME.FAILED : OUTCOME.RETRY
}

module.exports = { resolveTemplate, buildData, classifyError, clip, formatTime, OUTCOME, THING_MAX }
