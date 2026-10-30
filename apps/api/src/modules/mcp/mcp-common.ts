import { Injectable, Logger } from "@nestjs/common";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { z } from "zod";
import {
  AppError,
  AuditLogService,
  translateErrorMessage,
  type ErrorLocale,
} from "@fin-nest/backend";
import { currencyDecimals } from "@fin-nest/shared";
import { yuanToMicros } from "../ai/ai-money";
import { LedgersService } from "../ledgers/ledgers.service";
import type { AgentAuthContext } from "./agent-token.service";
import { AgentTokenService } from "./agent-token.service";
import { toToolText } from "./mcp-format";

// ---------- 参数 schema（读写工具共用） ----------

const ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const id = (description: string) =>
  z.string().regex(ID_PATTERN, "须为 UUID").describe(description);

export const ledgerIdArg = id("账本 id，来自 list_ledgers");

export const dateArg = (description: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "格式须为 YYYY-MM-DD")
    .describe(description);

export const amountArg = (description: string) =>
  z
    .string()
    .regex(/^\d{1,13}(\.\d{1,6})?$/, "须为非负十进制字符串，如 88.5")
    .describe(description);

/** 与 REST 的 Idempotency-Key 同一套长度约束。 */
export const idempotencyKeyArg = z
  .string()
  .min(8)
  .max(128)
  .describe("幂等键（8~128 字符，如 UUID）：同一笔/同一个对象重试时保持不变，避免重复创建");

export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
export const WRITE_IDEMPOTENT = { ...WRITE, idempotentHint: true } as const;

export type LedgerInfo = { id: string; currency: string; amountDecimalPlaces: number };

/** 主单位十进制字符串 → micros，小数位超出该币种（或账本）精度时报错而不是静默舍入。 */
export function parseMoney(value: string, decimalPlaces: number, field: string): bigint {
  const micros = yuanToMicros(value, decimalPlaces);
  if (micros === null) {
    throw new AppError(
      "MCP_INVALID_ARGUMENT",
      `${field} 金额格式无效（最多 ${decimalPlaces} 位小数）`,
      400,
    );
  }
  return micros;
}

/** 金额的小数位：本币跟账本设置，外币跟币种常用位数（与账户/订阅的录入口径一致）。 */
export function moneyPlaces(ledger: LedgerInfo, currency: string): number {
  return currency === ledger.currency ? ledger.amountDecimalPlaces : currencyDecimals(currency);
}

/** 只把调用方给了的键带上：MCP 参数里「没传」和「传了 null（清空）」含义不同。 */
export function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

/**
 * MCP 工具的公共运行时：账本白名单、REST 同款 DTO 校验、错误包装、写工具的限流与审计。
 */
@Injectable()
export class McpRuntime {
  private readonly logger = new Logger("McpTools");

  constructor(
    private readonly ledgers: LedgersService,
    private readonly tokens: AgentTokenService,
    private readonly audit: AuditLogService,
  ) {}

  /** 账本白名单在前（token 级限制），领域 service 的 assertMember 在后（成员身份兜底）。 */
  async ledger(ctx: AgentAuthContext, ledgerId: string): Promise<LedgerInfo> {
    if (ctx.ledgerIds.length > 0 && !ctx.ledgerIds.includes(ledgerId)) {
      throw new AppError("AGENT_TOKEN_LEDGER_DENIED", "该 token 无权访问此账本", 403);
    }
    const ledger = await this.ledgers.get(ledgerId, ctx.userId);
    return {
      id: ledger.id,
      currency: ledger.currency,
      amountDecimalPlaces: ledger.amountDecimalPlaces,
    };
  }

  /**
   * 工具参数换算成 REST 的 DTO 后，过一遍与 ValidationPipe 相同的校验（whitelist + 禁止多余字段）。
   * 领域 service 默认入参已被校验过，绕过这一步会让非法值一路落到数据库约束上变成 500。
   */
  async dto<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<T> {
    const instance = plainToInstance(cls, plain);
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      const messages = errors.flatMap((error) => flattenConstraints(error));
      throw new AppError("MCP_INVALID_ARGUMENT", `参数校验失败：${messages.join("；")}`, 400);
    }
    return instance;
  }

  async read(handler: () => Promise<unknown>, locale: ErrorLocale): Promise<CallToolResult> {
    return this.wrap(handler, locale);
  }

  /**
   * 写工具：先按 token 单独限流，执行成功后补一条 `mcp.tool_call` 审计——领域 service 自己的审计
   * 只记得到「谁」（token 归属人），记不到「经由哪个 token、哪个工具」。
   */
  async write(
    ctx: AgentAuthContext,
    tool: string,
    ledgerId: string,
    handler: () => Promise<{ entityType: string; entityId?: string | null; result: unknown }>,
    locale: ErrorLocale,
  ): Promise<CallToolResult> {
    return this.wrap(async () => {
      this.tokens.checkWriteRate(ctx.tokenId);
      const { entityType, entityId, result } = await handler();
      await this.audit.write({
        source: "user",
        actorUserId: ctx.userId,
        ledgerId,
        action: "mcp.tool_call",
        entityType,
        entityId: entityId ?? null,
        metadata: { tool, agentTokenId: ctx.tokenId, agentTokenName: ctx.tokenName },
      });
      return result;
    }, locale);
  }

  private async wrap(
    handler: () => Promise<unknown>,
    locale: ErrorLocale,
  ): Promise<CallToolResult> {
    try {
      const result = await handler();
      return { content: [{ type: "text", text: toToolText(result) }] };
    } catch (error) {
      if (error instanceof AppError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                code: error.code,
                message: translateErrorMessage(error.message, locale),
              }),
            },
          ],
        };
      }
      this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      return {
        isError: true,
        content: [
          { type: "text", text: JSON.stringify({ code: "INTERNAL_ERROR", message: "执行失败" }) },
        ],
      };
    }
  }
}

function flattenConstraints(error: {
  property: string;
  constraints?: Record<string, string>;
  children?: Array<{
    property: string;
    constraints?: Record<string, string>;
    children?: unknown[];
  }>;
}): string[] {
  const own = Object.values(error.constraints ?? {});
  const nested = (error.children ?? []).flatMap((child) =>
    flattenConstraints(child as Parameters<typeof flattenConstraints>[0]).map(
      (message) => `${error.property}.${message}`,
    ),
  );
  return [...own, ...nested];
}
