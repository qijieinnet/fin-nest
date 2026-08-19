// LLM 客户端的协议无关类型。
//
// 对外形状按 OpenAI `/chat/completions` 建模（messages / tool_calls），
// 上游若是 Responses API（`/responses`），由协议适配层双向翻译，
// 调用方（ai.service）不感知差异。

export type LlmToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: LlmToolCall[];
      /** DeepSeek 思考模式的工具调用续轮要求原样带回，但不向用户展示。 */
      reasoning_content?: string | null;
    }
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
  reasoningContent: string | null;
  toolCalls: LlmToolCall[];
  usage?: LlmUsage;
};

export type LlmToolChoice = "auto" | "required";

export type LlmCallOptions = {
  signal?: AbortSignal;
  toolChoice?: LlmToolChoice;
};

/** 上游 API 协议：`chat` = `/chat/completions`，`responses` = `/responses`。 */
export type LlmProtocol = "chat" | "responses";

/** 一次上游调用的协议无关描述，由适配层翻译成各自的请求体。 */
export type LlmRequest = {
  model: string;
  messages: LlmMessage[];
  tools: LlmTool[];
  toolChoice: LlmToolChoice;
  stream: boolean;
  /** 仅 chat 协议使用：DeepSeek 工具调用关思考模式。 */
  disableThinking: boolean;
};

/** SSE 累积器：逐帧消费 `data:` 负载，最终产出与非流式同构的结果。 */
export type LlmStreamAccumulator = {
  apply(payload: unknown): void;
  /** 在 SSE 读取循环之外调用；上游以事件形式下发的错误在这里抛出。 */
  finish(): LlmReply;
};

export type LlmProtocolAdapter = {
  readonly protocol: LlmProtocol;
  /** 相对归一化 base url 的端点路径。 */
  readonly endpoint: string;
  buildBody(request: LlmRequest): Record<string, unknown>;
  parseResponse(data: unknown): LlmReply;
  createStreamAccumulator(onDelta: (text: string) => void): LlmStreamAccumulator;
};
