/**
 * 行前沟通页(T17)
 *
 * 定位是**行前对齐工具**,不是社交场 —— 只用来确认到场时间、发个定位、说一句「我到了」。
 * 因此:顶部常驻关闭时间提示、没有加好友入口、归档后输入框禁用。
 *
 * 用轮询而非 db.watch,理由见 docs/06 §3。退避策略是 common/chat.js 的纯函数。
 */
const api = require('../../utils/api')
const { nextPoll, MAX_LENGTH } = require('../../utils/chat')
const { showReportSheet } = require('../../utils/report-sheet')

Page({
  data: {
    messages: [],
    draft: '',
    archived: false,
    sending: false,
    loading: true,
    scrollTo: '',
    maxLength: MAX_LENGTH,
  },

  onLoad(q) {
    this.eventId = q.eventId
    this.since = null
    this.pollState = { emptyStreak: 0, intervalMs: 4000 }
    this.timer = null
    this.loadInitial()
  },

  // 页面不可见时立刻停轮询 —— 后台还在拉是纯粹的浪费
  onHide() { this.stopPolling() },
  onUnload() { this.stopPolling() },
  onShow() { if (!this.data.loading) this.schedule() },

  async loadInitial() {
    try {
      const r = await api.chat.list(this.eventId)
      this.applyMessages(r, true)
      this.setData({ loading: false, archived: r.archived })
      this.schedule()
    } catch (e) {
      this.setData({ loading: false })
      wx.showModal({
        title: '进不去', content: e.message || '暂时无法进入', showCancel: false,
        success: () => wx.navigateBack(),
      })
    }
  },

  /** 一次轮询:拉增量 → 按结果决定下次间隔 */
  async poll() {
    try {
      const r = await api.chat.list(this.eventId, this.since)
      this.applyMessages(r, false)
      if (r.archived !== this.data.archived) this.setData({ archived: r.archived })
      this.pollState = nextPoll(this.pollState, r.messages.length)
    } catch (e) {
      // 单次失败不打断轮询,按空结果退避即可
      this.pollState = nextPoll(this.pollState, 0)
    }
    this.schedule()
  },

  schedule() {
    this.stopPolling()
    this.timer = setTimeout(() => this.poll(), this.pollState.intervalMs)
  },

  stopPolling() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  },

  applyMessages(r, replace) {
    if (!replace && !r.messages.length) return
    const messages = replace ? r.messages : this.data.messages.concat(r.messages)
    if (messages.length) this.since = messages[messages.length - 1].createdAt
    this.setData({
      messages,
      scrollTo: messages.length ? `msg-${messages[messages.length - 1]._id}` : '',
    })
  },

  /** 长按别人的消息 → 举报 */
  onLongPressMessage(e) {
    const { id, mine } = e.currentTarget.dataset
    if (mine) return
    showReportSheet('message', id)
  },

  onInput(e) { this.setData({ draft: e.detail.value }) },

  async onSend() {
    const content = this.data.draft.trim()
    if (!content || this.data.sending) return

    this.setData({ sending: true })
    try {
      await api.chat.send(this.eventId, content)
      this.setData({ draft: '' })
      // 发完立刻拉一次,不等下一个轮询周期 —— 自己的消息要马上看到
      this.stopPolling()
      this.pollState = { emptyStreak: 0, intervalMs: 4000 }
      await this.poll()
    } catch (e) {
      wx.showToast({ title: e.message || '发送失败', icon: 'none' })
    } finally {
      this.setData({ sending: false })
    }
  },
})
