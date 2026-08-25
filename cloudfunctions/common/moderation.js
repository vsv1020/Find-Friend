/**
 * 内容安全(T28)—— 见 docs/03 §7
 *
 * 微信要求 UGC 必须过内容安全检测,不接会被审核直接打回。
 * 覆盖范围:群聊消息、发局文案、昵称(文本)与头像(图片)。
 *
 * 本模块只做**结果判读与降级决策**的纯逻辑,实际调用在云函数里 ——
 * 判读规则是需要被测试锁住的部分,网络调用不是。
 */

const ACTION = {
  PASS: 'pass',       // 正常入库
  FLAG: 'flag',       // 入库但标记待复核
  REJECT: 'reject',   // 拒绝入库,提示用户
}

/**
 * 判读 security.msgSecCheck(version 2)的返回。
 *
 * suggest 三档:
 *   pass   —— 放行
 *   review —— 机器不确定。**入库但标记**,交由人工复核。
 *             直接拒绝会误伤大量正常内容(地名、外语、口语都可能触发)。
 *   risky  —— 拒绝
 */
function interpret(res) {
  const suggest = res && res.result && res.result.suggest
  if (suggest === 'risky') return { action: ACTION.REJECT, label: res.result.label, suggest }
  if (suggest === 'review') return { action: ACTION.FLAG, label: res.result.label, suggest }
  return { action: ACTION.PASS, suggest: suggest || 'pass' }
}

/**
 * ⚠️ 接口调用失败时的降级策略 —— 这是个需要明确表态的产品决定。
 *
 * 选择:**放行,但标记为未检测并进入复核队列。**
 *
 * 为什么不拦截:
 *   内容安全接口超时或配额耗尽时,拦截意味着整个群聊直接不可用 ——
 *   一次接口抖动就让活动当天所有人发不出「我到了」。
 * 为什么可以接受:
 *   这是最多 10 人、且都已通过报名的行前沟通群,不是公开广场,
 *   传播面极小;而且全部留痕,事后可复核可追溯。
 *
 * ⚠️ 若将来把内容安全用在公开可见的内容上(如发局文案出现在列表页),
 *    该场景应改为 REJECT —— 传播面不同,取舍就不同。
 */
function onError(err) {
  return { action: ACTION.FLAG, suggest: 'unchecked', error: String((err && err.message) || err) }
}

/** 空内容不必送检,省一次调用 */
function needsCheck(content) {
  return Boolean(content && String(content).trim())
}

module.exports = { interpret, onError, needsCheck, ACTION }
