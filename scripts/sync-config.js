#!/usr/bin/env node
/**
 * 配置与领域逻辑同步
 *
 * 微信云开发中每个云函数是独立的 node 模块,无法 require 目录之外的文件。
 * 因此以 config/rules.js 为唯一真源,同步到:
 *   - cloudfunctions/common/rules.js   (领域逻辑使用)
 *   - miniprogram/config/rules.js      (小程序端使用)
 *   - cloudfunctions/<fn>/common/      (每个云函数各带一份 common 副本)
 *
 * 部署前务必执行:npm run sync:config
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC_RULES = path.join(ROOT, 'config/rules.js')
const COMMON_DIR = path.join(ROOT, 'cloudfunctions/common')
/**
 * 自动发现云函数目录 —— 不用硬编码列表。
 * 硬编码的话,新增一个云函数却忘了加进列表,会一直到部署时才报「找不到 common」。
 * 判定依据:cloudfunctions/ 下含 package.json 的目录(common 是共享源,不算云函数)。
 */
const FUNCTIONS = fs.readdirSync(path.join(ROOT, 'cloudfunctions'))
  .filter(d => d !== 'common')
  .filter(d => fs.existsSync(path.join(ROOT, 'cloudfunctions', d, 'package.json')))

const BANNER = '// ⚠️ 由 scripts/sync-config.js 自动生成,请勿直接修改。真源:config/rules.js\n'

function copyRules(dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, BANNER + fs.readFileSync(SRC_RULES, 'utf8'))
}

let count = 0
copyRules(path.join(COMMON_DIR, 'rules.js')); count++
copyRules(path.join(ROOT, 'miniprogram/config/rules.js')); count++

// 小程序端也需要用到的领域模块(发局表单的周末时段计算)
for (const mod of ['schedule.js']) {
  const dest = path.join(ROOT, 'miniprogram/utils', mod)
  fs.writeFileSync(dest, BANNER + fs.readFileSync(path.join(COMMON_DIR, mod), 'utf8')
    .replace("require('./rules')", "require('../config/rules')"))
  count++
}

for (const fn of FUNCTIONS) {
  const dest = path.join(ROOT, 'cloudfunctions', fn, 'common')
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  for (const f of fs.readdirSync(COMMON_DIR)) {
    fs.copyFileSync(path.join(COMMON_DIR, f), path.join(dest, f))
    count++
  }
}

console.log(`✓ 已同步 ${count} 个文件到 ${FUNCTIONS.length} 个云函数与小程序端`)
