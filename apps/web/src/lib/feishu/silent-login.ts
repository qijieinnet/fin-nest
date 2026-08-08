import {
  API_ENDPOINTS,
  apiRequest,
  type FeishuLoginConfig,
  type FeishuSilentLoginResult,
  type PublicUser,
  setSessionToken,
} from "@/lib/api";

/**
 * 飞书容器内免登（客户端侧）。
 *
 * 触发条件苛刻是刻意的：**只有**「UA 是飞书客户端」且「本地没有 token」才会动，
 * 普通浏览器打开时这里立刻返回 null，一次网络请求都不发，密码登录路径完全不受影响。
 *
 * 一轮完整流程会经历两次进入本模块：
 * 1. 无 `code` → 拿公开配置确认已启用 → 整页跳飞书授权页（用户已登录飞书，无任何交互）；
 * 2. 带 `code` 回跳 → 调后端换登录态 → 已绑定则拿到 token，未绑定则存下待绑定票据并回落登录页。
 */

// 飞书客户端内置 WebView：国内版 UA 带 Lark，海外版带 Feishu，均附版本号。
const FEISHU_UA_PATTERN = /Lark|Feishu/i;
// 授权页在 accounts 域，与业务 API 的 open.feishu.cn 不是同一个host，不要合并。
const FEISHU_AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
// 「本标签页已试过免登」——授权失败或用户未绑定时，防止无限跳转回飞书。
const ATTEMPTED_KEY = "fin_nest_feishu_silent_login_attempted";
const BIND_TICKET_KEY = "fin_nest_feishu_bind_ticket";

/** sessionStorage 在隐私模式/WebView 限制下可能不可用，统一静默降级为「读不到」。 */
function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // 存不下最多让用户多走一次流程，不影响正确性。
  }
}

function removeSession(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function isFeishuClient(): boolean {
  if (typeof window === "undefined") return false;
  return FEISHU_UA_PATTERN.test(window.navigator.userAgent);
}

/** 登录页据此提示「登录后将自动绑定飞书」。 */
export function readPendingBindTicket(): string | null {
  if (typeof window === "undefined") return null;
  return readSession(BIND_TICKET_KEY);
}

/**
 * 登录/注册成功后调用：把免登时暂存的飞书身份绑到刚登录的账号上，此后免登生效。
 *
 * 绑定失败不打断登录——用户已经进来了，最坏结果只是下次还得手输一次密码，
 * 因此这里吞掉错误，不往上抛。
 */
export async function bindPendingFeishuTicket(): Promise<void> {
  const ticket = readPendingBindTicket();
  if (!ticket) return;
  removeSession(BIND_TICKET_KEY);
  try {
    await apiRequest(API_ENDPOINTS.feishuBindTicket, { method: "POST", body: { ticket } });
  } catch {
    // 票据过期或该账号还没有账本，都只影响「下次能不能免登」，不影响本次登录。
  }
}

/**
 * 尝试免登。返回用户表示已拿到登录态；返回 null 表示不适用或需要回落密码登录。
 *
 * 永不抛错：免登是锦上添花，任何一步失败（飞书不可达、反代拦截、授权码过期）
 * 都必须安静地回到密码登录，绝不能把用户挡在登录页之外。
 */
export async function tryFeishuSilentLogin(): Promise<PublicUser | null> {
  if (!isFeishuClient()) return null;

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");

  if (code) {
    // 先把授权码从地址栏抹掉：它一次性且 5 分钟过期，留着只会在刷新时触发必然失败的重试。
    const redirectUri = stripOAuthParams(url);
    try {
      const result = await apiRequest<FeishuSilentLoginResult>(API_ENDPOINTS.feishuSilentLogin, {
        method: "POST",
        body: { code, redirectUri },
      });

      if (result.status === "authenticated") {
        setSessionToken(result.token);
        return result.user;
      }
      writeSession(BIND_TICKET_KEY, result.bindTicket);
    } catch {
      // 落到密码登录即可。
    }
    return null;
  }

  // 已经试过一次还回到这里，说明上一轮没换到登录态，再跳就是死循环。
  if (readSession(ATTEMPTED_KEY) === "1") return null;

  let config: FeishuLoginConfig;
  try {
    config = await apiRequest<FeishuLoginConfig>(API_ENDPOINTS.feishuLoginConfig);
  } catch {
    return null;
  }
  if (!config.enabled || !config.appId) return null;

  writeSession(ATTEMPTED_KEY, "1");
  window.location.replace(buildAuthorizeUrl(config.appId, currentRedirectUri()));
  // 页面正在跳走，这里永不 resolve，让调用方停在加载态而不是闪一下登录页。
  return new Promise<null>(() => {});
}

/**
 * 回调地址：只取 origin + pathname。
 * 换 token 时后端要原样带上它，两边必须由同一个函数算出来，因此不含 query/hash。
 */
function currentRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/** 抹掉授权回跳带来的 code/state，返回本次应当上报给后端的 redirect_uri。 */
function stripOAuthParams(url: URL): string {
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return `${url.origin}${url.pathname}`;
}

function buildAuthorizeUrl(appId: string, redirectUri: string): string {
  const authorize = new URL(FEISHU_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", appId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  return authorize.toString();
}
