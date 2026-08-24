const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: { signups: [], loading: true },
  onShow() { this.load() },
  async load() {
    try {
      const list = await api.signups.mine()
      this.setData({ loading: false, signups: list.map(s => ({
        ...s, startText: fmt.formatStart(s.event.startAt),
      })) })
    } catch (e) { this.setData({ loading: false }) }
  },
})
