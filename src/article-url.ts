import { validateThreadParams } from "./thread-params.js";

const FORUM_ORIGIN = "https://bbs.byr.cn";

// 只生成文章地址，不包含分页参数，也不发送请求。
export function buildArticleUrl(board: string, article_id: string): string {
  const params = validateThreadParams({ board, article_id });
  const boardPath = encodeURIComponent(params.board);
  const articlePath = encodeURIComponent(params.article_id);

  return `${FORUM_ORIGIN}/article/${boardPath}/${articlePath}`;
}
