const { test, describe } = require('node:test')
const assert = require('node:assert')
const rel = require('../cloudfunctions/common/reliability')
const { RELIABILITY_MARK: M } = require('../cloudfunctions/common/rules')

const ENDED = '2026-08-29T12:00:00.000Z'
const day = n => new Date(new Date(ENDED).getTime() + n * 24 * 3600 * 1000).toISOString()
const base = {
  event: { endedAt: ENDED }, raterAttended: true, rateeInEvent: true,
  alreadyRated: false, isSelf: false, mark: M.ON_TIME, now: day(1),
}

describe('靠谱度分数', () => {
  test('准时加分,让长期靠谱的人能把分养回来', () => {
    assert.strictEqual(rel.scoreDelta(M.ON_TIME), 2)
  })

  test('放鸽子的扣分明显重于迟到', () => {
    assert.ok(Math.abs(rel.scoreDelta(M.NO_SHOW)) > Math.abs(rel.scoreDelta(M.LATE)) * 3)
  })

  test('分数上限 100 —— 刷不出超高分', () => {
    assert.strictEqual(rel.applyMarks(100, [M.ON_TIME, M.ON_TIME, M.ON_TIME]), 100)
  })

  test('分数下限 0 —— 不会变成负数', () => {
    assert.strictEqual(rel.applyMarks(10, [M.NO_SHOW, M.NO_SHOW]), 0)
  })

  test('批量应用与逐条应用结果一致', () => {
    assert.strictEqual(rel.applyMarks(100, [M.LATE, M.NO_SHOW]), 75)
  })

  test('未知评价不影响分数', () => {
    assert.strictEqual(rel.applyMarks(80, ['whatever']), 80)
  })
})

describe('评价资格', () => {
  test('正常情况可评', () => {
    assert.strictEqual(rel.canRate(base).allowed, true)
  })

  test('不能评自己', () => {
    assert.strictEqual(rel.canRate({ ...base, isSelf: true }).reason, rel.RATE_REJECT.SELF)
  })

  test('没参加的人不能评 —— 也不能被评', () => {
    assert.strictEqual(rel.canRate({ ...base, raterAttended: false }).reason, rel.RATE_REJECT.NOT_PARTICIPANT)
    assert.strictEqual(rel.canRate({ ...base, rateeInEvent: false }).reason, rel.RATE_REJECT.NOT_PARTICIPANT)
  })

  test('解散的局不能评 —— 没人见过面,无从评起', () => {
    assert.strictEqual(rel.canRate({ ...base, event: { endedAt: null } }).reason, rel.RATE_REJECT.NOT_ENDED)
  })

  test('同一个人只能评一次', () => {
    assert.strictEqual(rel.canRate({ ...base, alreadyRated: true }).reason, rel.RATE_REJECT.DUPLICATE)
  })

  test('7 天窗口内可评,超出即关闭', () => {
    assert.strictEqual(rel.canRate({ ...base, now: day(6.9) }).allowed, true)
    assert.strictEqual(rel.canRate({ ...base, now: day(8) }).reason, rel.RATE_REJECT.WINDOW_CLOSED)
  })

  test('PRD §5:评价枚举不可扩展,自定义评价被拒', () => {
    assert.strictEqual(rel.canRate({ ...base, mark: 'good_looking' }).reason, rel.RATE_REJECT.BAD_MARK)
    assert.strictEqual(rel.canRate({ ...base, mark: 'fun' }).reason, rel.RATE_REJECT.BAD_MARK)
  })
})

describe('⚠️ 事实认定与主观评价的边界', () => {
  test('互评的 no_show 影响分数', () => {
    assert.ok(rel.scoreDelta(M.NO_SHOW) < 0)
  })

  test('但处罚只看局主标记的累计次数,与互评分数无关', () => {
    // applyPenalty 的入参是次数,不是分数 —— 互评压根没有触发处罚的通道
    assert.strictEqual(rel.applyPenalty(0, ENDED).status, 'active')
    assert.strictEqual(rel.applyPenalty(2, ENDED).status, 'restricted')
  })

  test('局主未标记时默认全部到场 —— 宁可漏判不误判', () => {
    const r = rel.defaultAttendance([{ userId: 'a' }, { userId: 'b' }])
    assert.ok(r.every(x => x.mark === M.ON_TIME && x.defaulted))
    assert.ok(r.every(x => rel.scoreDelta(x.mark) >= 0), '默认处理不能扣任何人的分')
  })
})
