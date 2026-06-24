// 分析服务：基于 LLM 的真实 AI 项目分析
// - 检查 LLM 配置，未配置时演示项目降级到预定义分析，其他项目报错
// - 调用 LLM 分析项目代码摘要与文档，输出 B1-B7 七类分析结果
// - LLM 调用失败时，演示项目降级到预定义分析，其他项目抛出错误
// 注意：本模块在服务端运行（API 路由调用），不能在客户端直接调用

import "server-only";

import {
  getProject,
  updateProject,
  type AnalysisModel,
  type FeatureNode,
  type RiskLevel,
  type SourceType,
  type Confidence,
  type ProjectOverview,
  type RolePermission,
  type StateTransition,
  type DataObject,
  type DataRelation,
  type RiskItem,
  type CrossCheckItem,
} from "./store";
import { demoAnalysisModel } from "./demo-analysis";
import { isLLMConfigured, getLLMConfig } from "./llm-config";
import {
  chatCompletionJSON,
  ANALYSIS_TIMEOUT,
  type LLMMessage,
} from "./llm-client";
import { parseLocalProject, type ParsedProjectInfo } from "./project-parser";
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
} from "./prompts/analysis-prompt";
import { recordAIThinkingLog, startAIThinkingSession } from "./ai-thinking-log";

// 延时工具
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// LLM 返回结果类型（与 AnalysisModel 接口对应，但字段可能缺失或类型不符）
// ============================================================

interface LLMAnalysisResult {
  overview?: Partial<ProjectOverview> & {
    // 兼容 LLM 可能返回的字符串形式
    coreFunctions?: string[] | string;
    businessObjects?: string[] | string;
    techStack?: string[] | string;
    apis?: string[] | string;
  };
  featureMap?: unknown;
  roleMap?: unknown;
  stateMap?: unknown;
  stateMachines?: unknown; // 兼容 LLM 可能使用的别名
  dataMap?: unknown;
  riskMap?: unknown;
  crossCheck?: unknown;
  consistencyRisks?: unknown;
}

// ============================================================
// 类型转换与补全工具
// ============================================================

// 安全转换为字符串数组
function toStringArray(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v : String(v ?? "")))
      .filter((s) => s.length > 0);
  }
  if (typeof value === "string" && value.trim()) {
    // 字符串按逗号或顿号分割
    return value
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return fallback;
}

// 安全转换为字符串
function toString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

// 安全转换为风险等级
function toRiskLevel(value: unknown): RiskLevel {
  const v = toString(value).toLowerCase();
  if (v === "low" || v === "medium" || v === "high" || v === "critical") {
    return v;
  }
  return "medium";
}

// 安全转换为来源类型
function toSourceType(value: unknown): SourceType {
  const v = toString(value).toLowerCase();
  if (
    v === "doc" ||
    v === "code" ||
    v === "runtime" ||
    v === "ai" ||
    v === "unknown"
  ) {
    return v;
  }
  return "ai";
}

// 安全转换为置信度
function toConfidence(value: unknown): Confidence {
  const v = toString(value).toLowerCase();
  if (v === "high" || v === "medium" || v === "low") {
    return v;
  }
  return "medium";
}

// 转换功能节点（递归）
function toFeatureNode(value: unknown): FeatureNode {
  const obj = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const node: FeatureNode = {
    name: toString(obj.name, "未命名功能"),
  };
  // 兼容 riskLevel / risk 两种字段名
  const riskVal = obj.risk ?? obj.riskLevel;
  if (riskVal != null) {
    node.risk = toRiskLevel(riskVal);
  }
  // 递归处理子节点
  if (Array.isArray(obj.children) && obj.children.length > 0) {
    node.children = obj.children.map((c) => toFeatureNode(c));
  }
  return node;
}

// 转换角色权限
function toRolePermission(value: unknown): RolePermission {
  const obj = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    role: toString(obj.role, "未识别角色"),
    pages: toStringArray(
      obj.pages ?? obj.accessiblePages,
      ["待识别"],
    ),
    dataScope: toString(obj.dataScope ?? obj.dataOwnership, "待识别"),
  };
}

// 转换状态机
function toStateTransition(value: unknown): StateTransition {
  const obj = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const flows = Array.isArray(obj.flows)
    ? obj.flows.map((f) => {
        const fo = (f && typeof f === "object" ? f : {}) as Record<
          string,
          unknown
        >;
        return {
          from: toString(fo.from, "?"),
          to: toString(fo.to, "?"),
          event: toString(fo.event, ""),
        };
      })
    : [];
  const illegalFlows = Array.isArray(obj.illegalFlows)
    ? obj.illegalFlows.map((f) => {
        const fo = (f && typeof f === "object" ? f : {}) as Record<
          string,
          unknown
        >;
        return {
          from: toString(fo.from, "?"),
          to: toString(fo.to, "?"),
          note: toString(fo.note, ""),
        };
      })
    : [];
  return {
    subject: toString(obj.subject, "未识别状态机"),
    states: toStringArray(obj.states, []),
    flows,
    illegalFlows,
  };
}

// 转换数据对象
function toDataObject(value: unknown): DataObject {
  const obj = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    name: toString(obj.name, "未命名"),
    description: toString(obj.description, ""),
  };
}

// 转换数据关系
function toDataRelation(value: unknown): DataRelation {
  const obj = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    from: toString(obj.from, "?"),
    to: toString(obj.to, "?"),
    type: toString(obj.type, "1:N"),
  };
}

// 转换风险条目
function toRiskItem(value: unknown): RiskItem {
  const obj = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    area: toString(obj.area, "未识别风险"),
    level: toRiskLevel(obj.level ?? obj.riskLevel),
    reason: toString(obj.reason, ""),
    priority: toString(obj.priority, "P1 · 重要"),
  };
}

// 转换三方对照条目
function toCrossCheckItem(value: unknown): CrossCheckItem {
  const obj = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    feature: toString(obj.feature, "未识别功能"),
    doc: toString(obj.doc, ""),
    code: toString(obj.code, ""),
    runtime: toString(obj.runtime, ""),
    conclusion: toString(obj.conclusion, ""),
    source: toSourceType(obj.source),
    confidence: toConfidence(obj.confidence),
  };
}

// ============================================================
// transformLLMResult：将 LLM 返回的 JSON 转换为 AnalysisModel
// - 合并 parsedInfo 中的确定性信息（技术栈、路由等，source="code"）
// - 如果 LLM 返回不完整，用 parsedInfo 信息补全
// ============================================================

export function transformLLMResult(
  result: LLMAnalysisResult,
  parsedInfo: ParsedProjectInfo | null | undefined,
): AnalysisModel {
  // ---- B1 项目概况 ----
  const llmOverview = result.overview ?? {};
  const overview: ProjectOverview = {
    projectType: toString(llmOverview.projectType, "Web 应用"),
    targetUser: toString(llmOverview.targetUser, "待识别"),
    coreFunctions: toStringArray(
      llmOverview.coreFunctions,
      parsedInfo ? ["待补充"] : ["待识别"],
    ),
    businessObjects: toStringArray(
      llmOverview.businessObjects,
      parsedInfo?.dataModels ?? [],
    ),
    techStack: toStringArray(
      llmOverview.techStack,
      parsedInfo?.techStack ?? [],
    ),
    database: toString(llmOverview.database, "待识别"),
    apis: toStringArray(llmOverview.apis, parsedInfo?.apiRoutes ?? []),
    authMethod: toString(llmOverview.authMethod, "待识别"),
    permissionSystem: toString(llmOverview.permissionSystem, "待识别"),
  };

  // ---- B2 功能地图 ----
  const featureMap: FeatureNode[] = Array.isArray(result.featureMap)
    ? result.featureMap.map((n) => toFeatureNode(n))
    : [];
  const finalFeatureMap: FeatureNode[] =
    featureMap.length > 0
      ? featureMap
      : [
          {
            name: "待识别功能模块",
            children: [{ name: "待识别功能点", risk: "medium" }],
          },
        ];

  // ---- B3 角色权限地图 ----
  const roleMap: RolePermission[] = Array.isArray(result.roleMap)
    ? result.roleMap.map((r) => toRolePermission(r))
    : [];
  const finalRoleMap: RolePermission[] =
    roleMap.length > 0
      ? roleMap
      : [
          {
            role: "待识别",
            pages: ["待识别"],
            dataScope: "待识别",
          },
        ];

  // ---- B4 状态机地图 ----
  // 兼容 LLM 可能使用 stateMachines 字段名
  const stateMapSrc = result.stateMap ?? result.stateMachines;
  const stateMap: StateTransition[] = Array.isArray(stateMapSrc)
    ? stateMapSrc.map((s) => toStateTransition(s))
    : [];

  // ---- B5 数据地图 ----
  const llmDataMap = (result.dataMap && typeof result.dataMap === "object"
    ? result.dataMap
    : {}) as Record<string, unknown>;
  let objects: DataObject[] = Array.isArray(llmDataMap.objects)
    ? llmDataMap.objects.map((o) => toDataObject(o))
    : [];
  const relations: DataRelation[] = Array.isArray(llmDataMap.relations)
    ? llmDataMap.relations.map((r) => toDataRelation(r))
    : [];

  // 如果 LLM 未返回数据对象，但 parsedInfo 有数据模型，则用 parsedInfo 补全
  if (objects.length === 0 && parsedInfo?.dataModels?.length) {
    objects = parsedInfo.dataModels.map((dm) => ({ name: dm, description: "" }));
  }

  // ---- 一致性风险 ----
  let consistencyRisks: string[] = [];
  if (Array.isArray(result.consistencyRisks)) {
    consistencyRisks = result.consistencyRisks
      .map((r) => toString(r))
      .filter((s) => s.length > 0);
  } else if (Array.isArray(llmDataMap.consistencyRisks)) {
    consistencyRisks = llmDataMap.consistencyRisks
      .map((r) => toString(r))
      .filter((s) => s.length > 0);
  }

  // ---- B6 风险地图 ----
  const riskMap: RiskItem[] = Array.isArray(result.riskMap)
    ? result.riskMap.map((r) => toRiskItem(r))
    : [];

  // ---- B7 三方对照 ----
  const crossCheck: CrossCheckItem[] = Array.isArray(result.crossCheck)
    ? result.crossCheck.map((c) => toCrossCheckItem(c))
    : [];

  return {
    overview,
    featureMap: finalFeatureMap,
    roleMap: finalRoleMap,
    stateMap,
    dataMap: { objects, relations },
    riskMap,
    crossCheck,
    consistencyRisks:
      consistencyRisks.length > 0 ? consistencyRisks : undefined,
  };
}

// ============================================================
// 统计已确认的业务 Bug 数量
// 来源为 runtime 或 code 的高置信度结论
// ============================================================

function countIssuesFound(model: AnalysisModel): number {
  return model.crossCheck.filter(
    (c) =>
      (c.source === "runtime" || c.source === "code") &&
      c.confidence === "high",
  ).length;
}

// ============================================================
// 主函数：运行 AI 分析
// - 检查 LLM 配置
// - 获取/补全解析结果
// - 构建 prompt 并调用 LLM
// - 转换结果并保存
// - 失败时演示项目降级到预定义分析
// ============================================================

export async function runAnalysis(
  projectId: string,
): Promise<AnalysisModel | undefined> {
  const project = getProject(projectId);
  if (!project) return undefined;

  // 标记为分析中
  updateProject(projectId, { status: "analyzing" });

  // 开启新的 AI 思考会话（清空旧日志，刷新页面时保留本次分析的思考过程）
  startAIThinkingSession(projectId, "analysis");

  // AI 思考日志：开始分析
  recordAIThinkingLog(
    projectId,
    "analysis",
    "thinking",
    `开始分析项目「${project.name}」，识别功能模块、角色权限、状态机、数据关系与风险点`,
  );

  // 0. 演示项目一票否决：无论 LLM 是否配置，全程剧本回放，不调用真实 LLM
  // 目的：保证"演示项目"等价于"完整剧本回放"，不出现"真真假假"的混合体验
  if (project.isDemo) {
    recordAIThinkingLog(
      projectId,
      "analysis",
      "thinking",
      "演示项目走预置剧本：跳过真实 LLM 调用，使用预定义分析结果以保证演示一致性",
    );
    recordAIThinkingLog(
      projectId,
      "analysis",
      "acting",
      "正在加载预置的功能地图 / 角色地图 / 状态机 / 数据地图 / 风险地图 / 三方对照…",
    );
    // 渐进式延迟，给前端步骤动画足够时间
    await delay(2500);
    recordAIThinkingLog(
      projectId,
      "analysis",
      "observing",
      `已加载预置分析模型，识别 ${demoAnalysisModel.featureMap.length} 个功能模块、${demoAnalysisModel.riskMap.length} 个风险点、${demoAnalysisModel.roleMap.length} 个角色`,
    );
    updateProject(projectId, {
      status: "analyzed",
      analysisModel: demoAnalysisModel,
      issuesFound: countIssuesFound(demoAnalysisModel),
    });
    recordAIThinkingLog(
      projectId,
      "analysis",
      "judging",
      "演示项目分析完成（剧本回放）",
    );
    return demoAnalysisModel;
  }

  // 1. 检查 LLM 是否已配置（非演示项目）
  if (!isLLMConfigured()) {
    recordAIThinkingLog(
      projectId,
      "analysis",
      "judging",
      "LLM 未配置，无法进行 AI 分析",
      { level: "warning" },
    );
    // 降级：演示项目使用预定义分析
    if (project.isDemo) {
      recordAIThinkingLog(
        projectId,
        "analysis",
        "acting",
        "演示项目降级使用预定义分析结果",
      );
      await delay(2000);
      updateProject(projectId, {
        status: "analyzed",
        analysisModel: demoAnalysisModel,
        issuesFound: countIssuesFound(demoAnalysisModel),
      });
      return demoAnalysisModel;
    }
    // 非演示项目：抛出错误
    throw new Error(
      "LLM 未配置，无法进行 AI 分析。请在设置页配置 LLM API。",
    );
  }

  // 2. 获取解析结果，若无则尝试解析本地项目
  let parsedInfo: ParsedProjectInfo | undefined = project.parsedInfo;
  if (!parsedInfo && project.localPath) {
    recordAIThinkingLog(
      projectId,
      "analysis",
      "acting",
      `正在解析本地项目代码结构（${project.localPath}）…`,
    );
    try {
      parsedInfo = await parseLocalProject(project.localPath);
      // 解析成功后回写，避免重复解析
      updateProject(projectId, { parsedInfo });
      recordAIThinkingLog(
        projectId,
        "analysis",
        "observing",
        `代码解析完成，识别到 ${parsedInfo.codeSummary?.length ?? 0} 字符的代码摘要`,
      );
    } catch {
      // 解析失败时忽略，继续使用空解析信息
      recordAIThinkingLog(
        projectId,
        "analysis",
        "judging",
        "本地项目代码解析失败，将继续使用文档信息进行分析",
        { level: "warning" },
      );
    }
  }

  // 3. 构建 prompt
  recordAIThinkingLog(
    projectId,
    "analysis",
    "thinking",
    "正在构建分析 prompt，注入代码摘要、项目文档与解析结果…",
  );
  const userPrompt = buildAnalysisUserPrompt(
    parsedInfo?.codeSummary || "",
    project.docs || "",
    parsedInfo,
  );

  // 4. 调用 LLM
  try {
    recordAIThinkingLog(
      projectId,
      "analysis",
      "acting",
      `正在调用 LLM 进行 7 类分析（功能地图/角色地图/状态机/数据地图/风险地图/交叉验证/概览），超时 ${ANALYSIS_TIMEOUT / 1000} 秒…`,
    );
    const messages: LLMMessage[] = [
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    const analysisResult = (await chatCompletionJSON(messages, {
      timeout: ANALYSIS_TIMEOUT,
      retries: 1,
      // 7 类分析 JSON 较长，4096 易截断导致解析失败，提升到 8192
      maxTokens: 8192,
    })) as LLMAnalysisResult;

    recordAIThinkingLog(
      projectId,
      "analysis",
      "observing",
      `LLM 返回分析结果，正在转换为 AnalysisModel 并保存`,
    );

    // 5. 转换为 AnalysisModel
    const analysisModel = transformLLMResult(analysisResult, parsedInfo);

    // 6. 保存
    updateProject(projectId, {
      status: "analyzed",
      analysisModel,
      issuesFound: countIssuesFound(analysisModel),
    });

    recordAIThinkingLog(
      projectId,
      "analysis",
      "judging",
      `项目分析完成 · 识别 ${analysisModel.featureMap?.length ?? 0} 个功能模块、${analysisModel.riskMap?.length ?? 0} 个风险点、${analysisModel.roleMap?.length ?? 0} 个角色`,
    );

    return analysisModel;
  } catch (error) {
    recordAIThinkingLog(
      projectId,
      "analysis",
      "judging",
      `LLM 分析失败：${error instanceof Error ? error.message : String(error)}`,
      { level: "error" },
    );
    // 降级：演示项目使用预定义分析
    if (project.isDemo) {
      recordAIThinkingLog(
        projectId,
        "analysis",
        "acting",
        "演示项目降级使用预定义分析结果",
      );
      updateProject(projectId, {
        status: "analyzed",
        analysisModel: demoAnalysisModel,
        issuesFound: countIssuesFound(demoAnalysisModel),
      });
      return demoAnalysisModel;
    }
    // 非演示项目：抛出原始错误
    throw error;
  }
}

// 同步获取分析模型（用于服务端读取，不触发分析流程）
export function getAnalysisModel(projectId: string): AnalysisModel | undefined {
  const project = getProject(projectId);
  return project?.analysisModel;
}

// 获取当前 LLM 模型名称（供前端显示分析步骤时使用）
export function getCurrentModelName(): string {
  const config = getLLMConfig();
  return config?.modelName || config?.modelId || "LLM";
}
