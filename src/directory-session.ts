import { createForumSession } from "./forum-session.js";

// 单独调用目录读取时保留临时会话；MCP 服务注入跨工具共享的持久会话。
export function createDirectorySession(request: typeof fetch, env: NodeJS.ProcessEnv) {
  return createForumSession(request, env, { cookieFile: null });
}
