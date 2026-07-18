import { AppError } from "@fin-nest/backend";

// OpenAI-compatible /chat/completions 客户端（非流式）。
// 用原生 fetch 而非 SDK：避免新增依赖，且自部署可指向 DeepSeek/通义/Ollama 等任意兼容端点。

export type LlmToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
};

export type LlmReply = {
  content: string | null;
  toolCalls: LlmToolCall[];
  usage?: LlmUsage;
};

type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: LlmToolCall[];
    };
  }>;
  usage?: RawUsage;
};

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: RawUsage;
};

function packUsage(usage: RawUsage | undefined): LlmUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
  };
}

const REQUEST_TIMEOUT_MS = 90_000;
// 流式整体超时放宽：带思维链的模型（reasoning_content）首 token 前可能停顿较久。
const STREAM_TIMEOUT_MS = 300_000;

export class LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  private async request(
    messages: LlmMessage[],
    tools: LlmTool[],
    stream: boolean,
    signal?: AbortSignal,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(stream ? STREAM_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          ...(tools.length > 0 ? { tools } : {}),
          temperature: 0.2,
          // include_usage：让上游在流式末块附带 token 用量（OpenAI-compatible），用于用量记账。
          ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
        }),
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

  async chat(messages: LlmMessage[], tools: LlmTool[]): Promise<LlmReply> {
    const response = await this.request(messages, tools, false);
    const data = (await response.json()) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new AppError("AI_UPSTREAM_ERROR", "AI 服务返回了空响应", 502);
    }
    return {
      content: message.content ?? null,
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      usage: packUsage(data.usage),
    };
  }

  /**
   * 流式调用：正文增量经 onDelta 实时回调（思维链 reasoning_content 不透出），
   * tool_call 的参数分片在此累积，最终整体结果与非流式 chat() 同构返回。
   */
  async chatStream(
    messages: LlmMessage[],
    tools: LlmTool[],
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<LlmReply> {
    const response = await this.request(messages, tools, true, signal);
    if (!response.body) {
      throw new AppError("AI_UPSTREAM_ERROR", "AI 服务未返回流式响应", 502);
    }

    let content = "";
    let usage: LlmUsage | undefined;
    const toolCalls = new Map<number, LlmToolCall>();
    const applyChunk = (chunk: ChatCompletionChunk) => {
      // 用量随末块下发（choices 通常为空），单独提取。
      if (chunk.usage) usage = packUsage(chunk.usage);
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) {
        content += delta.content;
        onDelta(delta.content);
      }
      for (const fragment of delta.tool_calls ?? []) {
        let call = toolCalls.get(fragment.index);
        if (!call) {
          call = {
            id: fragment.id ?? `call_${fragment.index}`,
            type: "function",
            function: { name: fragment.function?.name ?? "", arguments: "" },
          };
          toolCalls.set(fragment.index, call);
        }
        if (fragment.id) call.id = fragment.id;
        if (fragment.function?.name) call.function.name = fragment.function.name;
        if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
      }
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 以空行分隔事件；data 行可能跨网络分片，按行缓冲解析。
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).trimEnd();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            applyChunk(JSON.parse(payload) as ChatCompletionChunk);
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

    return {
      content: content || null,
      toolCalls: [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call),
      usage,
    };
  }
}
