/**
 * 账号与隐私 —— 隐私政策第七条承诺的权利入口
 *
 * 注销是 PIPL 与 PDPA 下的强制入口,不能藏。
 */
const api = require('../../utils/api')

Page({
  data: { profile: null, loading: true },

  onShow() { this.load() },

  async load() {
    try { this.setData({ loading: false, profile: await api.account.profile() }) }
    catch (e) { this.setData({ loading: false }) }
  },

  async onExport() {
    wx.showLoading({ title: '正在整理' })
    try {
      const data = await api.account.exportMyData()
      wx.hideLoading()
      wx.setClipboardData({ data: JSON.stringify(data, null, 2) })
      wx.showModal({
        title: '已复制到剪贴板',
        content: '这是我们持有的关于你的全部个人信息,你可以粘贴到任意地方保存。',
        showCancel: false,
      })
    } catch (e) { wx.hideLoading(); wx.showToast({ title: '导出失败', icon: 'none' }) }
  },

  /** 两级确认 —— 注销不可恢复,不能让人手滑点掉 */
  onDelete() {
    wx.showModal({
      title: '注销账号',
      content: '我们会永久删除你的手机号、昵称等个人信息,不可恢复。尚未开始的活动报名会自动取消。',
      confirmText: '继续',
      success: r => r.confirm && this.confirmDelete(),
    })
  },

  confirmDelete() {
    wx.showModal({
      title: '再确认一次',
      content: '注销后无法恢复,也无法用同一个微信重新找回历史记录。确定吗?',
      confirmText: '确定注销',
      confirmColor: '#c0392b',
      success: async r => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中' })
        try {
          const res = await api.account.deleteAccount()
          wx.hideLoading()
          wx.showModal({
            title: '已注销',
            content: res.cancelledUpcoming
              ? `已为你取消 ${res.cancelledUpcoming} 个未开始的报名,个人信息已删除。`
              : '你的个人信息已删除。',
            showCancel: false,
            success: () => wx.reLaunch({ url: '/pages/index/index' }),
          })
        } catch (e) { wx.hideLoading(); wx.showToast({ title: '注销失败,请联系我们', icon: 'none' }) }
      },
    })
  },
})
