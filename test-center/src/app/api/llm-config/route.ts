import { NextResponse } from "next/server";
import {
  getLLMConfigAsync,
  getLLMConfigSafeAsync,
  setLLMConfigAsync,
  isLLMConfiguredAsync,
  clearLLMConfig,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  type LLMConfig,
  type LLMProvider,
} from "@/lib/llm-config";

// GET：获取配置（Key 脱敏，只显示前4位+****）
export async function GET() {
  const config = await getLLMConfigSafeAsync();
  const configured = await isLLMConfiguredAsync();
  return NextResponse.json({
    configured,
    config,
  });
}

// POST：保存配置（持久化到文件，Key 加密存储）
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 校验必填字段
    const provider = (body.provider as LLMProvider) ?? "custom";
    const modelId = (body.modelId as string)?.trim();
    const apiUrl = (body.apiUrl as string)?.trim();
    const apiKey = (body.apiKey as string)?.trim();
    const modelName = (body.modelName as string)?.trim();

    if (!modelId) {
      return NextResponse.json(
        { error: "模型 ID 不能为空" },
        { status: 400 },
      );
    }
    if (!apiUrl) {
      return NextResponse.json(
        { error: "API 地址不能为空" },
        { status: 400 },
      );
    }
    if (!apiKey) {
      return NextResponse.json(
        { error: "API Key 不能为空" },
        { status: 400 },
      );
    }

    // 处理"占位脱敏 Key"：若前端传回的是脱敏格式（以 **** 结尾），则保留原 Key
    let finalApiKey = apiKey;
    if (apiKey.endsWith("****")) {
      const rawExisting = await getLLMConfigAsync();
      if (rawExisting && rawExisting.apiKey) {
        finalApiKey = rawExisting.apiKey;
      } else {
        return NextResponse.json(
          { error: "未找到已保存的真实 API Key，请重新填写完整 Key" },
          { status: 400 },
        );
      }
    }

    const config: LLMConfig = {
      provider,
      modelId,
      apiUrl,
      apiKey: finalApiKey,
      modelName: modelName || modelId,
      temperature:
        typeof body.temperature === "number"
          ? clamp(body.temperature, 0, 2)
          : DEFAULT_TEMPERATURE,
      maxTokens:
        typeof body.maxTokens === "number" && body.maxTokens > 0
          ? Math.floor(body.maxTokens)
          : DEFAULT_MAX_TOKENS,
    };

    // 异步保存（写内存 + 写文件，Key 加密）
    await setLLMConfigAsync(config);

    return NextResponse.json({
      ok: true,
      message: "配置已加密保存到本地",
      config: {
        ...config,
        apiKey: `${config.apiKey.slice(0, 4)}****`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `保存配置失败：${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}

// DELETE：清除配置
export async function DELETE() {
  try {
    await clearLLMConfig();
    return NextResponse.json({ ok: true, message: "配置已清除" });
  } catch (err) {
    return NextResponse.json(
      {
        error: `清除配置失败：${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}

// 数值范围约束
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
