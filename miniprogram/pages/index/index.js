/** 周末局列表 —— 未登录可完整浏览 */
const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: { events: [], loading: true },
  onShow() { this.load() },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()) },

  async load() {
    try {
      const list = await api.events.list({ upcoming: true })
      this.setData({
        loading: false,
        events: list.map(e => ({
          ...e,
          startText: fmt.formatStart(e.startAt),
          sceneText: fmt.sceneLabel(e.sceneType),
          shortByText: fmt.shortByText(e),
        })),
      })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  onTapEvent(e) {
    wx.navigateTo({ url: `/pages/event-detail/index?eventId=${e.currentTarget.dataset.id}` })
  },
})
