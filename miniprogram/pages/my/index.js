/**
 * 我的局 —— 「我接下来去哪」优先,个人信息只占顶部一行
 *
 * 分组由云函数完成(common/my.js,有测试),这里只负责展示字段与跳转。
 */
const api = require('../../utils/api')
const fmt = require('../../utils/format')

const decorateItem = it => ({ ...it, event: fmt.decorate(it.event) })

Page({
  data: { profile: null, upcoming: [], hosted: [], past: [], pendingRatings: [], showPast: false, loading: true },

  onShow() { this.load() },

  async load() {
    // 三个请求互不依赖;还没建号的新用户 mine/profile 会报 no_user,按空状态处理
    const [mine, pending, profile] = await Promise.allSettled([
      api.signups.mine(),
      api.rating.pending(),
      api.account.profile(),
    ])
    const groups = mine.status === 'fulfilled' ? mine.value : { upcoming: [], hosted: [], past: [] }
    this.setData({
      loading: false,
      profile: profile.status === 'fulfilled' ? profile.value : null,
      upcoming: groups.upcoming.map(decorateItem),
      hosted: groups.hosted.map(decorateItem),
      past: groups.past.map(decorateItem),
      pendingRatings: pending.status === 'fulfilled'
        ? pending.value.map(p => ({ ...p, startText: fmt.formatStart(p.event.startAt), count: p.remaining.length }))
        : [],
    })
  },

  onTapEvent(e) {
    wx.navigateTo({ url: `/pages/event-detail/index?eventId=${e.currentTarget.dataset.id}` })
  },

  onTapChat(e) {
    wx.navigateTo({ url: `/pages/chat/index?eventId=${e.currentTarget.dataset.id}` })
  },

  onTapHost(e) {
    wx.navigateTo({ url: `/pages/host/index?eventId=${e.currentTarget.dataset.id}` })
  },

  onTapRating(e) {
    const { id, ishost } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/rating/index?eventId=${id}&isHost=${ishost ? 1 : 0}` })
  },

  onTogglePast() { this.setData({ showPast: !this.data.showPast }) },

  onBrowse() { wx.switchTab({ url: '/pages/index/index' }) },
})
