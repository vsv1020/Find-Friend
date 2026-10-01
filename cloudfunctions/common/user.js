/**
 * 账号文档的构造 —— 报名与发局两条建号路径共用,避免字段漂移。
 *
 * 为什么要有独立的建号路径:原先账号只在首次报名时创建,
 * 没报过名的人(包括第一个用户)无法发局、无法进后台。
 */
function newUserDoc({ openid, phone, nickname, gender, now }) {
  return {
    openid, phone: phone || null,
    notifyPhone: null,          // 可选的泰国本地号,V1.0 才启用
    nickname, gender,           // D08 必填,V1 仅供人工审核参考
    isHost: false,              // D14 局主权限,由管理员授予
    isAdmin: false,
    reliability: 100,
    noShowCount: 0,
    status: 'active',
    restrictedUntil: null,
    createdAt: now,
  }
}

module.exports = { newUserDoc }
