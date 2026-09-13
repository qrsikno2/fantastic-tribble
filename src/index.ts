import { buildArticleUrl } from "./article-url.js";
import { validateThreadParams } from "./thread-params.js";

// 固定样例：只校验参数、生成地址，不发网络请求。
const params_example = validateThreadParams({
  board: "Talking",
  article_id: "6454538",
});

const articleUrl = buildArticleUrl(params_example.board, params_example.article_id);

console.error(JSON.stringify({
  board: params_example.board,
  article_id: params_example.article_id,
  page: params_example.page,
  article_url: articleUrl,
}, null, 2));
