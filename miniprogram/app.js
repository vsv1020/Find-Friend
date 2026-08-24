/**
 * 小程序入口
 *
 * 身份体系(见 docs/03 §4):
 *   openid       —— 登录态,由云函数自动注入,无需前端处理
 *   phone        —— 账号唯一性锚点,首次报名时经 getPhoneNumber 采集
 *   notifyPhone  —— 可选的泰国本地号,仅用于短信兜底(V1.0 才启用)
 */
App({
  globalData: {
    userInfo: null,
    /** 未登录也要记录访问 —— PRD §8 的「链接打开→报名」转化率要求从未登录状态就开始统计 */
    anonId: null,
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('基础库版本过低,请使用 2.2.3 以上')
      return
    }
    wx.cloud.init({ env: wx.cloud.DYNAMIC_CURRENT_ENV, traceUser: true })
    this.globalData.anonId = this.ensureAnonId()
  },

  /** 匿名 ID 持久化在本地,用于串联未登录与登录后的行为 */
  ensureAnonId() {
    let id = wx.getStorageSync('anonId')
    if (!id) {
      id = `anon_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
      wx.setStorageSync('anonId', id)
    }
    return id
  },
})
