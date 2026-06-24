// 基础测试用例生成（模块 C1）
// 为演示项目（闯关学习 + 签到积分）生成基础测试用例，覆盖 6 大类约 15-20 个用例
// 用例字段对应 store.ts 中的 TestCase 数据对象
// 注意：本模块为同构模块（客户端/服务端均可使用），不能 import "server-only"

import {
  getTestCases,
  saveTestCases,
  type TestCase,
  type BasicTestCategory,
} from "./store";

// 6 大类分类的中文标签
export const categoryLabels: Record<BasicTestCategory, string> = {
  env: "环境与启动",
  page: "页面与导航",
  happy: "核心正常路径",
  form: "表单与输入",
  persistence: "数据持久化",
  permission: "基础权限",
};

// 6 大类分类的简短描述
export const categoryDescriptions: Record<BasicTestCategory, string> = {
  env: "验证测试环境可用、服务可访问、API 可连通",
  page: "验证核心页面可正常加载，无白屏 / 404 / 500",
  happy: "验证主业务路径可走通：注册、登录、退出",
  form: "验证表单输入校验：空值、错误输入拦截",
  persistence: "验证关键状态在刷新后可保持",
  permission: "验证未登录访问受保护资源被正确拦截",
};

// 用例 ID 前缀
const CASE_PREFIX = "BTC";

// 构造单个用例的辅助函数
function makeCase(
  index: number,
  projectId: string,
  category: BasicTestCategory,
  data: {
    title: string;
    objective: string;
    preconditions: string[];
    steps: string[];
    expectedResult: string;
    priority: TestCase["priority"];
    blockingLevel: TestCase["blockingLevel"];
    source: TestCase["source"];
  },
): TestCase {
  const idNum = String(index).padStart(3, "0");
  return {
    id: `${CASE_PREFIX}-${idNum}`,
    projectId,
    type: "basic",
    title: data.title,
    objective: data.objective,
    preconditions: data.preconditions,
    steps: data.steps,
    expectedResult: data.expectedResult,
    priority: data.priority,
    blockingLevel: data.blockingLevel,
    category,
    source: data.source,
    status: "pending",
  };
}

// 为演示项目生成基础测试用例
// 演示项目位于 demo-project，是"闯关学习+签到积分"应用，预埋 6 个 Bug
// 其中 Bug 5（关卡进度刷新丢失）会在 persistence 类用例中被发现
export function generateBasicTestCases(projectId: string): TestCase[] {
  const cases: TestCase[] = [];
  let idx = 1;

  // ============================================================
  // 1. 环境与启动（env）
  // ============================================================
  cases.push(
    makeCase(idx++, projectId, "env", {
      title: "演示项目页面可正常访问",
      objective: "验证演示项目首页可被浏览器访问，HTTP 状态码 200",
      preconditions: ["演示项目已通过 npm run dev 启动", "测试地址可访问"],
      steps: [
        "打开浏览器访问 http://localhost:4010",
        "等待页面完全加载",
        "检查浏览器地址栏与页面渲染状态",
      ],
      expectedResult: "页面返回 200，正常渲染闯关学习首页，无白屏",
      priority: "P0",
      blockingLevel: "blocking",
      source: "runtime",
    }),
  );

  cases.push(
    makeCase(idx++, projectId, "env", {
      title: "API 服务连通性验证",
      objective: "验证后端 API 基础连通，可正常响应请求",
      preconditions: ["演示项目已启动"],
      steps: [
        "向 /api/level 发起 GET 请求",
        "向 /api/auth/login 发起 OPTIONS 请求",
        "观察响应状态码与响应体",
      ],
      expectedResult: "API 返回 200 或 401（未授权），无 500 / 网络错误",
      priority: "P0",
      blockingLevel: "blocking",
      source: "runtime",
    }),
  );

  // ============================================================
  // 2. 页面与导航（page）
  // ============================================================
  cases.push(
    makeCase(idx++, projectId, "page", {
      title: "首页可正常加载并渲染关卡列表入口",
      objective: "验证首页加载完整，渲染出注册 / 登录入口或关卡列表",
      preconditions: ["演示项目已启动"],
      steps: [
        "访问 /",
        "等待页面加载完成",
        "检查页面是否渲染出标题、入口按钮",
      ],
      expectedResult: "首页正常渲染，包含「闯关学习 + 签到积分」标题与操作入口",
      priority: "P0",
      blockingLevel: "blocking",
      source: "runtime",
    }),
  );

  cases.push(
    makeCase(idx++, projectId, "page", {
      title: "登录页可正常加载",
      objective: "验证登录页可访问，包含用户名 / 密码输入框与登录按钮",
      preconditions: ["演示项目已启动"],
      steps: ["访问 /login", "检查表单元素是否完整"],
      expectedResult: "登录页渲染用户名、密码输入框与登录按钮",
      priority: "P0",
      blockingLevel: "blocking",
      source: "runtime",
    }),
  );

  cases.push(
    makeCase(idx++, projectId, "page", {
      title: "注册页可正常加载",
      objective: "验证注册页可访问，包含用户名 / 密码输入框与注册按钮",
      preconditions: ["演示项目已启动"],
      steps: ["访问 /register", "检查表单元素是否完整"],
      expectedResult: "注册页渲染用户名、密码输入框与注册按钮",
      priority: "P0",
      blockingLevel: "blocking",
      source: "runtime",
    }),
  );

  cases.push(
    makeCase(idx++, projectId, "page", {
      title: "关卡详情页可正常加载",
      objective: "验证已登录用户可访问关卡详情页，渲染题目与答题入口",
      preconditions: ["用户已登录", "存在至少一个已解锁关卡"],
      steps: [
        "登录后访问 /level/{已解锁关卡ID}",
        "等待页面加载完成",
        "检查是否渲染出题目与答题表单",
      ],
      expectedResult: "关卡详情页正常渲染，显示题目、答案输入框与提交按钮",
      priority: "P1",
      blockingLevel: "blocking",
      source: "runtime",
    }),
  );

  cases.push(
    makeCase(idx++, projectId, "page", {
      title: "全站无白屏 / 404 / 500 错误",
      objective: "验证核心页面均无白屏、404、500 等异常状态",
      preconditions: ["演示项目已启动"],
      steps: [
        "依次访问 /、/login、/register、/signin、/rewards",
        "检查每个页面的状态码与渲染结果",
      ],
      expectedResult: "所有页面均正常渲染，无 404 / 500 / 白屏",
      priority: "P0",
      blockingLevel: "blocking",
      source: "runtime",
    }),
  );

  // ============================================================
  // 3. 核心正常路径（happy）
  // ============================================================
  cases.push(
    makeCase(idx++, projectId, "happy", {
      title: "用户注册主路径可走通",
      objective: "验证新用户可通过注册页面完成注册并自动登录",
      preconditions: ["演示项目已启动", "用户名未被占用"],
      steps: [
        "访问 /register",
        "输入用户名 learner_test 与密码 123456",
        "点击注册按钮",
        "观察跳转与登录态",
      ],
      expectedResult: "注册成功后自动登录并跳转到首页，可看到关卡列表",
      priority: "P0",
      blockingLevel: "non_blocking",
      source: "runtime",
    }),
  );

  cases.push(
    makeCase(idx++, projectId, "happy", {
      title: "用户登录主路径可走通",
      objective: "验证已注册用户可通过登录页面完成登录",
      preconditions: ["演示项目已启动", "用户 learner_test 已注册"],
      steps: [
        "访问 /login",
        "输入用户名 learner_test 与密码 123456",
        "点击登录按钮",
        "观察跳转与登录态",
      ],
      expectedResult: "登录成功后跳转到首页，可看到关卡列表与签到入口",
      priority: "P0",
      blockingLevel: "non_blocking",
      source: "runtime",
    }),
  );

  cases.push(
    makeCase(idx++, projectId, "happy", {
      title: "用户退出登录可走通",
      objective: "验证已登录用户可成功退出，退出后回到游客态",
      preconditions: ["用户已登录"],
      steps: [
        "在已登录状态下点击退出按钮",
        "观察页面跳转与登录态变化",
        "再次访问 /level/{id} 验证是否被拦截",
      ],
      expectedResult: "退出后回到游客态，访问受保护页面被拦截",
      priority: "P1",
      blockingLevel: "non_blocking",
      source: "runtime",
    }),
  );

  // ============================================================
  // 4. 表单与输入（form）
  // ============================================================
  cases.push(
    makeCase(idx++, projectId, "form", {
      title: "注册时空用户名被拦截",
      objective: "验证注册表单对空用户名的拦截",
      preconditions: ["演示项目已启动"],
      steps: [
        "访问 /register",
        "用户名留空，密码输入 123456",
        "点击注册按钮",
        "观察响应与提示",
      ],
      expectedResult: "注册失败，提示用户名不能为空",
      priority: "P1",
      blockingLevel: "non_blocking",
      source: "runtime",
    }),
  );

  cases.push(
    makeCase(idx++, projectId, "form", {
      title: "注册时空密码被拦截",
      objective: "验证注册表单对空密码的拦截",
      preconditions: ["演示项目已启动"],
      steps: [
        "访问 /register",
        "用户名输入 form_test_user，密码留空",
        "点击注册按钮",
        "观察响应与提示",
      ],
      expectedResult: "注册失败，提示密码不能为空",
      priority: "P1",
      blockingLevel: "non_blocking",
      source: "runtime",
    }),
  );

  cases.push(
    makeCase(idx++, projectId, "form", {
      title: "登录错误密码被拦截",
      objective: "验证登录表单对错误密码的拦截",
      preconditions: ["演示项目已启动", "用户 learner_test 已注册"],
      steps: [
        "访问 /login",
        "输入用户名 learner_test 与错误密码 wrong_pwd",
        "点击登录按钮",
        "观察响应与提示",
      ],
      expectedResult: "登录失败，提示用户名或密码错误",
      priority: "P1",
      blockingLevel: "non_blocking",
      source: "runtime",
    }),
  );

  // ============================================================
  // 5. 数据持久化（persistence）
  // ============================================================
  cases.push(
    makeCase(idx++, projectId, "persistence", {
      title: "登录后刷新页面保持登录状态",
      objective: "验证登录态在浏览器刷新后仍然保持",
      preconditions: ["用户已登录"],
      steps: [
        "在已登录状态下记录当前 URL",
        "刷新浏览器（F5）",
        "观察页面是否仍处于登录态",
      ],
      expectedResult: "刷新后仍为登录态，可继续访问受保护页面",
      priority: "P0",
      blockingLevel: "non_blocking",
      source: "runtime",
    }),
  );

  // 关键用例：完成关卡后刷新查进度（会失败 - Bug 5）
  cases.push(
    makeCase(idx++, projectId, "persistence", {
      title: "完成关卡后刷新页面进度保持已完成",
      objective:
        "验证用户答对关卡后刷新页面，关卡仍显示为已完成状态（对应预埋 Bug 5）",
      preconditions: [
        "用户已登录",
        "存在一个已解锁但未完成的关卡",
      ],
      steps: [
        "进入 /level/{已解锁关卡ID}",
        "输入正确答案并提交",
        "确认返回「回答正确」",
        "刷新浏览器（F5）",
        "回到首页或关卡详情页查看进度",
      ],
      expectedResult:
        "刷新后关卡仍显示为已完成状态，下一关已解锁，已完成关卡不可重复答题",
      priority: "P0",
      blockingLevel: "non_blocking",
      source: "runtime",
    }),
  );

  // ============================================================
  // 6. 基础权限（permission）
  // ============================================================
  cases.push(
    makeCase(idx++, projectId, "permission", {
      title: "未登录访问关卡详情页被拦截",
      objective: "验证未登录用户访问受保护页面被正确拦截（401 或重定向到登录）",
      preconditions: ["用户未登录"],
      steps: [
        "退出登录或使用无痕窗口",
        "直接访问 /level/{任意关卡ID}",
        "观察响应与跳转",
      ],
      expectedResult: "返回 401 或重定向到登录页，不渲染关卡内容",
      priority: "P0",
      blockingLevel: "non_blocking",
      source: "runtime",
    }),
  );

  cases.push(
    makeCase(idx++, projectId, "permission", {
      title: "未登录调用签到 API 被拦截",
      objective: "验证未登录用户调用受保护 API 被拦截",
      preconditions: ["用户未登录"],
      steps: [
        "退出登录或使用无痕窗口",
        "向 /api/sign 发起 POST 请求",
        "观察响应状态码与响应体",
      ],
      expectedResult: "返回 401 未授权，不执行签到也不发放积分",
      priority: "P0",
      blockingLevel: "non_blocking",
      source: "runtime",
    }),
  );

  return cases;
}

// 获取分类的执行顺序（用于按 6 大类分组展示）
export const categoryOrder: BasicTestCategory[] = [
  "env",
  "page",
  "happy",
  "form",
  "persistence",
  "permission",
];

// 获取或生成基础测试用例（同构函数，客户端/服务端均可调用）
// 若已有用例则直接返回，否则生成并保存
export function getOrGenerateBasicCases(projectId: string): TestCase[] {
  let cases = getTestCases(projectId);
  if (cases.length === 0) {
    cases = generateBasicTestCases(projectId);
    saveTestCases(cases);
  }
  return cases;
}
