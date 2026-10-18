import { validateThreadParams } from "./thread-params.js";

const FORUM_ORIGIN = "https://bbs.byr.cn";

// 第一页保持原有地址；后续页面使用论坛的 p 参数，不发送请求。
export function buildArticleUrl(board: string, article_id: string, page = 1): string {
  const params = validateThreadParams({ board, article_id, page });
  const boardPath = encodeURIComponent(params.board);
  const articlePath = encodeURIComponent(params.article_id);

  return `${FORUM_ORIGIN}/article/${boardPath}/${articlePath}${params.page === 1 ? "" : `?p=${params.page}`}`;
}
