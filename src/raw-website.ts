import { buildArticleUrl } from "./article-url.js";
import { fetchForumHtml } from "./forum-http.js";
import type { ForumPageReader } from "./forum-session.js";
import { validateThreadParams, type ThreadInput } from "./thread-params.js";

export type RawWebsiteInspection = {
  board: string;
  article_id: string;
  page: number;
  article_url: string;
  http_status: number;
  content_type: string;
  content: string;
  result: "OK" | "AUTH_REQUIRED" | "HTTP_ERROR";
};

// 原始网页接口只检查传输/登录状态，不要求正文符合帖子页面结构。
export async function inspectRawWebsite(
  input: ThreadInput,
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
  readPage?: ForumPageReader,
): Promise<RawWebsiteInspection> {
  const params = validateThreadParams(input);
  const article_url = buildArticleUrl(params.board, params.article_id, params.page);
  const response = await (readPage ? readPage(article_url) : fetchForumHtml(article_url, request, env));
  return {
    ...params,
    article_url,
    ...response,
    result: response.result === "UNPARSED_PAGE" ? "OK" : response.result,
  };
}
