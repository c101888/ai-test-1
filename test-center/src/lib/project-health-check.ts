// 项目可达性预检工具
// - 执行前探测 testUrl 可达性
// - 本地项目端口不通时尝试自动启动
// - 无法真实执行时返回错误原因和解决方案（不降级到剧本回放）

import "server-only";
import { spawn } from "child_process";
import type { Project } from "./store";

// ============================================================
// 类型定义
// ============================================================

export interface ReachableResult {
  reachable: boolean;
  reason?: string;
  latencyMs?: number;
  statusCode?: number;
}

export interface StartResult {
  started: boolean;
  reason?: string;
}

export interface PrecheckResult {
  canExecuteReal: boolean;
  reason?: string;
  solution?: string;
  startedByUs?: boolean;
  latencyMs?: number;
}

// ============================================================
// 可达性探测
// ============================================================

// 探测 testUrl 是否可访问（HTTP 探测，超时 5 秒）
export async function checkProjectReachable(
  testUrl: string,
): Promise<ReachableResult> {
  if (!testUrl || !testUrl.trim()) {
    return { reachable: false, reason: "测试地址为空" };
  }

  let url: URL;
  try {
    url = new URL(testUrl);
  } catch {
    return { reachable: false, reason: `测试地址格式无效：${testUrl}` };
  }

  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "0.0.0.0";

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(testUrl, {
      signal: controller.signal,
      // 不跟随重定向，只探测可达性
      redirect: "manual",
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    // 任何 HTTP 响应（包括 4xx/5xx）都说明服务在运行
    return {
      reachable: true,
      latencyMs,
      statusCode: res.status,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    const reason = isLocal
      ? `本地项目未运行（${url.host} 无法连接）。请先启动项目，或系统将尝试自动启动。`
      : `远程项目无法访问（${url.host}）：${errMsg}`;
    return { reachable: false, reason, latencyMs };
  }
}

// ============================================================
// 本地项目自动启动
// ============================================================

// 尝试用 startCommand 在 localPath 启动本地项目
export async function tryStartLocalProject(
  project: Project,
): Promise<StartResult> {
  if (!project.startCommand || !project.startCommand.trim()) {
    return { started: false, reason: "项目未配置启动命令（startCommand）" };
  }
  if (!project.localPath || !project.localPath.trim()) {
    return { started: false, reason: "项目未配置本地路径（localPath）" };
  }

  const cmd = project.startCommand.trim();
  const cwd = project.localPath.trim();

  try {
    // 解析命令：支持 "npm run dev"、"node server.js" 等
    // Windows 下用 cmd /c，否则直接 spawn
    const isWindows = process.platform === "win32";
    const child = isWindows
      ? spawn("cmd", ["/c", cmd], {
          cwd,
          detached: true,
          stdio: "ignore",
          shell: false,
        })
      : spawn(cmd, {
          cwd,
          detached: true,
          stdio: "ignore",
          shell: true,
        });

    // 分离子进程，使其独立运行
    child.unref();

    // 等待最多 15 秒让项目启动
    await new Promise((resolve) => setTimeout(resolve, 15000));

    return { started: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { started: false, reason: `启动失败：${errMsg}` };
  }
}

// ============================================================
// 组合预检：探测 → 尝试启动 → 再探测
// ============================================================

export async function precheckProjectForExecution(
  project: Project,
): Promise<PrecheckResult> {
  if (!project.testUrl || !project.testUrl.trim()) {
    return {
      canExecuteReal: false,
      reason: "项目未配置测试地址（testUrl）",
      solution:
        "请在项目设置中填写被测项目的访问地址（如 http://localhost:2000），然后重新执行测试。",
    };
  }

  // 第一次探测
  const firstCheck = await checkProjectReachable(project.testUrl);
  if (firstCheck.reachable) {
    return {
      canExecuteReal: true,
      latencyMs: firstCheck.latencyMs,
    };
  }

  // 不可达，尝试自动启动本地项目
  const url = new URL(project.testUrl);
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "0.0.0.0";

  if (!isLocal) {
    // 远程项目不可达，无法自动启动
    return {
      canExecuteReal: false,
      reason: `远程项目无法访问（${url.host}）：${firstCheck.reason ?? "连接失败"}`,
      solution:
        "请检查远程项目是否已部署、网络是否可达、防火墙是否放行该端口，然后重新执行测试。",
    };
  }

  // 本地项目，尝试启动
  const startResult = await tryStartLocalProject(project);
  if (!startResult.started) {
    return {
      canExecuteReal: false,
      reason: `本地项目未运行（${url.host} 无法连接），且自动启动失败：${startResult.reason ?? "未知原因"}`,
      solution: `请手动启动被测项目后重新执行测试。操作步骤：\n1. 打开终端，进入项目目录\n2. 执行启动命令（如 npm run dev）\n3. 确认项目在 ${url.host} 上正常运行\n4. 回到此页面点击「重新执行」\n\n或在项目设置中配置「启动命令」和「本地路径」，系统将自动启动项目。`,
    };
  }

  // 启动后再次探测
  const secondCheck = await checkProjectReachable(project.testUrl);
  if (secondCheck.reachable) {
    return {
      canExecuteReal: true,
      startedByUs: true,
      latencyMs: secondCheck.latencyMs,
    };
  }

  // 启动后仍不可达
  return {
    canExecuteReal: false,
    startedByUs: true,
    reason: `本地项目自动启动后仍无法访问（${url.host}）：${secondCheck.reason ?? "连接失败"}`,
    solution: `项目可能需要更长的启动时间，或启动命令有误。请检查：\n1. 启动命令是否正确（如 npm run dev）\n2. 项目是否监听在 ${url.host} 上\n3. 手动启动项目后重新执行测试`,
  };
}
