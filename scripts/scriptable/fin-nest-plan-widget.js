// ============================================================================
// Fin Nest · 计划进度小组件 (Scriptable)
// ----------------------------------------------------------------------------
// 数据来源：GET https://<域名>/api/public/plans/<token>/progress
// 该接口应用层免登录（分享 token 即鉴权），需在 Cloudflare Access 里对
// /api/public/plans* 放行（Bypass），或配置 Service Token 后在下方填 CF_ 头。
//
// 用法：
//   1. 在 App 内为某个计划生成分享 token（fn_plan_xxx，明文只显示一次）。
//   2. 把 DOMAIN / TOKEN 填到下面，或用小组件参数传 "token" / "域名,token"。
//   3. 支持 small / medium 尺寸，视觉对齐 App 内「本期卡片」。
// ============================================================================

// ------------------------- 配置 -------------------------
const CONFIG = {
  // 你的对外域名（不带末尾斜杠），例如 "https://fin.example.com"
  DOMAIN: "",
  // 计划分享 token（fn_plan_ 开头）
  TOKEN: "",
  // 账本金额小数位（App 里可配，一般 2）
  DECIMAL_PLACES: 0,
  // 若在 CF 用 Service Token，填这两项；否则留空
  CF_ACCESS_CLIENT_ID: "",
  CF_ACCESS_CLIENT_SECRET: "",
};

// 小组件参数覆盖：可填 "fn_plan_xxx" 或 "https://域名,fn_plan_xxx"
if (args.widgetParameter) {
  const parts = String(args.widgetParameter)
    .split(",")
    .map((s) => s.trim());
  if (parts.length === 1) {
    CONFIG.TOKEN = parts[0];
  } else if (parts.length >= 2) {
    CONFIG.DOMAIN = parts[0];
    CONFIG.TOKEN = parts[1];
  }
}

// ------------------------- 主题色（对齐 globals.css）-------------------------
const isDark = Device.isUsingDarkAppearance();
const COLORS = {
  bg: isDark ? new Color("#1c1c1e") : new Color("#ffffff"),
  bgGrad: isDark ? new Color("#2c2c2e") : new Color("#f5f6f6"),
  textPrimary: isDark ? new Color("#f2f4f3") : new Color("#1c2320"),
  textMuted: new Color("#8a9690"),
  expense: new Color("#fe373c"),
  income: new Color("#35c758"),
  tint: new Color("#0a84ff"),
  trackFill: isDark ? new Color("#3a3a3c") : new Color("#eef0ef"),
  border: isDark ? new Color("#ffffff", 0.08) : new Color("#000000", 0.06),
};

// ------------------------- 金额格式化（复刻 formatMicros）-------------------------
const MICROS_PER_UNIT = 1_000_000n;

function groupInteger(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 与 web 端 formatMicros 一致：四舍五入(远离零)、千分位、可去尾零。 */
function formatMicros(
  microsInput,
  { decimalPlaces = CONFIG.DECIMAL_PLACES, trimTrailingZeros = false } = {},
) {
  const micros = BigInt(microsInput ?? "0");
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const fractionScale = 10n ** BigInt(decimalPlaces);
  const scaled = (absolute * fractionScale * 2n + MICROS_PER_UNIT) / (MICROS_PER_UNIT * 2n);
  const units = scaled / fractionScale;
  const fractionValue = scaled % fractionScale;
  let fraction = decimalPlaces > 0 ? fractionValue.toString().padStart(decimalPlaces, "0") : "";
  if (trimTrailingZeros) fraction = fraction.replace(/0+$/, "");
  const sign = negative ? "-" : "";
  const decimal = fraction ? `.${fraction}` : "";
  return `${sign}${groupInteger(units.toString())}${decimal}`;
}

// ------------------------- 日期工具（复刻 plan-utils）-------------------------
function todayKey() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function addDaysKey(dateKey, days) {
  const [y, mo, d] = dateKey.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d + days));
  return date.toISOString().slice(0, 10);
}

const periodEndInclusive = (endExclusive) => addDaysKey(endExclusive, -1);

function periodRangeText(start, endExclusive) {
  const end = periodEndInclusive(endExclusive);
  const [sy, sm, sd] = start.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em && sd === ed) return `${sy}年${sm}月${sd}日`;
  if (sy === ey && sm === em) return `${sy}年${sm}月${sd}日–${ed}日`;
  if (sy === ey) return `${sy}年${sm}月${sd}日–${em}月${ed}日`;
  return `${sy}年${sm}月${sd}日 – ${ey}年${em}月${ed}日`;
}

function daysBetweenKeys(startKey, endKey) {
  const start = Date.parse(`${startKey.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endKey.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

// ------------------------- 拉取数据 -------------------------
async function fetchCard() {
  const url = `${CONFIG.DOMAIN.replace(/\/$/, "")}/api/public/plans/${CONFIG.TOKEN}/progress`;
  const req = new Request(url);
  req.timeoutInterval = 15;
  // 一次性构造完整 headers 再赋值：Scriptable 里对 req.headers 逐个追加属性
  // 可能不会生效（读取返回的是副本），必须整体赋值。
  const headersToSend = { Accept: "application/json" };
  if (CONFIG.CF_ACCESS_CLIENT_ID && CONFIG.CF_ACCESS_CLIENT_SECRET) {
    headersToSend["CF-Access-Client-Id"] = CONFIG.CF_ACCESS_CLIENT_ID.trim();
    headersToSend["CF-Access-Client-Secret"] = CONFIG.CF_ACCESS_CLIENT_SECRET.trim();
  }
  req.headers = headersToSend;
  // 先取原始文本，便于在出错时判断是 CF Access 拦截还是应用返回。
  const raw = await req.loadString();
  const status = req.response ? req.response.statusCode : 0;
  const headers = (req.response && req.response.headers) || {};
  if (status >= 400) {
    const server = headers.Server || headers.server || "";
    const cfRay = headers["cf-ray"] || headers["Cf-Ray"] || headers["CF-RAY"] || "";
    // 把 HTML 标签去掉、压缩空白，截取一段正文，方便直接看到 CF 的拦截文案。
    const snippet = String(raw || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);
    const err = new Error(`HTTP ${status}`);
    err.detail = {
      status,
      server: String(server),
      cfRay: String(cfRay),
      contentType: String(headers["Content-Type"] || headers["content-type"] || ""),
      body: snippet || "(空响应体)",
    };
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (_e) {
    const err = new Error("返回非 JSON");
    err.detail = {
      status,
      server: String(headers.Server || headers.server || ""),
      body: String(raw || "").slice(0, 600),
    };
    throw err;
  }
}

// ------------------------- 从卡片数据派生展示模型（复刻 PlanPeriodCard）-------------------------
function buildModel(data) {
  const plan = data.plan;
  const p = data.period;
  const isIncome = plan.kind === "income";
  const isCount = plan.metric === "count";

  const today = todayKey();
  const endInclusive = periodEndInclusive(p.endExclusive);
  const isCurrent = p.start <= today && today <= endInclusive;

  const limit = isCount ? BigInt(p.targetCount ?? 0) : BigInt(p.targetAmountMicros ?? "0");
  const used = isCount ? BigInt(p.projectedCount) : BigInt(p.projectedAmountMicros);
  const remain = limit > used ? limit - used : 0n;
  const over = used > limit ? used - limit : 0n;
  const percent = p.percent;
  const overLimit = over > 0n;
  const daysLeft = isCurrent ? Math.max(0, daysBetweenKeys(today, endInclusive)) : 0;

  const fmt = (v) =>
    isCount ? `${v.toString()} 次` : formatMicros(v.toString(), { trimTrailingZeros: true });
  const limitText = isCount
    ? `${p.targetCount ?? 0} 次`
    : formatMicros(p.targetAmountMicros ?? "0", { trimTrailingZeros: true });

  return {
    title: plan.name,
    periodText: periodRangeText(p.start, p.endExclusive),
    isIncome,
    overLimit,
    percent,
    main: {
      label: isIncome ? "还差" : "剩余",
      sub: isCurrent ? ` / ${daysLeft}天` : "",
      value: fmt(remain),
    },
    limit: { label: isIncome ? "目标" : "限额", value: limitText },
    statusText: overLimit
      ? isIncome
        ? "已超过目标"
        : "已超出限额"
      : isIncome
        ? "目标推进中"
        : "仍在限额内",
    used: { label: isIncome ? "已收" : "已用", value: fmt(used) },
    over: { label: isIncome ? "超出" : "超过", value: fmt(over) },
  };
}

// ------------------------- 渲染 -------------------------
function bgGradient() {
  const g = new LinearGradient();
  g.colors = [COLORS.bg, COLORS.bgGrad];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(0, 1);
  return g;
}

function addProgressBar(stack, percent, overLimit, width) {
  const height = 8;
  const track = stack.addStack();
  track.size = new Size(width, height);
  track.cornerRadius = height / 2;
  track.backgroundColor = COLORS.trackFill;
  // 轨道默认水平居中子元素，会把填充块居中；用 centerAlignContent + 尾部 spacer
  // 把填充顶到最左，模拟 width:X% 从左起的进度条。
  track.centerAlignContent();
  const filledW = (Math.max(0, Math.min(100, percent)) / 100) * width;
  if (filledW > 0) {
    const fill = track.addStack();
    fill.size = new Size(filledW, height);
    fill.cornerRadius = height / 2;
    fill.backgroundColor = overLimit ? COLORS.expense : COLORS.tint;
  }
  track.addSpacer();
}

function statRow(stack, label, value) {
  const row = stack.addStack();
  row.centerAlignContent();
  const l = row.addText(label);
  l.font = Font.systemFont(12);
  l.textColor = COLORS.textMuted;
  row.addSpacer();
  const v = row.addText(value);
  v.font = Font.semiboldSystemFont(15);
  v.textColor = COLORS.textPrimary;
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.7;
}

function buildWidget(model, family) {
  const w = new ListWidget();
  w.backgroundGradient = bgGradient();
  w.setPadding(14, 15, 14, 15);
  const isSmall = family === "small";
  const barWidth = isSmall ? 138 : 300;

  // 标题行
  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText(model.title);
  title.font = Font.semiboldSystemFont(isSmall ? 15 : 17);
  title.textColor = COLORS.textPrimary;
  title.lineLimit = 1;
  if (!isSmall) {
    head.addSpacer();
    const period = head.addText(model.periodText);
    period.font = Font.systemFont(12);
    period.textColor = COLORS.textMuted;
    period.lineLimit = 1;
  }

  w.addSpacer(isSmall ? 6 : 8);

  // 主数值行：剩余/还差  +  限额/目标
  const mid = w.addStack();
  mid.bottomAlignContent();

  const left = mid.addStack();
  left.layoutVertically();
  const mainLabel = left.addText(`${model.main.label}${model.main.sub}`);
  mainLabel.font = Font.systemFont(12);
  mainLabel.textColor = COLORS.textMuted;
  left.addSpacer(3);
  const mainVal = left.addText(model.main.value);
  mainVal.font = Font.boldSystemFont(isSmall ? 24 : 28);
  mainVal.textColor = model.overLimit && !model.isIncome ? COLORS.expense : COLORS.textPrimary;
  mainVal.lineLimit = 1;
  mainVal.minimumScaleFactor = 0.6;

  mid.addSpacer();

  const right = mid.addStack();
  right.layoutVertically();
  const limitLabel = right.addText(model.limit.label);
  limitLabel.font = Font.systemFont(12);
  limitLabel.textColor = COLORS.textMuted;
  limitLabel.rightAlignText();
  right.addSpacer(3);
  const limitVal = right.addText(model.limit.value);
  limitVal.font = Font.semiboldSystemFont(isSmall ? 14 : 16);
  limitVal.textColor = COLORS.textPrimary;
  limitVal.rightAlignText();
  limitVal.lineLimit = 1;

  w.addSpacer(isSmall ? 8 : 10);

  // 进度条 + 百分比/状态
  addProgressBar(w, model.percent, model.overLimit, barWidth);
  w.addSpacer(5);
  const pctRow = w.addStack();
  pctRow.centerAlignContent();
  const pct = pctRow.addText(`${model.percent.toFixed(2)}%`);
  pct.font = Font.systemFont(12);
  pct.textColor = COLORS.textMuted;
  pctRow.addSpacer();
  const status = pctRow.addText(model.statusText);
  status.font = Font.systemFont(12);
  status.textColor = COLORS.textMuted;

  // medium：底部两格（已用/已收、超过/超出）
  if (!isSmall) {
    w.addSpacer(10);
    const divider = w.addStack();
    divider.size = new Size(barWidth, 1);
    divider.backgroundColor = COLORS.border;
    w.addSpacer(8);
    const foot = w.addStack();
    const c1 = foot.addStack();
    c1.layoutVertically();
    c1.size = new Size(barWidth / 2 - 8, 0);
    statRow(c1, model.used.label, model.used.value);
    foot.addSpacer();
    const c2 = foot.addStack();
    c2.layoutVertically();
    c2.size = new Size(barWidth / 2 - 8, 0);
    statRow(c2, model.over.label, model.over.value);
  }

  w.url = CONFIG.DOMAIN;
  return w;
}

function errorWidget(err) {
  const detail = err && err.detail;
  const w = new ListWidget();
  w.backgroundGradient = bgGradient();
  w.setPadding(14, 15, 14, 15);
  const t = w.addText("计划加载失败");
  t.font = Font.semiboldSystemFont(15);
  t.textColor = COLORS.textPrimary;
  w.addSpacer(4);
  const m = w.addText(String((err && err.message) || err));
  m.font = Font.systemFont(12);
  m.textColor = COLORS.expense;
  m.lineLimit = 1;
  if (detail) {
    w.addSpacer(4);
    const meta = [];
    if (detail.server) meta.push(`Server: ${detail.server}`);
    if (detail.cfRay) meta.push(`cf-ray: ${detail.cfRay}`);
    if (detail.contentType) meta.push(detail.contentType);
    if (meta.length) {
      const mt = w.addText(meta.join("  ·  "));
      mt.font = Font.systemFont(10);
      mt.textColor = COLORS.textMuted;
      mt.lineLimit = 2;
    }
    w.addSpacer(4);
    const b = w.addText(detail.body || "");
    b.font = Font.systemFont(10);
    b.textColor = COLORS.textMuted;
    // 中等尺寸能放下更多行；小尺寸少放几行。
    b.lineLimit = config.widgetFamily === "small" ? 4 : 12;
  }
  return w;
}

// ------------------------- 入口 -------------------------
async function main() {
  const family = config.widgetFamily || "medium";
  let widget;
  try {
    const data = await fetchCard();
    widget = buildWidget(buildModel(data), family);
  } catch (e) {
    // 在 App 内运行时，完整细节打到控制台，方便排查（小组件里空间有限）。
    if (!config.runsInWidget && e && e.detail) {
      console.log("加载失败详情:");
      console.log(JSON.stringify(e.detail, null, 2));
    }
    widget = errorWidget(e);
  }
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    if (family === "small") await widget.presentMedium();
    else await widget.presentMedium();
  }
  Script.complete();
}

await main();
