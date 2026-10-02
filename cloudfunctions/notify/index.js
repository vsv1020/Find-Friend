/**
 * 云函数 notify —— 通知发送端(定时,每分钟)
 *
 * 消费 notifications 队列中 status=pending 的记录,经微信订阅消息发出。
 * 幂等由入队时的 dedupeKey 唯一索引保证;本函数只负责「发」与「记录结果」。
 * 逻辑(模板解析、字段组装、错误分类)在 common/notify.js,有测试。
 */
const cloud = require('wx-server-sdk')
const { resolveTemplate, buildData, classifyError, OUTCOME } = require('./common/notify')
const { NOTIFY } = require('./common/rules')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async () => {
  const now = new Date().toISOString()
  const summary = { sent: 0, refused: 0, retry: 0, failed: 0, skipped: 0 }

  const pending = (await db.collection('notifications')
    .where({ status: 'pending', channel: 'wx_subscribe' })
    .orderBy('createdAt', 'asc').limit(NOTIFY.drainBatchSize).get()).data

  for (const n of pending) {
    // 先占住这条记录,防止两个并发触发重复发送
    const lock = await db.collection('notifications')
      .where({ _id: n._id, status: 'pending' })
      .update({ data: { status: 'sending', lockedAt: now } })
    if (!lock.stats.updated) continue

    const template = resolveTemplate(n.templateKey)
    if (!template) {
      await finish(n._id, OUTCOME.SKIPPED, { error: `缺模板 ID: ${n.templateKey}` })
      summary.skipped++
      continue
    }

    const [user, event] = await Promise.all([
      db.collection('users').doc(n.userId).get().then(r => r.data).catch(() => null),
      n.eventId ? db.collection('events').doc(n.eventId).get().then(r => r.data).catch(() => null) : null,
    ])
    if (!user || !user.openid) { await finish(n._id, OUTCOME.FAILED, { error: '用户不存在或已注销' }); summary.failed++; continue }

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: user.openid,
        templateId: template.templateId,
        page: n.eventId ? `${template.page}?eventId=${n.eventId}` : template.page,
        data: buildData(n, event, template),
        miniprogramState: process.env.MP_STATE || 'formal',   // developer | trial | formal
      })
      await finish(n._id, OUTCOME.SENT, {})
      summary.sent++
    } catch (err) {
      const outcome = classifyError(err && err.errCode, n.attempts || 0)
      await finish(n._id, outcome, { error: String(err && (err.errMsg || err.message)), attempts: _.inc(1) })
      summary[outcome === OUTCOME.RETRY ? 'retry' : outcome === OUTCOME.REFUSED ? 'refused' : 'failed']++
    }
  }

  console.log('[notify]', JSON.stringify(summary))
  return summary
}

async function finish(id, status, extra) {
  await db.collection('notifications').doc(id).update({
    data: { status, ...extra, ...(status === OUTCOME.SENT ? { sentAt: new Date().toISOString() } : {}) },
  })
}
