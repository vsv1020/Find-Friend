/**
 * 运营后台 —— 必须手机可用
 *
 * 前三个月本质是人肉运营(PRD §9),所以这个页面的目标是:
 * 把 Victor 每天的操作时间压到 15 分钟以内。审核一个局 ≤ 3 次点击。
 */
const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: { pending: [], reports: [], metrics: null, autoApprove: false, loading: true },

  onShow() { this.load() },

  async load() {
    try {
      const [pending, metrics, reports] = await Promise.all([
        api.admin.pending(), api.admin.metrics(), api.admin.openReports().catch(() => []),
      ])
      this.setData({
        loading: false,
        metrics,
        autoApprove: metrics.autoApprove,
        pending: pending.map(e => ({ ...e, startText: fmt.formatStart(e.startAt) })),
        reports,
      })
    } catch (e) { this.setData({ loading: false }) }
  },

  /** D06 全局自动审核开关 —— 忙不过来就打开,不需要发版 */
  async onToggleAutoApprove(e) {
    await api.admin.setAutoApprove(e.detail.value)
    this.setData({ autoApprove: e.detail.value })
  },

  /** 处理一条举报:提供 封人 / 下架局 / 驳回 三个动作 */
  onHandleReport(e) {
    const r = this.data.reports[e.currentTarget.dataset.index]
    const actions = ['举报成立,封禁对方', '举报成立,下架该局', '不成立,驳回']
    wx.showActionSheet({
      itemList: actions,
      success: async res => {
        try {
          if (res.tapIndex === 0 && r.targetOwnerId) {
            await api.admin.banUser(r.targetOwnerId, `举报: ${r.reason}`)
            await api.admin.resolveReport(r._id, 'resolved', '已封禁')
          } else if (res.tapIndex === 1) {
            const eventId = r.targetType === 'event' ? r.targetId : (r.context && r.context.eventId)
            if (eventId) await api.admin.takedownEvent(eventId, `举报: ${r.reason}`)
            await api.admin.resolveReport(r._id, 'resolved', '已下架')
          } else {
            await api.admin.resolveReport(r._id, 'dismissed')
          }
          this.load()
        } catch (err) {
          wx.showToast({ title: err.message || '处理失败', icon: 'none' })
        }
      },
    })
  },

  async onReview(e) {
    const { id, approved } = e.currentTarget.dataset
    await api.admin.review(id, approved === 'true')
    this.load()
  },
})
