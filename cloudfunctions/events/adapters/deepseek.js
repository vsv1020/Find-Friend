/**
 * DeepSeek 传输适配器 —— 只负责 HTTP 与超时,不含任何评审判断(判断在 common/reviewer.js)。
 *
 * 密钥来自云函数环境变量 DEEPSEEK_API_KEY,不进代码、不进仓库;未配置时 available() 为 false,被跳过。
 * 只向第三方发送活动字段(buildReviewInput 的产物),不含任何身份字段 —— 隐私政策据此承诺。
 * 需要云函数运行时 Node ≥ 18(全局 fetch)。
 */
const ENDPOINT = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions'
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

function available() { return Boolean(process.env.DEEPSEEK_API_KEY) }

/** @returns {Promise<string>} 模型输出的原始文本,交给 reviewer.interpret 判读 */
async function review({ system, user }, { timeoutMs }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    })
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`)
    const data = await res.json()
    const msg = data && data.choices && data.choices[0] && data.choices[0].message
    return (msg && msg.content) || ''
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { name: 'deepseek', available, review, MODEL }
