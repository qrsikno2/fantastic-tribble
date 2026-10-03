import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { inspectArticle } from "./inspect-article.js";
import { validateThreadParams } from "./thread-params.js";

export const server = new McpServer({
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
    const result = await inspectArticle(params);

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
);
