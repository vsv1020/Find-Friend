const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: { signups: [], pendingRatings: [], loading: true },

  onShow() { this.load() },

  async load() {
    try {
      const [list, pending] = await Promise.all([
        api.signups.mine(),
        api.rating.pending().catch(() => []),
      ])
      this.setData({
        loading: false,
        signups: list.map(s => ({ ...s, startText: fmt.formatStart(s.event.startAt) })),
        pendingRatings: pending.map(p => ({
          ...p, startText: fmt.formatStart(p.event.startAt), count: p.remaining.length,
        })),
      })
    } catch (e) { this.setData({ loading: false }) }
  },

  onTapRating(e) {
    const { id, ishost } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/rating/index?eventId=${id}&isHost=${ishost ? 1 : 0}` })
  },
})
