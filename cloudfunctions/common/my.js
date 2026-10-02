/**
 * 「我的局」分组 —— 纯函数,无数据库依赖
 *
 * 输入:当前用户的报名记录(含局主自己的那条 isHostSignup)+ 对应的局原始文档。
 * 输出:即将开始 / 我发起的 / 过去的局 三组,每项只带页面需要的字段。
 *
 * 两条约束:
 * 1. 局一律经 publicEvent 白名单投影。原始文档里有 hostId、genderCounts,
 *    哪怕是「自己报过的局」也不该原样下发(安全测试锁住)。
 * 2. 报名记录只透出状态和是否局主,不带 userId / gender。
 */
const { publicEvent } = require('./projection')
const { EVENT_STATUS: E, SIGNUP_STATUS: S } = require('./rules')

/** 局已经结束或不会再发生的状态 */
const OVER = new Set([E.DONE, E.ARCHIVED, E.CANCELLED_LOW, E.CANCELLED_HOST, E.REJECTED])
/** 报名侧已经有结果的状态 */
const SETTLED = new Set([S.ATTENDED, S.NO_SHOW])

function endMs(event) {
  return new Date(event.startAt).getTime() + (event.durationMin || 0) * 60 * 1000
}

function isPast(signup, event, nowMs) {
  return OVER.has(event.status) || SETTLED.has(signup.status) || endMs(event) <= nowMs
}

/** 参与者视角的状态文案。tone 决定颜色:warm 进行中 / ok 已成 / mute 已结束 */
function joinerLabel(signup, event) {
  if (signup.status === S.WAITLIST) return { label: '候补中', tone: 'warm' }
  if (event.status === E.FORMED) return { label: '已成团', tone: 'ok' }
  return { label: '已报名,等成团', tone: 'warm' }
}

/**
 * 局主视角。D06「审核对报名者不可见」—— 局主本人可以知道自己的局还没放出去,
 * 措辞沿用发局成功弹窗的「待放行」,不出现「审核」二字。
 */
function hostLabel(event) {
  switch (event.status) {
    case E.PENDING_REVIEW: return { label: '待放行', tone: 'mute' }
    case E.FORMED:         return { label: '已成团', tone: 'ok' }
    default:               return { label: '招人中', tone: 'warm' }
  }
}

function pastLabel(signup, event) {
  if (event.status === E.REJECTED) return { label: '未放行', tone: 'mute' }
  if (event.status === E.CANCELLED_LOW) return { label: '人没凑齐,已解散', tone: 'mute' }
  if (event.status === E.CANCELLED_HOST) return { label: signup.isHostSignup ? '你取消了' : '局主取消了', tone: 'mute' }
  if (signup.status === S.ATTENDED) return { label: '去过了', tone: 'ok' }
  if (signup.status === S.NO_SHOW) return { label: '没去成', tone: 'mute' }
  return { label: '已结束', tone: 'mute' }
}

function item(signup, event, extra) {
  return {
    signupId: signup._id,
    signupStatus: signup.status,
    isHost: !!signup.isHostSignup,
    event: publicEvent(event),
    ...extra,
  }
}

/**
 * @param {Array<{signup, event}>} rows
 * @param {string|number|Date} now
 */
function groupMine(rows, now) {
  const nowMs = new Date(now).getTime()
  const upcoming = [], hosted = [], past = []
  for (const { signup, event } of rows) {
    if (!signup || !event || signup.status === S.CANCELLED) continue
    if (isPast(signup, event, nowMs)) {
      past.push(item(signup, event, pastLabel(signup, event)))
    } else if (signup.isHostSignup) {
      hosted.push(item(signup, event, { ...hostLabel(event), canChat: event.status === E.FORMED }))
    } else {
      upcoming.push(item(signup, event, {
        ...joinerLabel(signup, event),
        canChat: event.status === E.FORMED && signup.status === S.CONFIRMED,
      }))
    }
  }
  const asc = (a, b) => new Date(a.event.startAt) - new Date(b.event.startAt)
  upcoming.sort(asc)
  hosted.sort(asc)
  past.sort((a, b) => -asc(a, b))
  return { upcoming, hosted, past }
}

module.exports = { groupMine }
