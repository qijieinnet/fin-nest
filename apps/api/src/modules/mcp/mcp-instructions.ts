/**
 * MCP 服务端说明（initialize 时下发给智能体）。按 token 的 scope 拼装：智能体只被告知它真能做的事，
 * 没有写权限时明确说「做不到、请到应用里操作」，免得它编造自己已经记好了账。
 */
export function serverInstructions(scopes: string[]): string {
  const lines = [
    "Fin Nest 是一个个人/家庭记账应用，本服务让你以当前 token 所属用户的身份访问其账本数据。",
    "使用顺序：先调用 list_ledgers 取得账本 id，再调用 get_ledger_context 取得该账本的分类、账户、人员等 id；之后每个工具都要显式传 ledgerId，用到的 id 必须来自这些工具的返回。",
    '金额：入参与出参都是主单位十进制字符串，如 "88.5"，不是分或 micros；交易、预算、计划默认是账本本币，账户余额与流水是账户自己的币种。',
    "统计、预算、计划使用「有效金额」（原始金额减去可收回/需归还关联），账户流水使用原始金额。",
  ];
  if (scopes.includes("drafts:write")) {
    lines.push(
      "记账：draft_transaction / draft_from_quick_template 只生成「待确认草稿」，不会直接入账；必须由用户在 Fin Nest 的「待确认」里（或点推送卡片上的「确认入账」）确认后才记入账本。回复用户时要说「已生成草稿，请确认」，绝不能说「已记账」。每笔草稿传一个新的 idempotencyKey，网络重试同一笔时沿用原值。用 get_draft_status 查看用户是否已确认。",
    );
  } else {
    lines.push("当前 token 不能记账；用户要求记账时，请说明需要在 Fin Nest 应用内操作。");
  }
  if (scopes.includes("changes:write")) {
    lines.push(
      "修改已入账数据：request_transaction_update / request_transaction_delete / request_balance_adjustment 只提交「变更申请」，不会立即生效；用户在 Fin Nest「更多 › 智能体接入」里看过前后对比并批准后才执行。回复用户时要说「已提交申请，请批准」。用 get_change_requests 查看结果；申请提交后目标若又被改过，批准会失败，需要重新提交。",
    );
  } else {
    lines.push("已入账的交易不能修改或删除，余额也不能调整；遇到这类请求，请让用户在应用内操作。");
  }
  if (scopes.includes("accounts:write")) {
    lines.push(
      "账户：可以新建账户/子账户（余额一律为 0）和修改名称、归属等信息；初始余额需要通过余额调整申请（有 changes:write 时）或由用户在应用内设置。",
    );
  }
  if (scopes.includes("assets:write")) {
    lines.push(
      "档案：可以新建和修改物品、订阅、保险，并把它们标记为报废/退订/终止或恢复；不能删除。",
    );
  }
  if (scopes.includes("plans:write")) {
    lines.push("计划与预算：可以新建、修改、停止、恢复计划，以及设置月度总预算与分类预算。");
  }
  if (!scopes.some((scope) => scope !== "read")) {
    lines.push("当前 token 只有只读权限：不能新建、修改或删除任何数据。");
  }
  return lines.join("\n");
}
