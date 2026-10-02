#!/usr/bin/env node
/**
 * 把小程序各页面的 WXML/WXSS 与 mock 数据打成一个静态预览页(preview/index.html),
 * 用于在没有微信开发者工具的环境里查看界面。?page=<name> 选择页面。
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')

const PAGES = { index: 'index', 'event-detail': 'event-detail', 'event-detail-sheet': 'event-detail', 'event-create': 'event-create',
  'signup-success': 'signup-success', poster: 'poster', chat: 'chat', rating: 'rating', my: 'my', privacy: 'privacy', admin: 'admin', host: 'host' }
const TITLES = { index: '周末', 'event-detail': '', 'event-detail-sheet': '', 'event-create': '开个局', 'signup-success': '', poster: '分享海报',
  chat: '行前沟通', rating: '', my: '我的', privacy: '账号与隐私', admin: '运营后台', host: '局主工具' }

const read = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
const pages = {}
for (const [key, dir] of Object.entries(PAGES)) {
  pages[key] = { wxml: read(path.join(MP, 'pages', dir, 'index.wxml')), wxss: read(path.join(MP, 'pages', dir, 'index.wxss')), title: TITLES[key] }
}
const appWxss = read(path.join(MP, 'app.wxss'))
// 自定义组件:预览时按标签名展开其 WXML/WXSS
const components = {}
for (const dir of fs.existsSync(path.join(MP, 'components')) ? fs.readdirSync(path.join(MP, 'components')) : []) {
  components[dir] = { wxml: read(path.join(MP, 'components', dir, 'index.wxml')), wxss: read(path.join(MP, 'components', dir, 'index.wxss')) }
}

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>小程序界面预览</title>
<style>
  body{margin:0;background:#e9e9ee;font-family:-apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif;}
  .phone{width:375px;min-height:812px;margin:0 auto;background:#F7F2EA;position:relative;overflow:hidden;}
  .nav{height:88px;background:#F7F2EA;display:flex;align-items:flex-end;justify-content:center;padding-bottom:12px;font-size:17px;font-weight:600;border-bottom:1px solid #eee;box-sizing:border-box}
  .page{display:block;--paper:#F7F2EA;--card:#FFFDF9;--ink:#26221D;--ink-2:#5C554B;--mute:#9A9084;--line:#EDE6DB;--amber:#D98A3C;--amber-soft:#FBEEDD;--olive:#6F7D5C;--olive-soft:#EEF1E6;--plum:#7A4F6B;--plum-soft:#F3E9F0;--sage:#6E8A86;--sage-soft:#E8EFEE;--radius:12px;--shadow:0 3px 12px rgba(60,40,10,.06);}
  img[data-wx=image]{max-width:100%;display:block}
  input[data-wx=input],textarea{border:none;outline:none;font:inherit;width:100%;box-sizing:border-box;background:transparent}
  button[data-wx=button]{border:none;font:inherit;width:100%;cursor:default}
  .wx-switch{display:inline-block;width:51px;height:31px;border-radius:16px;background:#e5e5e5;position:relative;vertical-align:middle}
  .wx-switch i{position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2)}
  .wx-switch.on{background:#1a1a1a}.wx-switch.on i{left:22px}
  .wx-slider{width:100%}
  a[data-wx=navigator]{display:block;color:inherit;text-decoration:none}
  .tabbar{position:absolute;bottom:0;left:0;right:0;height:56px;background:#FFFDF9;border-top:1px solid #EDE6DB;display:flex;justify-content:space-around;align-items:center;font-size:12px;color:#9A9084}
  .tabbar .on{color:#26221D;font-weight:600}
  .tabbar[hidden]{display:none}
</style>
<style id="app-css"></style><style id="page-css"></style>
</head><body>
<div class="phone"><div class="nav" id="nav"></div><div class="page" id="mount"></div><div class="tabbar" id="tabbar" hidden><span class="on">周末</span><span>我的</span></div></div>
<script>window.PAGES=${JSON.stringify(pages)};window.APP_WXSS=${JSON.stringify(appWxss)};window.COMPONENTS=${JSON.stringify(components)};</script>
<script>${read(path.join(ROOT, 'preview/render.js'))}</script>
<script>${read(path.join(ROOT, 'preview/mock.js'))}</script>
<script>
  const key = new URLSearchParams(location.search).get('page') || 'index'
  const p = window.PAGES[key]
  document.getElementById('app-css').textContent = convertWxss(window.APP_WXSS)
  document.getElementById('page-css').textContent = convertWxss(p.wxss + Object.values(window.COMPONENTS).map(c => c.wxss).join(' '))
  document.getElementById('nav').textContent = p.title || (window.MOCK[key] && window.MOCK[key].event ? '' : '')
  document.getElementById('tabbar').hidden = !(key === 'index' || key === 'my')
  renderWxml(p.wxml, window.MOCK[key] || {}, document.getElementById('mount'))
</script></body></html>`
fs.writeFileSync(path.join(ROOT, 'preview/index.html'), html)
// 海报预览用的占位图
fs.writeFileSync(path.join(ROOT, 'preview/poster-sample.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1200"><rect width="750" height="1200" fill="#fff"/><text x="60" y="160" font-size="28" fill="#8a8a8a">下午咖啡局</text><text x="60" y="240" font-size="52" font-weight="bold" fill="#1a1a1a">周六 15:00 · Sarnies</text><text x="60" y="300" font-size="52" font-weight="bold" fill="#1a1a1a">Bangkok</text><text x="60" y="370" font-size="30" fill="#5a5a5a">周六下午找人一起去 Sarnies 喝咖啡</text><text x="60" y="440" font-size="28" fill="#8a8a8a">人均约 ฿200</text><text x="60" y="520" font-size="40" fill="#d4741a">还差 1 人</text><rect x="490" y="940" width="200" height="200" fill="#1a1a1a"/><text x="60" y="1050" font-size="28" fill="#8a8a8a">长按识别,看看还差谁</text></svg>`)
console.log('✓ preview/index.html 已生成,页面:', Object.keys(pages).join(', '))
