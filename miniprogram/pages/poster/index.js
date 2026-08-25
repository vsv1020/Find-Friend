/**
 * 分享海报页
 *
 * 小程序无法分享到朋友圈,这里是那条路径唯一的替代方案 ——
 * 生成一张带小程序码的图,局主保存后发朋友圈,别人长按识别进来。
 * 见 docs/03 §6.1。
 */
const api = require('../../utils/api')
const posterUtil = require('../../utils/poster')
const fmt = require('../../utils/format')
const { track, EVENTS } = require('../../utils/track')

Page({
  data: { rendering: true, previewPath: '', error: '' },

  onLoad(q) {
    this.eventId = q.eventId
    this.render()
  },

  async render() {
    try {
      const [event, qr] = await Promise.all([
        api.events.detail(this.eventId),
        api.poster.qrcode(this.eventId),
      ])
      const canvas = await this.getCanvas()
      const ctx = canvas.getContext('2d')

      const dpr = wx.getWindowInfo().pixelRatio || 2
      canvas.width = posterUtil.W * dpr
      canvas.height = posterUtil.H * dpr
      ctx.scale(dpr, dpr)

      // 测量函数交给 layout,布局计算本身不接触 canvas(有单元测试)
      const measure = (text, size) => {
        ctx.font = `${size}px sans-serif`
        return ctx.measureText(text).width
      }
      const l = posterUtil.layout({
        sceneText: fmt.sceneLabel(event.sceneType),
        startText: fmt.formatStart(event.startAt),
        venueName: event.venue.name,
        priceEstTHB: event.priceEstTHB,
        shortByText: fmt.shortByText(event),
        description: event.description,
      }, measure)

      const qrImage = await this.loadImage(canvas, qr.fileID)
      posterUtil.draw(ctx, l, { qrcode: qrImage })

      const r = await wx.canvasToTempFilePath({ canvas, destWidth: posterUtil.W * dpr, destHeight: posterUtil.H * dpr })
      this.setData({ rendering: false, previewPath: r.tempFilePath })
    } catch (e) {
      this.setData({ rendering: false, error: e.message || '海报生成失败' })
    }
  },

  getCanvas() {
    return new Promise(resolve => {
      wx.createSelectorQuery().in(this).select('#poster')
        .fields({ node: true, size: true }).exec(res => resolve(res[0].node))
    })
  },

  /** 云存储文件需先换成临时链接才能被 canvas 加载 */
  async loadImage(canvas, fileID) {
    const { fileList } = await wx.cloud.getTempFileURL({ fileList: [fileID] })
    const url = fileList[0].tempFileURL
    const local = await wx.getImageInfo({ src: url })
    return new Promise((resolve, reject) => {
      const img = canvas.createImage()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = local.path
    })
  },

  async onSave() {
    try {
      await wx.saveImageToPhotosAlbum({ filePath: this.data.previewPath })
      track(EVENTS.SHARE_POSTER_SAVE, { eventId: this.eventId })
      wx.showToast({ title: '已保存,去发朋友圈吧', icon: 'none' })
    } catch (e) {
      // 用户拒绝过相册权限时,引导去设置页而不是反复弹同一个失败提示
      if (String(e.errMsg || '').includes('auth deny')) {
        wx.showModal({
          title: '需要相册权限', content: '保存海报需要访问相册,去设置里打开一下?',
          success: r => r.confirm && wx.openSetting(),
        })
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    }
  },
})
