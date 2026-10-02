/**
 * 账号注销的去标识化 —— 见 docs/legal/data-inventory.md §4
 *
 * PIPL 与 PDPA 都要求删除个人信息,但允许保留**无法识别到特定个人**的统计数据。
 * 因此注销 = 永久抹除全部标识符 + 保留一条去标识化的墓碑记录,
 * 使历史 signups 的外键不悬空、已结束活动的成团率统计不被破坏。
 *
 * 纯函数,便于测试「到底抹掉了哪些字段」—— 这正是法务会逐条核对的部分。
 */

/** 必须被永久抹除的标识符字段 */
const PII_FIELDS = ['openid', 'phone', 'notifyPhone', 'nickname', 'gender', 'avatarUrl']

/** 注销后仍保留的字段(均已无法关联到自然人) */
const RETAINED_FIELDS = ['_id', 'createdAt', 'deletedAt', 'status']

/**
 * 计算注销后应写入 users 文档的内容。
 * @param {object} user 现有用户文档
 * @param {string} now
 * @returns {object} 用于 update 的数据(被抹除的字段显式置为 null,而非留着不动)
 */
function anonymizeUser(user, now) {
  const patch = { status: 'deleted', deletedAt: now }
  for (const f of PII_FIELDS) patch[f] = null
  // 靠谱度相关也一并清零 —— 账号已不可登录,保留无意义且仍具画像性质
  patch.reliability = null
  patch.noShowCount = null
  patch.restrictedUntil = null
  patch.isHost = false
  patch.isAdmin = false
  return patch
}

/** 校验注销结果:确认没有任何标识符残留。供单元测试与上线前自查使用。 */
function verifyAnonymized(userAfter) {
  const leaked = PII_FIELDS.filter(f => userAfter[f] !== null && userAfter[f] !== undefined)
  return { clean: leaked.length === 0, leaked }
}

module.exports = { anonymizeUser, verifyAnonymized, PII_FIELDS, RETAINED_FIELDS }
