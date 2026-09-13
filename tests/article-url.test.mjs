import assert from "node:assert/strict";
import test from "node:test";
import { buildArticleUrl } from "../dist/article-url.js";

test("生成固定站点的文章地址", () => {
  const result = buildArticleUrl("Talking", "6454538");
  assert.equal(result, "https://bbs.byr.cn/article/Talking/6454538");
  const url = new URL(result);
  assert.equal(url.origin, "https://bbs.byr.cn");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
});

test("保留版面大小写及大整数文章 ID", () => {
  assert.equal(
    buildArticleUrl("Board_1-test", "90071992547409931234567890"),
    "https://bbs.byr.cn/article/Board_1-test/90071992547409931234567890",
  );
});

for (const board of [undefined, "https://example.com", "//example.com", "../Talking", "Talking?x=1", "Talking#x", "Talking\\Other", "%2e%2e"]) {
  test(`拒绝非法版面：${String(board)}`, () => {
    assert.throws(() => buildArticleUrl(board, "6454538"), /board/);
  });
}

for (const id of [undefined, 6454538, "0", "01", "1/2", "1?x=2", "1#x"]) {
  test(`拒绝非法文章 ID：${String(id)}`, () => {
    assert.throws(() => buildArticleUrl("Talking", id), /article_id/);
  });
}
