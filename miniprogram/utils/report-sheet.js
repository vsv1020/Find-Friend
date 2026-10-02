/**
 * 举报交互(T22)—— 局详情页与行前沟通页共用
 * 一次 ActionSheet 选原因 → 提交。门槛刻意压到最低:遇到问题的人没有耐心填表单。
 */
const api = require('./api')

const REASONS = [
  { value: 'harassment', label: '骚扰或越界言行' },
  { value: 'scam',       label: '推销、引流或诈骗' },
  { value: 'fake_event', label: '虚假活动或地址' },
  { value: 'dating',     label: '把这里当约会软件用' },
  { value: 'safety',     label: '人身安全问题' },
  { value: 'other',      label: '其他' },
]

function showReportSheet(targetType, targetId) {
  wx.showActionSheet({
    alertText: '举报原因',
    itemList: REASONS.map(r => r.label),
    success: async res => {
      const reason = REASONS[res.tapIndex].value
      try {
        await api.report.create(targetType, targetId, reason)
        wx.showToast({ title: '已收到,我们会尽快处理', icon: 'none' })
      } catch (e) {
        wx.showToast({ title: e.message || '举报失败', icon: 'none' })
      }
    },
  })
}

module.exports = { showReportSheet, REASONS }
