const { test, describe } = require('node:test')
const assert = require('node:assert')
const h = require('../cloudfunctions/common/host')
const { HOST_TOOLS, FORMATION } = require('../config/rules')
const { MAX_DAYS_AHEAD, startAtWindowError } = require('../cloudfunctions/common/validate')
const { viewerOf, publicEvent } = require('../cloudfunctions/common/projection')
const { isBlocked } = require('../cloudfunctions/common/report')

const NOW = '2026-08-25T00:00:00.000Z'
const MIN = 60 * 1000
const HOUR = 60 * MIN
const at = ms => new Date(Date.parse(NOW) + ms).toISOString()

describe('canBroadcast 冷却', () => {
  const cd = HOST_TOOLS.broadcastCooldownMinutes * MIN

  test('冷却时长来自配置', () => {
    assert.strictEqual(HOST_TOOLS.broadcastCooldownMinutes, 10)
  })

  test('从未群发过 → 放行', () => {
    assert.strictEqual(h.canBroadcast({ lastBroadcastAt: null, now: NOW }).allowed, true)
    assert.strictEqual(h.canBroadcast({ lastBroadcastAt: undefined, now: NOW }).allowed, true)
  })

  test('冷却差 1ms → 拒绝,并给出下次可发时间', () => {
    const r = h.canBroadcast({ lastBroadcastAt: NOW, now: at(cd - 1) })
    assert.strictEqual(r.allowed, false)
    assert.strictEqual(r.reason, h.HOST_REJECT.COOLDOWN)
    assert.strictEqual(r.nextAllowedAt, at(cd))
  })

  test('恰好满冷却 → 放行', () => {
    assert.strictEqual(h.canBroadcast({ lastBroadcastAt: NOW, now: at(cd) }).allowed, true)
  })

  test('刚发完立即再发 → 拒绝', () => {
    assert.strictEqual(h.canBroadcast({ lastBroadcastAt: NOW, now: NOW }).allowed, false)
  })

  test('传入状态时,非 open/formed 的局不能群发', () => {
    for (const status of ['done', 'cancelled_host', 'cancelled_low', 'pending_review', 'archived']) {
      assert.strictEqual(h.canBroadcast({ lastBroadcastAt: null, now: NOW, status }).reason,
        h.HOST_REJECT.BAD_STATUS, status)
    }
    assert.strictEqual(h.canBroadcast({ lastBroadcastAt: null, now: NOW, status: 'formed' }).allowed, true)
  })

  test('去重键精确到分钟:同一分钟重放落同一键,跨分钟不同', () => {
    const k1 = h.broadcastDedupeKey({ userId: 'u1', eventId: 'e1', now: at(5 * 1000) })
    const k2 = h.broadcastDedupeKey({ userId: 'u1', eventId: 'e1', now: at(50 * 1000) })
    const k3 = h.broadcastDedupeKey({ userId: 'u1', eventId: 'e1', now: at(cd) })
    assert.strictEqual(k1, k2)
    assert.notStrictEqual(k1, k3)
    assert.ok(k1.startsWith('u1:e1:broadcast:'))
  })
})

describe('canReschedule 状态与时间边界', () => {
  const oldStart = at(3 * 24 * HOUR)
  const open = { status: 'open', startAt: oldStart }
  const formed = { status: 'formed', startAt: oldStart }
  const minLead = (FORMATION.judgeBeforeStartHours + 1) * HOUR

  test('open 可改,返回归一化时间且状态不变', () => {
    const r = h.canReschedule({ event: open, newStartAt: at(4 * 24 * HOUR), now: NOW })
    assert.strictEqual(r.allowed, true)
    assert.strictEqual(r.startAt, at(4 * 24 * HOUR))
    assert.strictEqual(r.status, 'open')
  })

  test('done / 取消 / 待审 的局不可改', () => {
    for (const status of ['done', 'archived', 'cancelled_host', 'cancelled_low', 'pending_review', 'rejected']) {
      const r = h.canReschedule({ event: { status, startAt: oldStart }, newStartAt: at(4 * 24 * HOUR), now: NOW })
      assert.strictEqual(r.allowed, false, status)
      assert.strictEqual(r.reason, h.HOST_REJECT.BAD_STATUS)
    }
  })

  test('过近拒绝 —— 与发局同一口径', () => {
    const r = h.canReschedule({ event: open, newStartAt: at(minLead - 1), now: NOW })
    assert.strictEqual(r.reason, 'startAt_too_soon')
    assert.strictEqual(h.canReschedule({ event: open, newStartAt: at(minLead), now: NOW }).allowed, true)
  })

  test('过去的时间拒绝', () => {
    assert.strictEqual(h.canReschedule({ event: open, newStartAt: '2020-01-01T00:00:00Z', now: NOW }).reason,
      'startAt_too_soon')
  })

  test('过远拒绝', () => {
    const limit = MAX_DAYS_AHEAD * 24 * HOUR
    assert.strictEqual(h.canReschedule({ event: open, newStartAt: at(limit + 1), now: NOW }).reason, 'startAt_too_far')
    assert.strictEqual(h.canReschedule({ event: open, newStartAt: at(limit), now: NOW }).allowed, true)
  })

  test('改期边界与发局校验共用同一函数', () => {
    assert.strictEqual(startAtWindowError(at(minLead - 1), NOW), 'startAt_too_soon')
    assert.strictEqual(startAtWindowError(at(minLead), NOW), null)
  })

  test('垃圾时间 / 非字符串被拒', () => {
    for (const bad of ['garbage', 12345, null, { $gt: '' }, ['2026']]) {
      assert.strictEqual(h.canReschedule({ event: open, newStartAt: bad, now: NOW }).reason,
        h.HOST_REJECT.BAD_TIME, JSON.stringify(bad))
    }
  })

  test('与原时间相同被拒', () => {
    assert.strictEqual(h.canReschedule({ event: open, newStartAt: oldStart, now: NOW }).reason,
      h.HOST_REJECT.SAME_TIME)
  })

  test('formed 改晚 → 保持 formed', () => {
    const r = h.canReschedule({ event: formed, newStartAt: at(5 * 24 * HOUR), now: NOW })
    assert.strictEqual(r.allowed, true)
    assert.strictEqual(r.status, 'formed')
  })

  test('formed 改早 → 拒绝(状态机没有 formed → open)', () => {
    const r = h.canReschedule({ event: formed, newStartAt: at(2 * 24 * HOUR), now: NOW })
    assert.strictEqual(r.reason, h.HOST_REJECT.FORMED_EARLIER)
  })

  test('open 改早是允许的 —— 仍会在新时点被正常判定', () => {
    assert.strictEqual(h.canReschedule({ event: open, newStartAt: at(2 * 24 * HOUR), now: NOW }).allowed, true)
  })

  test('改期日志:状态不变,reason 记录旧→新时间', () => {
    const log = h.rescheduleLog({ event: formed, newStartAt: at(5 * 24 * HOUR), now: NOW })
    assert.strictEqual(log.from, 'formed')
    assert.strictEqual(log.status, 'formed')
    assert.ok(log.reason.includes(oldStart) && log.reason.includes(at(5 * 24 * HOUR)))
    assert.strictEqual(log.changedAt, NOW)
  })
})

describe('roster 输出字段白名单(护城河 + D10)', () => {
  const fullUser = {
    _id: 'u2', openid: 'oXYZ', phone: '+8613800000000', notifyPhone: '+66800000000',
    nickname: '小王', gender: 'female', avatarUrl: 'https://x', isAdmin: false, isHost: false,
    reliability: 88, noShowCount: 1, status: 'active', restrictedUntil: null, createdAt: NOW,
  }
  const signup = { _id: 's2', eventId: 'e1', userId: 'u2', status: 'confirmed', gender: 'female', createdAt: NOW }

  test('输出键集合恰好是白名单', () => {
    const out = h.rosterEntry(fullUser, signup)
    assert.deepStrictEqual(Object.keys(out).sort(),
      ['isHostSignup', 'nickname', 'noShowCount', 'reliability', 'status', 'userId'])
    assert.deepStrictEqual(Object.keys(out).sort(), [...h.ROSTER_FIELDS].sort())
  })

  test('不含 phone / gender / openid 及其他资料', () => {
    const out = h.rosterEntry(fullUser, signup)
    for (const k of ['phone', 'notifyPhone', 'gender', 'openid', 'avatarUrl', 'isAdmin', 'restrictedUntil', '_id']) {
      assert.ok(!(k in out), `泄露了 ${k}`)
    }
    assert.strictEqual(out.status, 'confirmed')   // 是报名状态,不是账号状态
    assert.strictEqual(out.reliability, 88)
    assert.strictEqual(out.noShowCount, 1)
  })

  test('账号已注销(user 缺失)仍保留座位,字段给默认值', () => {
    const out = h.rosterEntry(null, signup)
    assert.deepStrictEqual(Object.keys(out).sort(), [...h.ROSTER_FIELDS].sort())
    assert.strictEqual(out.nickname, '这位朋友')
    assert.strictEqual(out.reliability, 100)
    assert.strictEqual(out.noShowCount, 0)
  })

  test('buildRoster:排除已取消,局主置顶,候补排最后', () => {
    const signups = [
      { userId: 'w', status: 'waitlist', createdAt: at(3) },
      { userId: 'c', status: 'confirmed', createdAt: at(2) },
      { userId: 'x', status: 'cancelled', createdAt: at(1) },
      { userId: 'h', status: 'confirmed', isHostSignup: true, createdAt: at(4) },
    ]
    const out = h.buildRoster(signups, [{ _id: 'c', nickname: 'C' }])
    assert.deepStrictEqual(out.map(r => r.userId), ['h', 'c', 'w'])
    assert.strictEqual(out[0].isHostSignup, true)
    for (const r of out) assert.deepStrictEqual(Object.keys(r).sort(), [...h.ROSTER_FIELDS].sort())
  })
})

describe('权限与通知对象', () => {
  test('只有局主本人或管理员能操作', () => {
    const e = { hostId: 'u1' }
    assert.strictEqual(h.isHostOf({ _id: 'u1' }, e), true)
    assert.strictEqual(h.isHostOf({ _id: 'u2' }, e), false)
    assert.strictEqual(h.isHostOf({ _id: 'u2', isAdmin: true }, e), true)
    assert.strictEqual(h.isHostOf(null, e), false)
    assert.strictEqual(h.isHostOf({}, { hostId: undefined }), false)   // 缺 _id 不能碰巧相等
  })

  test('通知对象按状态筛选、去重、排除操作者', () => {
    const signups = [
      { userId: 'h', status: 'confirmed' }, { userId: 'a', status: 'confirmed' },
      { userId: 'b', status: 'waitlist' }, { userId: 'c', status: 'cancelled' },
      { userId: 'a', status: 'confirmed' },
    ]
    assert.deepStrictEqual(h.notifyTargets(signups, ['confirmed'], 'h'), ['a'])
    assert.deepStrictEqual(h.notifyTargets(signups, ['confirmed', 'waitlist'], 'h'), ['a', 'b'])
  })

  test('封禁用户不能用局主工具(走 isBlocked 单一出口)', () => {
    assert.strictEqual(isBlocked({ status: 'banned' }, 'host_tools', NOW).blocked, true)
    assert.strictEqual(isBlocked({ status: 'restricted', restrictedUntil: at(HOUR) }, 'host_tools', NOW).blocked, false)
  })
})

describe('detail 的 viewer 字段', () => {
  const doc = { _id: 'e1', hostId: 'u1', sceneType: 'coffee', startAt: NOW, status: 'open', confirmedCount: 1 }

  test('只含 isHost / signupStatus,不含 hostId', () => {
    const v = viewerOf({ user: { _id: 'u1' }, event: doc, signup: { status: 'confirmed' } })
    assert.deepStrictEqual(v, { isHost: true, signupStatus: 'confirmed' })
    const merged = { ...publicEvent(doc), viewer: v }
    assert.strictEqual(merged.hostId, undefined)
    assert.ok(!JSON.stringify(merged).includes('u1'), '结果里不得出现局主 id')
  })

  test('未登录 / 无账号 → 默认值,不抛错', () => {
    assert.deepStrictEqual(viewerOf({ user: null, event: doc, signup: null }), { isHost: false, signupStatus: null })
  })

  test('非局主的报名者', () => {
    assert.deepStrictEqual(viewerOf({ user: { _id: 'u2' }, event: doc, signup: { status: 'waitlist' } }),
      { isHost: false, signupStatus: 'waitlist' })
  })
})

const { describe: dH, test: tH } = require('node:test')
const aH = require('node:assert')
const hostMod = require('../cloudfunctions/common/host')
dH('改期冷却(T23 发现 #7)', () => {
  const ev = { status: 'open', startAt: '2026-09-05T08:00:00Z', rescheduledAt: '2026-09-01T00:00:00Z' }
  tH('刚改过期,一小时内再改被拒 —— 每改一次全员收通知,反复改期就是骚扰', () => {
    const r = hostMod.canReschedule({ event: ev, newStartAt: '2026-09-06T08:00:00Z', now: '2026-09-01T00:30:00Z' })
    aH.strictEqual(r.reason, hostMod.HOST_REJECT.RESCHEDULE_COOLDOWN)
  })
  tH('冷却结束后可再改', () => {
    const r = hostMod.canReschedule({ event: ev, newStartAt: '2026-09-06T08:00:00Z', now: '2026-09-01T02:00:00Z' })
    aH.strictEqual(r.allowed, true)
  })
})
