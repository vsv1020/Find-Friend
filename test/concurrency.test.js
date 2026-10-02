/**
 * 对撞测试 —— 用随机交错调度轰炸 atomic.js 的临界区编排
 *
 * 关键:被测的 attemptJoin / attemptCancel / promoteOne 就是生产代码本身
 * (cloudfunctions/signups 调用的同一模块),测试只替换存储实现。
 * 内存 ops 的每个方法先随机让出若干次微任务再原子执行 ——
 * 等价于在任意语句边界插入并发交错。每个用例跑多个随机种子。
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { attemptJoin, attemptCancel } = require('../cloudfunctions/common/atomic')
const { SIGNUP_STATUS } = require('../cloudfunctions/common/rules')

/** 确定性伪随机(LCG),同一种子可复现失败 */
function lcg(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

/** 内存存储:让出随机次微任务制造交错,随后的读改写同步完成(原子) */
function makeMemOps(rand) {
  const events = new Map()
  const signups = new Map()
  let nextId = 1
  const yieldRandom = async () => {
    const n = Math.floor(rand() * 4)
    for (let i = 0; i < n; i++) await Promise.resolve()
  }
  const ops = {
    async reserveSlot(eventId) {
      await yieldRandom()
      const e = events.get(eventId)
      if (e.confirmedCount < e.capacityMax) { e.confirmedCount++; return true }
      return false
    },
    async releaseSlot(eventId) {
      await yieldRandom()
      const e = events.get(eventId)
      if (e.confirmedCount > 0) e.confirmedCount--
    },
    async adjustGender(eventId, gender, delta) {
      await yieldRandom()
      const e = events.get(eventId)
      e.genderCounts[gender] = (e.genderCounts[gender] || 0) + delta
    },
    async addSignup(doc) {
      await yieldRandom()
      // 唯一索引 (eventId, userId) —— 与真库一致:**不认状态**,已取消的记录同样阻挡插入
      for (const s of signups.values()) {
        if (s.eventId === doc.eventId && s.userId === doc.userId) return null
      }
      const _id = `s${nextId++}`
      signups.set(_id, { _id, ...doc })
      return { _id }
    },
    async findSignup(eventId, userId) {
      await yieldRandom()
      return [...signups.values()].find(s => s.eventId === eventId && s.userId === userId) || null
    },
    async casSignupStatus(id, from, to) {
      await yieldRandom()
      const s = signups.get(id)
      if (!s || s.status !== from) return false
      s.status = to
      return true
    },
    async earliestWaitlist(eventId) {
      await yieldRandom()
      const list = [...signups.values()]
        .filter(s => s.eventId === eventId && s.status === SIGNUP_STATUS.WAITLIST)
        .sort((a, b) => a.createdAt < b.createdAt ? -1 : 1)
      return list[0] || null
    },
    async casEventStatus(eventId, from, patch) {
      await yieldRandom()
      const e = events.get(eventId)
      if (!e || e.status !== from) return false
      Object.assign(e, patch)
      return true
    },
  }
  return { ops, events, signups }
}

/** 不变量:计数与实际 confirmed 一致、不超卖、无重复有效报名 */
function assertInvariants({ events, signups }, eventId, label) {
  const e = events.get(eventId)
  const confirmed = [...signups.values()]
    .filter(s => s.eventId === eventId && s.status === SIGNUP_STATUS.CONFIRMED)
  assert.strictEqual(e.confirmedCount, confirmed.length,
    `${label}: confirmedCount(${e.confirmedCount}) ≠ 实际 confirmed(${confirmed.length})`)
  assert.ok(e.confirmedCount <= e.capacityMax, `${label}: 超卖 ${e.confirmedCount}/${e.capacityMax}`)
  const active = [...signups.values()].filter(s => s.eventId === eventId && s.status !== SIGNUP_STATUS.CANCELLED)
  const users = active.map(s => s.userId)
  assert.strictEqual(new Set(users).size, users.length, `${label}: 同一用户有多条有效报名`)
}

const SEEDS = [1, 7, 42, 1337, 20260829]
const t = i => `2026-08-25T00:00:${String(i).padStart(2, '0')}.000Z`

describe('对撞:并发报名抢最后名额', () => {
  for (const seed of SEEDS) {
    test(`20 人并发抢 4 个名额,恰好 4 个 confirmed(seed=${seed})`, async () => {
      const rand = lcg(seed)
      const h = makeMemOps(rand)
      h.events.set('e1', { _id: 'e1', capacityMax: 4, confirmedCount: 0, genderCounts: {} })

      const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
        attemptJoin(h.ops, { eventId: 'e1', userId: `u${i}`, gender: 'male', now: t(i) })))

      const confirmed = results.filter(r => r.status === SIGNUP_STATUS.CONFIRMED).length
      const waitlist = results.filter(r => r.status === SIGNUP_STATUS.WAITLIST).length
      assert.strictEqual(confirmed, 4, `应恰好 4 个 confirmed,实际 ${confirmed}`)
      assert.strictEqual(waitlist, 16)
      assertInvariants(h, 'e1', `seed=${seed}`)
    })
  }
})

describe('对撞:同一用户并发重复报名', () => {
  for (const seed of SEEDS) {
    test(`同一用户 10 个并发请求只成功一次(seed=${seed})`, async () => {
      const rand = lcg(seed)
      const h = makeMemOps(rand)
      h.events.set('e1', { _id: 'e1', capacityMax: 4, confirmedCount: 0, genderCounts: {} })

      const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
        attemptJoin(h.ops, { eventId: 'e1', userId: 'same', gender: 'male', now: t(i) })))

      const okCount = results.filter(r => r.status !== 'duplicate').length
      assert.strictEqual(okCount, 1, `应只成功 1 次,实际 ${okCount}`)
      assertInvariants(h, 'e1', `seed=${seed}`)
      // 关键:撞唯一索引后必须把占的座还回去,否则名额被幽灵占用
      assert.strictEqual(h.events.get('e1').confirmedCount, 1)
    })
  }
})

describe('对撞:并发取消触发候补递补', () => {
  for (const seed of SEEDS) {
    test(`2 个并发取消,3 个候补,恰好递补 2 人且按先来后到(seed=${seed})`, async () => {
      const rand = lcg(seed)
      const h = makeMemOps(rand)
      h.events.set('e1', { _id: 'e1', capacityMax: 2, confirmedCount: 0, genderCounts: {} })

      // 2 个 confirmed 占满,3 个候补排队
      for (let i = 0; i < 5; i++) {
        await attemptJoin(h.ops, { eventId: 'e1', userId: `u${i}`, gender: 'male', now: t(i) })
      }
      const confirmedIds = [...h.signups.values()]
        .filter(s => s.status === SIGNUP_STATUS.CONFIRMED).map(s => s._id)
      assert.strictEqual(confirmedIds.length, 2)

      const results = await Promise.all(confirmedIds.map(id =>
        attemptCancel(h.ops, { signupId: id, eventId: 'e1', gender: 'male', now: t(9) })))

      assert.ok(results.every(r => r.cancelled && r.wasConfirmed))
      const promoted = results.map(r => r.promoted).filter(Boolean)
      assert.strictEqual(promoted.length, 2, `应恰好递补 2 人,实际 ${promoted.length}`)
      // 无双重递补:两次递补的是不同的人
      assert.strictEqual(new Set(promoted.map(p => p.userId)).size, 2)
      // 先来后到:u2、u3 先于 u4 排队
      assert.ok(promoted.every(p => ['u2', 'u3'].includes(p.userId)),
        `应递补最早候补 u2/u3,实际 ${promoted.map(p => p.userId)}`)
      assertInvariants(h, 'e1', `seed=${seed}`)
    })
  }
})

describe('对撞:取消与新报名同时抢释放的座位', () => {
  for (const seed of SEEDS) {
    test(`混合取消+新报名不破坏不变量(seed=${seed})`, async () => {
      const rand = lcg(seed)
      const h = makeMemOps(rand)
      h.events.set('e1', { _id: 'e1', capacityMax: 3, confirmedCount: 0, genderCounts: {} })

      for (let i = 0; i < 3; i++) {
        await attemptJoin(h.ops, { eventId: 'e1', userId: `old${i}`, gender: 'female', now: t(i) })
      }
      const ids = [...h.signups.values()].map(s => s._id)

      // 3 个取消与 6 个新报名同时开跑
      await Promise.all([
        ...ids.map(id => attemptCancel(h.ops, { signupId: id, eventId: 'e1', gender: 'female', now: t(20) })),
        ...Array.from({ length: 6 }, (_, i) =>
          attemptJoin(h.ops, { eventId: 'e1', userId: `new${i}`, gender: 'male', now: t(30 + i) })),
      ])
      assertInvariants(h, 'e1', `seed=${seed}`)
      // 座位应被充分利用:混战结束后满员
      assert.strictEqual(h.events.get('e1').confirmedCount, 3)
    })
  }
})

describe('对撞:取消后重新报名(唯一索引不认状态)', () => {
  for (const seed of SEEDS) {
    test(`取消后可重新报名,且并发重报只成功一次(seed=${seed})`, async () => {
      const rand = lcg(seed)
      const h = makeMemOps(rand)
      h.events.set('e1', { _id: 'e1', capacityMax: 4, confirmedCount: 0, genderCounts: {} })

      await attemptJoin(h.ops, { eventId: 'e1', userId: 'u1', gender: 'male', now: t(0) })
      const id = [...h.signups.keys()][0]
      await attemptCancel(h.ops, { signupId: id, eventId: 'e1', gender: 'male', now: t(1) })

      // 并发重新报名:同一条已取消记录被 CAS 复活,只能成功一次
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        attemptJoin(h.ops, { eventId: 'e1', userId: 'u1', gender: 'male', now: t(2 + i) })))
      const okCount = results.filter(r => r.status !== 'duplicate').length
      assert.strictEqual(okCount, 1, `重报应只成功一次,实际 ${okCount}`)
      assertInvariants(h, 'e1', `seed=${seed}`)
      assert.strictEqual(h.events.get('e1').confirmedCount, 1)
      // 全程只有一条记录 —— 复活而非新增
      assert.strictEqual(h.signups.size, 1)
    })
  }
})

describe('对撞:成团判定重复触发(定时任务并发/重试)', () => {
  for (const seed of SEEDS) {
    test(`5 个并发 form 尝试只成功一次(seed=${seed})`, async () => {
      const rand = lcg(seed)
      const h = makeMemOps(rand)
      h.events.set('e1', { _id: 'e1', status: 'open', capacityMax: 4, confirmedCount: 2, genderCounts: {} })

      const results = await Promise.all(Array.from({ length: 5 }, () =>
        h.ops.casEventStatus('e1', 'open', { status: 'formed' })))
      assert.strictEqual(results.filter(Boolean).length, 1,
        'CAS 保证成团只流转一次 —— 这是成团通知不重发的基础')
    })
  }
})

describe('对撞:取消的幂等性', () => {
  for (const seed of SEEDS) {
    test(`同一报名并发取消 5 次只生效一次(seed=${seed})`, async () => {
      const rand = lcg(seed)
      const h = makeMemOps(rand)
      h.events.set('e1', { _id: 'e1', capacityMax: 4, confirmedCount: 0, genderCounts: {} })
      await attemptJoin(h.ops, { eventId: 'e1', userId: 'u1', gender: 'male', now: t(0) })
      const id = [...h.signups.keys()][0]

      const results = await Promise.all(Array.from({ length: 5 }, () =>
        attemptCancel(h.ops, { signupId: id, eventId: 'e1', gender: 'male', now: t(1) })))
      assert.strictEqual(results.filter(r => r.cancelled).length, 1,
        '重复取消只能生效一次 —— 否则计数会被减成负数')
      assertInvariants(h, 'e1', `seed=${seed}`)
    })
  }
})
