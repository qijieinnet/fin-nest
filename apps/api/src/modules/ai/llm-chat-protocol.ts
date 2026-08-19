import { AppError } from "@fin-nest/backend";

import type {
  LlmProtocolAdapter,
  LlmRequest,
  LlmStreamAccumulator,
  LlmToolCall,
  LlmUsage,
} from "./llm-types";

// OpenAI `/chat/completions` 协议（DeepSeek / 通义 / Ollama 等兼容端点的默认形态）。

type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: LlmToolCall[];
    };
  }>;
  usage?: RawUsage;
};

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
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

export const chatProtocolAdapter: LlmProtocolAdapter = {
  protocol: "chat",
  endpoint: "/chat/completions",

  buildBody({ model, messages, tools, toolChoice, stream, disableThinking }: LlmRequest) {
    return {
      model,
      messages,
      ...(tools.length > 0 ? { tools, tool_choice: toolChoice } : {}),
      ...(disableThinking ? { thinking: { type: "disabled" } } : {}),
      temperature: 0.2,
      // include_usage：让上游在流式末块附带 token 用量（OpenAI-compatible），用于用量记账。
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
  },

  parseResponse(data: unknown) {
    const body = data as ChatCompletionResponse;
    const message = body.choices?.[0]?.message;
    if (!message) {
      throw new AppError("AI_UPSTREAM_ERROR", "AI 服务返回了空响应", 502);
    }
    return {
      content: message.content ?? null,
      reasoningContent: message.reasoning_content ?? null,
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      usage: packUsage(body.usage),
    };
  },

  createStreamAccumulator(onDelta: (text: string) => void): LlmStreamAccumulator {
    let content = "";
    let reasoningContent = "";
    let usage: LlmUsage | undefined;
    const toolCalls = new Map<number, LlmToolCall>();

    return {
      apply(payload: unknown) {
        const chunk = payload as ChatCompletionChunk;
        // 用量随末块下发（choices 通常为空），单独提取。
        if (chunk.usage) usage = packUsage(chunk.usage);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;
        if (delta.content) {
          content += delta.content;
          onDelta(delta.content);
        }
        if (delta.reasoning_content) reasoningContent += delta.reasoning_content;
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
          if (fragment.function?.name) {
            const name = fragment.function.name;
            if (!call.function.name) call.function.name = name;
            else if (call.function.name !== name && !call.function.name.endsWith(name)) {
              call.function.name += name;
            }
          }
          if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
        }
      },

      finish() {
        return {
          content: content || null,
          reasoningContent: reasoningContent || null,
          toolCalls: [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call),
          usage,
        };
      },
    };
  },
};
