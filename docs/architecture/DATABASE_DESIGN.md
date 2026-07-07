# Fin Nest 数据库模型设计

版本：v0.2  
数据库：PostgreSQL  
依据：`ARCHITECTURE.md`、`FUNCTION_BOUNDARIES.md`、`claude-design/记账本.dc.html`

## 1. 设计原则

- PostgreSQL 是唯一业务事实源。
- v1 不依赖 Redis。
- MinIO 只保存文件对象，PostgreSQL 保存附件元数据和业务关系。
- 所有账本内业务数据必须带 `ledger_id`。
- 金额使用固定精度整数：`amount_micros BIGINT`。
- 小数位由账本记账设置控制，只影响输入校验和展示。
- 交易和账户余额变更必须在同一个数据库事务中完成。
- 账户余额保存在账户表中，同时所有余额变化写入账户流水。
- 交易区分原始金额和有效金额。账户余额按原始金额变化；列表、统计、计划默认按有效金额计算。
- 存在可收回/需归还关联时，有效金额 = 原始金额 - 关联金额合计。
- 交易删除使用软删除；账户、分类、人员存在关联交易时禁止删除，改为停用/归档。
- 业务对象的 `created_by`、`updated_by` 记录用户；关键修改写审计日志。
- v1 使用 Prisma + Prisma Migrate；Prisma 难以表达的 PostgreSQL 特性使用 raw SQL migration。

## 2. 通用字段约定

主键：

```txt
id UUID PRIMARY KEY
```

时间字段：

```txt
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
deleted_at TIMESTAMPTZ NULL
```

用户追踪字段：

```txt
created_by UUID NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
deleted_by UUID NULL REFERENCES users(id)
```

金额字段：

```txt
amount_micros BIGINT NOT NULL
```

含义：

```txt
真实金额 = amount_micros / 1_000_000
```

示例：

```txt
12.34 -> 12340000
100   -> 100000000
```

TypeScript 中不要用 `number` 做精确金额计算，使用 `bigint`、字符串或 Decimal 封装。

如果使用 `CITEXT` 存储邮箱和账号，需要在数据库迁移中启用扩展：

```sql
CREATE EXTENSION IF NOT EXISTS citext;
```

## 3. 用户与认证

### 3.1 users

用户账号表。

```txt
id UUID PK
email CITEXT UNIQUE NOT NULL
account CITEXT UNIQUE NOT NULL
alias TEXT NOT NULL
is_admin BOOLEAN NOT NULL DEFAULT false
password_hash TEXT NOT NULL
disabled_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

说明：

- `email` 可用于登录和通知。
- `account` 可用于登录，唯一；v1 不提供账号名修改功能。
- `alias` 是展示名，可修改，不等于 Person。
- 首个注册用户自动设置 `is_admin=true`。
- 禁止保存明文密码。

### 3.2 app_settings

系统级设置。个人部署场景使用单行表。

```txt
id SMALLINT PK DEFAULT 1
registration_enabled BOOLEAN NOT NULL DEFAULT true
updated_by UUID NULL REFERENCES users(id)
updated_at TIMESTAMPTZ
```

规则：

- 首次启动允许注册。
- 第一个注册用户成为管理员。
- 管理员可以关闭开放注册。
- 关闭注册后，普通用户不能自行注册。

### 3.3 sessions

用户登录 session。使用 opaque token，数据库只存 hash。

```txt
id UUID PK
user_id UUID NOT NULL REFERENCES users(id)
token_hash TEXT UNIQUE NOT NULL
device_name TEXT NULL
user_agent TEXT NULL
ip INET NULL
expires_at TIMESTAMPTZ NOT NULL
revoked_at TIMESTAMPTZ NULL
last_seen_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
```

索引：

```txt
UNIQUE(token_hash)
INDEX(user_id, revoked_at)
INDEX(expires_at)
```

### 3.4 service_tokens

外部系统 token，例如 Dify。数据库只存 hash。

```txt
id UUID PK
name TEXT NOT NULL
token_hash TEXT UNIQUE NOT NULL
scopes TEXT[] NOT NULL DEFAULT '{}'
allowed_ips CIDR[] NULL
expires_at TIMESTAMPTZ NULL
revoked_at TIMESTAMPTZ NULL
last_used_at TIMESTAMPTZ NULL
created_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
```

说明：

- 外部系统不能使用用户 session token。
- 如需代表用户操作，接口必须传 `actor_user_id` 和 `ledger_id`，后端重新校验权限。

## 4. 账本、成员与加入申请

### 4.1 ledgers

账本表。

```txt
id UUID PK
name TEXT NOT NULL
icon TEXT NULL
currency CHAR(3) NOT NULL DEFAULT 'CNY'
owner_user_id UUID NOT NULL REFERENCES users(id)
created_by UUID NOT NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
deleted_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
deleted_at TIMESTAMPTZ NULL
```

规则：

- 删除账本仅 owner 可执行。
- 删除账本使用软删除。

### 4.2 ledger_members

账本成员表。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
user_id UUID NOT NULL REFERENCES users(id)
role TEXT NOT NULL CHECK (role IN ('owner', 'member'))
joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
removed_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

约束与索引：

```txt
UNIQUE(ledger_id, user_id)
INDEX(user_id, removed_at)
INDEX(ledger_id, role)
```

权限：

- `owner` 可删除账本、审批加入申请。
- `member` 拥有除删除账本外的账本内业务权限。
- `member` 可以修改别人创建的记账，但交易要记录最后修改人。

### 4.3 ledger_invites

邀请码/分享码表。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
code_hash TEXT UNIQUE NOT NULL
created_by UUID NOT NULL REFERENCES users(id)
expires_at TIMESTAMPTZ NOT NULL
revoked_at TIMESTAMPTZ NULL
used_count INTEGER NOT NULL DEFAULT 0
created_at TIMESTAMPTZ
```

规则：

- 默认有效期 1 天。
- 数据库保存 code hash，不保存明文邀请码。

### 4.4 ledger_join_requests

通过邀请码申请加入账本。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
invite_id UUID NULL REFERENCES ledger_invites(id)
requester_user_id UUID NOT NULL REFERENCES users(id)
status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired'))
reviewed_by UUID NULL REFERENCES users(id)
reviewed_at TIMESTAMPTZ NULL
message TEXT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

索引：

```txt
INDEX(ledger_id, status)
INDEX(requester_user_id, status)
```

规则：

- 输入邀请码只创建 `pending` 申请。
- owner 同意后创建 `ledger_members`。
- 同一个用户同一个账本只允许一个 pending 申请。

## 5. 账本设置、分类与人员

### 5.1 record_settings

账本记账设置。

```txt
ledger_id UUID PK REFERENCES ledgers(id)
field_order JSONB NOT NULL
visible_fields JSONB NOT NULL
acct_required BOOLEAN NOT NULL DEFAULT false
person_required BOOLEAN NOT NULL DEFAULT false
amount_decimal_places SMALLINT NOT NULL DEFAULT 2
updated_by UUID NULL REFERENCES users(id)
updated_at TIMESTAMPTZ
```

规则：

- `amount_decimal_places` 只影响输入和展示。
- 默认账户非必填。

### 5.1.1 默认初始化数据

第一个用户注册成功后，系统必须自动创建默认账本，并在该账本内创建：

- 默认记账设置。
- 默认人员“我”。
- 基础支出分类。
- 基础收入分类。

用户新建账本时，也必须创建同样的账本内默认数据。

规则：

- 不自动创建默认账户。
- 初始化逻辑必须幂等，不能因为重试创建重复默认人员或默认分类。
- 默认人员“我”设置 `is_default=true`，不可删除。
- 基础分类的具体名称和图标可在前端/产品细化时确定，但必须区分收入和支出。

### 5.2 categories

一级分类。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
type TEXT NOT NULL CHECK (type IN ('expense', 'income'))
name TEXT NOT NULL
icon TEXT NULL
sort_order INTEGER NOT NULL DEFAULT 0
archived_at TIMESTAMPTZ NULL
created_by UUID NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

索引：

```txt
INDEX(ledger_id, type, archived_at)
UNIQUE(ledger_id, type, name)
```

规则：

- 分类存在关联交易时不能删除。
- 不再使用时归档。

### 5.3 subcategories

二级分类。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
category_id UUID NOT NULL REFERENCES categories(id)
name TEXT NOT NULL
icon TEXT NULL
sort_order INTEGER NOT NULL DEFAULT 0
archived_at TIMESTAMPTZ NULL
created_by UUID NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

索引：

```txt
INDEX(category_id, archived_at)
UNIQUE(category_id, name)
```

规则：

- 二级分类存在关联交易时不能删除。

### 5.4 people

账本内消费归属人员，不等于用户。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
name TEXT NOT NULL
icon TEXT NULL
is_default BOOLEAN NOT NULL DEFAULT false
archived_at TIMESTAMPTZ NULL
created_by UUID NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

索引：

```txt
INDEX(ledger_id, archived_at)
UNIQUE(ledger_id, name)
```

规则：

- 默认人员不可删除。
- 人员存在关联交易时不能删除。
- 不再使用时归档。

## 6. 账户与账户流水

### 6.1 accounts

账户表。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
type TEXT NOT NULL CHECK (type IN ('savings', 'credit', 'invest', 'receivable', 'payable'))
name TEXT NOT NULL
icon TEXT NULL
balance_micros BIGINT NOT NULL DEFAULT 0
include_in_net_worth BOOLEAN NOT NULL DEFAULT true

credit_limit_micros BIGINT NULL
investment_cost_micros BIGINT NULL
counterparty TEXT NULL
due_date DATE NULL
bill_day SMALLINT NULL
repay_day SMALLINT NULL
settled_at TIMESTAMPTZ NULL

archived_at TIMESTAMPTZ NULL
created_by UUID NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

索引：

```txt
INDEX(ledger_id, type, archived_at)
```

规则：

- 储蓄、投资、可收回属于资产。
- 信用、需归还属于负债。
- 存在关联交易或流水时禁止硬删，使用归档。

### 6.2 sub_accounts

子账户。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
account_id UUID NOT NULL REFERENCES accounts(id)
name TEXT NOT NULL
balance_micros BIGINT NOT NULL DEFAULT 0
archived_at TIMESTAMPTZ NULL
created_by UUID NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

索引：

```txt
INDEX(account_id, archived_at)
UNIQUE(account_id, name)
```

规则：

- 子账户存在关联交易时不能删除。
- 手动修改子账户余额也要生成调整记录和账户流水。

### 6.3 account_entries

账户流水表。所有余额变化都写这里。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
account_id UUID NOT NULL REFERENCES accounts(id)
sub_account_id UUID NULL REFERENCES sub_accounts(id)
entry_type TEXT NOT NULL
amount_delta_micros BIGINT NOT NULL
balance_before_micros BIGINT NOT NULL
balance_after_micros BIGINT NOT NULL

transaction_id UUID NULL
adjustment_id UUID NULL
related_account_id UUID NULL REFERENCES accounts(id)
note TEXT NULL
occurred_at TIMESTAMPTZ NOT NULL
created_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
```

`entry_type` 枚举：

```txt
expense
income
transfer_out
transfer_in
receivable_increase
receivable_decrease
payable_increase
payable_decrease
settlement
adjustment
reversal
```

索引：

```txt
INDEX(ledger_id, account_id, occurred_at DESC)
INDEX(transaction_id)
INDEX(adjustment_id)
```

规则：

- 转账生成两条流水：转出和转入。
- 编辑/删除交易时使用反向流水回滚旧影响，不物理删除旧流水。
- 反向流水使用 `entry_type='reversal'`，并通过 `transaction_id` 或 metadata 指向被回滚的交易/流水。
- 账户当前余额以账户表字段为准，但必须能通过账户流水审计余额变化路径。

### 6.4 account_adjustments

手动余额调整记录。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
account_id UUID NOT NULL REFERENCES accounts(id)
sub_account_id UUID NULL REFERENCES sub_accounts(id)
balance_before_micros BIGINT NOT NULL
balance_after_micros BIGINT NOT NULL
delta_micros BIGINT NOT NULL
note TEXT NULL
created_by UUID NOT NULL REFERENCES users(id)
created_at TIMESTAMPTZ
```

规则：

- 调整记录可在账户详情查询。
- 调整影响账户余额。
- 调整默认不进入收支统计。

## 7. 交易

### 7.1 transactions

正式交易表。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer'))
gross_amount_micros BIGINT NOT NULL
effective_amount_micros BIGINT NOT NULL
currency CHAR(3) NOT NULL DEFAULT 'CNY'
occurred_on DATE NOT NULL
occurred_at TIMESTAMPTZ NOT NULL

category_id UUID NULL REFERENCES categories(id)
subcategory_id UUID NULL REFERENCES subcategories(id)
category_snapshot JSONB NULL

person_id UUID NULL REFERENCES people(id)
person_snapshot JSONB NULL

account_id UUID NULL REFERENCES accounts(id)
sub_account_id UUID NULL REFERENCES sub_accounts(id)
from_account_id UUID NULL REFERENCES accounts(id)
from_sub_account_id UUID NULL REFERENCES sub_accounts(id)
to_account_id UUID NULL REFERENCES accounts(id)
to_sub_account_id UUID NULL REFERENCES sub_accounts(id)

note TEXT NULL
source TEXT NOT NULL DEFAULT 'manual'
source_id UUID NULL

created_by UUID NOT NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
deleted_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
deleted_at TIMESTAMPTZ NULL
```

`source` 枚举：

```txt
manual
quick
auto
import
ai
```

说明：

- `import` 和 `ai` 是 v1 之后来源，v1 schema 保留枚举值以免后续迁移交易来源字段。

索引：

```txt
INDEX(ledger_id, occurred_on DESC)
INDEX(ledger_id, type, occurred_on DESC)
INDEX(ledger_id, category_id)
INDEX(ledger_id, person_id)
INDEX(ledger_id, created_by)
INDEX(account_id)
INDEX(from_account_id)
INDEX(to_account_id)
```

规则：

- 支出/收入是否必须绑定账户由 `record_settings.acct_required` 决定。
- `gross_amount_micros` 是用户输入的原始交易金额，也是账户余额变化的现金流基础。
- `effective_amount_micros` 是列表、统计、计划默认使用的有效金额。
- `effective_amount_micros = gross_amount_micros - transaction_account_relations.amount_micros 合计`。
- 如果没有可收回/需归还关联，则 `effective_amount_micros = gross_amount_micros`。
- 关联金额合计不能大于 `gross_amount_micros`。
- 绑定账户的支出/收入立即改变账户余额。
- 未绑定账户的支出/收入不改变账户余额。
- 转账必须绑定转出和转入账户，并立即改变两边余额。
- 交易删除使用软删除，并回滚账户影响。

### 7.2 transaction_account_relations

交易关联的可收回/需归还项目。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
transaction_id UUID NOT NULL REFERENCES transactions(id)
account_id UUID NOT NULL REFERENCES accounts(id)
relation_kind TEXT NOT NULL
amount_micros BIGINT NOT NULL
created_at TIMESTAMPTZ
```

`relation_kind` 枚举：

```txt
receivable_from_expense
payable_from_income
receivable_from_income
payable_from_expense
```

说明：

- `receivable_from_expense` 文案为“支出计入可收回”。
- `payable_from_income` 文案为“收入产生需归还”。
- `receivable_from_income` 文案为“收入冲减可收回”。
- `payable_from_expense` 文案为“支出冲减需归还”。
- 每条 relation 会产生对应的 account_entries。
- 每条 relation 的金额都会从交易原始金额中扣减，用于计算交易有效金额。
- `receivable_from_expense`、`payable_from_income` 会增加对应可收回/需归还余额。
- `receivable_from_income`、`payable_from_expense` 会减少对应可收回/需归还余额，且不能把余额扣成负数。
- 交易列表、收支统计、计划命中默认使用交易有效金额。
- 账户现金流仍按交易原始金额处理。

### 7.3 transaction_links

交易关联保单、物品等业务对象。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
transaction_id UUID NOT NULL REFERENCES transactions(id)
linked_type TEXT NOT NULL CHECK (linked_type IN ('insurance', 'item'))
linked_id UUID NOT NULL
created_at TIMESTAMPTZ
```

索引：

```txt
INDEX(ledger_id, linked_type, linked_id)
UNIQUE(transaction_id, linked_type, linked_id)
```

说明：

- 使用通用关联表，避免 transactions 上不断增加 nullable 外键。

## 8. 自动记账与快捷记账

### 8.1 auto_rules

自动记账规则。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
enabled BOOLEAN NOT NULL DEFAULT true
type TEXT NOT NULL CHECK (type IN ('expense', 'income'))
amount_micros BIGINT NOT NULL
category_id UUID NOT NULL REFERENCES categories(id)
subcategory_id UUID NULL REFERENCES subcategories(id)
account_id UUID NULL REFERENCES accounts(id)
sub_account_id UUID NULL REFERENCES sub_accounts(id)
person_id UUID NULL REFERENCES people(id)
note TEXT NULL
repeat_rule TEXT NOT NULL CHECK (repeat_rule IN ('daily', 'weekly', 'monthly', 'yearly', 'once'))
start_date DATE NOT NULL
next_run_on DATE NULL
created_by UUID NOT NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
archived_at TIMESTAMPTZ NULL
```

### 8.2 auto_pending_transactions

自动记账生成的待确认记录。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
auto_rule_id UUID NOT NULL REFERENCES auto_rules(id)
period_key TEXT NOT NULL
scheduled_for DATE NOT NULL
status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'deleted'))

type TEXT NOT NULL CHECK (type IN ('expense', 'income'))
amount_micros BIGINT NOT NULL
category_id UUID NOT NULL REFERENCES categories(id)
subcategory_id UUID NULL REFERENCES subcategories(id)
account_id UUID NULL REFERENCES accounts(id)
sub_account_id UUID NULL REFERENCES sub_accounts(id)
person_id UUID NULL REFERENCES people(id)
note TEXT NULL
relation_payload JSONB NULL

confirmed_transaction_id UUID NULL REFERENCES transactions(id)
confirmed_by UUID NULL REFERENCES users(id)
confirmed_at TIMESTAMPTZ NULL
deleted_by UUID NULL REFERENCES users(id)
deleted_at TIMESTAMPTZ NULL
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

索引与约束：

```txt
UNIQUE(auto_rule_id, period_key)
INDEX(ledger_id, status, scheduled_for)
```

规则：

- 只生成待确认记录。
- 不判断用户是否已有类似手动交易。
- 待确认记录可以编辑后确认。
- 待确认记录可以批量确认。
- 删除待确认记录只影响当前记录，不影响下一周期生成。
- 用户确认后创建正式 transaction。

### 8.3 quick_templates

快捷记账模板。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
type TEXT NOT NULL CHECK (type IN ('expense', 'income'))
name TEXT NULL
amount_micros BIGINT NULL
category_id UUID NOT NULL REFERENCES categories(id)
subcategory_id UUID NULL REFERENCES subcategories(id)
account_id UUID NULL REFERENCES accounts(id)
sub_account_id UUID NULL REFERENCES sub_accounts(id)
person_id UUID NULL REFERENCES people(id)
note TEXT NULL
relation_payload JSONB NULL
direct_enabled BOOLEAN NOT NULL DEFAULT false
sort_order INTEGER NOT NULL DEFAULT 0
created_by UUID NOT NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
archived_at TIMESTAMPTZ NULL
```

规则：

- `direct_enabled=true` 时，除日期外所有必填字段必须已填写。
- 日期使用触发当天。
- 直接记账仍必须调用 Transaction 服务。

## 9. 计划与预算

### 9.1 plans

支出限额 / 收入目标。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
kind TEXT NOT NULL CHECK (kind IN ('expense', 'income'))
metric TEXT NOT NULL CHECK (metric IN ('amount', 'count'))
name TEXT NOT NULL
limit_amount_micros BIGINT NULL
limit_count INTEGER NULL
start_date DATE NOT NULL
repeat_rule TEXT NOT NULL CHECK (repeat_rule IN ('weekly', 'monthly', 'yearly', 'once'))
match_rule JSONB NULL
foresight_enabled BOOLEAN NOT NULL DEFAULT false
created_by UUID NOT NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
archived_at TIMESTAMPTZ NULL
```

规则：

- `metric=amount` 使用 `limit_amount_micros`。
- `metric=count` 使用 `limit_count`。
- 计划读取交易计算命中，不写交易。

### 9.2 预算与计划的区别

原型里「预算」与「计划」是两套东西，不能合用 `plans` 表：

- 计划 `plans`：一个个命名的支出限额/收入目标，带自定义 `match_rule`、周期、历史周期、命中明细、预知能力。
- 预算 `budget_settings` / `category_budgets`：账本级的月度总预算 + 分类月度预算，用于账单首页「本月预算 / 已用 / 剩余 / 进度」展示，没有命名条目、没有历史周期、没有自定义 match_rule。

代码上预算可由 PlanModule 承载，但数据模型必须独立，不复用 `plans`。

### 9.3 budget_settings

账本月度总预算。个人部署场景每账本单行。

```txt
ledger_id UUID PK REFERENCES ledgers(id)
enabled BOOLEAN NOT NULL DEFAULT false
total_amount_micros BIGINT NULL
updated_by UUID NULL REFERENCES users(id)
updated_at TIMESTAMPTZ
```

规则：

- `total_amount_micros` 为账本当月总预算；`NULL` 表示未设置总预算。
- 预算为按自然月重置的滚动预算，不存历史周期。
- `enabled=false` 时首页不展示预算进度。

### 9.4 category_budgets

分类月度预算。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
category_id UUID NOT NULL REFERENCES categories(id)
amount_micros BIGINT NOT NULL
created_by UUID NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

约束与索引：

```txt
UNIQUE(ledger_id, category_id)
INDEX(ledger_id)
```

规则：

- 每个分类在一个账本内最多一条月度预算。
- 仅支出分类参与预算。
- 预算项只是配置，不影响交易和账户余额。

### 9.5 预算进度计算口径

预算进度是读模型，不落库进度结果：

- 已用金额按**当月有效支出**（`effective_amount_micros`，仅 `type='expense'`，排除软删除）累计，与统计、计划口径一致。
- 总预算进度：`已用 = 当月有效支出合计`，`剩余 = max(0, total_amount_micros - 已用)`，`百分比 = 已用 / total_amount_micros`。
- 分类预算进度：`已用 = 当月该分类有效支出合计`，按 `category_budgets.amount_micros` 计算剩余和百分比。
- 转账、账户调整不计入预算已用。

## 10. 保险

### 10.1 insurances

保单表。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
type TEXT NOT NULL
name TEXT NOT NULL
insurer TEXT NULL
method TEXT NULL
policy_no TEXT NULL
coverage_micros BIGINT NULL
premium_micros BIGINT NULL
premium_freq TEXT NULL
periods INTEGER NULL
renewal TEXT NULL
coverage_desc TEXT NULL
start_date DATE NULL
end_date DATE NULL
note TEXT NULL
terminated_at TIMESTAMPTZ NULL
created_by UUID NOT NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
deleted_at TIMESTAMPTZ NULL
```

### 10.2 insurance_insured_people

保单被保人。

```txt
insurance_id UUID REFERENCES insurances(id)
person_id UUID REFERENCES people(id)
PRIMARY KEY (insurance_id, person_id)
```

规则：

- 保单可关联交易。
- 保单不是账户，不参与净资产。

## 11. 物品

### 11.1 item_types

账本内物品类型。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
name TEXT NOT NULL
sort_order INTEGER NOT NULL DEFAULT 0
created_at TIMESTAMPTZ
```

### 11.2 items

物品档案。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
name TEXT NOT NULL
type_id UUID NULL REFERENCES item_types(id)
purchase_price_micros BIGINT NULL
purchase_date DATE NULL
expected_years NUMERIC(6,2) NULL
note TEXT NULL
scrapped_at TIMESTAMPTZ NULL
scrap_date DATE NULL
sell_price_micros BIGINT NULL
created_by UUID NOT NULL REFERENCES users(id)
updated_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
deleted_at TIMESTAMPTZ NULL
```

规则：

- 物品不是账户，不自动改变账户余额。
- 物品可被交易关联。
- 报废不删除历史记录。

## 12. 文件与附件

### 12.1 files

MinIO 对象元数据。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
owner_user_id UUID NOT NULL REFERENCES users(id)
bucket TEXT NOT NULL
object_key TEXT UNIQUE NOT NULL
original_name TEXT NULL
mime TEXT NOT NULL
size_bytes BIGINT NOT NULL
checksum TEXT NULL
status TEXT NOT NULL CHECK (status IN ('attached', 'delete_pending', 'delete_failed'))
created_at TIMESTAMPTZ
deleted_at TIMESTAMPTZ NULL
```

object key 规范：

```txt
ledgers/{ledgerId}/{bizType}/{bizId}/{yyyy}/{mm}/{random}.{ext}
```

### 12.2 attachments

附件挂载关系。

```txt
id UUID PK
ledger_id UUID NOT NULL REFERENCES ledgers(id)
file_id UUID NOT NULL REFERENCES files(id)
owner_type TEXT NOT NULL CHECK (owner_type IN ('transaction', 'insurance', 'item'))
owner_id UUID NOT NULL
created_by UUID NULL REFERENCES users(id)
created_at TIMESTAMPTZ
```

索引：

```txt
INDEX(ledger_id, owner_type, owner_id)
UNIQUE(file_id, owner_type, owner_id)
```

规则：

- MinIO bucket 私有。
- 有账本权限的用户才能访问附件。
- 删除业务对象时同步删除附件和 MinIO 对象；失败写后台任务重试。

## 13. 审计与后台任务

### 13.1 audit_logs

审计日志。

```txt
id UUID PK
ledger_id UUID NULL REFERENCES ledgers(id)
actor_user_id UUID NULL REFERENCES users(id)
service_token_id UUID NULL REFERENCES service_tokens(id)
source TEXT NOT NULL CHECK (source IN ('user', 'service', 'system'))
action TEXT NOT NULL
entity_type TEXT NOT NULL
entity_id UUID NULL
metadata JSONB NULL
created_at TIMESTAMPTZ
```

必须审计：

- 修改别人创建的交易。
- 删除交易。
- 手动余额调整。
- 成员审批。
- 删除账本。
- service token 代表用户写入。

### 13.2 background_jobs

PostgreSQL 后台任务表。

```txt
id UUID PK
type TEXT NOT NULL
status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled'))
payload JSONB NOT NULL
run_after TIMESTAMPTZ NOT NULL DEFAULT now()
attempts INTEGER NOT NULL DEFAULT 0
max_attempts INTEGER NOT NULL DEFAULT 3
locked_at TIMESTAMPTZ NULL
locked_by TEXT NULL
last_error TEXT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

用途：

- 自动记账调度。
- MinIO 删除失败后的重试清理。
- v1 之后 AI 任务。
- v1 之后导入导出任务。

索引：

```txt
INDEX(status, run_after)
INDEX(type, status)
```

## 14. 删除策略总表

| 对象 | 删除策略 |
|---|---|
| 用户 | 禁用，不硬删 |
| session | 可吊销，可过期清理 |
| service token | 可吊销，可过期清理 |
| 账本 | owner 软删除 |
| 分类 | 有交易禁止删除；无交易可硬删；隐藏用归档 |
| 二级分类 | 有交易禁止删除；无交易可硬删；隐藏用归档 |
| 人员 | 有交易禁止删除；无交易可硬删；隐藏用归档 |
| 账户 | 有交易/流水禁止硬删；隐藏用归档 |
| 子账户 | 有交易/流水禁止硬删；隐藏用归档 |
| 交易 | 软删除并回滚账户影响 |
| 自动规则 | 归档/停用，不删除历史待确认 |
| 快捷模板 | 归档 |
| 分类月度预算 | 配置项，可硬删；分类归档时一并清理 |
| 保单 | 软删除 |
| 物品 | 软删除 |
| 附件 | 删除业务对象时同步删元数据和 MinIO 对象，失败重试 |
