/**
 * 局详情页 —— V0.5 的核心页面
 *
 * 两条不可妥协的约束:
 * 1. 未登录可完整浏览(PRD §4.1「先看内容再要身份」),因此埋点必须带 anonId;
 * 2. 只显示「已报 n / 还差 m」的计数,绝不显示参与者头像或昵称 ——
 *    否则会立刻退化成「看人报名」,违背 PRD §5「只匹配活动不匹配人」。
 */
const api = require('../../utils/api')
const { track, EVENTS } = require('../../utils/track')
const fmt = require('../../utils/format')

Page({
  data: {
    event: null,
    loading: true,
    /** 报名弹层:需要昵称 + 性别(D08 必填三选项) */
    showProfileSheet: false,
    profile: { nickname: '', gender: '' },
    genderOptions: [
      { value: 'male', label: '男' },
      { value: 'female', label: '女' },
      { value: 'other', label: '不便透露' },
    ],
  },

  onLoad(query) {
    // 小程序码带参进入时 query.scene 形如 "e=<eventId>"
    const eventId = query.eventId || (query.scene || '').replace(/^e=/, '')
    this.eventId = eventId
    this.load()
  },

  async load() {
    try {
      const event = await api.events.detail(this.eventId)
      this.setData({
        loading: false,
        event: {
          ...event,
          startText: fmt.formatStart(event.startAt),
          sceneText: fmt.sceneLabel(event.sceneType),
          shortByText: fmt.shortByText(event),
        },
      })
      track(EVENTS.EVENT_DETAIL_VIEW, { eventId: this.eventId, sceneType: event.sceneType })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '活动不存在', icon: 'none' })
    }
  },

  onTapSignup() {
    track(EVENTS.SIGNUP_START, { eventId: this.eventId })
    this.setData({ showProfileSheet: true })
  },

  /**
   * 手机号一键授权(D06 企业主体解锁)。
   * ⚠️ 拿到的是微信绑定号(多为 +86),只作账号唯一性锚点,不作通知通道 —— 见 docs/03 §4。
   */
  async onGetPhoneNumber(e) {
    if (!e.detail.code) return wx.showToast({ title: '需要手机号才能报名', icon: 'none' })
    const { nickname, gender } = this.data.profile
    if (!nickname.trim()) return wx.showToast({ title: '请填写昵称', icon: 'none' })
    if (!gender) return wx.showToast({ title: '请选择性别', icon: 'none' })

    wx.showLoading({ title: '报名中' })
    try {
      const r = await api.signups.join(this.eventId, { phoneCode: e.detail.code, nickname, gender })
      track(EVENTS.SIGNUP_SUCCESS, { eventId: this.eventId, status: r.status })
      wx.redirectTo({ url: `/pages/signup-success/index?eventId=${this.eventId}&status=${r.status}` })
    } catch (err) {
      wx.showToast({ title: err.message || '报名失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onNicknameInput(e) { this.setData({ 'profile.nickname': e.detail.value }) },
  onGenderSelect(e) { this.setData({ 'profile.gender': e.currentTarget.dataset.value }) },
  onCloseSheet() { this.setData({ showProfileSheet: false }) },

  onOpenLocation() {
    const { venue } = this.data.event
    if (venue && venue.lat) wx.openLocation({ latitude: venue.lat, longitude: venue.lng, name: venue.name, address: venue.address })
  },

  /** 分享到群 —— 小程序无法分享到朋友圈,朋友圈走海报(见 docs/03 §6.1) */
  onShareAppMessage() {
    const e = this.data.event || {}
    return {
      title: `${e.startText} ${e.sceneText}·${(e.venue || {}).name || ''} ${e.shortByText}`,
      path: `/pages/event-detail/index?eventId=${this.eventId}`,
    }
  },
})
