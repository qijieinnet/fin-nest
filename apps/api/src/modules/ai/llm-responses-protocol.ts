import { AppError } from "@fin-nest/backend";

import type {
  LlmMessage,
  LlmProtocolAdapter,
  LlmReply,
  LlmRequest,
  LlmStreamAccumulator,
  LlmToolCall,
  LlmUsage,
} from "./llm-types";

// OpenAI Responses API（`POST /responses`）。与 chat/completions 的差异全部收敛在本文件：
//   请求：system 提到顶层 instructions，其余消息打平成 input 数组
//         （message / function_call / function_call_output）；tools 由嵌套结构摊平。
//   响应：结果在 output 数组里按 item 类型分布，而非 choices[0].message。
//   流式：SSE 帧是带 type 的语义化事件，而非 choices[0].delta。

type ResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

type ResponsesContentPart = {
  type?: string;
  text?: string;
};

type ResponsesOutputItem = {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: ResponsesContentPart[];
  summary?: ResponsesContentPart[];
};

type ResponsesBody = {
  output?: ResponsesOutputItem[];
  usage?: ResponsesUsage;
  error?: { message?: string } | null;
};

type ResponsesStreamEvent = {
  type?: string;
  delta?: string;
  arguments?: string;
  output_index?: number;
  item?: ResponsesOutputItem;
  response?: ResponsesBody;
  error?: { message?: string };
  message?: string;
};

function packUsage(usage: ResponsesUsage | undefined): LlmUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
  };
}

function joinParts(parts: ResponsesContentPart[] | undefined, types: string[]): string {
  return (parts ?? [])
    .filter((part) => types.includes(part.type ?? ""))
    .map((part) => part.text ?? "")
    .join("");
}

/**
 * chat 形态的 messages → Responses 的 instructions + input。
 *
 * 工具调用的 id 用 `call_id` 往返：续轮的 function_call_output 必须用同一个 call_id 对上，
 * 因此解析响应时也一律取 call_id 作为 LlmToolCall.id。
 */
function buildInput(messages: LlmMessage[]): {
  instructions: string;
  input: Record<string, unknown>[];
} {
  const instructions: string[] = [];
  const input: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      // 正文与工具调用是两类独立 item，顺序上正文在前。
      const text = message.content?.trim();
      if (text) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }
      for (const call of message.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments || "{}",
        });
      }
      // reasoning_content 无法还原成 Responses 的 reasoning item（需要上游签发的加密内容），
      // 故不回传；思考模型的续轮推理由上游自行重建。
      continue;
    }
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content,
      });
      continue;
    }
    if (message.role === "system") {
      instructions.push(message.content);
      continue;
    }
    input.push({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: message.content }],
    });
  }
  return { instructions: instructions.join("\n\n"), input };
}

function parseOutput(output: ResponsesOutputItem[] | undefined): {
  content: string;
  reasoningContent: string;
  toolCalls: LlmToolCall[];
} {
  let content = "";
  let reasoningContent = "";
  const toolCalls: LlmToolCall[] = [];
  for (const [index, item] of (output ?? []).entries()) {
    switch (item.type) {
      case "message":
        content += joinParts(item.content, ["output_text", "text"]);
        break;
      case "reasoning":
        // 思维链摘要在 summary，少数网关放在 content，两处都收（同样不向用户透出）。
        reasoningContent += joinParts(item.summary, ["summary_text"]);
        reasoningContent += joinParts(item.content, ["reasoning_text"]);
        break;
      case "function_call":
        toolCalls.push({
          id: item.call_id ?? item.id ?? `call_${index}`,
          type: "function",
          function: { name: item.name ?? "", arguments: item.arguments ?? "" },
        });
        break;
      default:
        break;
    }
  }
  return { content, reasoningContent, toolCalls };
}

function upstreamError(message: string | undefined): AppError {
  return new AppError("AI_UPSTREAM_ERROR", `AI 服务返回错误：${message ?? "未知原因"}`, 502);
}

export const responsesProtocolAdapter: LlmProtocolAdapter = {
  protocol: "responses",
  endpoint: "/responses",

  buildBody({ model, messages, tools, toolChoice, stream }: LlmRequest) {
    const { instructions, input } = buildInput(messages);
    return {
      model,
      ...(instructions ? { instructions } : {}),
      input,
      ...(tools.length > 0
        ? {
            tools: tools.map((tool) => ({
              type: "function",
              name: tool.function.name,
              description: tool.function.description,
              parameters: tool.function.parameters,
              // Responses API 的 function 工具默认 strict，会要求 schema 全字段必填 +
              // additionalProperties:false；本项目的工具参数含可选项，显式关掉免得 400。
              strict: false,
            })),
            tool_choice: toolChoice,
          }
        : {}),
      // 不下发 temperature：Responses API 主要面向推理模型，非默认值会被直接拒绝。
      // store:false —— 自部署记账数据不留在上游。
      store: false,
      ...(stream ? { stream: true } : {}),
    };
  },

  parseResponse(data: unknown): LlmReply {
    const body = data as ResponsesBody;
    if (body.error?.message) throw upstreamError(body.error.message);
    if (!Array.isArray(body.output)) {
      throw new AppError("AI_UPSTREAM_ERROR", "AI 服务返回了空响应", 502);
    }
    const parsed = parseOutput(body.output);
    return {
      content: parsed.content || null,
      reasoningContent: parsed.reasoningContent || null,
      toolCalls: parsed.toolCalls,
      usage: packUsage(body.usage),
    };
  },

  createStreamAccumulator(onDelta: (text: string) => void): LlmStreamAccumulator {
    let content = "";
    let reasoningContent = "";
    let usage: LlmUsage | undefined;
    let failure: AppError | undefined;
    let completed: ResponsesBody | undefined;
    // 按 output_index 归位：同一次回复里可能并列多个 function_call。
    const toolCalls = new Map<number, LlmToolCall>();
    // added 帧里带过来的 arguments 只是种子值（OpenAI 端点恒为 ""）。收到第一个增量分片就丢弃它，
    // 否则「网关在 added 里已给出完整/部分参数、随后又逐片重发」会拼成 {}{"amount":"10"} 这种坏 JSON。
    const seededSlots = new Set<number>();

    const slotFor = (index: number): LlmToolCall => {
      let call = toolCalls.get(index);
      if (!call) {
        call = { id: `call_${index}`, type: "function", function: { name: "", arguments: "" } };
        toolCalls.set(index, call);
      }
      return call;
    };

    return {
      apply(payload: unknown) {
        const event = payload as ResponsesStreamEvent;
        const index = event.output_index ?? 0;
        switch (event.type) {
          case "response.output_text.delta": {
            const text = event.delta ?? "";
            if (text) {
              content += text;
              onDelta(text);
            }
            break;
          }
          case "response.reasoning_summary_text.delta":
          case "response.reasoning_text.delta":
            reasoningContent += event.delta ?? "";
            break;
          // added 建槽位，done 收口；两者语义不同，参数的写法也不同。
          case "response.output_item.added": {
            const item = event.item;
            if (item?.type !== "function_call") break;
            const call = slotFor(index);
            const id = item.call_id ?? item.id;
            if (id) call.id = id;
            if (item.name) call.function.name = item.name;
            call.function.arguments = item.arguments ?? "";
            if (call.function.arguments) seededSlots.add(index);
            else seededSlots.delete(index);
            break;
          }
          case "response.output_item.done": {
            const item = event.item;
            if (item?.type !== "function_call") break;
            const call = slotFor(index);
            const id = item.call_id ?? item.id;
            if (id) call.id = id;
            if (item.name) call.function.name = item.name;
            // done 帧带完整参数，直接覆盖增量拼接的结果，避免丢片导致 JSON 截断。
            if (item.arguments) {
              call.function.arguments = item.arguments;
              seededSlots.delete(index);
            }
            break;
          }
          case "response.function_call_arguments.delta": {
            const call = slotFor(index);
            if (seededSlots.delete(index)) call.function.arguments = "";
            call.function.arguments += event.delta ?? "";
            break;
          }
          case "response.function_call_arguments.done":
            if (typeof event.arguments === "string") {
              slotFor(index).function.arguments = event.arguments;
              seededSlots.delete(index);
            }
            break;
          case "response.completed":
          case "response.incomplete":
            completed = event.response;
            usage = packUsage(event.response?.usage) ?? usage;
            break;
          case "response.failed":
          case "error":
            failure = upstreamError(
              event.response?.error?.message ?? event.error?.message ?? event.message,
            );
            break;
          default:
            break;
        }
      },

      finish() {
        if (failure) throw failure;
        // 兜底：只发粗粒度事件的网关可能全程没有增量帧，此时用末帧的完整 response 补齐。
        if (completed) {
          const fallback = parseOutput(completed.output);
          if (!content && fallback.content) {
            content = fallback.content;
            // 补发增量，保证流式所见与最终持久化的正文一致。
            onDelta(content);
          }
          if (!reasoningContent) reasoningContent = fallback.reasoningContent;
          const accumulated = [...toolCalls.values()];
          const incomplete =
            accumulated.length === 0 || accumulated.some((call) => !call.function.name);
          if (fallback.toolCalls.length > 0 && incomplete) {
            toolCalls.clear();
            fallback.toolCalls.forEach((call, i) => toolCalls.set(i, call));
          }
          usage ??= packUsage(completed.usage);
        }
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
