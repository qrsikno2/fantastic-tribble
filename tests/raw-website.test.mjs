import assert from "node:assert/strict";
import test from "node:test";
import { inspectRawWebsite } from "../dist/raw-website.js";

const fakeEnv = { BYR_COOKIE: "session=fake-test-cookie" };
const input = { board: "Talking", article_id: "100001" };

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

test("raw website returns decoded HTML unchanged, including unrecognized and empty pages", async () => {
  for (const html of ["<!doctype html>\n<html><body>正文 &amp; <b>bold</b></body></html>\n", "", "unknown page"]) {
    let calls = 0;
    const result = await inspectRawWebsite(input, async (url, options) => {
      calls += 1;
      assert.equal(url, "https://bbs.byr.cn/article/Talking/100001");
      assert.equal(new Headers(options.headers).get("Cookie"), fakeEnv.BYR_COOKIE);
      assert.equal(options.redirect, "error");
      return htmlResponse(html);
    }, fakeEnv);
    assert.deepEqual(result, {
      ...input,
      page: 1,
      article_url: "https://bbs.byr.cn/article/Talking/100001",
      http_status: 200,
      content_type: "text/html; charset=utf-8",
      content: html,
      result: "OK",
    });
    assert.equal(calls, 1);
  }
});

test("raw website supports a single requested page without following pagination", async () => {
  let calls = 0;
  const result = await inspectRawWebsite({ ...input, page: 4 }, async (url) => {
    calls += 1;
    assert.equal(url, "https://bbs.byr.cn/article/Talking/100001?p=4");
    return htmlResponse('<a href="?p=5">下一页</a>');
  }, fakeEnv);
  assert.equal(result.page, 4);
  assert.equal(result.article_url, "https://bbs.byr.cn/article/Talking/100001?p=4");
  assert.equal(result.result, "OK");
  assert.equal(calls, 1);
});

test("raw website preserves GBK-decoded login HTML and reports authentication failure", async () => {
  const result = await inspectRawWebsite(input, async () => new Response(
    Buffer.from("c4faceb4b5c7c2bc2cc7ebb5c7c2bcbaf3bcccd0f8b2d9d7f7", "hex"),
    { headers: { "content-type": "text/html;charset=GBK", "set-cookie": "private=fake" } },
  ), fakeEnv);
  assert.equal(result.result, "AUTH_REQUIRED");
  assert.equal(result.content, "您未登录,请登录后继续操作");
  assert.equal(JSON.stringify(result).includes("private=fake"), false);
});

test("raw website does not read or return an unsuccessful HTTP response body", async () => {
  let cancelled = false;
  const result = await inspectRawWebsite(input, async () => htmlResponse(new ReadableStream({
    cancel() { cancelled = true; },
  }), 503), fakeEnv);
  assert.equal(result.result, "HTTP_ERROR");
  assert.equal(result.http_status, 503);
  assert.equal(result.content, "");
  assert.equal(cancelled, true);
});

test("raw website validates target and authentication before fetching", async () => {
  let calls = 0;
  const request = async () => { calls += 1; return htmlResponse(""); };
  for (const params of [
    { ...input, board: "https://example.com" },
    { ...input, article_id: "../100001" },
    { ...input, article_id: "01" },
    { ...input, page: 0 },
    { ...input, page: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    await assert.rejects(inspectRawWebsite(params, request, fakeEnv));
  }
  await assert.rejects(inspectRawWebsite(input, request, {}), { message: "AUTH_REQUIRED" });
  await assert.rejects(inspectRawWebsite(input, request, { BYR_COOKIE: "fake\r\nheader" }), { message: "COOKIE_INVALID" });
  assert.equal(calls, 0);
});

test("raw website normalizes request exceptions without disclosing credentials", async () => {
  let calls = 0;
  await assert.rejects(inspectRawWebsite(input, async () => {
    calls += 1;
    throw new Error(`private request: ${fakeEnv.BYR_COOKIE}`);
  }, fakeEnv), { message: "REQUEST_FAILED" });
  assert.equal(calls, 1);
});
