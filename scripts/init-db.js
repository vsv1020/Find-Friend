#!/usr/bin/env node
/**
 * 打印建库指令 —— 在云开发控制台的「数据库 > 高级操作」中执行,或用 CLI 逐条创建。
 *
 * 集合权限一律设为「仅管理端可读写」:前端不直连数据库,全部走云函数。
 * 这是 docs/05 §0 三条硬约束的实现方式,不是保守配置。
 */
const COLLECTIONS = [
  { name: 'users', indexes: [
    { keys: { openid: 1 }, unique: true },
    { keys: { phone: 1 }, unique: true, sparse: true },
  ]},
  { name: 'events', indexes: [
    { keys: { status: 1, startAt: 1 } },
    { keys: { publishedAt: 1 } },
    { keys: { shareCode: 1 }, unique: true, sparse: true },
    { keys: { hostId: 1 } },
  ]},
  { name: 'signups', indexes: [
    { keys: { eventId: 1, userId: 1 }, unique: true },
    { keys: { eventId: 1, status: 1, createdAt: 1 } },
    { keys: { userId: 1, createdAt: -1 } },
  ]},
  // eventId + createdAt 是轮询拉增量的关键索引
  { name: 'messages', indexes: [{ keys: { eventId: 1, createdAt: 1 } }] },
  { name: 'reviewQueue', indexes: [{ keys: { type: 1, createdAt: -1 } }] },
  // dedupeKey 唯一:同一举报人对同一目标只记一次
  { name: 'reports', indexes: [
    { keys: { dedupeKey: 1 }, unique: true },
    { keys: { status: 1, createdAt: 1 } },
    { keys: { reporterId: 1, createdAt: -1 } },
  ]},
  { name: 'reliabilityMarks', indexes: [{ keys: { eventId: 1, rateeId: 1 } }] },
  // dedupeKey 唯一索引是定时任务幂等的最后一道防线
  { name: 'notifications', indexes: [
    { keys: { dedupeKey: 1 }, unique: true, sparse: true },
    { keys: { status: 1, createdAt: 1 } },
  ]},
  { name: 'eventStatusLog', indexes: [{ keys: { eventId: 1, changedAt: 1 } }] },
  { name: 'analyticsEvents', indexes: [
    { keys: { name: 1, createdAt: 1 } },
    { keys: { anonId: 1 } },
  ]},
  { name: 'settings', indexes: [] },
]

console.log('# 集合与索引(权限一律设为「仅管理端可读写」)\n')
for (const c of COLLECTIONS) {
  console.log(`db.createCollection('${c.name}')`)
  for (const i of c.indexes) {
    const opts = [i.unique && 'unique', i.sparse && 'sparse'].filter(Boolean).join(', ') || '普通'
    console.log(`  索引 ${JSON.stringify(i.keys)}  [${opts}]`)
  }
}
console.log(`\n# 初始化全局配置(D06 自动审核开关,初期关闭)`)
console.log(`db.collection('settings').doc('global').set({ autoApprove: false })`)
console.log(`\n# 把自己设为管理员(替换成你的 openid)`)
console.log(`db.collection('users').where({ openid: 'YOUR_OPENID' }).update({ isAdmin: true, isHost: true })`)
