import { AppError } from "@fin-nest/backend";

import { chatProtocolAdapter } from "./llm-chat-protocol";
import { responsesProtocolAdapter } from "./llm-responses-protocol";
import type {
  LlmCallOptions,
  LlmMessage,
  LlmProtocol,
  LlmProtocolAdapter,
  LlmReply,
  LlmTool,
} from "./llm-types";

// 上游 LLM 客户端。用原生 fetch 而非 SDK：避免新增依赖，且自部署可指向
// DeepSeek/通义/Ollama 等任意 OpenAI-compatible 端点，或走 OpenAI Responses API。
// 请求/响应的协议差异由 llm-*-protocol.ts 适配，这里只负责取端点、发请求、读 SSE。

export type {
  LlmCallOptions,
  LlmMessage,
  LlmProtocol,
  LlmReply,
  LlmTool,
  LlmToolCall,
  LlmToolChoice,
  LlmUsage,
} from "./llm-types";

const ADAPTERS: Record<LlmProtocol, LlmProtocolAdapter> = {
  chat: chatProtocolAdapter,
  responses: responsesProtocolAdapter,
};

const REQUEST_TIMEOUT_MS = 90_000;
// 流式整体超时放宽：带思维链的模型（reasoning_content）首 token 前可能停顿较久。
const STREAM_TIMEOUT_MS = 300_000;

/**
 * 归一化 base url：容忍配置里把完整端点（.../v1/chat/completions、.../v1/responses）
 * 填进 AI_BASE_URL，否则会拼成 .../responses/responses 并以无指向性的 404 失败。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses)$/i, "");
}

/**
 * 选择上游协议：显式配置（AI_PROTOCOL）优先；未配置时按 base url 末段推断，
 * 因为 `.../v1/responses` 只可能是 Responses API，其余一律按 chat/completions 走。
 */
export function resolveLlmProtocol(baseUrl: string, configured?: string | null): LlmProtocol {
  if (configured === "chat" || configured === "responses") return configured;
  return /\/responses\/*$/i.test(baseUrl) ? "responses" : "chat";
}

/** DeepSeek V4 工具调用在非思考模式下更稳定，且可使用 required tool_choice。 */
export function shouldDisableThinking(baseUrl: string, model: string): boolean {
  let deepSeekHost = false;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    deepSeekHost = hostname === "deepseek.com" || hostname.endsWith(".deepseek.com");
  } catch {
    // baseUrl 已由配置层校验；这里保留容错，按模型名继续判断。
  }
  return deepSeekHost || /^deepseek-v4(?:-|$)/i.test(model);
}

export class LlmClient {
  private readonly adapter: LlmProtocolAdapter;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    protocol: LlmProtocol = "chat",
  ) {
    this.adapter = ADAPTERS[protocol];
  }

  get protocol(): LlmProtocol {
    return this.adapter.protocol;
  }

  private async request(
    messages: LlmMessage[],
    tools: LlmTool[],
    stream: boolean,
    options: LlmCallOptions = {},
  ): Promise<Response> {
    const { signal, toolChoice = "auto" } = options;
    const timeout = AbortSignal.timeout(stream ? STREAM_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${normalizeBaseUrl(this.baseUrl)}${this.adapter.endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(
          this.adapter.buildBody({
            model: this.model,
            messages,
            tools,
            toolChoice,
            stream,
            disableThinking: shouldDisableThinking(this.baseUrl, this.model),
          }),
        ),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (error) {
      throw new AppError("AI_UPSTREAM_UNREACHABLE", "AI 服务连接失败，请稍后重试", 502, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AppError("AI_UPSTREAM_ERROR", `AI 服务调用失败（HTTP ${response.status}）`, 502, {
        body: body.slice(0, 500),
      });
    }
    return response;
  }

  async chat(
    messages: LlmMessage[],
    tools: LlmTool[],
    options: LlmCallOptions = {},
  ): Promise<LlmReply> {
    const response = await this.request(messages, tools, false, options);
    return this.adapter.parseResponse(await response.json());
  }

  /**
   * 流式调用：正文增量经 onDelta 实时回调（思维链不透出），
   * tool_call 的参数分片由协议适配层累积，最终整体结果与非流式 chat() 同构返回。
   */
  async chatStream(
    messages: LlmMessage[],
    tools: LlmTool[],
    onDelta: (text: string) => void,
    options: LlmCallOptions = {},
  ): Promise<LlmReply> {
    const response = await this.request(messages, tools, true, options);
    if (!response.body) {
      throw new AppError("AI_UPSTREAM_ERROR", "AI 服务未返回流式响应", 502);
    }

    const accumulator = this.adapter.createStreamAccumulator(onDelta);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 以空行分隔事件；data 行可能跨网络分片，按行缓冲解析。
        // 只读 data 行：两种协议的事件类型都写在 JSON 负载里，`event:` 行可以忽略。
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).trimEnd();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            accumulator.apply(JSON.parse(payload));
          } catch {
            // 忽略无法解析的分片（keep-alive 注释等）
          }
        }
      }
    } catch (error) {
      throw new AppError("AI_UPSTREAM_ERROR", "AI 流式响应中断，请重试", 502, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    // finish 放在 try 外：上游以事件下发的错误要原样抛出，不被「流中断」话术盖掉。
    return accumulator.finish();
  }
}
