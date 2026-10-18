import { readCookie } from "./cookie-config.js";

export type ForumHtmlResponse = {
  http_status: number;
  content_type: string;
  content: string;
  result: "AUTH_REQUIRED" | "UNPARSED_PAGE" | "HTTP_ERROR";
};

const FORUM_ORIGIN = "https://bbs.byr.cn";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// 实测限流正文“请勿频繁登录”为 GBK，但响应可能错误声明 UTF-8。
const LOGIN_RATE_LIMIT_GBK = Buffer.from("c7ebcef0c6b5b7b1b5c7c2bc", "hex");

// 只接受固定站点；必须在接触 Cookie 之前验证目标地址。
function validateForumUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL_INVALID");
  }
  if (url.origin !== FORUM_ORIGIN || url.username !== "" || url.password !== "") {
    throw new Error("URL_INVALID");
  }
}

// 登录提示必须是页面的提示正文，帖子中引用相同文字不代表登录失效。
export function isForumLoginRequired(html: string): boolean {
  const visibleHtml = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  if (
    /<article\b/i.test(visibleHtml) ||
    /\bclass\s*=\s*["'][^"']*\ba-content\b/i.test(visibleHtml) ||
    /<a\b[^>]*\bhref\s*=\s*["'](?:https:\/\/bbs\.byr\.cn)?\/article\//i.test(visibleHtml)
  ) {
    return false;
  }
  const visibleText = visibleHtml
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&#(?:44|65292);|&#x(?:2c|ff0c);/gi, ",")
    .replace(/\s+/g, "")
    .trim();
  return /^您未登录[,，]请登录后继续操作[。.!！]?$/.test(visibleText);
}

// 分块读取，避免先把一个无限大的响应全部放进内存。
async function readHtml(response: Response): Promise<string> {
  if (response.body === null) return "";

  const contentType = response.headers.get("content-type") ?? "";
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType);
  const encoding = charset === null ? "gbk" : charset[1];
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // 仅识别已确认的整条错误消息；普通页面仍严格按声明编码解码。
  if (bytes.length === LOGIN_RATE_LIMIT_GBK.length &&
    bytes.every((byte, index) => byte === LOGIN_RATE_LIMIT_GBK[index])) {
    throw new Error("RATE_LIMITED");
  }
  let html: string;
  try {
    html = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error("DECODE_ERROR");
  }
  if (html.trim() === "请勿频繁登录") throw new Error("RATE_LIMITED");
  return html;
}

// request 和 env 可替换，便于离线测试，不需要真实凭据。
export async function fetchForumHtml(
  url: string,
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ForumHtmlResponse> {
  validateForumUrl(url);
  const cookie = readCookie(env);
  const signal = AbortSignal.timeout(15_000);

  try {
    const response = await request(url, {
      method: "GET",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "text/html",
        Cookie: cookie,
      },
      credentials: "omit",
      redirect: "error",
      signal,
    });

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new Error("RATE_LIMITED");
      return {
        http_status: response.status,
        content_type: contentType,
        result: "HTTP_ERROR",
        content: "",
      };
    }

    const html = await readHtml(response);
    return {
      http_status: response.status,
      content_type: contentType,
      result: isForumLoginRequired(html) ? "AUTH_REQUIRED" : "UNPARSED_PAGE",
      content: html,
    };
  } catch (error) {
    if (signal.aborted) throw new Error("REQUEST_TIMEOUT");
    if (error instanceof Error && ["RESPONSE_TOO_LARGE", "DECODE_ERROR", "RATE_LIMITED"].includes(error.message)) {
      throw error;
    }
    // 不透传底层异常、响应正文或 Cookie 到输出。
    throw new Error("REQUEST_FAILED");
  }
}
