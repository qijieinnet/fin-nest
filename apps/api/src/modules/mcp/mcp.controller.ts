import { All, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { errorLocaleFromHeader } from "@fin-nest/backend";
import type { Request, Response } from "express";
import { AgentTokenService } from "./agent-token.service";
import { McpToolsService } from "./mcp-tools.service";

/**
 * MCP 端点（Streamable HTTP，无状态）。经 web 的 /api 反代对外即 `https://<域名>/api/mcp`。
 *
 * 每个 POST 现建 server + transport：没有会话可恢复，也就不需要进程间共享状态（单实例假设之外
 * 也成立）；不开 SSE，响应一律 JSON，反代链路最简单。鉴权失败在进入 transport 之前抛 AppError，
 * 由全局 ApiExceptionFilter 回 401/403，MCP 客户端据此提示用户检查 token。
 */
@ApiExcludeController()
@Controller("mcp")
export class McpController {
  constructor(
    private readonly tokens: AgentTokenService,
    private readonly tools: McpToolsService,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const ctx = await this.tokens.authenticate(req);
    const server = this.tools.createServer(
      ctx,
      errorLocaleFromHeader(req.headers["accept-language"]),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  /** 无状态模式没有可订阅的 SSE 流，也没有可删除的会话。 */
  @All()
  @HttpCode(405)
  methodNotAllowed(@Res({ passthrough: true }) res: Response) {
    res.setHeader("Allow", "POST");
    return {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    };
  }
}
