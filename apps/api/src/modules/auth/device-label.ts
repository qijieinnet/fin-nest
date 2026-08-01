/**
 * 从 User-Agent 粗略推断设备标签，仅供管理端展示登录设备。
 * 只做常见系统/浏览器的关键字匹配，不追求精确识别，识别不出时退回原始 UA 片段。
 */
export function deviceLabelFromUserAgent(userAgent: string | null | undefined): string {
  const ua = userAgent?.trim();
  if (!ua) return "未知设备";

  const os = matchOs(ua);
  const browser = matchBrowser(ua);
  if (os && browser) return `${os} · ${browser}`;
  if (os) return os;
  if (browser) return browser;
  // 完全认不出时给出 UA 前缀，至少能人工分辨是不是同一个客户端。
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}

function matchOs(ua: string): string | null {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  // iPadOS 桌面模式的 UA 与 macOS 一致，无法区分，统一算 Mac。
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Linux/i.test(ua)) return "Linux";
  return null;
}

function matchBrowser(ua: string): string | null {
  // 顺序敏感：套壳浏览器的 UA 里同样带 Chrome/Safari 关键字，必须先匹配更具体的。
  if (/MicroMessenger/i.test(ua)) return "微信";
  if (/Lark|Feishu/i.test(ua)) return "飞书";
  if (/Edg[A-Z]?\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Firefox\/|FxiOS\//i.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return null;
}
