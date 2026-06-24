// AI 项目分析 prompt 模板
// 定义 LLM 角色、任务、输出格式，并注入代码摘要与文档供分析使用

import type { ParsedProjectInfo } from "../project-parser";

// ============================================================
// 输出格式定义：严格对应 AnalysisModel 接口
// ============================================================

export const ANALYSIS_OUTPUT_FORMAT = `{
  "overview": {
    "projectType": "项目类型，如：Web 应用 · 闯关学习平台",
    "targetUser": "面向用户，如：学习者（注册用户）",
    "coreFunctions": ["核心功能1", "核心功能2"],
    "businessObjects": ["业务对象1", "业务对象2"],
    "techStack": ["Next.js", "React", "Prisma"],
    "database": "数据库类型，如：SQLite",
    "apis": ["/api/sign", "POST /api/level/[id]/answer"],
    "authMethod": "登录方式，如：用户名 + 密码（JWT）",
    "permissionSystem": "权限体系，如：游客 / 已登录用户 两层权限"
  },
  "featureMap": [
    {
      "name": "模块名，如：用户系统",
      "children": [
        { "name": "功能点名，如：注册", "risk": "low|medium|high|critical" }
      ]
    }
  ],
  "roleMap": [
    {
      "role": "角色名，如：已登录用户",
      "pages": ["可访问页面1", "可访问页面2"],
      "dataScope": "数据归属范围描述"
    }
  ],
  "stateMap": [
    {
      "subject": "状态主体，如：签到状态",
      "states": ["未签到", "今日已签到"],
      "flows": [
        { "from": "未签到", "to": "今日已签到", "event": "调用 /api/sign" }
      ],
      "illegalFlows": [
        { "from": "今日已签到", "to": "未签到", "note": "同一天内重复签到（应被拦截）" }
      ]
    }
  ],
  "dataMap": {
    "objects": [
      { "name": "User", "description": "用户：含用户名、密码、积分" }
    ],
    "relations": [
      { "from": "User", "to": "SignRecord", "type": "1:N" }
    ]
  },
  "riskMap": [
    {
      "area": "风险区域，如：每日签到",
      "level": "low|medium|high|critical",
      "reason": "风险原因",
      "priority": "测试优先级，如：P0 · 必测"
    }
  ],
  "crossCheck": [
    {
      "feature": "功能点，如：每日签到",
      "doc": "文档侧描述（无文档则为空字符串）",
      "code": "代码侧描述",
      "runtime": "运行侧描述（未运行则为空字符串）",
      "conclusion": "结论，如：已确认业务 Bug：签到无频率限制",
      "source": "doc|code|runtime|ai|unknown",
      "confidence": "high|medium|low"
    }
  ],
  "consistencyRisks": [
    "一致性风险描述，如：积分余额应等于签到积分 + 答题积分 - 兑换积分"
  ]
}`;

// ============================================================
// System Prompt：定义 AI 角色与输出要求
// ============================================================

export const ANALYSIS_SYSTEM_PROMPT = `你是一位资深测试架构师，擅长分析 Web 项目代码并识别业务风险。

你的任务是：分析给定的项目代码摘要与文档，输出 7 类结构化分析结果（B1-B7），为后续测试计划提供依据。

【输出要求】
1. 严格输出合法 JSON，不要包含任何解释性文字，不要使用 markdown 代码块包裹。
2. JSON 顶层必须包含以下 7 个字段：overview、featureMap、roleMap、stateMap、dataMap、riskMap、crossCheck，以及可选的 consistencyRisks。
3. 每个结论必须标记来源（doc/code/runtime/ai/unknown）和置信度（high/medium/low）。
   - doc：文档明确说明
   - code：代码确认（直接从代码中读到）
   - runtime：运行确认（需要实际运行验证）
   - ai：AI 推断（基于经验推断，未在代码或文档中直接确认）
   - unknown：未知
4. 重点关注以下高风险区域的业务规则漏洞：
   - 积分系统：积分发放、扣减、余额一致性
   - 签到功能：频率限制、重复签到、状态持久化
   - 奖励兑换：积分校验、库存校验、扣减原子性
   - 权限控制：登录校验、越权访问、角色隔离
   - 订单/关卡：状态流转、解锁校验、进度持久化
5. 对于代码中明确存在的缺陷（如缺少校验、未持久化、未检查频率），source 标记为 "code"，confidence 标记为 "high"。
6. 对于需要运行验证的怀疑（如并发问题、边界条件），source 标记为 "runtime"，confidence 标记为 "medium"。
7. 对于基于经验的推断，source 标记为 "ai"，confidence 标记为 "low" 或 "medium"。

【输出 JSON 格式】
${ANALYSIS_OUTPUT_FORMAT}`;

// ============================================================
// User Prompt 构建器：注入代码摘要、文档与解析信息
// ============================================================

export function buildAnalysisUserPrompt(
  codeSummary: string,
  docs: string,
  parsedInfo: ParsedProjectInfo | null | undefined,
): string {
  const sections: string[] = [];

  // 项目解析信息
  if (parsedInfo) {
    sections.push("【项目解析信息】");
    sections.push(`主框架：${parsedInfo.framework || "未识别"}`);
    sections.push(`技术栈：${parsedInfo.techStack.join(", ") || "未识别"}`);
    sections.push(
      `页面路由（${parsedInfo.pageRoutes.length} 个）：${parsedInfo.pageRoutes.join(", ") || "无"}`,
    );
    sections.push(
      `API 路由（${parsedInfo.apiRoutes.length} 个）：${parsedInfo.apiRoutes.join(", ") || "无"}`,
    );
    sections.push(
      `数据模型（${parsedInfo.dataModels.length} 个）：${parsedInfo.dataModels.join(", ") || "无"}`,
    );
    if (parsedInfo.readmeSummary) {
      sections.push(`README 摘要：${parsedInfo.readmeSummary}`);
    }
    sections.push("");
  }

  // 用户上传的文档
  if (docs && docs.trim()) {
    sections.push("【项目文档】");
    sections.push(docs.trim());
    sections.push("");
  }

  // 代码摘要
  if (codeSummary && codeSummary.trim()) {
    sections.push("【代码摘要】");
    sections.push(codeSummary.trim());
    sections.push("");
  }

  // 分析任务指令
  sections.push("【分析任务】");
  sections.push(
    "请基于以上项目信息，输出 B1-B7 七类分析结果的 JSON：",
  );
  sections.push("1. B1 项目概况（overview）：识别项目类型、面向用户、核心功能、业务对象、技术栈、数据库、API 列表、登录方式、权限体系。");
  sections.push("2. B2 功能地图（featureMap）：按模块拆解功能点，每个叶子节点标记风险等级。重点关注积分、签到、奖励、兑换、关卡等高风险模块。");
  sections.push("3. B3 角色权限地图（roleMap）：识别系统中的角色、可访问页面与数据归属范围。");
  sections.push("4. B4 状态机地图（stateMap）：识别核心业务对象的状态流转，标记非法流转用于异常测试。");
  sections.push("5. B5 数据地图（dataMap）：识别核心数据实体与关系，标记一致性风险（consistencyRisks）。");
  sections.push("6. B6 风险地图（riskMap）：按风险等级排序的高危区域，标记原因与测试优先级。");
  sections.push("7. B7 三方对照（crossCheck）：对每个关键功能点，对照文档 / 代码 / 运行三方，标记来源与置信度。");
  sections.push("");
  sections.push("请严格按以下 JSON 格式输出（不要 markdown 代码块包裹）：");
  sections.push(ANALYSIS_OUTPUT_FORMAT);

  return sections.join("\n");
}
