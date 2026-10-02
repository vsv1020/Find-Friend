/**
 * 建号弹层 —— 报名与发局共用:昵称 + 性别(D08 必填)+ 同意勾选(不可默认勾选)+ 手机号一键授权
 * 只收集输入并抛出 submit 事件,不调接口;调用方决定是报名还是建号。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '最后一步' },
    confirmText: { type: String, value: '确认' },
  },
  data: {
    nickname: '', gender: '', agreed: false,
    genderOptions: [{ value: 'male', label: '男' }, { value: 'female', label: '女' }, { value: 'other', label: '不便透露' }],
  },
  methods: {
    onNicknameInput(e) { this.setData({ nickname: e.detail.value }) },
    onGenderSelect(e) { this.setData({ gender: e.currentTarget.dataset.value }) },
    onToggleAgree() { this.setData({ agreed: !this.data.agreed }) },
    onOpenTerms() { wx.navigateTo({ url: '/pages/privacy/terms' }) },
    onOpenPolicy() { wx.navigateTo({ url: '/pages/privacy/policy' }) },
    onClose() { this.triggerEvent('close') },
    /** 未勾选同意时按钮没有 open-type,点击只提示 */
    onTapConfirm() { if (!this.data.agreed) wx.showToast({ title: '请先阅读并同意协议', icon: 'none' }) },
    onGetPhoneNumber(e) {
      if (!this.data.agreed) return wx.showToast({ title: '请先阅读并同意协议', icon: 'none' })
      if (!e.detail.code) return wx.showToast({ title: '需要手机号才能继续', icon: 'none' })
      const { nickname, gender } = this.data
      if (!nickname.trim()) return wx.showToast({ title: '请填写昵称', icon: 'none' })
      if (!gender) return wx.showToast({ title: '请选择性别', icon: 'none' })
      this.triggerEvent('submit', { nickname: nickname.trim(), gender, phoneCode: e.detail.code })
    },
  },
})
