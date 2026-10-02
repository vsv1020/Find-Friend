/** 每个页面的 mock 数据 —— 形状与各页 Page({data}) 一致,只为预览 */
const SEATS = (n, max) => Array.from({ length: max }, (_, i) => i < n)
const EV = (o = {}) => ({
  weekdayText: '周六', clockText: '15:00', dayText: '10 月 3 日', sceneGlyph: '☕', seats: SEATS(1, 4), formed: false,
  _id: 'e1', sceneType: 'coffee', sceneText: '下午咖啡局', startText: '周六 15:00', startAt: '2026-10-03T08:00:00Z',
  venue: { name: 'Sarnies Bangkok', address: '101-103 Charoen Krung 44, Bang Rak' },
  capacityMin: 2, capacityMax: 4, confirmedCount: 1, priceEstTHB: 200, shortByText: '还差 1 人',
  description: '周六下午找人一起去 Sarnies 喝咖啡聊聊天,不赶时间。', status: 'open',
  viewer: { isHost: false, signupStatus: null }, canChat: false, ...o,
})
const EVENTS = [
  EV(),
  EV({ _id: 'e2', sceneType: 'art', sceneText: '艺术展 / 市集', startText: '周六 14:00', clockText: '14:00', sceneGlyph: '🎨', seats: SEATS(2, 6), venue: { name: 'BACC 曼谷艺术文化中心', address: 'Pathum Wan' }, confirmedCount: 2, capacityMax: 6, priceEstTHB: 300, shortByText: '还差 1 人', description: '新开的摄影展,看完一起找地方坐坐。' }),
  EV({ _id: 'e3', sceneType: 'bar', sceneText: '晚间小酒馆', startText: '周日 20:00', weekdayText: '周日', clockText: '20:00', dayText: '10 月 4 日', sceneGlyph: '🍸', seats: SEATS(4, 8), formed: true, venue: { name: 'Teens of Thailand', address: 'Soi Nana, Chinatown' }, confirmedCount: 4, capacityMax: 8, priceEstTHB: 600, shortByText: '已成团,仍可加入', status: 'formed' }),
]
window.MOCK_COMPONENTS = {
  'profile-sheet': { nickname: '小王', gender: 'male', agreed: true,
    genderOptions: [{ value: 'male', label: '男' }, { value: 'female', label: '女' }, { value: 'other', label: '不便透露' }] },
}
window.MOCK = {
  index: { loading: false, events: EVENTS, heroDate: '10 月 2 日 · 周五' },
  'event-detail': { loading: false, event: EV({ canChat: true, viewer: { isHost: true, signupStatus: 'confirmed' } }), showProfileSheet: false, agreed: false,
    profile: { nickname: '', gender: '' }, genderOptions: [{ value: 'male', label: '男' }, { value: 'female', label: '女' }, { value: 'other', label: '不便透露' }] },
  'event-detail-sheet': { loading: false, event: EV(), showProfileSheet: true, agreed: true,
    profile: { nickname: '小王', gender: 'male' }, genderOptions: [{ value: 'male', label: '男' }, { value: 'female', label: '女' }, { value: 'other', label: '不便透露' }] },
  'event-create': { scenes: [{ value: 'coffee', label: '下午咖啡局', hint: '两人即可成局' }, { value: 'art', label: '艺术展 / 市集', hint: '有话题载体,适合社恐' }, { value: 'bar', label: '晚间小酒馆', hint: '需要四人成局' }],
    sceneType: 'coffee', slots: [{ label: '本周六 15:00', startAt: 'a' }, { label: '本周日 15:00', startAt: 'b' }, { label: '下周六 15:00', startAt: 'c' }], slotIndex: 0,
    customStartAt: '', customDate: '', customTime: '', minDate: '2026-10-01', maxDate: '2026-11-30',
    suggestions: [{ _id: 'v1', name: 'Sarnies Bangkok', formed: 4 }, { _id: 'v2', name: 'Hands and Heart', formed: 2 }, { _id: 'v3', name: 'Rocket Coffeebar S.12', formed: 0 }, { _id: 'v4', name: 'Factory Coffee', formed: 1 }],
    venue: { name: 'Sarnies Bangkok', address: '101-103 Charoen Krung 44' }, capacityMin: 2, capacityMax: 4, capacityHardMax: 6, priceEstTHB: 200, description: '', submitting: false },
  'signup-success': { status: 'confirmed', subscribed: true, recommends: EVENTS.slice(1).map(e => ({ ...e })) },
  poster: { rendering: false, previewPath: 'poster-sample.svg', error: '' },
  chat: { loading: false, archived: false, draft: '', sending: false, scrollTo: '', maxLength: 500,
    messages: [
      { _id: 'm1', nickname: 'Victor', content: '周六 15:00 Sarnies 见,我订了靠窗的位置。', isMine: false, isBroadcast: true, createdAt: '' },
      { _id: 'm2', nickname: '小林', content: '收到!我大概提前十分钟到。', isMine: false, isBroadcast: false, createdAt: '' },
      { _id: 'm3', nickname: '我', content: '我到了,在二楼靠窗。', isMine: true, isBroadcast: false, createdAt: '' },
    ] },
  rating: { loading: false, isHost: true, marks: [{ value: 'on_time', label: '准时', tone: 'good' }, { value: 'late', label: '迟到', tone: 'warn' }, { value: 'no_show', label: '放鸽子', tone: 'bad' }],
    event: EV(), participants: [{ userId: 'u2', nickname: '小林' }, { userId: 'u3', nickname: 'Mia' }], picked: { u2: 'on_time', u3: 'late' }, submitting: false },
  my: {
    loading: false, showPast: true,
    profile: { nickname: '小王', reliability: 96, isAdmin: true },
    pendingRatings: [{ event: EVENTS[1], startText: '上周日 14:00', count: 2, isHost: false }],
    upcoming: [
      { signupId: 's1', label: '已成团', tone: 'ok', canChat: true, event: EVENTS[2] },
      { signupId: 's2', label: '候补中', tone: 'warm', canChat: false, event: EVENTS[1] },
    ],
    hosted: [{ signupId: 's3', isHost: true, label: '招人中', tone: 'warm', canChat: false, event: EV() }],
    past: [
      { signupId: 's4', label: '去过了', tone: 'ok', isHost: false, event: { ...EVENTS[1], dayText: '9 月 27 日' } },
      { signupId: 's5', label: '人没凑齐,已解散', tone: 'mute', isHost: true, event: { ...EV(), dayText: '9 月 20 日' } },
    ],
  },
  privacy: { loading: false, profile: { nickname: '小王', reliability: 96 } },
  admin: { loading: false, autoApprove: false, aiPrecheck: 'advisory',
    venues: [{ _id: 'v1', name: 'Sarnies Bangkok', isActive: true, formed: 4, published: 5 }, { _id: 'v2', name: 'Hands and Heart', isActive: true, formed: 2, published: 2 }, { _id: 'v3', name: 'Old Town Cafe', isActive: false, formed: 0, published: 1 }],
    hotspots: [{ geohash: 'w4rqnx', name: 'Teens of Thailand', published: 3, formed: 3, sample: {} }],
    board: {
      funnel: { views: 182, starts: 61, successes: 47, rateText: '25.8%', targetText: '25%', met: true, lookbackDays: 30 },
      repeat: { users: 23, repeaters: 9, pending: 4, rateText: '39%', targetText: '35%', met: true, windowDays: 30 },
      share: { total: 14, organic: 7, rateText: '50%', targetText: '50%', met: true },
      weekly: [['09-07', 2, 1, 0], ['09-14', 3, 2, 1], ['09-21', 4, 3, 2], ['09-28', 5, 5, 4]]
        .map(([label, published, formed, organic]) => ({ label, published, formed, organic, publishedWidth: published * 20, formedWidth: formed * 20, organicWidth: organic * 20 })),
      truncated: false,
    },
    aiModes: [{ value: 'off', label: '关闭' }, { value: 'advisory', label: '顾问' }, { value: 'gate', label: '放行' }],
    metrics: { overall: { formed: 11, total: 14, target: 0.6, met: true }, organic: { formed: 3, total: 7, target: 0.4, met: true },
      funnel: { views: 182, starts: 61, successes: 47, viewToSignupRate: 0.258, target: 0.25, met: true },
      repeat: { users: 23, repeaters: 9, pending: 4, rate: 0.39, target: 0.35, met: true },
      organicShare: { total: 14, organic: 7, share: 0.5, target: 0.5, met: true },
      weekly: [['09-07', 2, 1, 0], ['09-14', 3, 2, 1], ['09-21', 4, 3, 2], ['09-28', 5, 5, 4]].map(([w, p, f, o]) => ({ weekStart: w, published: p, formed: f, organic: o, pubPct: p * 20, formedPct: f * 20, organicPct: o * 20 })),
      truncated: { events: false, signups: false, analyticsEvents: false } },
    pending: [{ _id: 'p1', startText: '周日 15:00', venue: { name: 'Hands and Heart Cafe' }, description: '周日下午找人一起喝咖啡' }],
    reports: [{ _id: 'r1', reason: 'commercial', targetType: 'event', detail: '', context: { description: '加微信了解副业项目' } }] },
  host: { loading: false, canManage: true, isDone: false, coolingDown: false, broadcastMax: 200, content: '', dateStart: '2026-10-01',
    rescheduling: false, sending: false, customDate: '', customTime: '',
    event: EV({ status: 'formed', confirmedCount: 2, dateText: '10 月 3 日' }), roster: [
      { userId: 'u1', nickname: 'Victor', status: 'confirmed', reliability: 100, noShowCount: 0, isHostSignup: true },
      { userId: 'u2', nickname: '小林', status: 'confirmed', reliability: 92, noShowCount: 0, isHostSignup: false },
      { userId: 'u3', nickname: 'Mia', status: 'waitlist', reliability: 78, noShowCount: 1, isHostSignup: false }]
      .map(r => ({ ...r, statusText: { confirmed: '已确认', waitlist: '候补' }[r.status], lowReliability: r.reliability < 80 })),
    draft: '', cooldownText: '', slots: [{ label: '本周六 15:00', startAt: 'a' }, { label: '本周日 15:00', startAt: 'b' }], submitting: false },
}
