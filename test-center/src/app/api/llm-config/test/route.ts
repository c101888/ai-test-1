import { NextResponse } from "next/server";
import { testLLMConnection } from "@/lib/llm-client";
import {
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  getLLMConfigAsync,
  type LLMConfig,
  type LLMProvider,
} from "@/lib/llm-config";

// POST：接收配置，调用 testLLMConnection，返回结果
// 支持两种入参：
// 1. 完整配置（含 apiKey）：直接测试
// 2. 脱敏配置（apiKey 以 **** 结尾）：从已存储配置读取真实 Key 后测试
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const provider = (body.provider as LLMProvider) ?? "custom";
    const modelId = (body.modelId as string)?.trim();
    const apiUrl = (body.apiUrl as string)?.trim();
    let apiKey = (body.apiKey as string)?.trim();
    const modelName = (body.modelName as string)?.trim();

    if (!modelId) {
      return NextResponse.json(
        { success: false, message: "模型 ID 不能为空" },
        { status: 400 },
      );
    }
    if (!apiUrl) {
      return NextResponse.json(
        { success: false, message: "API 地址不能为空" },
        { status: 400 },
      );
    }
    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: "API Key 不能为空" },
        { status: 400 },
      );
    }

    // 若传入的是脱敏 Key（以 **** 结尾），从已存储配置读取真实 Key
    if (apiKey.endsWith("****")) {
      const existing = await getLLMConfigAsync();
      if (existing?.apiKey) {
        apiKey = existing.apiKey;
      } else {
        return NextResponse.json(
          {
            success: false,
            message:
              "未找到已保存的真实 API Key，请重新填写完整 Key 后再测试",
          },
          { status: 400 },
        );
      }
    }

    const config: LLMConfig = {
      provider,
      modelId,
      apiUrl,
      apiKey,
      modelName: modelName || modelId,
      temperature:
        typeof body.temperature === "number"
          ? body.temperature
          : DEFAULT_TEMPERATURE,
      maxTokens:
        typeof body.maxTokens === "number" && body.maxTokens > 0
          ? Math.floor(body.maxTokens)
          : DEFAULT_MAX_TOKENS,
    };

    const result = await testLLMConnection(config);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: `测试连接失败：${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
