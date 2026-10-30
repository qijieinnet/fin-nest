/**
 * 智能体 token 的权限范围（见 docs/MCP_PLAN.md §3）。
 *
 * - read：全部只读工具（发现 id 也靠它，其它 scope 都离不开，前端强制勾选）；
 * - drafts:write：起草交易进「待确认」，修改/撤回本 token 起草的草稿——入账永远要用户确认；
 * - accounts:write：新建账户/子账户（余额只能为 0）、改名称/图标/归属等，不能动余额；
 * - assets:write：物品、订阅、保险的新建/修改/状态变更，新建物品类型与订阅分类；
 * - plans:write：计划新建/修改/停止/恢复，月度总预算与分类预算；
 * - changes:write：申请修改/删除已入账交易、申请调整余额——提交的是「变更申请」，用户批准才执行。
 */
export const AGENT_TOKEN_SCOPES = [
  "read",
  "drafts:write",
  "accounts:write",
  "assets:write",
  "plans:write",
  "changes:write",
] as const;

export type AgentTokenScope = (typeof AGENT_TOKEN_SCOPES)[number];

/** 每人同时有效的 token 上限：够覆盖几台电脑 × 几个客户端，又不至于失控。 */
export const MAX_ACTIVE_AGENT_TOKENS = 20;

/** lastUsedAt 按分钟节流写库，与 session 的 lastSeenAt 同口径。 */
export const AGENT_TOKEN_TOUCH_INTERVAL_MS = 60_000;

/** 进程内限流（单实例假设，与登录限速一致）：每个 token 每分钟的工具调用上限。 */
export const AGENT_TOKEN_CALLS_PER_MINUTE = 120;

/** 写工具的每分钟上限（在总上限之内另算）。 */
export const AGENT_TOKEN_WRITES_PER_MINUTE = 30;
