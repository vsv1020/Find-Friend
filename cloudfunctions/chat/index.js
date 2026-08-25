/**
 * 云函数 chat —— 行前沟通(T17)
 *
 * 权限与校验全部委托给 common/chat.js 的纯函数(有单元测试),
 * 本文件只负责取数、内容安全调用与落库。
 *
 * 【为什么不用 db.watch】
 * watch 是客户端直连数据库、走数据库权限,与「集合仅管理端可读写、
 * 前端一律走云函数」的设计直接冲突,要用就得引入自定义安全规则与
 * eventMembers 凭据集合。见 docs/06 §2。V1 用轮询。
 */
const cloud = require('wx-server-sdk')
const { canEnter, canSend, normalizeContent, PAGE_SIZE, CHAT_REJECT } = require('./common/chat')
const { interpret, onError, needsCheck, ACTION } = require('./common/moderation')
const { SIGNUP_STATUS } = require('./common/rules')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ok = d => ({ ok: true, data: d })
const fail = (code, message) => ({ ok: false, code, message })

const REJECT_MESSAGE = {
  [CHAT_REJECT.NOT_FORMED]: '人齐了才会开放沟通',
  [CHAT_REJECT.NOT_MEMBER]: '只有确认参加的人可以进',
  [CHAT_REJECT.ARCHIVED]: '这个局已经结束,沟通已关闭',
  [CHAT_REJECT.EMPTY]: '说点什么吧',
  [CHAT_REJECT.TOO_LONG]: '太长了,精简一下',
  risky: '这条消息没能发出去',
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    switch (event.action) {
      case 'list': return ok(await list(event, OPENID))
      case 'send': return ok(await send(event, OPENID))
      default:     return fail('unknown_action', `未知操作: ${event.action}`)
    }
  } catch (e) {
    console.error('[chat]', event.action, e)
    return fail(e.code || 'internal', e.message)
  }
}

/**
 * 拉消息。
 * 传 since 拉增量(轮询用),不传则拉最近一页(进页面时用)。
 */
async function list({ eventId, since }, openid) {
  const { me, e, signupStatus } = await context(eventId, openid)
  const verdict = canEnter({ event: e, signupStatus })
  if (!verdict.allowed) throw reject(verdict.reason)

  const where = since ? { eventId, createdAt: _.gt(since) } : { eventId }
  const rows = (await db.collection('messages')
    .where(where)
    .orderBy('createdAt', since ? 'asc' : 'desc')
    .limit(PAGE_SIZE).get()).data
  const messages = since ? rows : rows.reverse()

  const nicknames = await nicknamesFor(messages.map(m => m.userId))
  return {
    archived: Boolean(e.chatArchivedAt),
    chatArchivedAt: e.chatArchivedAt || null,
    messages: messages.map(m => ({
      _id: m._id, content: m.content, createdAt: m.createdAt,
      nickname: nicknames[m.userId] || '这位朋友',
      isMine: m.userId === me._id,
    })),
  }
}

/** 发消息。必须先过内容安全(T28),这是微信审核的硬性要求。 */
async function send({ eventId, content: raw }, openid) {
  const { me, e, signupStatus } = await context(eventId, openid)
  const verdict = canSend({ event: e, signupStatus })
  if (!verdict.allowed) throw reject(verdict.reason)

  const normalized = normalizeContent(raw)
  if (!normalized.ok) throw reject(normalized.reason)
  const content = normalized.content

  const check = await moderate(content, openid)
  if (check.action === ACTION.REJECT) throw reject('risky')

  const now = new Date().toISOString()
  const doc = { eventId, userId: me._id, content, createdAt: now }
  // 机器不确定或未检测成功的,入库但留痕,交人工复核
  if (check.action === ACTION.FLAG) {
    doc.moderation = { suggest: check.suggest, label: check.label || null, error: check.error || null }
  }
  const added = await db.collection('messages').add({ data: doc })

  if (check.action === ACTION.FLAG) {
    await db.collection('reviewQueue').add({
      data: { type: 'message_flagged', messageId: added._id, eventId, userId: me._id,
              suggest: check.suggest, createdAt: now },
    }).catch(() => {})
  }
  return { messageId: added._id, createdAt: now }
}

/** 内容安全检测。失败时按 moderation.onError 的降级策略处理(放行并留痕)。 */
async function moderate(content, openid) {
  if (!needsCheck(content)) return { action: ACTION.PASS }
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content, version: 2, scene: 2, openid,   // scene 2 = 评论/聊天
    })
    return interpret(res)
  } catch (err) {
    console.warn('[chat] msgSecCheck 调用失败,按降级策略放行并留痕', err && err.message)
    return onError(err)
  }
}

// ---- helpers ----
async function context(eventId, openid) {
  const me = await getUser(openid)
  const e = (await db.collection('events').doc(eventId).get().catch(() => ({ data: null }))).data
  if (!e) throw Object.assign(new Error('活动不存在'), { code: 'not_found' })
  const s = (await db.collection('signups')
    .where({ eventId, userId: me._id }).limit(1).get()).data[0]
  return { me, e, signupStatus: s ? s.status : null }
}

/** 只取昵称。不返回任何其他用户信息 —— 这里也不例外。 */
async function nicknamesFor(userIds) {
  const ids = [...new Set(userIds)]
  if (!ids.length) return {}
  const users = (await db.collection('users').where({ _id: _.in(ids) }).get()).data
  return Object.fromEntries(users.map(u => [u._id, u.nickname]))
}

async function getUser(openid) {
  const r = await db.collection('users').where({ openid }).limit(1).get()
  if (!r.data.length) throw Object.assign(new Error('账号不存在'), { code: 'no_user' })
  return r.data[0]
}

function reject(reason) {
  return Object.assign(new Error(REJECT_MESSAGE[reason] || '无法操作'), { code: reason })
}
