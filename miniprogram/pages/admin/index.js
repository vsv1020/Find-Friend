/**
 * 运营后台 —— 必须手机可用
 *
 * 前三个月本质是人肉运营(PRD §9),所以这个页面的目标是:
 * 把 Victor 每天的操作时间压到 15 分钟以内。审核一个局 ≤ 3 次点击。
 */
const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: { pending: [], metrics: null, autoApprove: false, loading: true },

  onShow() { this.load() },

  async load() {
    try {
      const [pending, metrics] = await Promise.all([api.admin.pending(), api.admin.metrics()])
      this.setData({
        loading: false,
        metrics,
        autoApprove: metrics.autoApprove,
        pending: pending.map(e => ({ ...e, startText: fmt.formatStart(e.startAt) })),
      })
    } catch (e) { this.setData({ loading: false }) }
  },

  /** D06 全局自动审核开关 —— 忙不过来就打开,不需要发版 */
  async onToggleAutoApprove(e) {
    await api.admin.setAutoApprove(e.detail.value)
    this.setData({ autoApprove: e.detail.value })
  },

  async onReview(e) {
    const { id, approved } = e.currentTarget.dataset
    await api.admin.review(id, approved === 'true')
    this.load()
  },
})
