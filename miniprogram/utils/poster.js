/**
 * 分享海报的布局与绘制
 *
 * 【为什么需要海报】
 * 小程序**无法直接分享到朋友圈** —— 只能分享给好友和群。
 * 而 PRD §6 的冷启动方案写的是「直接扔进朋友圈和现有微信群」。
 * 海报 + 小程序码是朋友圈这条路径唯一的替代方案,不是锦上添花。
 *
 * 布局计算与绘制分离:layout() 是纯函数(有单元测试),draw() 只负责把结果画出来。
 */

const W = 750
const H = 1200
const PAD = 60

/**
 * 按可用宽度折行。
 * @param {string} text
 * @param {number} maxWidth
 * @param {(s:string)=>number} measure 注入测量函数(canvas 的 measureText),便于测试
 * @param {number} maxLines 超出的部分以省略号结尾
 */
function wrapText(text, maxWidth, measure, maxLines = 3) {
  if (!text) return []
  const lines = []
  let line = ''
  for (const ch of text) {
    const next = line + ch
    if (measure(next) > maxWidth && line) {
      lines.push(line)
      line = ch
      if (lines.length === maxLines) break
    } else {
      line = next
    }
  }
  if (lines.length < maxLines && line) lines.push(line)

  // 内容被截断时,给最后一行加省略号
  const consumed = lines.join('').length
  if (consumed < [...text].length && lines.length) {
    let last = lines[lines.length - 1]
    while (last && measure(last + '…') > maxWidth) last = last.slice(0, -1)
    lines[lines.length - 1] = last + '…'
  }
  return lines
}

/**
 * 计算海报各元素的位置。纯函数 —— 不接触 canvas,可直接测试。
 *
 * @param {object} data {sceneText, startText, venueName, priceEstTHB, shortByText, description}
 * @param {(s:string, size:number)=>number} measure
 */
function layout(data, measure) {
  const contentWidth = W - PAD * 2
  let y = 140

  const blocks = []
  const push = (type, props) => blocks.push({ type, ...props })

  push('text', { text: data.sceneText, x: PAD, y, size: 28, color: '#8a8a8a' })
  y += 60

  const titleLines = wrapText(data.startText + ' · ' + data.venueName, contentWidth,
    s => measure(s, 52), 2)
  for (const line of titleLines) {
    push('text', { text: line, x: PAD, y, size: 52, weight: 'bold', color: '#1a1a1a' })
    y += 76
  }
  y += 12

  if (data.description) {
    for (const line of wrapText(data.description, contentWidth, s => measure(s, 30), 3)) {
      push('text', { text: line, x: PAD, y, size: 30, color: '#5a5a5a' })
      y += 46
    }
    y += 20
  }

  push('text', { text: `人均约 ฿${data.priceEstTHB}`, x: PAD, y, size: 28, color: '#8a8a8a' })
  y += 70

  // 「还差 2 人」是整张海报的行动召唤,给它最重的视觉权重
  push('badge', { text: data.shortByText, x: PAD, y, size: 40, color: '#d4741a' })
  y += 100

  // 小程序码固定在右下角,左侧留出扫码引导文案
  const qrSize = 200
  const qrY = H - PAD - qrSize
  push('image', { key: 'qrcode', x: W - PAD - qrSize, y: qrY, w: qrSize, h: qrSize })
  push('text', { text: '长按识别,看看还差谁', x: PAD, y: qrY + qrSize / 2 - 10, size: 28, color: '#8a8a8a' })

  return { width: W, height: H, padding: PAD, blocks, contentBottom: y }
}

/**
 * 把 layout 的结果画到 canvas 上。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} l layout() 的返回值
 * @param {object} images {qrcode: CanvasImage}
 */
function draw(ctx, l, images = {}) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, l.width, l.height)

  for (const b of l.blocks) {
    if (b.type === 'image') {
      const img = images[b.key]
      if (img) ctx.drawImage(img, b.x, b.y, b.w, b.h)
      continue
    }
    ctx.fillStyle = b.color
    ctx.font = `${b.weight === 'bold' ? 'bold ' : ''}${b.size}px sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(b.text, b.x, b.y)
  }
}

module.exports = { layout, draw, wrapText, W, H, PAD }
