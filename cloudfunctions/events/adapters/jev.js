/**
 * Jev(TypeSafe AI)传输适配器 —— 只负责 HTTP 与超时,判读在 common/reviewer.interpretJev。
 *
 * 密钥来自云函数环境变量 JEV_API_KEY;未配置时 available() 为 false,被跳过。
 * 端点可配:默认走 OpenRouter 的 TypeSafe 兼容端点(TypeSafe 本站 2026-09 暂停新注册),
 * 直连 TypeSafe 时把 JEV_BASE_URL 设为其官方 API 地址即可。
 *
 * ⚠️ 官方 API 参考(docs.typesafe.ai/api)在开发环境不可达,请求体按公开摘要写成
 *    { model, state, questions };部署前必须对照官方文档核对字段名。
 * 只向第三方发送活动字段(buildJevQuestions 的产物),不含任何身份字段。
 */
const ENDPOINT = process.env.JEV_BASE_URL || 'https://openrouter.ai/api/v1/systemone'
const MODEL = process.env.JEV_MODEL || 'typesafe/jev-1.13'

function available() { return Boolean(process.env.JEV_API_KEY) }

/** @returns {Promise<object>} 原始响应对象(含 answers),交给 reviewer.interpretJev 判读 */
async function review({ state, questions }, { timeoutMs }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.JEV_API_KEY}` },
      body: JSON.stringify({ model: MODEL, state, questions }),
    })
    if (!res.ok) throw new Error(`Jev HTTP ${res.status}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { name: 'jev', available, review, MODEL }
