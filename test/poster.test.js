const { test, describe } = require('node:test')
const assert = require('node:assert')
const p = require('../miniprogram/utils/poster')
const sc = require('../cloudfunctions/common/sharecode')

/** 等宽假测量器:每个字符宽度 = 字号的一半,便于精确断言 */
const measure = (s, size = 30) => [...s].length * (size / 2)

describe('海报文字折行', () => {
  test('短文本不折行', () => {
    assert.deepStrictEqual(p.wrapText('周六下午', 1000, s => measure(s)), ['周六下午'])
  })

  test('超宽文本按可用宽度折行', () => {
    const r = p.wrapText('一二三四五六七八九十', 50, s => measure(s))
    assert.ok(r.length > 1)
    assert.ok(r.every(l => measure(l) <= 50))
  })

  test('超出最大行数时截断并加省略号', () => {
    const r = p.wrapText('一二三四五六七八九十十一十二十三', 30, s => measure(s), 2)
    assert.strictEqual(r.length, 2)
    assert.ok(r[1].endsWith('…'), '最后一行应有省略号')
    assert.ok(measure(r[1]) <= 30, '加了省略号也不能超宽')
  })

  test('恰好填满不加省略号', () => {
    // 每字 15px、行宽 30px => 每行 2 字;4 个字恰好占满 2 行,没有内容被丢掉
    const r = p.wrapText('一二三四', 30, s => measure(s), 2)
    assert.deepStrictEqual(r, ['一二', '三四'])
  })

  test('单字宽于行宽时不死循环,退化为每行一字', () => {
    const r = p.wrapText('一二三', 5, s => measure(s), 3)
    assert.deepStrictEqual(r, ['一', '二', '三'])
  })

  test('空文本返回空数组,不崩', () => {
    assert.deepStrictEqual(p.wrapText('', 100, s => measure(s)), [])
    assert.deepStrictEqual(p.wrapText(null, 100, s => measure(s)), [])
  })
})

describe('海报布局', () => {
  const data = {
    sceneText: '下午咖啡局', startText: '周六 15:00', venueName: 'Sarnies Bangkok',
    priceEstTHB: 200, shortByText: '还差 2 人', description: '想找人一起去看那个新开的展',
  }

  test('所有元素都在画布内', () => {
    const l = p.layout(data, measure)
    for (const b of l.blocks) {
      assert.ok(b.x >= 0 && b.x < l.width, `${b.text || b.key} 的 x 越界`)
      assert.ok(b.y >= 0 && b.y < l.height, `${b.text || b.key} 的 y 越界`)
    }
  })

  test('小程序码固定在右下角,不被正文挤走', () => {
    const qr = p.layout(data, measure).blocks.find(b => b.key === 'qrcode')
    assert.ok(qr, '必须有小程序码')
    assert.strictEqual(qr.x + qr.w, p.W - p.PAD)
    assert.strictEqual(qr.y + qr.h, p.H - p.PAD)
  })

  test('超长说明不会把正文顶到小程序码上', () => {
    const l = p.layout({ ...data, description: '很长的说明'.repeat(50) }, measure)
    const qr = l.blocks.find(b => b.key === 'qrcode')
    assert.ok(l.contentBottom < qr.y, '正文底部必须在小程序码之上')
  })

  test('没有说明时照样能排', () => {
    const l = p.layout({ ...data, description: '' }, measure)
    assert.ok(l.blocks.some(b => b.text === '还差 2 人'))
  })

  test('「还差 N 人」是行动召唤,必须存在且醒目', () => {
    const badge = p.layout(data, measure).blocks.find(b => b.type === 'badge')
    assert.strictEqual(badge.text, '还差 2 人')
    assert.ok(badge.size >= 36, '字号应明显大于正文')
  })
})

describe('分享短码(绕开 scene 32 字符上限)', () => {
  test('长度为 8,远小于 scene 上限', () => {
    const c = sc.generate()
    assert.strictEqual(c.length, 8)
    assert.ok(c.length <= sc.SCENE_MAX_LENGTH)
  })

  test('字符集剔除了易混淆的 0 O 1 I L', () => {
    for (const ch of '0O1IL') assert.ok(!sc.ALPHABET.includes(ch), `${ch} 不该在字符集里`)
  })

  test('可注入随机源以获得确定输出', () => {
    assert.strictEqual(sc.generate(() => 0), '22222222')
  })

  test('校验能挡住非法码', () => {
    assert.ok(sc.isValid(sc.generate()))
    assert.ok(!sc.isValid('SHORT'))
    assert.ok(!sc.isValid('OOOOOOOO'), '含被剔除的字符应判非法')
    assert.ok(!sc.isValid(null))
  })

  test('toScene 对非法码抛错而非生成一个扫不出的码', () => {
    assert.throws(() => sc.toScene('bad'), /非法分享码/)
  })
})
