import { readCookie } from "./cookie-config.js";
import { buildArticleUrl } from "./article-url.js";
import { validateThreadParams } from "./thread-params.js";
import type { ThreadInput } from "./thread-params.js";

export type ArticleInspection = {
  article_url: string;
  http_status: number;
  content_type: string;
  content: string;
  result: "AUTH_REQUIRED" | "UNRECOGNIZED_PAGE" | "HTTP_ERROR";
};

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

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

  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error("DECODE_ERROR");
  }
}

// request 和 env 可在测试中替换；正常调用只需传帖子参数。
export async function inspectArticle(
  input: ThreadInput,
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ArticleInspection> {
  const params = validateThreadParams(input);
  if (params.page !== 1) throw new Error("PAGE_NOT_SUPPORTED");
  const articleUrl = buildArticleUrl(params.board, params.article_id);
  const cookie = readCookie(env);
  const signal = AbortSignal.timeout(15_000);

  try {
    const response = await request(articleUrl, {
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
      return {
        article_url: articleUrl,
        http_status: response.status,
        content_type: contentType,
        result: "HTTP_ERROR",
        content: "",
      };
    }

    const html = await readHtml(response);
    // 仅识别目前已观察到的登录提示；其他页面不宣称读取成功。
    const loginRequired = html.includes("您未登录,请登录后继续操作");
    return {
      article_url: articleUrl,
      http_status: response.status,
      content_type: contentType,
      result: loginRequired ? "AUTH_REQUIRED" : "UNRECOGNIZED_PAGE",
      content: html,
    };
  } catch (error) {
    if (signal.aborted) throw new Error("REQUEST_TIMEOUT");
    if (error instanceof Error && ["RESPONSE_TOO_LARGE", "DECODE_ERROR"].includes(error.message)) {
      throw error;
    }
    // 不透传底层异常、响应正文或 Cookie 到输出。
    throw new Error("REQUEST_FAILED");
  }
}
