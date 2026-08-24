/**
 * 云函数调用封装
 *
 * 所有数据读写必须经过云函数,前端不直连数据库 —— 这是 PRD §5 结构设计的技术落点:
 * 数据库不对小程序端开放任何「按人检索」的能力,前端拿不到用户列表接口。
 */
function call(name, action, data = {}) {
  return wx.cloud.callFunction({ name, data: { action, ...data } }).then(res => {
    const r = res.result || {}
    if (r.ok === false) throw Object.assign(new Error(r.message || '请求失败'), { code: r.code })
    return r.data
  })
}

module.exports = {
  events: {
    list: params => call('events', 'list', params),
    detail: eventId => call('events', 'detail', { eventId }),
    create: payload => call('events', 'create', payload),
    cancel: eventId => call('events', 'cancel', { eventId }),
    /** 报名成功页的推荐位:同时段还差人的其他局(PRD §6 的留存关键动作) */
    recommend: eventId => call('events', 'recommend', { eventId }),
  },
  signups: {
    join: (eventId, profile) => call('signups', 'join', { eventId, profile }),
    cancel: eventId => call('signups', 'cancel', { eventId }),
    mine: () => call('signups', 'mine'),
  },
  admin: {
    pending: () => call('admin', 'pendingReviews'),
    review: (eventId, approved, note) => call('admin', 'review', { eventId, approved, note }),
    /** D06 全局自动审核开关,运营后台可随时切换,不需要发版 */
    setAutoApprove: on => call('admin', 'setAutoApprove', { on }),
    /** D14 授予/回收局主权限 —— 「给权限不给钱」的操作入口 */
    setHost: (userId, isHost) => call('admin', 'setHost', { userId, isHost }),
    metrics: () => call('admin', 'metrics'),
  },
}
