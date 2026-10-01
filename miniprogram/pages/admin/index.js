/**
 * 运营后台 —— 必须手机可用
 *
 * 前三个月本质是人肉运营(PRD §9),所以这个页面的目标是:
 * 把 Victor 每天的操作时间压到 15 分钟以内。审核一个局 ≤ 3 次点击。
 */
const api = require('../../utils/api')
const fmt = require('../../utils/format')

const pct = r => (r === null || r === undefined ? '—' : `${Math.round(r * 100)}%`)

/**
 * 把看板数字整理成可直接渲染的结构。
 * 周趋势的条宽以所有周里最大的公开数为 100%,成团与非官方都是公开的子集,不会溢出。
 */
function dashboardView(m) {
  if (!m || !m.funnel) return null   // 云函数尚未部署新版时不渲染看板,旧卡片照常显示
  const maxPublished = Math.max(1, ...m.weekly.map(w => w.published))
  const width = n => `${Math.round((n / maxPublished) * 100)}%`
  const t = m.truncated || {}
  return {
    funnel: { ...m.funnel, rateText: pct(m.funnel.viewToSignupRate), targetText: pct(m.funnel.target) },
    repeat: { ...m.repeat, rateText: pct(m.repeat.rate), targetText: pct(m.repeat.target) },
    share: { ...m.organicHostShare, rateText: pct(m.organicHostShare.share), targetText: pct(m.organicHostShare.target) },
    weekly: m.weekly.map(w => ({
      ...w,
      label: w.weekStart.slice(5),
      publishedWidth: width(w.published), formedWidth: width(w.formed), organicWidth: width(w.organic),
    })),
    truncated: Boolean(t.events || t.signups || t.analyticsEvents),
  }
}

Page({
  data: {
    pending: [], reports: [], metrics: null, board: null, autoApprove: false, loading: true,
    aiPrecheck: 'off',
    venues: [], hotspots: [],
    aiModes: [{ value: 'off', label: '关闭' }, { value: 'advisory', label: '顾问' }, { value: 'gate', label: '放行' }],
  },

  onShow() { this.load() },

  async load() {
    try {
      const [pending, metrics, reports, venueData] = await Promise.all([
        api.admin.pending(), api.admin.metrics(), api.admin.openReports().catch(() => []),
        api.admin.listVenues().catch(() => ({ venues: [], hotspots: [] })),
      ])
      this.setData({
        loading: false,
        metrics,
        board: dashboardView(metrics),
        autoApprove: metrics.autoApprove,
        aiPrecheck: metrics.aiPrecheck || 'off',
        pending: pending.map(e => ({ ...e, startText: fmt.formatStart(e.startAt) })),
        reports,
        venues: venueData.venues, hotspots: venueData.hotspots,
      })
    } catch (e) { this.setData({ loading: false }) }
  },

  /** D06 全局自动审核开关 —— 忙不过来就打开,不需要发版 */
  async onToggleAutoApprove(e) {
    await api.admin.setAutoApprove(e.detail.value)
    this.setData({ autoApprove: e.detail.value })
  },

  async onToggleVenue(e) {
    const { id, active } = e.currentTarget.dataset
    await api.admin.toggleVenue(id, !active)
    this.load()
  },

  /** 一键收录热点:用该格子里最常用的名称与一次采样坐标建推荐场地 */
  async onAdoptHotspot(e) {
    const h = this.data.hotspots[Number(e.currentTarget.dataset.index)]
    if (!h) return
    await api.admin.upsertVenue({ name: h.name, address: h.sample.address || '', lat: h.sample.lat, lng: h.sample.lng, sceneTypes: [] })
    this.load()
  },

  async onSetAiPrecheck(e) {
    const mode = e.currentTarget.dataset.value
    if (mode === 'gate') {
      const r = await new Promise(resolve => wx.showModal({
        title: '开启自动放行?', content: '两个模型一致且高置信的局会跳过人工直接公开。建议先跑 8 周顾问模式看一致率。',
        success: resolve,
      }))
      if (!r.confirm) return
    }
    await api.admin.setAiPrecheck(mode)
    this.setData({ aiPrecheck: mode })
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
