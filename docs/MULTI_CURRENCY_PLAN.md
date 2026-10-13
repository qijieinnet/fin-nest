# 多币种方案

> 状态：已实现（迁移 `56_multi_currency`）。现状摘要见 `PROJECT_GUIDE.md` §3「多币种」，本文件保留设计取舍。

## 0. 目标与边界

| 步骤       | 内容                                                                                    |
| ---------- | --------------------------------------------------------------------------------------- |
| ① 收口     | 账本本币只在建账时选、有数据后锁定；交易币种必须等于账本本币；前端去掉写死的 `¥`/`元`   |
| ② 外币记账 | 一笔支出/收入可以用外币记：存原币金额，本币金额（按汇率折算、可改）照旧进统计/预算/计划 |
| ③ 外币账户 | 储蓄/信用/投资账户可选币种，余额按账户币种记；跨币种转账；净资产按汇率折成本币          |

**不变的东西**（这是三步能叠在一起做的前提）：

- `transactions.gross_amount_micros / effective_amount_micros` **永远是账本本币**，`transactions.currency` 永远等于账本本币。统计、预算、计划、AI/飞书统计卡片只读这两列，全部不用改。
- `account_entries.amount_delta_micros`、`accounts/sub_accounts.balance_micros`、`account_adjustments.*` 一律是**账户自己的币种**。账户币种建账后不可改，所以一条流水的币种由它的账户唯一确定。
- 往来账户（可收回 / 需归还）只能是本币：关联金额（`transaction_account_relations.amount_micros`）与有效金额同口径，都是本币。

不做：保险 / 物品 / 计划 / 预算的外币；汇兑损益单独记账（汇率变动只体现在净资产折算里）。

## 1. 币种目录与汇率精度

`packages/shared` 的 `CURRENCIES`：代码、符号、展示小数位（JPY/KRW 0 位，其余 2 位）。账本本币和账户币种都只能从这个目录里选；外币记账同样。

汇率统一表达为「1 单位 from = rate 单位 to」，存 `DECIMAL(24,10)`，TS 侧用 10 位定点 `bigint`（`FX_RATE_SCALE = 10^10`），换算 `to_micros = round_half_away(from_micros × rate / 10^10)`，全程不碰 `number`（硬规则 1）。

## 2. 数据模型

```
ledgers.currency                    建账时选；有账户或交易后不可改
accounts.currency CHAR(3) NOT NULL  迁移时回填为所属账本本币；建账后不可改；往来账户必须等于本币
transactions
  currency                          = 账本本币（校验）
  gross/effective_amount_micros     本币
  original_currency  CHAR(3)?       「外币那一侧」的币种；!= 本币
  original_amount_micros BIGINT?    外币金额
  to_currency CHAR(3)?              仅转账：转出、转入都是外币且币种不同（USD→HKD）时，转入侧币种
  to_amount_micros BIGINT?          转入侧金额
auto_rules / auto_pending_transactions / quick_templates
  original_currency / original_amount_micros   同交易；amount_micros 仍是本币（规则/模板里是「估算」，生成时按当日汇率重算）
subscriptions.currency CHAR(3)?     订阅费用币种；空 = 账本本币
exchange_rates                      汇率表（见 §4）
```

### 2.1 一笔交易落到账户上用哪个金额（`sideAmount`）

对交易涉及的每个账户（收支的 `account`、转账的 `from`/`to`），按账户币种 `C` 取：

1. `C == 本币` → `gross_amount_micros`
2. `C == original_currency` → `original_amount_micros`
3. 转账且 `C == to_currency` → `to_amount_micros`
4. 否则 400 `FX_ACCOUNT_CURRENCY_MISMATCH`

各场景的字段填法：

| 场景                                | original      | to            | gross      |
| ----------------------------------- | ------------- | ------------- | ---------- |
| 本币账户/无账户，本币消费           | —             | —             | 本币       |
| 本币信用卡刷 $10（卡按 ¥72.3 入账） | USD 10        | —             | 72.3       |
| 美元卡刷 $10                        | USD 10        | —             | 折算       |
| 转账 CNY → USD 卡                   | USD（转入额） | —             | CNY 转出额 |
| 转账 USD → CNY                      | USD（转出额） | —             | CNY 转入额 |
| 转账 USD → USD                      | USD           | —             | 折算       |
| 转账 USD → HKD                      | USD（转出额） | HKD（转入额） | 折算       |

服务端校验：`original_currency != 本币`；`original` 与 `to` 成对出现（同空或同非空）；`to_*` 只允许在「两侧都是外币且币种不同」的转账上出现，且 `to_currency` 必须等于转入账户币种、`original_currency` 必须等于转出账户币种；同一笔里每个账户都必须能按上面规则取到金额。客户端总是显式传 `grossAmountMicros`（本币），服务端**不**按汇率反向校验它——用户可以照银行账单的实际入账额改。

## 3. 余额、净资产

- `applyEntry` 不变：调用方传进来的 delta 已经是账户币种（由 `sideAmount` 决定）。
- `GET /accounts` 每个账户 / 子账户多返回 `baseBalanceMicros`（按最新汇率折成本币，取不到汇率为 `null`）和 `fxRate`。
- 净资产（当前值 + 曲线）：先按币种分别回放出各时点的原币净资产，再乘以**该时点**的汇率（曲线每个点用当天或之前最近一天的汇率，当前值用最新汇率）。取不到汇率的币种不计入，并在响应里返回 `missingCurrencies`，前端提示去补汇率。
- 投资账户的本金/收益推导是单账户内的，按账户币种照旧算。

## 4. 汇率

表 `exchange_rates(id, ledger_id?, from_currency, to_currency, rate_date, rate DECIMAL(24,10), source, created_by, created_at, updated_at)`：

- `ledger_id IS NULL` = 数据源自动抓取（全局共享）；非空 = 该账本成员手填（只影响本账本，优先于自动）。
- 唯一性：`(ledger_id, from, to, rate_date)`，`ledger_id` 为空的一组用部分唯一索引兜住（PG 里 NULL 互不相等）。
- 查询 `rate(from, to, date)`：同币种 = 1；否则在「本账本手填 + 全局」里取 `rate_date <= date` 最近的一条（同一天手填优先，正向优先于反向 `to→from` 取倒数）；`date` 之前没有时只接受 7 天内的下一条（周末/节假日、手填日期略晚），再晚就当缺汇率；启用了数据源且最近一条过时或缺失时，先向数据源请求 `date` 当天（或最近交易日）并入库；两个外币之间（USD→HKD）直查不到时经账本本币交叉（两条「X→本币」相除）；仍没有返回 `null`。净资产曲线同口径：某时点缺汇率的币种不计入，并进 `missingCurrencies`。
- 数据源：`FX_PROVIDER=frankfurter`（ECB 数据，免 key，`FX_BASE_URL` 可指自建实例）或 `none`（默认，只能手填）。四份 compose 默认填 `frankfurter`。数据源请求一律 5 秒超时、失败吞掉只记日志，**不能影响记账**。
- Worker 每天一次：收集各账本在用的外币（账户币种、订阅币种、近 90 天交易的原币），按本币分组各请求一次 latest 入库。
- 净资产曲线缺历史汇率时，API 用一次 time series 请求补齐该区间（进程内按「币种对 + 区间」记忆，失败后 1 小时内不重试）。
- `exchange_rates` 是业务数据，跟系统备份走（不进排除名单）；账本级 JSON 备份带上该账本的手填汇率。

## 5. 接口

- `GET  /ledgers/:id/fx/rate?from=USD&to=CNY&date=YYYY-MM-DD` → `{ from, to, date, rate, source } | null`（`to` 缺省为本币）
- `GET  /ledgers/:id/fx/rates` → 本账本在用外币的最新汇率 + 手填记录
- `PUT  /ledgers/:id/fx/rates`（`{ fromCurrency, rateDate, rate }`，to 固定本币）手填 / 覆盖
- `DELETE /ledgers/:id/fx/rates/:rateId` 删除手填
- 交易 / 待确认 / 自动规则 / 快捷模板 DTO：新增 `originalCurrency`、`originalAmountMicros`（交易另有 `toCurrency`、`toAmountMicros`）
- 账户 DTO：创建时可传 `currency`；修改不接受
- 订阅 DTO：`currency`

## 6. 各入口

- **记账表单**：金额旁加币种选择。绑定外币账户时币种锁成账户币种；本币账户 / 不绑账户时可自选。币种 ≠ 本币时出现「折合本币」输入框，按记账日期的汇率自动填，用户改过就不再自动覆盖。转账：金额是转出侧；转入账户币种与转出不同时出现「转入金额」。
- **账单列表 / 详情**：主金额仍是本币，外币交易下方多一行原币金额；详情显示汇率（由两个金额反推）。
- **账户**：新建可选币种；外币账户余额显示原币 + 折合本币；分组合计与净资产卡用折合本币。
- **AI**：`draft_transaction` 增加 `currency`；后端按日期汇率折算，草稿卡同时展示原币与本币；外币账户未给币种时按账户币种理解。账户余额卡片带币种。花钱决策的「可动用现金」按折合本币。
- **飞书 / 推送**：草稿卡、订阅提醒按原币展示。
- **自动记账 / 快捷模板**：可填原币；生成待确认 / 直接记账时按当日汇率重算本币，取不到汇率用规则里的估算值。
- **订阅**：费用可选币种；续费确认生成的交易带原币；「月固定支出」折成本币。
- **Excel**：账户表加「币种」列；流水表加「原币种 / 原币金额 / 转入币种 / 转入金额」列，导入时可选。金额表头去掉「(元)」，导入同时认新旧表头。
- **设置**：「更多 › 记账设置」下加「汇率」页，看在用币种的最新汇率、手填覆盖。
