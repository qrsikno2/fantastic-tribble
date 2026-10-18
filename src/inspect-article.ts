import { buildArticleUrl } from "./article-url.js";
import { fetchForumHtml } from "./forum-http.js";
import { validateThreadParams } from "./thread-params.js";
import type { ThreadInput } from "./thread-params.js";

export type ArticleInspection = {
  article_url: string;
  http_status: number;
  content_type: string;
  content: string;
  result: "AUTH_REQUIRED" | "UNPARSED_PAGE" | "HTTP_ERROR";
};

// request 和 env 可在测试中替换；正常调用只需传帖子参数。
export async function inspectArticle(
  input: ThreadInput,
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ArticleInspection> {
  const params = validateThreadParams(input);
  if (params.page !== 1) throw new Error("PAGE_NOT_SUPPORTED");
  const articleUrl = buildArticleUrl(params.board, params.article_id);
  return { article_url: articleUrl, ...await fetchForumHtml(articleUrl, request, env) };
}
