/** 周末局列表 —— 未登录可完整浏览 */
const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: { events: [], loading: true, heroDate: '' },
  onLoad() {
    const d = fmt.toLocal(new Date().toISOString())
    this.setData({ heroDate: `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日 · ${['周日','周一','周二','周三','周四','周五','周六'][d.getUTCDay()]}` })
  },
  onCreate() { wx.navigateTo({ url: '/pages/event-create/index' }) },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()) },

  async load() {
    try {
      const list = await api.events.list({ upcoming: true })
      this.setData({
        loading: false,
        events: list.map(fmt.decorate),
      })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  onTapEvent(e) {
    wx.navigateTo({ url: `/pages/event-detail/index?eventId=${e.currentTarget.dataset.id}` })
  },
})
