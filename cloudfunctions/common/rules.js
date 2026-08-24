// ⚠️ 由 scripts/sync-config.js 自动生成,请勿直接修改。真源:config/rules.js
/**
 * 业务规则常量 —— 所有决策值的唯一来源
 *
 * 来源:docs/04-决策清单.md(2026-08-24 定稿)
 * 原则:D02/D03/D04/D06/D10 等全部为可配置项,严禁在业务代码里写魔法数字。
 *
 * 同步方式:小程序端直接 import;云函数目录为独立 node 模块,
 * 通过 `npm run sync:config` 复制本文件到各云函数的 config/ 下(见 package.json)。
 */

/** 场景类型 */
const SCENE = {
  COFFEE: 'coffee', // 下午咖啡局 —— 冷启动主力场景
  ART: 'art',       // 艺术展 / 市集局
  BAR: 'bar',       // 晚间小酒馆局
}

/**
 * D02 最低成团人数 / D03 人数上限
 * ⚠️ 人数均「含局主」。咖啡局 min=2 即「局主 + 1 名报名者」。
 * capacityMin 由系统按场景固定,不允许局主填写(局主会一律填最小值)。
 * capacityMax 局主可在 [capacityMin, capacityHardMax] 内调整。
 */
const SCENE_RULES = {
  [SCENE.COFFEE]: {
    label: '下午咖啡局',
    capacityMin: 2,
    capacityMaxDefault: 4,
    capacityHardMax: 6,      // 超过 6 人一张咖啡桌会裂成小圈子,伤害「零尬聊」体验
    priceEstDefaultTHB: 200,
    durationMinDefault: 120,
  },
  [SCENE.ART]: {
    label: '艺术展 / 市集局',
    capacityMin: 3,
    capacityMaxDefault: 6,
    capacityHardMax: 8,
    priceEstDefaultTHB: 300,
    durationMinDefault: 180,
  },
  [SCENE.BAR]: {
    label: '晚间小酒馆局',
    capacityMin: 4,
    capacityMaxDefault: 8,
    capacityHardMax: 10,
    priceEstDefaultTHB: 600,
    durationMinDefault: 180,
  },
}

/** D04 成团判定时点 —— 活动开始前多久判定成团/解散 */
const FORMATION = {
  /** 判定提前量(小时)。定稿值 6;冷启动期若体验反馈差可调至 12。 */
  judgeBeforeStartHours: 6,
  /** 判定任务扫描间隔(分钟)。判定必须幂等,重复执行不得重复发通知。 */
  scanIntervalMinutes: 15,
  /**
   * D05 成团后不锁定报名。
   * 成团后继续开放报名,直到人数上限或开始前 signupCloseBeforeStartHours。
   */
  lockOnFormed: false,
  /** 报名截止时点(开始前小时数)。给局主一个确定的最终人数去订位。 */
  signupCloseBeforeStartHours: 2,
  /**
   * D04 的配套缓解:判定时点提前到 6h 后,用户当天才知道结果。
   * 因此在开始前 24h 向「已报名者 + 局主」发一条催报名通知(还差 N 人,转发给朋友)。
   */
  rallyNoticeBeforeStartHours: 24,
  /**
   * 催报名的最小提前量(相对判定时点)。
   * 若定时任务曾失败,补发一条离判定只剩几分钟的催报名毫无用处 ——
   * 用户会先收到「还差 1 人」再立刻收到「已解散」,两条通知打架。
   * 因此距判定不足该小时数时,直接跳过催报名。
   */
  rallyMinLeadHours: 2,
}

/**
 * D06 审核策略
 * 审核对报名者完全不可见 —— 未通过的局不出现在任何列表中。
 * 局主端可见「审核中」状态,否则局主不知道自己的局为什么没出现。
 */
const REVIEW = {
  /**
   * 全局自动审核开关。
   * true  → 新局直接进 open,跳过 pending_review
   * false → 新局进 pending_review,等管理员手动放行
   * 运行时可在运营后台切换,不需要发版。
   */
  autoApprove: false,
  /**
   * D14 局主权限白名单:users.isHost === true 的用户发局免审,
   * 无论 autoApprove 为何值。这是「给权限不给钱」激励的核心载体。
   */
  hostBypassReview: true,
}

/**
 * D07 性别配比 —— V1 不做自动配比规则。
 * 性别仍按 D08 必填采集,仅供管理员人工审核参考,以及 V2 的算法层使用。
 * ⚠️ 收集但暂不使用的字段,必须在隐私政策中说明用途(活动氛围平衡与安全审核),
 *    否则在 PDPA 下属于合规瑕疵。
 */
const GENDER_RATIO = {
  enabled: false,
  // 以下参数在 enabled 转为 true 时生效(V2)
  maxSingleGenderRatio: 2 / 3,
  minSignupsToApply: 4,
  hardEnforceScenes: [SCENE.BAR],
}

/** D08 性别选项。OTHER 计入总人数,但不参与任何比例计算。 */
const GENDER = {
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other', // 不便透露
}

/**
 * D09 地点 —— 允许自由输入。
 * 用 wx.chooseLocation 选点,同时保存 name / address / lat / lng。
 * 保存坐标使得「场地热度」仍可通过 geohash 聚合统计出来,不因自由输入而丢失该维度。
 * 假地址风险由 D06 的手动审核开关兜底。
 */
const VENUE = {
  allowFreeInput: true,
  /** 推荐场地列表(非强制)。管理员后台维护,发局时置顶展示以降低填写成本。 */
  showSuggestedVenues: true,
  /** 热度聚合精度。geohash 6 位约 ±0.6km,足以把同一家店的多次选点聚到一起。 */
  heatmapGeohashPrecision: 6,
}

/**
 * D10 取消与爽约
 * 记录只对局主可见(报名者列表中显示靠谱度),不向其他参与者公开 ——
 * 公开会制造评判感,与产品调性冲突。
 */
const NO_SHOW = {
  /** open 状态下取消不算爽约 —— 鼓励尽早取消,把位置让出来。 */
  countCancelBeforeFormed: false,
  /** formed 之后取消算 1 次。 */
  countCancelAfterFormed: true,
  /** 未取消且未到场(局主活动后一键标记)算 1 次。 */
  countNoShow: true,
  /** 累计达到该次数 → 限制报名。 */
  restrictThreshold: 2,
  restrictDays: 14,
  /** 累计达到该次数 → 进人工复核,由管理员决定是否封禁。 */
  manualReviewThreshold: 3,
}

/** D10 靠谱度评价 —— 仅此三个枚举,不可扩展(PRD §5 结构层第四条) */
const RELIABILITY_MARK = {
  ON_TIME: 'on_time',
  LATE: 'late',
  NO_SHOW: 'no_show',
}

/** D11 保证金 —— V1 不收。爽约率 >25% 且持续 4 周时重新评估。 */
const DEPOSIT = {
  enabled: false,
  amountTHB: 0,
}

/**
 * D12 北极星指标 —— 双指标
 * 整体成团率是保健指标;非官方局成团率才是「产品能否自己跑」的真信号。
 */
const METRICS = {
  /** 保健指标:整体成团率(含官方局) */
  formationRateTarget: 0.6,
  /** 真北极星:非官方局成团率(isOfficial=false 且管理员未补位),8 周内达标 */
  organicFormationRateTarget: 0.4,
  organicTargetWeeks: 8,
  /** PRD §8 辅助指标 */
  repeatParticipationRateTarget: 0.35, // 30 天内二次参加
  signupConversionRateTarget: 0.25,    // 详情页打开 → 完成报名
  organicHostShareTarget: 0.5,         // 非官方局占比,8 周内
}

/** 局状态机(见 docs/02 §4)。状态流转必须写入 eventStatusLog 便于排障。 */
const EVENT_STATUS = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  REJECTED: 'rejected',
  OPEN: 'open',
  FORMED: 'formed',
  CANCELLED_LOW: 'cancelled_low',   // 判定时未达最低人数,自动解散
  CANCELLED_HOST: 'cancelled_host', // 局主主动取消,计入成团率分母且算未成团
  DONE: 'done',
  ARCHIVED: 'archived',
}

const SIGNUP_STATUS = {
  APPLIED: 'applied',
  WAITLIST: 'waitlist',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  ATTENDED: 'attended',
  NO_SHOW: 'no_show',
}

/** 群聊归档:活动结束后 48 小时转只读(PRD §4.1) */
const CHAT = {
  archiveAfterEndHours: 48,
}

/**
 * 通知通道(见 docs/03 §4 §9)
 * ⚠️ getPhoneNumber 返回的是微信绑定的手机号(目标用户大多为 +86),
 *    不等于用户在泰国能收到短信的号码 —— 因此手机号只作账号唯一性锚点,
 *    通知主通道是订阅消息,短信仅对填写了 notifyPhone(泰国号)的用户生效。
 */
const NOTIFY = {
  primaryChannel: 'wx_subscribe',
  smsFallbackEnabled: false, // V1.0 补 notifyPhone 后再开
  smsFallbackTemplates: ['event_formed', 'event_cancelled'],
}

module.exports = {
  SCENE, SCENE_RULES,
  FORMATION, REVIEW,
  GENDER, GENDER_RATIO,
  VENUE, NO_SHOW, RELIABILITY_MARK,
  DEPOSIT, METRICS,
  EVENT_STATUS, SIGNUP_STATUS,
  CHAT, NOTIFY,
}
