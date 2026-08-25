/**
 * 云函数 rating —— 靠谱度评价(T18)
 *
 * ⚠️ 两条路径必须分开,见 common/reliability.js 顶部的说明:
 *   markAttendance —— 局主的**事实认定**,影响爬约计数与限制报名
 *   rate           —— 参与者的**主观评价**,只影响分数,不触发任何处罚
 *
 * PRD §5 结构层第四条:只评靠谱度,不评外貌、不评好感。
 * 枚举写死在 RELIABILITY_MARK,canRate 会拒绝任何枚举外的值。
 */
const cloud = require('wx-server-sdk')
const { canRate, applyMarks, applyPenalty, markCounts, RATE_REJECT } = require('./common/reliability')
const { RELIABILITY_MARK, SIGNUP_STATUS, EVENT_STATUS } = require('./common/rules')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ok = d => ({ ok: true, data: d })
const fail = (code, message) => ({ ok: false, code, message })

const REJECT_MESSAGE = {
  [RATE_REJECT.NOT_ENDED]: '活动还没结束',
  [RATE_REJECT.WINDOW_CLOSED]: '评价时间已过',
  [RATE_REJECT.SELF]: '不能评价自己',
  [RATE_REJECT.NOT_PARTICIPANT]: '只有一起参加过的人才能评价',
  [RATE_REJECT.DUPLICATE]: '你已经评价过了',
  [RATE_REJECT.BAD_MARK]: '不支持这种评价',
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    switch (event.action) {
      case 'pendingRatings':  return ok(await pendingRatings(OPENID))
      case 'participants':    return ok(await participants(event, OPENID))
      case 'rate':            return ok(await rate(event, OPENID))
      case 'markAttendance':  return ok(await markAttendance(event, OPENID))
      default:                return fail('unknown_action', `未知操作: ${event.action}`)
    }
  } catch (e) {
    console.error('[rating]', event.action, e)
    return fail(e.code || 'internal', e.message)
  }
}

/** 我参加过、还在评价窗口内、且尚未评完的局 */
async function pendingRatings(openid) {
  const me = await getUser(openid)
  const mine = (await db.collection('signups')
    .where({ userId: me._id, status: _.in([SIGNUP_STATUS.CONFIRMED, SIGNUP_STATUS.ATTENDED]) })
    .orderBy('createdAt', 'desc').limit(30).get()).data
  if (!mine.length) return []

  const events = (await db.collection('events')
    .where({ _id: _.in(mine.map(s => s.eventId)), status: _.in([EVENT_STATUS.DONE, EVENT_STATUS.ARCHIVED]) })
    .get()).data

  const out = []
  for (const e of events) {
    const others = await otherParticipants(e._id, me._id)
    const rated = (await db.collection('reliabilityMarks')
      .where({ eventId: e._id, raterId: me._id }).get()).data
    const ratedIds = new Set(rated.map(r => r.rateeId))
    const remaining = others.filter(p => !ratedIds.has(p.userId))
    if (remaining.length) out.push({ event: e, remaining })
  }
  return out
}

/**
 * 该局的同行者。
 * ⚠️ 只返回昵称 —— 这是产品里唯一会露出他人身份的地方,且仅限一起参加过的人。
 */
async function participants({ eventId }, openid) {
  const me = await getUser(openid)
  await assertParticipant(eventId, me._id)
  return otherParticipants(eventId, me._id)
}

/** 参与者互评 —— 只动分数,不动爬约计数 */
async function rate({ eventId, rateeId, mark }, openid) {
  const now = new Date().toISOString()
  const me = await getUser(openid)
  const e = (await db.collection('events').doc(eventId).get()).data

  const [mineCount, theirsCount, dupCount] = await Promise.all([
    db.collection('signups').where({ eventId, userId: me._id, status: _.in([SIGNUP_STATUS.CONFIRMED, SIGNUP_STATUS.ATTENDED]) }).count(),
    db.collection('signups').where({ eventId, userId: rateeId, status: _.in([SIGNUP_STATUS.CONFIRMED, SIGNUP_STATUS.ATTENDED]) }).count(),
    db.collection('reliabilityMarks').where({ eventId, raterId: me._id, rateeId }).count(),
  ])

  const verdict = canRate({
    event: e, mark, now,
    raterAttended: mineCount.total > 0,
    rateeInEvent: theirsCount.total > 0,
    alreadyRated: dupCount.total > 0,
    isSelf: rateeId === me._id,
  })
  if (!verdict.allowed) {
    throw Object.assign(new Error(REJECT_MESSAGE[verdict.reason] || '无法评价'), { code: verdict.reason })
  }

  await db.collection('reliabilityMarks').add({
    data: { eventId, raterId: me._id, rateeId, mark, createdAt: now },
  })

  // 只更新分数。互评永远不触发 applyPenalty —— 否则互相报复评价就能把人送进复核。
  const ratee = (await db.collection('users').doc(rateeId).get()).data
  await db.collection('users').doc(rateeId).update({
    data: { reliability: applyMarks(ratee.reliability == null ? 100 : ratee.reliability, [mark]) },
  })
  return { rated: true }
}

/**
 * 局主的事实认定 —— 这条路径才会影响爬约计数与限制报名。
 * 一次提交全部标记,对应「局主一键标记到场/爽约」。
 */
async function markAttendance({ eventId, marks }, openid) {
  const now = new Date().toISOString()
  const me = await getUser(openid)
  const e = (await db.collection('events').doc(eventId).get()).data
  if (e.hostId !== me._id && !me.isAdmin) {
    throw Object.assign(new Error('只有局主能标记到场情况'), { code: 'forbidden' })
  }
  if (!e.endedAt) throw Object.assign(new Error('活动还没结束'), { code: RATE_REJECT.NOT_ENDED })

  const VALID_MARKS = new Set(Object.values(RELIABILITY_MARK))
  const results = []
  for (const { userId, mark } of marks) {
    if (userId === me._id) continue                       // 局主不标记自己
    if (!VALID_MARKS.has(mark)) continue                  // 枚举外的评价一律丢弃

    const s = (await db.collection('signups')
      .where({ eventId, userId, status: _.in([SIGNUP_STATUS.CONFIRMED, SIGNUP_STATUS.ATTENDED]) })
      .limit(1).get()).data[0]
    if (!s) continue                                      // 不在这个局里,忽略

    const attended = mark !== RELIABILITY_MARK.NO_SHOW
    await db.collection('signups').doc(s._id).update({
      data: { status: attended ? SIGNUP_STATUS.ATTENDED : SIGNUP_STATUS.NO_SHOW, markedAt: now },
    })

    const u = (await db.collection('users').doc(userId).get()).data
    const patch = { reliability: applyMarks(u.reliability == null ? 100 : u.reliability, [mark]) }

    // 只有局主标记的 no_show 才计入爬约,并触发 D10 的处罚阶梯
    if (markCounts(mark)) {
      const count = (u.noShowCount || 0) + 1
      const penalty = applyPenalty(count, now)
      Object.assign(patch, {
        noShowCount: count, status: penalty.status, restrictedUntil: penalty.restrictedUntil,
      })
      if (penalty.needsManualReview) {
        await db.collection('reviewQueue').add({
          data: { type: 'repeated_no_show', userId, count, createdAt: now },
        }).catch(() => {})
      }
    }
    await db.collection('users').doc(userId).update({ data: patch })
    results.push({ userId, mark })
  }

  await db.collection('events').doc(eventId).update({ data: { attendanceMarkedAt: now } })
  return { marked: results.length }
}

// ---- helpers ----
async function otherParticipants(eventId, meId) {
  const signups = (await db.collection('signups')
    .where({ eventId, userId: _.neq(meId), status: _.in([SIGNUP_STATUS.CONFIRMED, SIGNUP_STATUS.ATTENDED, SIGNUP_STATUS.NO_SHOW]) })
    .limit(20).get()).data
  if (!signups.length) return []
  const users = (await db.collection('users').where({ _id: _.in(signups.map(s => s.userId)) }).get()).data
  const byId = Object.fromEntries(users.map(u => [u._id, u]))
  // 只给昵称。不返回 phone / gender / reliability —— 靠谱度仅局主可见(D10)
  return signups
    .filter(s => byId[s.userId])
    .map(s => ({ userId: s.userId, nickname: byId[s.userId].nickname || '这位朋友' }))
}

async function assertParticipant(eventId, userId) {
  const c = await db.collection('signups')
    .where({ eventId, userId, status: _.in([SIGNUP_STATUS.CONFIRMED, SIGNUP_STATUS.ATTENDED]) }).count()
  if (!c.total) throw Object.assign(new Error('你没有参加这个局'), { code: RATE_REJECT.NOT_PARTICIPANT })
}

async function getUser(openid) {
  const r = await db.collection('users').where({ openid }).limit(1).get()
  if (!r.data.length) throw Object.assign(new Error('账号不存在'), { code: 'no_user' })
  return r.data[0]
}
