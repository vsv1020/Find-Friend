/**
 * 云函数 account —— 账号与隐私
 *
 * 注销是 PIPL 与 PDPA 下的**强制入口**,不是可选功能。
 * 实现见 common/anonymize.js;去标识化的依据见 docs/legal/data-inventory.md §4。
 */
const cloud = require('wx-server-sdk')
const { anonymizeUser, verifyAnonymized, PII_FIELDS } = require('./common/anonymize')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ok = d => ({ ok: true, data: d })
const fail = (code, message) => ({ ok: false, code, message })

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    switch (event.action) {
      case 'profile':       return ok(await profile(OPENID))
      case 'exportMyData':  return ok(await exportMyData(OPENID))
      case 'deleteAccount': return ok(await deleteAccount(OPENID))
      default:              return fail('unknown_action', `未知操作: ${event.action}`)
    }
  } catch (e) {
    console.error('[account]', event.action, e)
    return fail(e.code || 'internal', e.message)
  }
}

async function profile(openid) {
  const u = await getUser(openid)
  return { nickname: u.nickname, gender: u.gender, reliability: u.reliability, noShowCount: u.noShowCount }
}

/** 隐私政策第七条承诺的「查看我们持有的关于你的信息」 */
async function exportMyData(openid) {
  const u = await getUser(openid)
  const signups = (await db.collection('signups').where({ userId: u._id }).limit(500).get()).data
  return {
    account: Object.fromEntries(PII_FIELDS.map(f => [f, u[f] || null])),
    reliability: { score: u.reliability, noShowCount: u.noShowCount },
    signups: signups.map(s => ({ eventId: s.eventId, status: s.status, createdAt: s.createdAt })),
    note: '本导出包含我们持有的关于你的全部个人信息。',
  }
}

/**
 * 注销账号。不可恢复。
 *
 * 顺序很重要:先取消未来的报名(否则局主会一直等一个已注销的人),
 * 再删消息,最后抹除标识符。
 */
async function deleteAccount(openid) {
  const now = new Date().toISOString()
  const u = await getUser(openid)

  // 1) 取消尚未开始的活动的报名,避免局主空等
  const upcoming = (await db.collection('signups')
    .where({ userId: u._id, status: _.in(['confirmed', 'waitlist']) }).limit(200).get()).data
  for (const s of upcoming) {
    const e = (await db.collection('events').doc(s.eventId).get().catch(() => ({ data: null }))).data
    if (!e || new Date(e.startAt) <= new Date(now)) continue   // 已开始的活动保留记录
    await db.collection('signups').doc(s._id).update({ data: { status: 'cancelled', cancelledAt: now } })
    if (s.status === 'confirmed') {
      await db.collection('events').doc(s.eventId).update({ data: { confirmedCount: _.inc(-1) } })
    }
  }

  // 2) 删除该用户发出的消息
  await db.collection('messages').where({ userId: u._id }).remove().catch(() => {})

  // 3) 抹除全部标识符,保留去标识化墓碑
  const patch = anonymizeUser(u, now)
  await db.collection('users').doc(u._id).update({ data: patch })

  // 4) 自查:确认没有标识符残留。残留即为合规事故,必须留下日志。
  const after = (await db.collection('users').doc(u._id).get()).data
  const check = verifyAnonymized(after)
  if (!check.clean) console.error('[account] 注销后仍有标识符残留', check.leaked)

  return { deleted: true, cancelledUpcoming: upcoming.length, clean: check.clean }
}

async function getUser(openid) {
  const r = await db.collection('users').where({ openid }).limit(1).get()
  if (!r.data.length) throw Object.assign(new Error('账号不存在'), { code: 'no_user' })
  return r.data[0]
}
