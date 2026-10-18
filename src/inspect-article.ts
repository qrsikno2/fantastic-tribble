import { buildArticleUrl } from "./article-url.js";
import { fetchForumHtml } from "./forum-http.js";
import { parseThreadPage, type Thread } from "./parse-thread.js";
import { validateThreadParams } from "./thread-params.js";
import type { ThreadInput } from "./thread-params.js";

export type ArticleInspection = {
  board: string;
  article_id: string;
  page: number;
  article_url: string;
  http_status: number;
  content_type: string;
  total_pages: number | null;
  thread: Thread | null;
  result: "OK" | "AUTH_REQUIRED" | "UNPARSED_PAGE" | "HTTP_ERROR" | "PAGE_OUT_OF_RANGE";
};

// request 和 env 可在测试中替换；正常调用只需传帖子参数。
export async function inspectArticle(
  input: ThreadInput,
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ArticleInspection> {
  const params = validateThreadParams(input);
  const article_url = buildArticleUrl(params.board, params.article_id, params.page);
  const response = await fetchForumHtml(article_url, request, env);
  const base: ArticleInspection = {
    ...params, article_url, http_status: response.http_status, content_type: response.content_type,
    result: response.result, total_pages: null, thread: null,
  };
  if (response.result !== "UNPARSED_PAGE") return base;
  try {
    const parsed = parseThreadPage(response.content, params.board, params.article_id);
    if (params.page > parsed.total_pages) {
      return { ...base, result: "PAGE_OUT_OF_RANGE", total_pages: parsed.total_pages };
    }
    if (parsed.page !== params.page) return base;
    return { ...base, ...parsed, result: "OK" };
  } catch {
    // 未识别页面不返回部分帖子，也不把 HTML 带回结构化接口。
    return base;
  }
}
