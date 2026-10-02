const { test, describe } = require('node:test')
const assert = require('node:assert')
const m = require('../cloudfunctions/common/metrics')
const { METRICS, SIGNUP_STATUS } = require('../cloudfunctions/common/rules')
const { STATUS } = require('../cloudfunctions/common/state-machine')

// 曼谷 2026-09-29(周二)12:00;本周周一为 2026-09-28
const NOW = '2026-09-29T05:00:00Z'

const view = (o = {}) => ({ name: m.FUNNEL.VIEW, createdAt: '2026-09-20T00:00:00Z', ...o })
const start = (o = {}) => ({ ...view(o), name: m.FUNNEL.START })
const success = (o = {}) => ({ ...view(o), name: m.FUNNEL.SUCCESS })

describe('signupFunnel 报名漏斗', () => {
  test('同一 openid 多次浏览只算 1 个访客', () => {
    const r = m.signupFunnel([view({ openid: 'o1' }), view({ openid: 'o1' }), view({ openid: 'o1' })])
    assert.strictEqual(r.views, 1)
  })

  test('openid 优先于 anonId —— 同一条埋点两者都有时按 openid 去重', () => {
    const r = m.signupFunnel([
      view({ openid: 'o1', anonId: 'a1' }),
      view({ openid: 'o1', anonId: 'a2' }),   // 清过缓存换了 anonId,仍是同一人
    ])
    assert.strictEqual(r.views, 1)
  })

  test('只有 anonId 的访客也计入,并按 anonId 去重', () => {
    const r = m.signupFunnel([view({ anonId: 'a1' }), view({ anonId: 'a1' }), view({ anonId: 'a2' })])
    assert.strictEqual(r.views, 2)
  })

  test('已知口径:登录前 anonId、登录后 openid 视为两个访客', () => {
    // 埋点里没有 anonId↔openid 的映射,无法把两段行为合并到同一人。
    // 后果:浏览访客数偏高、转化率偏低(保守方向)。小程序里 OPENID 由云函数自动注入,
    // 实际只有 openid 缺失的极少数埋点会走 anonId,影响有限。
    const r = m.signupFunnel([
      view({ anonId: 'a1' }),
      view({ openid: 'o1' }),
      success({ openid: 'o1' }),
    ])
    assert.strictEqual(r.views, 2)
    assert.strictEqual(r.successes, 1)
    assert.strictEqual(r.viewToSignupRate, 0.5)
  })

  test('没有任何标识的埋点被忽略', () => {
    assert.strictEqual(m.signupFunnel([view(), view({ openid: null, anonId: null })]).views, 0)
  })

  test('三级漏斗计数与转化率', () => {
    const r = m.signupFunnel([
      view({ openid: 'o1' }), view({ openid: 'o2' }), view({ openid: 'o3' }), view({ openid: 'o4' }),
      start({ openid: 'o1' }), start({ openid: 'o2' }),
      success({ openid: 'o1' }),
    ])
    assert.deepStrictEqual(r, { views: 4, starts: 2, successes: 1, viewToSignupRate: 0.25 })
  })

  test('未浏览过的报名成功不进分子 —— 保证转化率不超过 1', () => {
    const r = m.signupFunnel([view({ openid: 'o1' }), success({ openid: 'o2' })])
    assert.strictEqual(r.successes, 0)
    assert.strictEqual(r.viewToSignupRate, 0)
  })

  test('signup_start 埋点丢失时,报名成功仍计入核心转化率', () => {
    const r = m.signupFunnel([view({ openid: 'o1' }), success({ openid: 'o1' })])
    assert.strictEqual(r.starts, 0)
    assert.strictEqual(r.successes, 1)
  })

  test('无关埋点被忽略', () => {
    const r = m.signupFunnel([{ name: 'share_poster_save', openid: 'o1' }])
    assert.strictEqual(r.views, 0)
  })

  test('无样本时转化率为 null 而非 0', () => {
    assert.strictEqual(m.signupFunnel([]).viewToSignupRate, null)
    assert.strictEqual(m.signupFunnel([success({ openid: 'o1' })]).viewToSignupRate, null)
  })
})

describe('repeatParticipation 30 天二次参加', () => {
  const att = (userId, createdAt, status = SIGNUP_STATUS.ATTENDED) => ({ userId, status, createdAt })
  const FIRST = '2026-08-01T03:00:00Z'   // 曼谷 8/1 10:00

  test('第 30 天再次参加算复购', () => {
    const r = m.repeatParticipation([att('u1', FIRST), att('u1', '2026-08-31T15:00:00Z')], { now: NOW })
    assert.deepStrictEqual(r, { users: 1, repeaters: 1, pending: 0, rate: 1 })
  })

  test('第 31 天不算 —— 按曼谷自然日,UTC 8/31 17:30 已是曼谷 9/1', () => {
    const r = m.repeatParticipation([att('u1', FIRST), att('u1', '2026-08-31T17:30:00Z')], { now: NOW })
    assert.strictEqual(r.repeaters, 0)
    assert.strictEqual(r.rate, 0)
  })

  test('只统计 attended,报名了但没到场不算参加', () => {
    const r = m.repeatParticipation([
      att('u1', FIRST),
      att('u1', '2026-08-05T03:00:00Z', SIGNUP_STATUS.CONFIRMED),
      att('u1', '2026-08-06T03:00:00Z', SIGNUP_STATUS.NO_SHOW),
      att('u2', FIRST, SIGNUP_STATUS.CANCELLED),
    ], { now: NOW })
    assert.deepStrictEqual(r, { users: 1, repeaters: 0, pending: 0, rate: 0 })
  })

  test('输入乱序时按时间排序找首次参加', () => {
    const r = m.repeatParticipation([
      att('u1', '2026-08-20T03:00:00Z'), att('u1', '2026-07-01T03:00:00Z'),
    ], { now: NOW })
    assert.strictEqual(r.repeaters, 0, '首次是 7/1,8/20 已超出 30 天')
  })

  test('首次参加距今不满窗口的用户记 pending,不进分母', () => {
    const r = m.repeatParticipation([
      att('u1', FIRST), att('u1', '2026-08-10T03:00:00Z'),
      att('u2', FIRST),
      att('u3', '2026-09-10T03:00:00Z'), att('u3', '2026-09-12T03:00:00Z'),  // 已复购但窗口未关闭
      att('u4', '2026-09-20T03:00:00Z'),
    ], { now: NOW })
    assert.deepStrictEqual(r, { users: 2, repeaters: 1, pending: 2, rate: 0.5 })
  })

  test('晚于 now 的记录被忽略', () => {
    const r = m.repeatParticipation([att('u1', FIRST), att('u1', '2026-08-02T03:00:00Z')],
      { now: '2026-07-30T00:00:00Z' })
    assert.deepStrictEqual(r, { users: 0, repeaters: 0, pending: 0, rate: null })
  })

  test('无样本时 rate 为 null', () => {
    assert.strictEqual(m.repeatParticipation([], { now: NOW }).rate, null)
  })
})

describe('weeklyEventCounts 周趋势(曼谷时间,周一起始)', () => {
  const ev = (startAt, o = {}) => ({
    status: STATUS.FORMED, isOfficial: false, publishedAt: '2026-09-01T00:00:00Z', startAt, ...o,
  })

  test('返回 N 行,按时间升序,weekStart 都是周一', () => {
    const rows = m.weeklyEventCounts([], { now: NOW })
    assert.strictEqual(rows.length, METRICS.trendWeeks)
    assert.strictEqual(rows[0].weekStart, '2026-08-10')
    assert.strictEqual(rows[rows.length - 1].weekStart, '2026-09-28')
    for (const r of rows) assert.strictEqual(new Date(`${r.weekStart}T00:00:00Z`).getUTCDay(), 1)
  })

  test('周日 23:59 曼谷时间归本周,周一 00:00 归下一周', () => {
    const rows = m.weeklyEventCounts([
      ev('2026-09-27T16:59:00Z'),   // 曼谷 9/27 周日 23:59
      ev('2026-09-27T17:00:00Z'),   // 曼谷 9/28 周一 00:00 —— UTC 仍是周日
    ], { now: NOW })
    const byWeek = Object.fromEntries(rows.map(r => [r.weekStart, r.published]))
    assert.strictEqual(byWeek['2026-09-21'], 1)
    assert.strictEqual(byWeek['2026-09-28'], 1)
  })

  test('now 恰为周日 23:59 曼谷时间时,本周仍是周一开始的那一周', () => {
    const rows = m.weeklyEventCounts([], { now: '2026-09-27T16:59:00Z', weeks: 1 })
    assert.strictEqual(rows[0].weekStart, '2026-09-21')
  })

  test('分别统计公开数、成团数、非官方局数', () => {
    const at = '2026-09-19T08:00:00Z'
    const rows = m.weeklyEventCounts([
      ev(at),
      ev(at, { isOfficial: true }),
      ev(at, { status: STATUS.CANCELLED_LOW }),
      ev(at, { status: STATUS.CANCELLED_HOST, isOfficial: true }),
      ev(at, { status: STATUS.DONE, adminFilledIn: true }),   // 补位不改变「谁发的局」
    ], { now: NOW })
    const w = rows.find(r => r.weekStart === '2026-09-14')
    assert.deepStrictEqual(w, { weekStart: '2026-09-14', published: 5, formed: 3, organic: 3 })
  })

  test('未公开过的局与窗口外的局不计入', () => {
    const rows = m.weeklyEventCounts([
      ev('2026-09-19T08:00:00Z', { publishedAt: null, status: STATUS.REJECTED }),
      ev('2026-08-01T08:00:00Z'),   // 8 周之前
      ev('2026-10-10T08:00:00Z'),   // 未来周
    ], { now: NOW })
    assert.strictEqual(rows.reduce((s, r) => s + r.published, 0), 0)
  })

  test('缺 startAt 时按 publishedAt 归周', () => {
    const rows = m.weeklyEventCounts([ev(undefined, { publishedAt: '2026-09-29T01:00:00Z' })], { now: NOW })
    assert.strictEqual(rows[rows.length - 1].published, 1)
  })
})

describe('organicHostShare 非官方局占比', () => {
  const pub = '2026-09-01T00:00:00Z'
  test('只算公开过的局,管理员补位的局仍算非官方', () => {
    const r = m.organicHostShare([
      { isOfficial: true, publishedAt: pub },
      { isOfficial: false, publishedAt: pub },
      { isOfficial: false, adminFilledIn: true, publishedAt: pub },
      { isOfficial: false, publishedAt: pub },
      { isOfficial: false, publishedAt: null },
    ])
    assert.deepStrictEqual(r, { total: 4, organic: 3, share: 0.75 })
  })

  test('无样本时 share 为 null', () => {
    assert.strictEqual(m.organicHostShare([]).share, null)
  })
})

describe('dashboard 汇总', () => {
  const pub = '2026-09-01T00:00:00Z'
  const events = [
    { status: STATUS.FORMED, isOfficial: true, publishedAt: pub, startAt: '2026-09-19T08:00:00Z' },
    { status: STATUS.FORMED, isOfficial: false, publishedAt: pub, startAt: '2026-09-19T08:00:00Z' },
    { status: STATUS.CANCELLED_LOW, isOfficial: false, publishedAt: pub, startAt: '2026-09-26T08:00:00Z' },
  ]

  test('保留 overall/organic 字段,每个指标附 target 与 met', () => {
    const d = m.dashboard({ events, now: NOW })
    assert.strictEqual(d.overall.target, METRICS.formationRateTarget)
    assert.strictEqual(d.organic.target, METRICS.organicFormationRateTarget)
    assert.strictEqual(d.funnel.target, METRICS.signupConversionRateTarget)
    assert.strictEqual(d.repeat.target, METRICS.repeatParticipationRateTarget)
    assert.strictEqual(d.organicHostShare.target, METRICS.organicHostShareTarget)
    assert.strictEqual(d.weekly.length, METRICS.trendWeeks)
  })

  test('met:达到目标即达标,恰好等于目标也算', () => {
    const d = m.dashboard({ events, now: NOW })
    // 2/3 非官方 ≥ 50%
    assert.strictEqual(d.organicHostShare.met, true)
    const atTarget = m.dashboard({
      events: [
        { status: STATUS.FORMED, isOfficial: true, publishedAt: pub },
        { status: STATUS.FORMED, isOfficial: false, publishedAt: pub },
      ],
      now: NOW,
    })
    assert.strictEqual(atTarget.organicHostShare.share, METRICS.organicHostShareTarget)
    assert.strictEqual(atTarget.organicHostShare.met, true)
  })

  test('met:低于目标为 false', () => {
    const viewers = ['o1', 'o2', 'o3', 'o4', 'o5'].map(openid => view({ openid }))
    const d = m.dashboard({ analyticsEvents: [...viewers, success({ openid: 'o1' })], now: NOW })
    assert.strictEqual(d.funnel.viewToSignupRate, 0.2)
    assert.strictEqual(d.funnel.met, false)
  })

  test('met:无样本时为 false,不因 null 被误判达标', () => {
    const d = m.dashboard({ now: NOW })
    for (const k of ['overall', 'organic', 'funnel', 'repeat', 'organicHostShare']) {
      assert.strictEqual(d[k].met, false, k)
    }
    assert.strictEqual(d.funnel.viewToSignupRate, null)
    assert.strictEqual(d.repeat.rate, null)
    assert.strictEqual(d.organicHostShare.share, null)
  })

  test('漏斗只看最近 funnelLookbackDays 天的埋点', () => {
    const old = view({ openid: 'o9', createdAt: '2026-08-01T00:00:00Z' })
    const d = m.dashboard({ analyticsEvents: [old, view({ openid: 'o1' })], now: NOW })
    assert.strictEqual(d.funnel.views, 1)
    assert.strictEqual(d.funnel.lookbackDays, METRICS.funnelLookbackDays)
  })

  test('输出只含聚合数字,不泄露任何用户标识', () => {
    const d = m.dashboard({
      events,
      signups: [{ userId: 'user_secret', status: SIGNUP_STATUS.ATTENDED, createdAt: '2026-08-01T03:00:00Z' }],
      analyticsEvents: [view({ openid: 'openid_secret', anonId: 'anon_secret' })],
      now: NOW,
    })
    const json = JSON.stringify(d)
    for (const secret of ['user_secret', 'openid_secret', 'anon_secret']) {
      assert.ok(!json.includes(secret), secret)
    }
  })
})

const { describe: d2, test: t2 } = require('node:test')
const a2 = require('node:assert')
const m2 = require('../cloudfunctions/common/metrics')
d2('复购口径:以参加时间为准', () => {
  t2('attendedAt 存在时优先于 createdAt', () => {
    // 报名相隔 2 天,但实际参加相隔 40 天 —— 按参加时间不算复购
    const signups = [
      { userId: 'u', status: 'attended', createdAt: '2026-08-01T00:00:00Z', attendedAt: '2026-08-05T00:00:00Z' },
      { userId: 'u', status: 'attended', createdAt: '2026-08-03T00:00:00Z', attendedAt: '2026-09-14T00:00:00Z' },
    ]
    const r = m2.repeatParticipation(signups, { now: '2026-10-20T00:00:00Z' })
    a2.strictEqual(r.repeaters, 0)
  })
})
