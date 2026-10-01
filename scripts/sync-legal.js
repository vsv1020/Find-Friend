#!/usr/bin/env node
/**
 * 把 docs/legal 的隐私政策与用户协议转成小程序可展示的纯文本模块。
 * 单一来源在 docs/legal;改了文档重新 sync 即可,避免两处维护。
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

function toPlain(md) {
  return md
    .replace(/^>.*$/gm, '')                 // 引用块(含草稿提示)不展示给用户
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\|.*\|$/gm, l => l.split('|').filter(Boolean).map(c => c.trim()).filter(c => !/^-+$/.test(c)).join(' · '))
    .replace(/^- /gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const out = {}
for (const [key, file] of [['privacy', 'privacy-policy.md'], ['terms', 'terms-of-service.md']]) {
  const md = fs.readFileSync(path.join(ROOT, 'docs/legal', file), 'utf8')
  const plain = toPlain(md)
  out[key] = { title: plain.split('\n')[0], sections: plain.split(/\n\s*\n/).slice(1) }
}
fs.mkdirSync(path.join(ROOT, 'miniprogram/legal'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'miniprogram/legal/texts.js'),
  '// ⚠️ 由 scripts/sync-legal.js 自动生成,真源:docs/legal/\nmodule.exports = ' + JSON.stringify(out, null, 2) + '\n')
console.log('✓ legal texts synced')
