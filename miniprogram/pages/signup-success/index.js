/**
 * 报名成功页
 *
 * PRD §6 明确指出这是最好的推荐位:用户刚约上周末的事,情绪最高点,
 * 此时展示「你附近这周末还有 N 个局」的转化率远高于任何弹窗。
 */
const api = require('../../utils/api')
const { track, EVENTS } = require('../../utils/track')
const fmt = require('../../utils/format')

Page({
  data: { status: '', recommends: [], subscribed: false },

  onLoad(q) {
    this.eventId = q.eventId
    this.setData({ status: q.status })
    this.loadRecommends()
    this.requestSubscribe()
  },

  /**
   * 订阅消息授权:一次授权一次推送。
   * 这里收的是「成团通知」那一次;成团后在结果页再收一次用于开场提醒。见 docs/03 §9。
   */
  requestSubscribe() {
    wx.requestSubscribeMessage({
      tmplIds: ['TODO_成团通知模板ID'],
      success: res => this.setData({ subscribed: Object.values(res).includes('accept') }),
      fail: () => {},
    })
  },

  async loadRecommends() {
    try {
      this.setData({ recommends: (await api.events.recommend(this.eventId)).map(e => ({
        ...e, startText: fmt.formatStart(e.startAt), shortByText: fmt.shortByText(e),
      })) })
    } catch (e) {}
  },

  onTapRecommend(e) {
    const id = e.currentTarget.dataset.id
    track(EVENTS.RECOMMEND_CLICK, { fromEventId: this.eventId, toEventId: id })
    wx.redirectTo({ url: `/pages/event-detail/index?eventId=${id}` })
  },
})
