/**
 * 并发安全的临界区编排(对撞测试的对象)
 *
 * 【为什么存在】
 * 原实现的报名是「读 event → evaluate → 写 signup + inc 计数」——
 * 两个并发请求同时抢最后一个名额,都会通过 evaluate,双双 confirmed,超卖。
 * 候补递补同理:两个取消并发触发,同一个候补者被递补两次,计数多加。
 *
 * 【怎么修】
 * 名额的**唯一权威来源**是 events 上的条件自增:
 *   where({ _id, confirmedCount < capacityMax }).update({ confirmedCount: inc(1) })
 * 数据库保证该操作原子:匹配即占座成功,不匹配即满员。evaluate 只做前置快速失败。
 *
 * 【为什么抽成本模块】
 * 编排逻辑接受一个 ops 存储接口注入 ——
 * 生产走 makeTcbOps(云数据库),测试走内存实现并用随机调度制造交错。
 * **测试与生产跑的是同一段编排代码**,而不是测一个仿写的影子。
 *
 * ops 接口(每个方法必须原子):
 *   reserveSlot(eventId)                    条件占座,满员返回 false
 *   releaseSlot(eventId)                    释放一个座位
 *   adjustGender(eventId, gender, delta)    性别计数
 *   addSignup(doc)                          写报名;唯一索引(eventId,userId)冲突返回 null
 *   casSignupStatus(id, from, to)           报名状态 CAS,不匹配返回 false
 *   earliestWaitlist(eventId)               最早的候补(可能已被别人处理,靠 CAS 兜底)
 *   casEventStatus(eventId, from, patch)    局状态 CAS(成团判定的幂等基础)
 */
const { SIGNUP_STATUS } = require('./rules')

/**
 * 报名(临界区)。
 * 顺序很重要:先占座再写报名 —— 反过来会出现「报名已写入但座位被别人占走」的悬空态。
 * 占座成功但写报名撞了唯一索引(并发重复报名),必须把座位还回去。
 */
async function attemptJoin(ops, { eventId, userId, gender, now }) {
  const reserved = await ops.reserveSlot(eventId)
  const target = reserved ? SIGNUP_STATUS.CONFIRMED : SIGNUP_STATUS.WAITLIST

  let added = await ops.addSignup({ eventId, userId, gender, status: target, createdAt: now })
  if (!added) {
    // 撞唯一索引:要么是有效报名(真重复),要么是此前取消过(重新报名)。
    // ⚠️ 数据库的 (eventId,userId) 唯一索引不认状态 —— 已取消的记录同样挡住 add,
    //    重新报名必须走「已取消记录的 CAS 复活」,而不是插入新记录。
    const existing = await ops.findSignup(eventId, userId)
    if (existing && existing.status === SIGNUP_STATUS.CANCELLED &&
        await ops.casSignupStatus(existing._id, SIGNUP_STATUS.CANCELLED, target)) {
      added = { _id: existing._id, rejoined: true }
    }
  }
  if (!added) {
    if (reserved) {
      await ops.releaseSlot(eventId)   // 占了座但没落成报名:还回去
      // ⚠️ 还座后必须触发递补,和取消路径对齐。否则会出现真实的活锁:
      //    并发重报中,抢到座位的都 CAS 失败还座,而 CAS 赢家恰好没抢到座 ——
      //    记录复活成了候补,座位却全空着,没人再去填。
      await promoteOne(ops, eventId)
    }
    return { status: 'duplicate' }
  }
  if (reserved) await ops.adjustGender(eventId, gender, 1)
  return { status: target }
}

/**
 * 取消(临界区)+ 候补递补。
 * 用两次 CAS 区分「取消时是 confirmed 还是 waitlist」—— 条件更新本身就是答案,
 * 不需要先读后写(先读后写正是竞态的来源)。
 */
async function attemptCancel(ops, { signupId, eventId, gender, now }) {
  if (await ops.casSignupStatus(signupId, SIGNUP_STATUS.CONFIRMED, SIGNUP_STATUS.CANCELLED, now)) {
    await ops.releaseSlot(eventId)
    await ops.adjustGender(eventId, gender, -1)
    const promoted = await promoteOne(ops, eventId)
    return { cancelled: true, wasConfirmed: true, promoted }
  }
  if (await ops.casSignupStatus(signupId, SIGNUP_STATUS.WAITLIST, SIGNUP_STATUS.CANCELLED, now)) {
    return { cancelled: true, wasConfirmed: false, promoted: null }
  }
  return { cancelled: false }               // 已被取消过/已流转,幂等返回
}

/**
 * 递补一个候补者。
 * 先占座 → 再 CAS 候补状态。CAS 失败说明这个候补被并发的另一次递补拿走了,
 * 把座位还回去,换下一个人重试。循环上界 = 候补队列长度,不会死循环。
 */
async function promoteOne(ops, eventId) {
  for (;;) {
    const w = await ops.earliestWaitlist(eventId)
    if (!w) return null
    const seat = await ops.reserveSlot(eventId)
    if (!seat) return null                  // 座位又被新报名抢了,不递补
    if (await ops.casSignupStatus(w._id, SIGNUP_STATUS.WAITLIST, SIGNUP_STATUS.CONFIRMED)) {
      await ops.adjustGender(eventId, w.gender, 1)
      return { userId: w.userId, signupId: w._id }
    }
    await ops.releaseSlot(eventId)          // 这个候补被别人递补了,还座,试下一个
  }
}

/**
 * 云数据库实现。每个方法都是单条条件更新 —— 云数据库保证其原子性。
 * @param {object} db wx-server-sdk 的 database()
 */
function makeTcbOps(db) {
  const _ = db.command
  return {
    async reserveSlot(eventId) {
      // capacityMax 存在文档里,而 TCB 的 where 不支持字段间比较,
      // 因此先读 capacityMax,再以它为条件做原子自增。
      // 这不会引入竞态:capacityMax 发布后不可变(没有任何修改它的接口),
      // 读到的值恒有效;真正的临界资源 confirmedCount 始终只经条件更新变化。
      const e = (await db.collection('events').doc(eventId).get()).data
      const upd = await db.collection('events')
        .where({ _id: eventId, confirmedCount: _.lt(e.capacityMax) })
        .update({ data: { confirmedCount: _.inc(1) } })
      return upd.stats.updated === 1
    },
    async releaseSlot(eventId) {
      await db.collection('events').where({ _id: eventId, confirmedCount: _.gt(0) })
        .update({ data: { confirmedCount: _.inc(-1) } })
    },
    async adjustGender(eventId, gender, delta) {
      await db.collection('events').doc(eventId)
        .update({ data: { [`genderCounts.${gender}`]: _.inc(delta) } })
        .catch(() => {})
    },
    async addSignup(doc) {
      try {
        const r = await db.collection('signups').add({ data: doc })
        return { _id: r._id }
      } catch (e) {
        return null                          // 唯一索引冲突
      }
    },
    async casSignupStatus(id, from, to, at) {
      const r = await db.collection('signups').where({ _id: id, status: from })
        .update({ data: { status: to, ...(to === SIGNUP_STATUS.CANCELLED ? { cancelledAt: at } : {}) } })
      return r.stats.updated === 1
    },
    async findSignup(eventId, userId) {
      const r = await db.collection('signups')
        .where({ eventId, userId }).limit(1).get()
      return r.data[0] || null
    },
    async earliestWaitlist(eventId) {
      const r = await db.collection('signups')
        .where({ eventId, status: SIGNUP_STATUS.WAITLIST })
        .orderBy('createdAt', 'asc').limit(1).get()
      return r.data[0] || null
    },
    async casEventStatus(eventId, from, patch) {
      const r = await db.collection('events').where({ _id: eventId, status: from })
        .update({ data: patch })
      return r.stats.updated === 1
    },
  }
}

module.exports = { attemptJoin, attemptCancel, promoteOne, makeTcbOps }
