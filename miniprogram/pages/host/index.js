/**
 * 局主工具(T23)—— 名单 / 群发 / 改期 / 取消
 *
 * 名单只显示昵称、状态、靠谱度、爬约次数。靠谱度仅局主可见(D10),
 * 所以这个页面只能从自己局的详情页进入,云函数也会再校验一次。
 * 标记到场不在这里做 —— 复用评价页,那是事实认定,入口要单一。
 */
const api = require('../../utils/api')
const fmt = require('../../utils/format')
const { HOST_TOOLS } = require('../../config/rules')
const { weekendSlots, bangkokParts, bangkokTimeToISO } = require('../../utils/schedule')

const MINUTE = 60 * 1000

const STATUS_LABEL = {
  confirmed: '已确认',
  waitlist: '候补',
  attended: '已到场',
  no_show: '未到场',
}

const ACTIVE_STATES = ['open', 'formed']

function pad(n) { return String(n).padStart(2, '0') }

function bangkokDate(iso) {
  const p = bangkokParts(iso)
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`
}

Page({
  data: {
    loading: true,
    event: null,
    roster: [],
    canManage: false,
    isDone: false,
    // 群发
    broadcastMax: HOST_TOOLS.broadcastMaxLength,
    content: '',
    cooldownText: '',
    coolingDown: false,
    sending: false,
    // 改期
    slots: [],
    slotIndex: -1,
    customDate: '',
    customTime: '',
    dateStart: '',
    rescheduling: false,
  },

  onLoad(q) {
    this.eventId = q.eventId
    this.load()
  },

  onShow() { this.startTicker() },
  onHide() { this.stopTicker() },
  onUnload() { this.stopTicker() },

  async load() {
    let event = null
    try {
      event = await api.events.detail(this.eventId)
    } catch (e) { /* 待审的局详情不可见,名单仍可看 */ }

    try {
      const r = await api.host.roster(this.eventId)
      this.lastBroadcastAt = r.lastBroadcastAt
      this.cooldownMinutes = r.cooldownMinutes
      const now = new Date().toISOString()
      const canManage = Boolean(event && ACTIVE_STATES.includes(event.status))
      this.setData({
        loading: false,
        canManage,
        isDone: Boolean(event && (event.status === 'done' || event.status === 'archived')),
        event: event && {
          ...event,
          startText: fmt.formatStart(event.startAt),
          dateText: bangkokDate(event.startAt),
          sceneText: fmt.sceneLabel(event.sceneType),
        },
        roster: r.roster.map(p => ({
          ...p,
          statusText: STATUS_LABEL[p.status] || p.status,
          lowReliability: p.noShowCount > 0,
        })),
        slots: event ? weekendSlots(now, event.sceneType, 4).filter(s => s.startAt !== event.startAt) : [],
        slotIndex: -1,
        customDate: '',
        customTime: '',
        // 不设上限日期:过远的边界由云函数按发局同一口径判定,前端不再抄一份常量
        dateStart: bangkokDate(now),
      })
      this.refreshCooldown()
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  // ---- 群发 ----

  startTicker() {
    this.stopTicker()
    this.ticker = setInterval(() => this.refreshCooldown(), 30 * 1000)
  },
  stopTicker() {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
  },

  /** 冷却只是提示,真正的限制在云函数里(CAS 占用 lastBroadcastAt) */
  refreshCooldown() {
    const cd = this.cooldownMinutes || HOST_TOOLS.broadcastCooldownMinutes
    const last = this.lastBroadcastAt ? new Date(this.lastBroadcastAt).getTime() : 0
    const remainMs = last + cd * MINUTE - Date.now()
    this.setData({
      coolingDown: remainMs > 0,
      cooldownText: remainMs > 0
        ? `${Math.ceil(remainMs / MINUTE)} 分钟后可再次群发`
        : `会通知所有已确认的人,并同步到行前沟通。每 ${cd} 分钟最多一次`,
    })
  },

  onContentInput(e) { this.setData({ content: e.detail.value }) },

  async onBroadcast() {
    const content = this.data.content.trim()
    if (!content) return wx.showToast({ title: '写点什么吧', icon: 'none' })
    if (this.data.coolingDown || this.data.sending) return
    this.setData({ sending: true })
    try {
      const r = await api.host.broadcast(this.eventId, content)
      this.lastBroadcastAt = new Date().toISOString()
      this.setData({ content: '' })
      this.refreshCooldown()
      wx.showToast({ title: `已通知 ${r.sent} 人`, icon: 'none' })
    } catch (e) {
      wx.showToast({ title: e.message || '发送失败', icon: 'none' })
      if (e.code === 'cooldown') this.load()
    } finally {
      this.setData({ sending: false })
    }
  },

  // ---- 改期 ----

  onSelectSlot(e) {
    this.setData({ slotIndex: Number(e.currentTarget.dataset.index), customDate: '', customTime: '' })
  },
  onDateChange(e) { this.setData({ customDate: e.detail.value, slotIndex: -1 }) },
  onTimeChange(e) { this.setData({ customTime: e.detail.value, slotIndex: -1 }) },

  /** 自定义时间按曼谷当地时间理解 —— 与发局表单同一时区口径 */
  pickedStartAt() {
    const { slots, slotIndex, customDate, customTime } = this.data
    if (slotIndex >= 0) return slots[slotIndex] && slots[slotIndex].startAt
    if (!customDate || !customTime) return null
    const [year, month, day] = customDate.split('-').map(Number)
    const [hour, minute] = customTime.split(':').map(Number)
    const base = bangkokTimeToISO({ year, month: month - 1, day, hour })
    return new Date(new Date(base).getTime() + minute * MINUTE).toISOString()
  },

  onReschedule() {
    const startAt = this.pickedStartAt()
    if (!startAt) return wx.showToast({ title: '选一个新时间', icon: 'none' })
    const text = `${bangkokDate(startAt)} ${fmt.formatStart(startAt)}`
    wx.showModal({
      title: '确认改期',
      content: `改到 ${text}?所有报名者会收到改期通知。`,
      success: async res => {
        if (!res.confirm) return
        this.setData({ rescheduling: true })
        try {
          const r = await api.host.reschedule(this.eventId, startAt)
          wx.showToast({ title: `已改期,通知 ${r.notified} 人`, icon: 'none' })
          this.load()
        } catch (e) {
          wx.showToast({ title: e.message || '改期失败', icon: 'none' })
        } finally {
          this.setData({ rescheduling: false })
        }
      },
    })
  },

  // ---- 取消整个局 ----

  /** 两级确认:第一级问意愿,第二级讲后果并收原因 —— 取消不可撤销 */
  onCancelEvent() {
    wx.showModal({
      title: '取消整个局?',
      content: '取消后无法恢复,所有报名者都会收到通知。',
      confirmText: '继续',
      success: res => {
        if (!res.confirm) return
        wx.showModal({
          title: '再确认一次',
          editable: true,
          placeholderText: `原因(选填,${HOST_TOOLS.cancelReasonMaxLength} 字内)`,
          confirmText: '确认取消',
          confirmColor: '#d43c3c',
          success: async res2 => {
            if (!res2.confirm) return
            wx.showLoading({ title: '取消中' })
            try {
              const r = await api.host.cancel(this.eventId, (res2.content || '').trim())
              wx.hideLoading()
              wx.showToast({ title: `已取消,通知 ${r.notified} 人`, icon: 'none' })
              this.load()
            } catch (e) {
              wx.hideLoading()
              wx.showToast({ title: e.message || '取消失败', icon: 'none' })
            }
          },
        })
      },
    })
  },

  onOpenRating() {
    wx.navigateTo({ url: `/pages/rating/index?eventId=${this.eventId}&isHost=1` })
  },
})
