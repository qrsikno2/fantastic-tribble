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

test("后续页使用经过校验的 p 参数，第一页保持原有地址", () => {
  assert.equal(buildArticleUrl("Talking", "6454538", 1), "https://bbs.byr.cn/article/Talking/6454538");
  assert.equal(buildArticleUrl("Talking", "6454538", 2), "https://bbs.byr.cn/article/Talking/6454538?p=2");
  for (const page of [0, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildArticleUrl("Talking", "6454538", page), /page/);
  }
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
