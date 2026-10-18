import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { inspectArticle } from "./inspect-article.js";
import { inspectBoard } from "./inspect-board.js";
import { validateThreadParams } from "./thread-params.js";

const boardSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/).refine((value) => !/\s/.test(value));
const pageSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional();
const publicErrors = new Set([
  "AUTH_REQUIRED",
  "COOKIE_INVALID",
  "REQUEST_TIMEOUT",
  "RATE_LIMITED",
  "RESPONSE_TOO_LARGE",
  "DECODE_ERROR",
  "REQUEST_FAILED",
]);

export function createServer(
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): McpServer {
  const server = new McpServer({
    name: "fantastic-tribble",
    version: "0.1.0",
  });

  server.registerTool(
    "get_thread",
    {
      description: "读取北邮人论坛帖子第一页，返回页面状态和原始 HTML，尚不解析正文",
      inputSchema: {
        board: z.string(),
        article_id: z.string(),
        page: z.number().int().positive().optional(),
      },
    },
    async (input) => {
      const params = validateThreadParams(input);
      const result = await inspectArticle(params, request, env);

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );

  async function readBoard(input: { board: string; page?: number }, infoOnly: boolean) {
    try {
      const inspection = await inspectBoard(input, request, env);
      const { threads, ...metadata } = inspection;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(infoOnly ? metadata : inspection) }],
        ...(inspection.result === "OK" ? {} : { isError: true }),
      };
    } catch (error) {
      const result = error instanceof Error && publicErrors.has(error.message)
        ? error.message
        : "REQUEST_FAILED";
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ result }) }],
        isError: true,
      };
    }
  }

  server.registerTool(
    "get_board_info",
    {
      description: "查询北邮人论坛版面（分组）及当前账号可见的总页数；只请求第一页，不遍历各页",
      inputSchema: { board: boardSchema },
    },
    async ({ board }) => readBoard({ board, page: 1 }, true),
  );

  server.registerTool(
    "get_board_threads",
    {
      description: "读取北邮人论坛指定版面的第 page 页帖子列表及总页数，page 默认为 1；每次只请求一页",
      inputSchema: { board: boardSchema, page: pageSchema },
    },
    async (input) => readBoard(input, false),
  );

  return server;
}

export const server = createServer();
