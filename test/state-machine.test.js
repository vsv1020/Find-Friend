const { test, describe } = require('node:test')
const assert = require('node:assert')
const sm = require('../cloudfunctions/common/state-machine')
const { STATUS: S } = sm

describe('局状态机', () => {
  test('D06 关闭自动审核时,新局进待审', () => {
    assert.strictEqual(sm.resolveInitialStatus({ isHost: false, autoApprove: false }), S.PENDING_REVIEW)
  })

  test('D06 开启自动审核时,新局直接公开', () => {
    assert.strictEqual(sm.resolveInitialStatus({ isHost: false, autoApprove: true }), S.OPEN)
  })

  test('D14 局主免审优先于全局开关 —— 即使关闭自动审核也直接公开', () => {
    assert.strictEqual(sm.resolveInitialStatus({ isHost: true, autoApprove: false }), S.OPEN)
  })

  test('合法流转', () => {
    assert.ok(sm.canTransition(S.PENDING_REVIEW, S.OPEN))
    assert.ok(sm.canTransition(S.OPEN, S.FORMED))
    assert.ok(sm.canTransition(S.OPEN, S.CANCELLED_LOW))
    assert.ok(sm.canTransition(S.FORMED, S.DONE))
    assert.ok(sm.canTransition(S.DONE, S.ARCHIVED))
  })

  test('非法流转必须抛错,不能静默忽略', () => {
    assert.throws(() => sm.transition(S.CANCELLED_LOW, S.OPEN), /非法状态流转/)
    assert.throws(() => sm.transition(S.ARCHIVED, S.DONE), /非法状态流转/)
    assert.throws(() => sm.transition(S.REJECTED, S.OPEN), /非法状态流转/)
  })

  test('解散后不能复活 —— 终态无出边', () => {
    for (const t of sm.TERMINAL) {
      assert.deepStrictEqual(sm.TRANSITIONS[t], [], `${t} 应为终态`)
      assert.ok(sm.isTerminal(t))
    }
  })

  test('D05 成团后仍可报名 —— formed 属于可报名状态', () => {
    assert.ok(sm.SIGNUP_OPEN_STATES.includes(S.FORMED))
    assert.ok(sm.SIGNUP_OPEN_STATES.includes(S.OPEN))
  })

  test('D01 未公开过的状态不计入成团率分母', () => {
    for (const s of [S.DRAFT, S.PENDING_REVIEW, S.REJECTED]) {
      assert.ok(!sm.PUBLISHED.includes(s), `${s} 不应算作公开过`)
    }
  })

  test('D01 局主取消属于公开过但未成团', () => {
    assert.ok(sm.PUBLISHED.includes(S.CANCELLED_HOST))
    assert.ok(!sm.FORMED_STATES.includes(S.CANCELLED_HOST))
  })

  test('transition 返回可直接写入 eventStatusLog 的记录', () => {
    const r = sm.transition(S.OPEN, S.FORMED, { reason: '达到最低人数', at: '2026-08-29T08:00:00Z' })
    assert.deepStrictEqual(r, {
      from: S.OPEN, status: S.FORMED, reason: '达到最低人数', changedAt: '2026-08-29T08:00:00Z',
    })
  })
})
