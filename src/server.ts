import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { inspectArticle } from "./inspect-article.js";
import { inspectBoard } from "./inspect-board.js";
import { inspectBoardDirectory } from "./inspect-board-directory.js";
import { inspectBoardRss } from "./inspect-board-rss.js";
import { inspectRawWebsite } from "./raw-website.js";
import { isSectionId } from "./parse-board-directory.js";
import { createForumSession, type ForumSessionOptions } from "./forum-session.js";

const boardSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/).refine((value) => !/\s/.test(value));
const pageSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional();
const threadInputSchema = {
  board: boardSchema,
  article_id: z.string().regex(/^[1-9][0-9]*$/).refine((value) => !/\s/.test(value)),
  page: pageSchema,
};
const publicErrors = new Set([
  "AUTH_REQUIRED",
  "COOKIE_INVALID",
  "REQUEST_TIMEOUT",
  "RATE_LIMITED",
  "RESPONSE_TOO_LARGE",
  "DECODE_ERROR",
  "REQUEST_FAILED",
  "RSS_UNAVAILABLE",
  "SESSION_STORAGE_ERROR",
]);

function toolError(error: unknown) {
  const result = error instanceof Error && publicErrors.has(error.message)
    ? error.message
    : "REQUEST_FAILED";
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ result }) }],
    isError: true,
  };
}

export function createServer(
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
  options: ForumSessionOptions = {},
): McpServer {
  const readPage = createForumSession(request, env, options);
  const server = new McpServer({
    name: "fantastic-tribble",
    version: "0.1.0",
  });

  server.registerTool(
    "list_boards",
    {
      description: "列出北邮人论坛版面英文名、中文名、链接及所属分区。省略 section 时顺序读取全部分区目录；传入返回的分区编号字符串可只查询该分区。不读取帖子内容",
      inputSchema: {
        section: z.string().refine(isSectionId).optional().describe("可选分区编号字符串，例如 1；省略时列出全部版面"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const inspection = await inspectBoardDirectory(input, request, env, readPage);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(inspection) }],
          ...(inspection.result === "OK" ? {} : { isError: true }),
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_thread",
    {
      description: "读取北邮人论坛指定页的帖子结构：主题、楼主发言、热门回复和每一楼的回复。page 默认为 1，每次只请求一页；不返回原始 HTML",
      inputSchema: threadInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const inspection = await inspectArticle(input, request, env, readPage);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(inspection) }],
          ...(inspection.result === "OK" ? {} : { isError: true }),
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_raw_website",
    {
      description: "读取北邮人论坛指定帖子的原始网页 HTML，保留页面内容用于检查。board 和 article_id 必填，page 默认为 1；每次只请求一页，OK 仅表示网页获取成功",
      inputSchema: threadInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const inspection = await inspectRawWebsite(input, request, env, readPage);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(inspection) }],
          ...(inspection.result === "OK" ? {} : { isError: true }),
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_board_rss",
    {
      description: "通过单个版面的公开 RSS 获取帖子粗列表，无需账号、密码或 BYR_COOKIE，且不发送 Cookie。仅返回订阅中的标题、链接、作者和发布时间；无分页或总页数。iwhisper 版面不支持此接口（不区分大小写）",
      inputSchema: { board: boardSchema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const inspection = await inspectBoardRss(input, request);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(inspection) }],
          ...(inspection.result === "OK" ? {} : { isError: true }),
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_board_threads",
    {
      description: "读取北邮人论坛指定版面的帖子列表，同时返回版面信息、当前页 page 和总页数 total_pages。page 默认为 1；每次只请求一页，不遍历各页",
      inputSchema: { board: boardSchema, page: pageSchema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const inspection = await inspectBoard(input, request, env, readPage);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(inspection) }],
          ...(inspection.result === "OK" ? {} : { isError: true }),
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

export const server = createServer();
