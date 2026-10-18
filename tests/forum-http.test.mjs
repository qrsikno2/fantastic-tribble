import assert from "node:assert/strict";
import test from "node:test";
import { fetchForumHtml, isForumLoginRequired } from "../dist/forum-http.js";

const fakeEnv = Object.freeze({ BYR_COOKIE: "session=fake" });

test("频率限制短消息即使错误标注 UTF-8 也返回 RATE_LIMITED，且不重试", async () => {
  const rateLimitGbk = Buffer.from("c7ebcef0c6b5b7b1b5c7c2bc", "hex");
  for (const response of [
    new Response(rateLimitGbk, { headers: { "content-type": "text/html; charset=UTF-8" } }),
    new Response(rateLimitGbk, { headers: { "content-type": "text/html; charset=GBK" } }),
    new Response("请勿频繁登录", { headers: { "content-type": "text/html; charset=utf-8" } }),
    new Response("Too Many Requests", { status: 429 }),
  ]) {
    let calls = 0;
    await assert.rejects(fetchForumHtml("https://bbs.byr.cn/board/Talking?p=2", async () => {
      calls++;
      return response;
    }, fakeEnv), { message: "RATE_LIMITED" });
    assert.equal(calls, 1);
  }
});

test("标题或文章提到限流提示时仍按普通内容处理", async () => {
  const html = '<a href="/article/Talking/123">请勿频繁登录</a>';
  const result = await fetchForumHtml("https://bbs.byr.cn/board/Talking?p=1", async () =>
    new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }), fakeEnv);
  assert.equal(result.result, "UNPARSED_PAGE");
  assert.equal(result.content, html);
});

test("公共传输拒绝跨站地址和 URL 凭据，并且不读取 Cookie", async () => {
  let calls = 0;
  const env = {
    get BYR_COOKIE() { throw new Error("Cookie must not be accessed"); },
  };
  const request = async () => { calls++; throw new Error("request must not be called"); };
  for (const url of [
    "https://example.com/board/Talking",
    "http://bbs.byr.cn/board/Talking",
    "https://bbs.byr.cn:444/board/Talking",
    "https://bbs.byr.cn.example.com/board/Talking",
    "https://bbs.byr.cn@evil.example/board/Talking",
    "https://user@bbs.byr.cn/board/Talking",
    "https://user:password@bbs.byr.cn/board/Talking",
    "/board/Talking",
    "not a URL",
  ]) {
    await assert.rejects(fetchForumHtml(url, request, env), { message: "URL_INVALID" });
  }
  assert.equal(calls, 0);
});

test("公共传输支持固定站点的版面分页 URL，并保留已解码 HTML", async () => {
  const url = "https://bbs.byr.cn/board/Talking?p=3";
  const html = "<p>中文帖子列表</p>";
  const result = await fetchForumHtml(url, async (target, options) => {
    assert.equal(target, url);
    assert.equal(new Headers(options.headers).get("Cookie"), fakeEnv.BYR_COOKIE);
    assert.equal(options.redirect, "error");
    return new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } });
  }, fakeEnv);
  assert.deepEqual(result, {
    http_status: 200,
    content_type: "text/html;charset=utf-8",
    content: html,
    result: "UNPARSED_PAGE",
  });
});

test("登录提示支持全角逗号、内联标签、HTML 实体及句末标点", () => {
  for (const html of [
    "您未登录,请登录后继续操作",
    "<p>您未登录，请<a href='/user/login'>登录</a>后继续操作。</p>",
    "<html><head><title>论坛提示</title></head><body><div>您未登录&#xff0c;请登录后继续操作！</div></body></html>",
    "<!-- hidden --><script>unrelated()</script><p>您未登录&#65292;&nbsp;请登录后继续操作</p>",
  ]) {
    assert.equal(isForumLoginRequired(html), true);
  }
});

test("帖子正文、标题、脚本或注释提到登录提示时不误判", () => {
  for (const html of [
    "<div class='a-content'>您未登录,请登录后继续操作</div>",
    "<article>您未登录,请登录后继续操作</article>",
    "<a href='/article/Talking/123'>您未登录，请登录后继续操作</a>",
    "<h1>登录问题</h1><div class='a-content'>您未登录,请登录后继续操作</div><p>作者 demo</p>",
    "<table><tr><td>123</td><td><a href='/article/Talking/123'>您未登录，请登录后继续操作</a></td><td>demo</td></tr></table>",
    "<script>const message = '您未登录,请登录后继续操作';</script><p>正常内容</p>",
    "<!-- 您未登录,请登录后继续操作 --><p>正常内容</p>",
    "<html><head><title>您未登录,请登录后继续操作</title></head><body>正常内容</body></html>",
  ]) {
    assert.equal(isForumLoginRequired(html), false);
  }
});
