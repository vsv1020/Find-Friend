/**
 * 云函数 formation —— 成团判定定时任务
 *
 * 触发:每 15 分钟(见 config/timer.json)
 *
 * 【幂等性】定时任务必然会重复执行、也可能失败重试,因此:
 *   1. 每次动作前先查当前状态,非预期状态直接跳过;
 *   2. 催报名靠 rallyNoticeSentAt 标记去重;
 *   3. 通知写入 notifications 表时带去重键,发送端二次去重。
 * 判定逻辑本身是 common/formation.js 的纯函数,有单元测试覆盖边界情况。
 */
const cloud = require('wx-server-sdk')
const { judge, isEnded } = require('./common/formation')
const { STATUS, transition, SIGNUP_OPEN_STATES } = require('./common/state-machine')
const { CHAT } = require('./common/rules')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async () => {
  const now = new Date().toISOString()
  const summary = { formed: 0, cancelledLow: 0, rallied: 0, done: 0, archived: 0, errors: [] }

  // 1) 待判定的局:仍处于可报名状态且尚未开始太久
  const pending = (await db.collection('events')
    .where({ status: _.in(SIGNUP_OPEN_STATES) })
    .orderBy('startAt', 'asc').limit(200).get()).data

  for (const e of pending) {
    try {
      const verdict = judge(e, now)
      if (verdict.action === 'form')        { await doForm(e, now, verdict); summary.formed++ }
      else if (verdict.action === 'cancel_low') { await doCancelLow(e, now, verdict); summary.cancelledLow++ }
      else if (verdict.action === 'rally')  { await doRally(e, now, verdict); summary.rallied++ }
    } catch (err) {
      console.error('[formation] judge failed', e._id, err)
      summary.errors.push({ eventId: e._id, message: err.message })
    }
  }

  // 2) 已成团且活动已结束 -> done
  const formed = (await db.collection('events').where({ status: STATUS.FORMED }).limit(200).get()).data
  for (const e of formed) {
    if (!isEnded(e, now)) continue
    try {
      const rec = transition(e.status, STATUS.DONE, { reason: '活动结束', at: now })
      await db.collection('events').doc(e._id).update({ data: { status: rec.status, endedAt: now } })
      await log(e._id, rec)
      await notifyParticipants(e._id, 'review_invite')   // 邀请互评靠谱度
      summary.done++
    } catch (err) { summary.errors.push({ eventId: e._id, message: err.message }) }
  }

  // 3) 结束满 48 小时 -> archived,群聊转只读(PRD §4.1「不沉淀私聊关系链」)
  const cutoff = new Date(Date.now() - CHAT.archiveAfterEndHours * 3600 * 1000).toISOString()
  const toArchive = (await db.collection('events')
    .where({ status: STATUS.DONE, endedAt: _.lt(cutoff) }).limit(200).get()).data
  for (const e of toArchive) {
    try {
      const rec = transition(e.status, STATUS.ARCHIVED, { reason: '结束满48小时', at: now })
      await db.collection('events').doc(e._id).update({ data: { status: rec.status, chatArchivedAt: now } })
      await log(e._id, rec)
      summary.archived++
    } catch (err) { summary.errors.push({ eventId: e._id, message: err.message }) }
  }

  console.log('[formation]', JSON.stringify(summary))
  return summary
}

async function doForm(e, now, verdict) {
  const rec = transition(e.status, STATUS.FORMED, { reason: verdict.reason, at: now })
  // 条件更新:仅当状态仍为判定时读到的值才写入,防止并发下重复流转
  const r = await db.collection('events')
    .where({ _id: e._id, status: e.status })
    .update({ data: { status: rec.status, formedAt: now } })
  if (!r.stats.updated) return          // 已被其他执行处理,静默跳过
  await log(e._id, rec)
  await notifyParticipants(e._id, 'event_formed')
}

async function doCancelLow(e, now, verdict) {
  const rec = transition(e.status, STATUS.CANCELLED_LOW, { reason: verdict.reason, at: now })
  const r = await db.collection('events')
    .where({ _id: e._id, status: e.status })
    .update({ data: { status: rec.status, cancelledAt: now } })
  if (!r.stats.updated) return
  await log(e._id, rec)
  // 解散通知必须附带同时段其他局的推荐 —— 把一次失败转成二次机会(缓解密度风险)
  await notifyParticipants(e._id, 'event_cancelled_low')
}

/** D04 的配套缓解:开始前 24 小时催报名,让用户有机会自己改变结果 */
async function doRally(e, now, verdict) {
  const r = await db.collection('events')
    .where({ _id: e._id, rallyNoticeSentAt: _.eq(null) })
    .update({ data: { rallyNoticeSentAt: now } })
  if (!r.stats.updated) return
  await notifyParticipants(e._id, 'event_rally', { shortBy: verdict.shortBy })
}

async function notifyParticipants(eventId, templateKey, payload = {}) {
  const signups = (await db.collection('signups')
    .where({ eventId, status: _.in(['confirmed', 'waitlist']) }).limit(100).get()).data
  const now = new Date().toISOString()
  for (const s of signups) {
    await db.collection('notifications').add({
      data: {
        userId: s.userId, eventId, templateKey, payload,
        channel: 'wx_subscribe', status: 'pending',
        // 去重键:同一用户、同一局、同一模板只发一次
        dedupeKey: `${s.userId}:${eventId}:${templateKey}`,
        createdAt: now,
      },
    }).catch(() => { /* 唯一索引冲突即已发过,忽略 */ })
  }
}

async function log(eventId, rec) {
  await db.collection('eventStatusLog').add({ data: { eventId, ...rec } })
}
