const { test, describe } = require('node:test')
const assert = require('node:assert')
const { groupMine } = require('../cloudfunctions/common/my')
const { FORBIDDEN_EVENT_FIELDS } = require('../cloudfunctions/common/projection')

const NOW = '2026-10-02T05:00:00.000Z'
const ev = (o = {}) => ({
  _id: 'e1', sceneType: 'coffee', startAt: '2026-10-03T08:00:00.000Z', durationMin: 120,
  venue: { name: 'Sarnies' }, capacityMin: 2, capacityMax: 4, priceEstTHB: 200,
  status: 'open', confirmedCount: 1,
  hostId: 'u-host', genderCounts: { male: 1 }, qrcodeFileID: 'cloud://x', isOfficial: true,
  ...o,
})
const su = (o = {}) => ({ _id: 's1', eventId: 'e1', userId: 'u-me', gender: 'female', status: 'confirmed', ...o })

describe('我的局分组', () => {
  test('参与的未来局进「即将开始」,自己发的进「我发起的」', () => {
    const r = groupMine([
      { signup: su(), event: ev() },
      { signup: su({ _id: 's2', isHostSignup: true }), event: ev({ _id: 'e2' }) },
    ], NOW)
    assert.deepStrictEqual(r.upcoming.map(i => i.event._id), ['e1'])
    assert.deepStrictEqual(r.hosted.map(i => i.event._id), ['e2'])
    assert.strictEqual(r.past.length, 0)
  })

  test('结束、解散、被拒、已到场的都进「过去的局」', () => {
    const r = groupMine([
      { signup: su({ _id: 'a' }), event: ev({ _id: 'done', status: 'done' }) },
      { signup: su({ _id: 'b' }), event: ev({ _id: 'low', status: 'cancelled_low' }) },
      { signup: su({ _id: 'c', isHostSignup: true }), event: ev({ _id: 'rej', status: 'rejected' }) },
      { signup: su({ _id: 'd', status: 'attended' }), event: ev({ _id: 'att', status: 'formed' }) },
      // 状态还是 formed,但结束时间已过(定时任务还没跑到)
      { signup: su({ _id: 'e' }), event: ev({ _id: 'late', status: 'formed', startAt: '2026-10-02T02:00:00.000Z', durationMin: 60 }) },
    ], NOW)
    assert.strictEqual(r.upcoming.length + r.hosted.length, 0)
    assert.strictEqual(r.past.length, 5)
  })

  test('自己取消的报名不显示', () => {
    const r = groupMine([{ signup: su({ status: 'cancelled' }), event: ev() }], NOW)
    assert.strictEqual(r.upcoming.length + r.hosted.length + r.past.length, 0)
  })

  test('状态文案', () => {
    const one = (s, e) => groupMine([{ signup: su(s), event: ev(e) }], NOW)
    assert.strictEqual(one({}, {}).upcoming[0].label, '已报名,等成团')
    assert.strictEqual(one({ status: 'waitlist' }, {}).upcoming[0].label, '候补中')
    assert.strictEqual(one({}, { status: 'formed' }).upcoming[0].label, '已成团')
    assert.strictEqual(one({ isHostSignup: true }, { status: 'pending_review' }).hosted[0].label, '待放行')
    assert.strictEqual(one({ isHostSignup: true }, {}).hosted[0].label, '招人中')
    assert.strictEqual(one({}, { status: 'cancelled_host' }).past[0].label, '局主取消了')
    assert.strictEqual(one({ isHostSignup: true }, { status: 'cancelled_host' }).past[0].label, '你取消了')
    assert.strictEqual(one({ status: 'no_show' }, { status: 'done' }).past[0].label, '没去成')
  })

  test('「待放行」只对局主出现,文案不含「审核」(D06)', () => {
    const r = groupMine([{ signup: su({ isHostSignup: true }), event: ev({ status: 'pending_review' }) }], NOW)
    assert.ok(!JSON.stringify(r).includes('审核'))
  })

  test('只有已成团且确认在列的人能看到行前沟通入口', () => {
    const one = (s, e) => groupMine([{ signup: su(s), event: ev(e) }], NOW).upcoming[0].canChat
    assert.strictEqual(one({}, { status: 'formed' }), true)
    assert.strictEqual(one({}, { status: 'open' }), false)
    assert.strictEqual(one({ status: 'waitlist' }, { status: 'formed' }), false)
  })

  test('排序:即将开始按时间正序,过去的局倒序', () => {
    const r = groupMine([
      { signup: su({ _id: 'x' }), event: ev({ _id: 'later', startAt: '2026-10-04T08:00:00.000Z' }) },
      { signup: su({ _id: 'y' }), event: ev({ _id: 'sooner', startAt: '2026-10-03T08:00:00.000Z' }) },
      { signup: su({ _id: 'p1' }), event: ev({ _id: 'old', status: 'done', startAt: '2026-09-20T08:00:00.000Z' }) },
      { signup: su({ _id: 'p2' }), event: ev({ _id: 'recent', status: 'done', startAt: '2026-09-27T08:00:00.000Z' }) },
    ], NOW)
    assert.deepStrictEqual(r.upcoming.map(i => i.event._id), ['sooner', 'later'])
    assert.deepStrictEqual(r.past.map(i => i.event._id), ['recent', 'old'])
  })

  test('安全:局走白名单投影,报名记录不带 userId / gender', () => {
    const r = groupMine([
      { signup: su(), event: ev() },
      { signup: su({ _id: 's2', isHostSignup: true }), event: ev({ _id: 'e2' }) },
      { signup: su({ _id: 's3' }), event: ev({ _id: 'e3', status: 'done' }) },
    ], NOW)
    for (const it of [...r.upcoming, ...r.hosted, ...r.past]) {
      for (const f of FORBIDDEN_EVENT_FIELDS) assert.ok(!(f in it.event), `泄露 ${f}`)
      assert.ok(!('userId' in it) && !('gender' in it))
    }
  })
})
