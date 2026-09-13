import { buildArticleUrl } from "./article-url.js";
import { inspectArticle } from "./inspect-article.js";
import { validateThreadParams } from "./thread-params.js";

// 固定样例：只校验参数、生成地址，不发网络请求。
const params_example = validateThreadParams({
  board: "Talking",
  article_id: "6454538",
});

const articleUrl = buildArticleUrl(params_example.board, params_example.article_id);

try {
  const articleContent = await inspectArticle(params_example);
  console.error(JSON.stringify(articleContent, null, 4));
} catch (error) {
  console.error(JSON.stringify({
    result: "REQUEST_FAILED",
    reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
  }, null, 2));

  process.exitCode = 1;
}
