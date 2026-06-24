// 演示项目（闯关学习 + 签到积分）的预定义 AI 分析结果
// 模拟 AI 对 demo-project 的完整分析输出，覆盖 B1-B7 七类地图

import type { AnalysisModel } from "./store";

// 演示项目的预定义分析模型
export const demoAnalysisModel: AnalysisModel = {
  // B1 项目概况
  overview: {
    projectType: "Web 应用 · 闯关学习平台",
    targetUser: "学习者（注册用户）",
    coreFunctions: [
      "关卡学习",
      "答题闯关",
      "每日签到",
      "积分系统",
      "奖励兑换",
    ],
    businessObjects: ["用户", "关卡", "签到记录", "积分", "奖励", "兑换记录"],
    techStack: ["Next.js", "React", "Tailwind CSS", "Prisma", "SQLite"],
    database: "SQLite",
    apis: [
      "/api/auth/register",
      "/api/auth/login",
      "/api/sign",
      "/api/points",
      "/api/level",
      "/api/level/[id]/answer",
      "/api/exchange",
    ],
    authMethod: "用户名 + 密码（JWT）",
    permissionSystem: "游客 / 已登录用户 两层权限",
  },

  // B2 功能地图（树形 + 风险色标）
  featureMap: [
    {
      name: "用户系统",
      children: [
        { name: "注册", risk: "medium" },
        { name: "登录", risk: "medium" },
        { name: "退出", risk: "low" },
      ],
    },
    {
      name: "学习系统",
      children: [
        { name: "课程列表", risk: "low" },
        { name: "关卡学习", risk: "medium" },
        { name: "答题", risk: "medium" },
        { name: "进度记录", risk: "high" },
        { name: "关卡解锁", risk: "high" },
      ],
    },
    {
      name: "激励系统",
      children: [
        { name: "每日签到", risk: "critical" },
        { name: "积分", risk: "critical" },
        { name: "连续签到", risk: "high" },
        { name: "奖励", risk: "medium" },
        { name: "兑换", risk: "critical" },
      ],
    },
  ],

  // B3 角色权限地图
  roleMap: [
    {
      role: "游客",
      pages: ["首页", "登录页", "注册页"],
      dataScope: "无数据访问权限，仅可浏览公开页面",
    },
    {
      role: "已登录用户",
      pages: [
        "首页",
        "关卡列表",
        "关卡详情",
        "签到页",
        "奖励页",
        "积分查询",
      ],
      dataScope: "仅可查看本人的积分、进度、签到与兑换记录",
    },
  ],

  // B4 状态机地图
  stateMap: [
    {
      subject: "签到状态",
      states: ["未签到", "今日已签到"],
      flows: [
        { from: "未签到", to: "今日已签到", event: "调用 /api/sign" },
      ],
      illegalFlows: [
        {
          from: "今日已签到",
          to: "未签到",
          note: "同一天内重复签到（应被拦截）",
        },
      ],
    },
    {
      subject: "关卡状态",
      states: ["锁定", "已解锁", "学习中", "已完成"],
      flows: [
        { from: "锁定", to: "已解锁", event: "前置关卡完成" },
        { from: "已解锁", to: "学习中", event: "进入关卡" },
        { from: "学习中", to: "已完成", event: "答对题目" },
      ],
      illegalFlows: [
        {
          from: "已完成",
          to: "学习中",
          note: "回退（已完成不应再变为学习中）",
        },
        {
          from: "锁定",
          to: "已完成",
          note: "跳过解锁直接完成（绕过前置关卡）",
        },
      ],
    },
  ],

  // B5 数据地图
  dataMap: {
    objects: [
      { name: "User", description: "用户：含用户名、密码、积分" },
      { name: "Level", description: "关卡：含题目、答案、奖励积分" },
      { name: "SignRecord", description: "签到记录：用户、积分、时间" },
      { name: "Progress", description: "进度：用户、关卡、状态" },
      { name: "Reward", description: "奖励：标题、所需积分、库存" },
      { name: "Exchange", description: "兑换记录：用户、奖励、时间" },
    ],
    relations: [
      { from: "User", to: "SignRecord", type: "1:N" },
      { from: "User", to: "Progress", type: "1:N" },
      { from: "User", to: "Exchange", type: "1:N" },
      { from: "Level", to: "Progress", type: "1:N" },
      { from: "Reward", to: "Exchange", type: "1:N" },
    ],
  },

  // 一致性风险（数据地图补充）
  consistencyRisks: [
    "积分余额应等于签到记录积分 + 答题积分 - 兑换扣减积分的汇总值",
    "关卡进度状态应与答题记录一致（答对后应标记为已完成）",
    "兑换记录应伴随积分扣减与库存扣减",
  ],

  // B6 风险地图
  riskMap: [
    {
      area: "每日签到",
      level: "critical",
      reason: "积分发放入口，无频率限制将导致积分无限刷取",
      priority: "P0 · 必测",
    },
    {
      area: "积分系统",
      level: "critical",
      reason: "全局流通凭证，余额错误影响所有激励功能",
      priority: "P0 · 必测",
    },
    {
      area: "关卡解锁",
      level: "critical",
      reason: "跳关可绕过学习路径，破坏业务逻辑",
      priority: "P0 · 必测",
    },
    {
      area: "奖励兑换",
      level: "critical",
      reason: "积分扣减入口，校验缺失将导致 0 积分兑换",
      priority: "P0 · 必测",
    },
    {
      area: "答题",
      level: "medium",
      reason: "积分发放入口，但单次影响有限",
      priority: "P1 · 重要",
    },
    {
      area: "用户认证",
      level: "medium",
      reason: "JWT 校验缺失将导致越权访问",
      priority: "P1 · 重要",
    },
  ],

  // B7 三方对照（文档 / 代码 / 运行）
  crossCheck: [
    {
      feature: "每日签到",
      doc: '页面文案"每日签到"，暗示每天仅可签到一次',
      code: "/api/sign 无频率限制，未检查今日是否已签到",
      runtime: "可对同一账号连续发起签到请求，每次均返回成功并增加积分",
      conclusion: "已确认业务 Bug：签到无频率限制，可无限刷积分",
      source: "runtime",
      confidence: "high",
    },
    {
      feature: "签到按钮防抖",
      doc: "未明确说明",
      code: "前端签到按钮未做 loading 防抖，可快速双击",
      runtime: "快速双击签到按钮会发送两次请求，两次均成功",
      conclusion: "已确认前端缺陷：按钮无防抖，叠加后端无限制可重复签到",
      source: "runtime",
      confidence: "high",
    },
    {
      feature: "签到状态持久化",
      doc: "未明确说明",
      code: "前端未读取任何持久化签到状态，刷新后状态丢失",
      runtime: "刷新页面后签到按钮恢复可点击状态",
      conclusion: "已确认前端缺陷：签到状态未持久化，刷新后可再次签到",
      source: "code",
      confidence: "high",
    },
    {
      feature: "关卡解锁校验",
      doc: "关卡需按顺序解锁，前置关卡完成后才能挑战下一关",
      code: "/api/level/[id]/answer 未校验该关卡是否已解锁",
      runtime: "可直接对锁定关卡提交答案并获得积分",
      conclusion: "已确认业务 Bug：可跳过前置关卡直接答题",
      source: "runtime",
      confidence: "high",
    },
    {
      feature: "关卡进度持久化",
      doc: "答对题目后应记录关卡完成状态",
      code: "/api/level/[id]/answer 答对后未更新 Progress 状态为 completed",
      runtime: "答对关卡后刷新页面，关卡仍显示为未完成状态",
      conclusion: "已确认业务 Bug：答题后进度未持久化",
      source: "code",
      confidence: "high",
    },
    {
      feature: "奖励兑换积分校验",
      doc: "兑换奖励需要消耗对应积分",
      code: "/api/exchange 未校验用户积分是否足够，且未扣减积分",
      runtime: "0 积分账号可成功兑换任意奖励，且积分余额不变",
      conclusion: "已确认业务 Bug：兑换不校验积分、不扣减积分",
      source: "runtime",
      confidence: "high",
    },
  ],
};

// 演示项目接入时的预填字段
export const demoProjectSeed = {
  name: "闯关学习 + 签到积分（演示项目）",
  description:
    "一个闯关学习 + 签到积分的 Web 应用，包含用户注册登录、关卡答题、每日签到、积分与奖励兑换。预埋 6 个业务 Bug 用于测试验证。",
  type: "Web 应用 · 闯关学习平台",
  codeUploaded: true,
  docUploaded: true,
  testUrl: "http://localhost:4010",
  startCommand: "cd demo-project && npm install && npm run dev",
  testAccount: "learner / 123456（学习者）",
  adminAccount: "无独立管理员账号（演示项目）",
  isDemo: true,
};
