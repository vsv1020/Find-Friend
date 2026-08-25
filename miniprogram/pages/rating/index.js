/**
 * 评价页(T18)
 *
 * 同一个页面两种身份,但做的是**完全不同的两件事**:
 *   局主   → 标记到场情况。这是事实认定,会影响对方的爬约记录与报名限制。
 *   参与者 → 互评靠谱度。只影响分数,不会让任何人被限制。
 * 文案上必须让局主意识到自己那一下的分量,所以两种模式的提示语不同。
 *
 * PRD §5:只有准时 / 迟到 / 放鸽子三个选项。没有「好感」「颜值」,也不会有。
 */
const api = require('../../utils/api')
const fmt = require('../../utils/format')

const MARKS = [
  { value: 'on_time', label: '准时', tone: 'good' },
  { value: 'late',    label: '迟到', tone: 'warn' },
  { value: 'no_show', label: '放鸽子', tone: 'bad' },
]

Page({
  data: {
    marks: MARKS,
    isHost: false,
    event: null,
    participants: [],
    picked: {},         // userId -> mark
    submitting: false,
    loading: true,
  },

  onLoad(q) {
    this.eventId = q.eventId
    this.setData({ isHost: q.isHost === '1' })
    this.load()
  },

  async load() {
    try {
      const [event, participants] = await Promise.all([
        api.events.detail(this.eventId),
        api.rating.participants(this.eventId),
      ])
      this.setData({
        loading: false,
        event: { ...event, startText: fmt.formatStart(event.startAt) },
        participants,
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  onPick(e) {
    const { userid, mark } = e.currentTarget.dataset
    this.setData({ [`picked.${userid}`]: mark })
  },

  async onSubmit() {
    const picked = this.data.picked
    const entries = Object.entries(picked)
    if (!entries.length) return wx.showToast({ title: '还没选', icon: 'none' })

    // 局主标记会影响对方能不能继续报名,提交前确认一次
    if (this.data.isHost && entries.some(([, m]) => m === 'no_show')) {
      const r = await new Promise(resolve => wx.showModal({
        title: '确认标记放鸽子',
        content: '这会计入对方的爬约记录,累计两次会被限制报名 14 天。确定吗?',
        success: resolve,
      }))
      if (!r.confirm) return
    }

    this.setData({ submitting: true })
    try {
      if (this.data.isHost) {
        await api.rating.markAttendance(this.eventId,
          entries.map(([userId, mark]) => ({ userId, mark })))
      } else {
        // 互评逐条提交,某一条失败(比如已评过)不影响其余
        for (const [rateeId, mark] of entries) {
          await api.rating.rate(this.eventId, rateeId, mark).catch(() => {})
        }
      }
      wx.showToast({ title: '谢谢', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (e) {
      wx.showToast({ title: e.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
