const { test, describe } = require('node:test')
const assert = require('node:assert')
const mod = require('../cloudfunctions/common/moderation')

const res = suggest => ({ result: { suggest, label: 20001 } })

describe('内容安全结果判读', () => {
  test('pass 放行', () => {
    assert.strictEqual(mod.interpret(res('pass')).action, mod.ACTION.PASS)
  })

  test('risky 拒绝', () => {
    assert.strictEqual(mod.interpret(res('risky')).action, mod.ACTION.REJECT)
  })

  test('review 入库但标记 —— 直接拒会误伤地名、外语、口语', () => {
    assert.strictEqual(mod.interpret(res('review')).action, mod.ACTION.FLAG)
  })

  test('返回结构异常时按放行处理,不因解析失败卡住用户', () => {
    assert.strictEqual(mod.interpret(null).action, mod.ACTION.PASS)
    assert.strictEqual(mod.interpret({}).action, mod.ACTION.PASS)
  })

  test('保留 label 供人工复核时定位违规类型', () => {
    assert.strictEqual(mod.interpret(res('risky')).label, 20001)
  })
})

describe('⚠️ 接口失败时的降级策略', () => {
  test('检测失败时放行但标记 —— 拦截会让接口一抖群聊就全废', () => {
    const r = mod.onError(new Error('timeout'))
    assert.strictEqual(r.action, mod.ACTION.FLAG)
    assert.notStrictEqual(r.action, mod.ACTION.REJECT)
  })

  test('降级必须留痕:标为 unchecked 并带上错误信息', () => {
    const r = mod.onError(new Error('quota exceeded'))
    assert.strictEqual(r.suggest, 'unchecked')
    assert.match(r.error, /quota/)
  })
})

describe('送检范围', () => {
  test('空内容不送检,省一次调用', () => {
    assert.strictEqual(mod.needsCheck(''), false)
    assert.strictEqual(mod.needsCheck('   '), false)
    assert.strictEqual(mod.needsCheck(null), false)
  })

  test('有内容就送检', () => {
    assert.strictEqual(mod.needsCheck('我到了'), true)
  })
})
