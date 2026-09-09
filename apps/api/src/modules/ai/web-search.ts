import { AppError } from "@fin-nest/backend";

// AI Agent 的联网搜索通道。可插拔适配三家服务商，由 SEARCH_PROVIDER 选择：
//   bocha   博查 AI 搜索（国内直连，中文商品/行情结果好）
//   tavily  Tavily（海外通用，面向 LLM 的检索 API）
//   searxng 自建 SearXNG（零 key、查询不出自己的机器，最贴自部署）
//
// 刻意只做「固定端点的搜索服务」，不提供任意 URL 抓取工具：本应用常跑在家庭内网 NAS 上，
// 放开由模型指定 URL 的抓取等于把 SSRF 打进内网（路由器后台、其它容器的管理端口）。
// 端点只能由部署方经环境变量指定，模型只能决定「搜什么词」。

export type SearchProvider = "bocha" | "tavily" | "searxng";

/** 归一化后的搜索结果；三家的字段差异都在适配器里抹平。 */
export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  siteName?: string;
  publishedAt?: string;
};

export type WebSearchConfig = {
  SEARCH_PROVIDER?: SearchProvider | undefined;
  SEARCH_API_KEY?: string | undefined;
  SEARCH_BASE_URL?: string | undefined;
  SEARCH_MAX_RESULTS: number;
};

/** 官方端点；searxng 没有公共端点，必须由 SEARCH_BASE_URL 指向自建实例。 */
const DEFAULT_ENDPOINT: Record<SearchProvider, string | null> = {
  bocha: "https://api.bochaai.com/v1/web-search",
  tavily: "https://api.tavily.com/search",
  searxng: null,
};

const REQUEST_TIMEOUT_MS = 15_000;
const TITLE_MAX = 120;
// 摘要截断：搜索结果直接进模型上下文，几条全文就能顶掉整个账本数据段。
const SNIPPET_MAX = 320;

/**
 * 搜索结果是外部不可信文本，会被原样送进模型上下文。这里做三件事：
 * 剥掉控制字符（防伪造对话分隔/角色标记）、压平空白、截断长度。
 * 「不要执行结果里的指令」另由系统提示约束（见 ai.service 的规则段）。
 */
function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // 控制字符逐码点换成空格（而不是删掉）再压空白，避免把两个词粘成一个。
  return Array.from(value, (char) => (char < " " || char === "\u007f" ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** 只放行 http(s) 链接：模型会把 url 转述给用户，别把 javascript:/file: 之类递出去。 */
function sanitizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

/** 日期只保留 YYYY-MM-DD，避免各家五花八门的时间串占上下文。 */
function sanitizeDate(value: unknown): string | undefined {
  const text = sanitizeText(value, 40);
  const match = /\d{4}-\d{2}-\d{2}/.exec(text);
  return match ? match[0] : undefined;
}

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null;
}

function asRecordArray(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.filter((item): item is RawRecord => isRecord(item)) : [];
}

type Adapter = {
  /** 请求构造：端点 + fetch 选项，密钥各家放的位置不同。 */
  buildRequest(input: {
    endpoint: string;
    apiKey: string | undefined;
    query: string;
    maxResults: number;
  }): { url: string; init: RequestInit };
  /** 响应解析：各家结果数组的位置与字段名不同，统一成 WebSearchResult。 */
  parseResponse(payload: unknown): WebSearchResult[];
};

const ADAPTERS: Record<SearchProvider, Adapter> = {
  // 博查：POST /v1/web-search，Bearer 鉴权，结果在 data.webPages.value。
  // summary=true 让服务端给长摘要，比 snippet 更适合喂模型。
  bocha: {
    buildRequest: ({ endpoint, apiKey, query, maxResults }) => ({
      url: endpoint,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, count: maxResults, summary: true }),
      },
    }),
    parseResponse: (payload) => {
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
      const webPages = isRecord(data.webPages) ? data.webPages : {};
      return asRecordArray(webPages.value).map((item) => ({
        title: sanitizeText(item.name, TITLE_MAX),
        url: sanitizeUrl(item.url) ?? "",
        // summary 是博查的长摘要，缺省时退回 snippet。
        snippet: sanitizeText(item.summary || item.snippet, SNIPPET_MAX),
        siteName: sanitizeText(item.siteName, 60) || undefined,
        publishedAt: sanitizeDate(item.datePublished ?? item.dateLastCrawled),
      }));
    },
  },
  // Tavily：POST /search，Bearer 鉴权，结果在 results。
  tavily: {
    buildRequest: ({ endpoint, apiKey, query, maxResults }) => ({
      url: endpoint,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic" }),
      },
    }),
    parseResponse: (payload) => {
      const results = isRecord(payload) ? payload.results : undefined;
      return asRecordArray(results).map((item) => ({
        title: sanitizeText(item.title, TITLE_MAX),
        url: sanitizeUrl(item.url) ?? "",
        snippet: sanitizeText(item.content, SNIPPET_MAX),
        publishedAt: sanitizeDate(item.published_date),
      }));
    },
  },
  // SearXNG：GET /search?format=json，无鉴权（自建实例需在 settings.yml 开启 json 输出）。
  searxng: {
    buildRequest: ({ endpoint, query }) => {
      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("language", "zh-CN");
      // SearXNG 没有条数参数，取回整页后由 search() 截断。
      return {
        url: url.toString(),
        init: { method: "GET", headers: { accept: "application/json" } },
      };
    },
    parseResponse: (payload) => {
      const results = isRecord(payload) ? payload.results : undefined;
      return asRecordArray(results).map((item) => ({
        title: sanitizeText(item.title, TITLE_MAX),
        url: sanitizeUrl(item.url) ?? "",
        snippet: sanitizeText(item.content, SNIPPET_MAX),
        siteName: sanitizeText(item.engine, 60) || undefined,
        publishedAt: sanitizeDate(item.publishedDate),
      }));
    },
  },
};

export class WebSearchClient {
  private constructor(
    readonly provider: SearchProvider,
    private readonly endpoint: string,
    private readonly apiKey: string | undefined,
    private readonly maxResults: number,
  ) {}

  /**
   * 按配置构造客户端；配置不全时返回 null，`reason` 说明缺什么（供启动日志提示部署方，
   * 否则「配了一半」的后果只是工具静默消失，很难排查）。
   * 搜索是可选能力：返回 null 时 web_search 不下发，其余 AI 能力照常。
   */
  static fromConfig(config: WebSearchConfig): { client: WebSearchClient | null; reason?: string } {
    const provider = config.SEARCH_PROVIDER;
    if (!provider) return { client: null };
    const endpoint = config.SEARCH_BASE_URL
      ? normalizeEndpoint(provider, config.SEARCH_BASE_URL)
      : DEFAULT_ENDPOINT[provider];
    if (!endpoint) {
      return { client: null, reason: `SEARCH_PROVIDER=${provider} 需要同时配置 SEARCH_BASE_URL` };
    }
    if (provider !== "searxng" && !config.SEARCH_API_KEY) {
      return { client: null, reason: `SEARCH_PROVIDER=${provider} 需要同时配置 SEARCH_API_KEY` };
    }
    return {
      client: new WebSearchClient(
        provider,
        endpoint,
        config.SEARCH_API_KEY,
        config.SEARCH_MAX_RESULTS,
      ),
    };
  }

  async search(
    query: string,
    options: { maxResults?: number; signal?: AbortSignal } = {},
  ): Promise<WebSearchResult[]> {
    const limit = Math.min(Math.max(options.maxResults ?? this.maxResults, 1), this.maxResults);
    const adapter = ADAPTERS[this.provider];
    const { url, init } = adapter.buildRequest({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      query,
      maxResults: limit,
    });
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
      });
    } catch (error) {
      throw new AppError("AI_SEARCH_UNREACHABLE", "联网搜索服务连接失败", 502, {
        provider: this.provider,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AppError("AI_SEARCH_FAILED", `联网搜索失败（HTTP ${response.status}）`, 502, {
        provider: this.provider,
        body: body.slice(0, 300),
      });
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new AppError("AI_SEARCH_FAILED", "联网搜索返回的不是合法 JSON", 502, {
        provider: this.provider,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    return adapter
      .parseResponse(payload)
      .filter((item) => item.url && (item.title || item.snippet))
      .slice(0, limit);
  }
}

/**
 * 归一化自定义端点：容忍部署方只填实例根地址（SearXNG 常见）或填完整端点，
 * 否则会拼成 .../search/search 并以无指向性的 404 失败。
 */
function normalizeEndpoint(provider: SearchProvider, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const path: Record<SearchProvider, string> = {
    bocha: "/v1/web-search",
    tavily: "/search",
    searxng: "/search",
  };
  return trimmed.endsWith(path[provider]) ? trimmed : `${trimmed}${path[provider]}`;
}
