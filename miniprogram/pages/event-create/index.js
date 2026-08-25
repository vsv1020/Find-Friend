/**
 * 发局表单 —— 目标:30 秒内填完(PRD §4.1)
 *
 * 6 个字段里只有「地点」需要真正思考,其余全部有默认值:
 *   场景  → 三选一,选完自动带出人数上限、人均、时长
 *   时间  → 周末快捷时段,点一下即可(见 common/schedule.js)
 *   人数  → 按场景默认,可调但有硬顶(D03)
 *   人均  → 按场景默认
 *   说明  → 选填
 *
 * ⚠️ capacityMin 不在表单里 —— 由系统按场景固定(D02)。
 *    让局主填这个字段,他会一律填最小值,字段就失去意义了。
 */
const api = require('../../utils/api')
const { track, EVENTS } = require('../../utils/track')
const { SCENE_RULES } = require('../../config/rules')
const { weekendSlots } = require('../../utils/schedule')

const SCENES = [
  { value: 'coffee', label: '下午咖啡局', hint: '两人即可成局' },
  { value: 'art',    label: '艺术展 / 市集', hint: '有话题载体,适合社恐' },
  { value: 'bar',    label: '晚间小酒馆', hint: '需要四人成局' },
]

Page({
  data: {
    scenes: SCENES,
    sceneType: 'coffee',
    slots: [],
    slotIndex: 0,
    customStartAt: '',
    venue: null,              // D09 自由输入:{name, address, lat, lng}
    capacityMax: 4,
    capacityHardMax: 6,
    capacityMin: 2,
    priceEstTHB: 200,
    description: '',
    submitting: false,
  },

  onLoad() { this.applyScene('coffee') },

  /** 选场景即带出全部默认值 —— 这是「30 秒填完」的关键 */
  applyScene(sceneType) {
    const r = SCENE_RULES[sceneType]
    this.setData({
      sceneType,
      capacityMin: r.capacityMin,
      capacityMax: r.capacityMaxDefault,
      capacityHardMax: r.capacityHardMax,
      priceEstTHB: r.priceEstDefaultTHB,
      slots: weekendSlots(new Date().toISOString(), sceneType, 3),
      slotIndex: 0,
      customStartAt: '',
    })
  },

  onSelectScene(e) { this.applyScene(e.currentTarget.dataset.value) },
  onSelectSlot(e) { this.setData({ slotIndex: Number(e.currentTarget.dataset.index), customStartAt: '' }) },

  /** D09 自由输入地点。必须保存坐标 —— 场地热度靠坐标聚合统计,不靠名称匹配。 */
  onChooseVenue() {
    wx.chooseLocation({
      success: r => this.setData({
        venue: { name: r.name || r.address, address: r.address, lat: r.latitude, lng: r.longitude },
      }),
      fail: () => {},
    })
  },

  onCapacityChange(e) { this.setData({ capacityMax: Number(e.detail.value) }) },
  onPriceInput(e) { this.setData({ priceEstTHB: Number(e.detail.value) || 0 }) },
  onDescInput(e) { this.setData({ description: e.detail.value }) },

  async onSubmit() {
    const { sceneType, slots, slotIndex, customStartAt, venue, capacityMax, priceEstTHB, description } = this.data
    if (!venue) return wx.showToast({ title: '选一个地点', icon: 'none' })
    const startAt = customStartAt || (slots[slotIndex] && slots[slotIndex].startAt)
    if (!startAt) return wx.showToast({ title: '选一个时间', icon: 'none' })

    this.setData({ submitting: true })
    try {
      const r = await api.events.create({ sceneType, startAt, venue, capacityMax, priceEstTHB, description })
      track(EVENTS.EVENT_CREATE, { sceneType, status: r.status })
      // 待审时明确告诉局主 —— 审核状态对报名者不可见,但局主必须知道自己的局为什么没出现(D06)
      wx.showModal({
        title: r.status === 'pending_review' ? '已提交,待放行' : '已发布',
        content: r.status === 'pending_review'
          ? '你的局正在等待放行,通过后才会出现在列表里。'
          : '已经出现在周末列表里了,分享给朋友吧。',
        showCancel: false,
        success: () => wx.redirectTo({ url: `/pages/event-detail/index?eventId=${r.eventId}` }),
      })
    } catch (e) {
      wx.showToast({ title: e.message || '发布失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
