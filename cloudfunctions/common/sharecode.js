/**
 * 局的分享短码
 *
 * 【为什么需要它】
 * 小程序码 wxacode.getUnlimited 的 scene 参数**最多 32 个可见字符**,
 * 而云开发自动生成的 _id 本身就是 32 位 —— 加任何前缀都会溢出,
 * 且 scene 对部分字符有限制。因此给每个局配一个 8 位短码,
 * 既留足余量,也让链接与日志更易读。
 *
 * 8 位 base32(去掉易混淆的 0/O/1/I/L)约 1.1 万亿种组合,
 * 冷启动期每周几十个局,碰撞概率可忽略;仍在数据库加唯一索引兜底。
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'   // 31 字符,已剔除 0 O 1 I L
const LENGTH = 8

/** scene 参数的长度上限,来自微信文档 */
const SCENE_MAX_LENGTH = 32

/**
 * @param {() => number} rand 注入随机源,便于测试
 */
function generate(rand = Math.random) {
  let out = ''
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)]
  return out
}

function isValid(code) {
  return typeof code === 'string' &&
    code.length === LENGTH &&
    [...code].every(c => ALPHABET.includes(c))
}

/** 生成小程序码的 scene 值,并校验长度不越界 */
function toScene(shareCode) {
  if (!isValid(shareCode)) throw new Error(`非法分享码: ${shareCode}`)
  if (shareCode.length > SCENE_MAX_LENGTH) throw new Error('scene 超出 32 字符上限')
  return shareCode
}

module.exports = { generate, isValid, toScene, ALPHABET, LENGTH, SCENE_MAX_LENGTH }
