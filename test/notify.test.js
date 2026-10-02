const { test, describe } = require('node:test')
const assert = require('node:assert')
const n = require('../cloudfunctions/common/notify')

describe('通知发送端:模板解析', () => {
  test('有模板 ID 时解析成功', () => {
    const t = n.resolveTemplate('event_formed', { TMPL_EVENT_FORMED: 'abc' })
    assert.strictEqual(t.templateId, 'abc')
    assert.strictEqual(t.title, '人齐了')
  })
  test('缺模板 ID → null,调用方标 skipped 而不是反复失败', () => {
    assert.strictEqual(n.resolveTemplate('event_formed', {}), null)
    assert.strictEqual(n.resolveTemplate('unknown_key', { X: '1' }), null)
  })
})

describe('通知发送端:字段组装', () => {
  const ev = { venue: { name: 'Sarnies Bangkok' }, startAt: '2026-08-29T08:00:00Z' }
  test('thing 字段不超过 20 字 —— 超长会被微信拒绝', () => {
    const d = n.buildData({ templateKey: 'host_broadcast', payload: { content: '字'.repeat(60) } }, ev, { title: '局主有话说' })
    assert.ok([...d.thing2.value].length <= n.THING_MAX)
    assert.ok(d.thing2.value.endsWith('…'))
  })
  test('时间按曼谷时区格式化', () => {
    const d = n.buildData({ templateKey: 'event_formed' }, ev, { title: '人齐了' })
    assert.strictEqual(d.time3.value, '2026-08-29 15:00')
  })
  test('催报名带上还差人数', () => {
    const d = n.buildData({ templateKey: 'event_rally', payload: { shortBy: 2 } }, ev, { title: '还差几个人' })
    assert.match(d.thing2.value, /还差 2 人/)
  })
  test('事件缺失时不崩', () => {
    const d = n.buildData({ templateKey: 'event_formed' }, null, { title: '人齐了' })
    assert.strictEqual(d.time3.value, '-')
  })
})

describe('通知发送端:错误分类', () => {
  test('43101 用户拒收 → 不重试', () => {
    assert.strictEqual(n.classifyError(43101, 0), n.OUTCOME.REFUSED)
  })
  test('模板错误 → 永久失败', () => {
    assert.strictEqual(n.classifyError(43104, 0), n.OUTCOME.FAILED)
  })
  test('临时错误在上限内重试,到上限后放弃', () => {
    assert.strictEqual(n.classifyError(45009, 0), n.OUTCOME.RETRY)
    assert.strictEqual(n.classifyError(45009, 2), n.OUTCOME.FAILED)
  })
})
