/**
 * 埋点 —— 见 docs/02 §7
 *
 * ⚠️ 「链接打开 → 完成报名」转化率要求在未登录状态就开始记录访问,
 *    因此每条埋点都带 anonId。事后补埋点等于重跑一遍冷启动。
 */
const EVENTS = {
  EVENT_DETAIL_VIEW: 'event_detail_view',
  SIGNUP_START: 'signup_start',
  SIGNUP_SUCCESS: 'signup_success',
  RECOMMEND_CLICK: 'recommend_click',
  SHARE_POSTER_SAVE: 'share_poster_save',
  EVENT_CREATE: 'event_create',
}

function track(name, props = {}) {
  const app = getApp()
  wx.cloud.callFunction({
    name: 'events',
    data: { action: 'track', name, props, anonId: app && app.globalData.anonId },
  }).catch(() => { /* 埋点失败不得影响主流程 */ })
}

module.exports = { track, EVENTS }
