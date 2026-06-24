// Playwright chromium 安装检查
// 在启动浏览器前验证 chromium 是否已安装，未安装时返回友好错误

export interface PlaywrightCheckResult {
  ok: boolean;
  error?: string;
  fixHint?: string;
}

/**
 * 检查 Playwright chromium 是否已安装
 * 未安装时返回带修复指引的错误
 */
export async function checkPlaywrightInstalled(): Promise<PlaywrightCheckResult> {
  try {
    const { chromium } = await import("playwright");
    const executable = chromium.executablePath();

    if (!executable) {
      return {
        ok: false,
        error: "chromium 可执行文件路径为空，可能未安装",
        fixHint: "请运行: npx playwright install chromium",
      };
    }

    // 验证可执行文件是否存在
    const fs = await import("fs/promises");
    try {
      await fs.access(executable);
    } catch {
      return {
        ok: false,
        error: `chromium 可执行文件不存在: ${executable}`,
        fixHint: "请运行: npx playwright install chromium",
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Playwright 检查失败: ${err instanceof Error ? err.message : String(err)}`,
      fixHint: "请运行: npx playwright install chromium",
    };
  }
}
