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
    detail: (eventId, shareCode) => call('events', 'detail', { eventId, shareCode }),
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
  chat: {
    /** 传 since 拉增量(轮询用),不传拉最近一页 */
    list: (eventId, since) => call('chat', 'list', { eventId, since }),
    send: (eventId, content) => call('chat', 'send', { eventId, content }),
  },
  rating: {
    /** 我参加过、还在 7 天评价窗口内、且没评完的局 */
    pending: () => call('rating', 'pendingRatings'),
    participants: eventId => call('rating', 'participants', { eventId }),
    /** 参与者互评:只影响分数,不触发任何处罚 */
    rate: (eventId, rateeId, mark) => call('rating', 'rate', { eventId, rateeId, mark }),
    /** 局主的事实认定:会影响爬约计数与报名限制 */
    markAttendance: (eventId, marks) => call('rating', 'markAttendance', { eventId, marks }),
  },
  account: {
    profile: () => call('account', 'profile'),
    /** 隐私政策第七条承诺的「查看我们持有的关于你的信息」 */
    exportMyData: () => call('account', 'exportMyData'),
    /** PIPL 与 PDPA 下的强制入口,不可省略 */
    deleteAccount: () => call('account', 'deleteAccount'),
  },
  poster: {
    /** 小程序码带缓存,同一个局重复分享不会重复消耗 getUnlimited 配额 */
    qrcode: eventId => call('poster', 'qrcode', { eventId }),
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
