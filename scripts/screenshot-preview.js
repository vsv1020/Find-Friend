#!/usr/bin/env node
/** 用 Chromium 对每个预览页面截图到 preview/shots/。需要 playwright-core 与本机 Chromium。 */
const path = require('path')
const fs = require('fs')
const { chromium } = require('playwright-core')
const ROOT = path.join(__dirname, '..')
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'

;(async () => {
  const out = path.join(ROOT, 'preview/shots'); fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 })
  const keys = Object.keys(require('../preview/mock.js.keys.json'))
  for (const key of keys) {
    await page.goto('file://' + path.join(ROOT, 'preview/index.html') + '?page=' + key)
    await page.waitForTimeout(150)
    await page.screenshot({ path: path.join(out, key + '.png'), fullPage: true })
    console.log('✓', key)
  }
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
