import assert from "node:assert/strict";
import test from "node:test";
import { buildBoardRssUrl, validateBoardRssParams } from "../dist/board-rss-params.js";
import { fetchForumRss } from "../dist/forum-http.js";
import { inspectBoardRss } from "../dist/inspect-board-rss.js";

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>中文</title><description>Board feed</description>
<link>https://bbs.byr.cn/board/Health</link><lastBuildDate>Mon, 19 Oct 2026 12:00:00 GMT</lastBuildDate>
<item><title>Example &amp; question</title><link>https://bbs.byr.cn/article/Health/123</link>
<author>Demo</author><pubDate>Mon, 19 Oct 2026 11:00:00 GMT</pubDate>
<description><![CDATA[private body <b>not a list field</b>]]></description></item></channel></rss>`;
const rssResponse = (body = rss) => new Response(body, { headers: { "content-type": "text/xml; charset=utf-8" } });

test("RSS 构造固定地址，并在发请求前排除 iwhisper 的所有大小写", async () => {
  const input = Object.freeze({ board: "Board_1-test" });
  assert.deepEqual(validateBoardRssParams(input), input);
  assert.equal(buildBoardRssUrl(input), "https://bbs.byr.cn/rss/board-Board_1-test");
  let calls = 0;
  const request = async () => { calls++; return rssResponse(); };
  for (const board of ["iwhisper", "IWhisper", "IWHISPER", "iWhIsPeR"]) {
    await assert.rejects(inspectBoardRss({ board }, request), { message: "RSS_UNAVAILABLE" });
  }
  for (const invalid of [null, [], "Health", {}, { board: "../Health" },
    { board: "https://example.com" }, { board: "Health?x=1" }, { board: "Health\n" },
    { board: "Health/Other" }, { board: "%49Whisper" }]) {
    await assert.rejects(inspectBoardRss(invalid, request));
  }
  assert.equal(calls, 0);
});

test("RSS 请求只取一次公开 feed，不带认证、不跟随跳转，也不回传正文或会话", async () => {
  let calls = 0;
  const result = await inspectBoardRss({ board: "health" }, async (url, options) => {
    calls++;
    assert.equal(url, "https://bbs.byr.cn/rss/board-health");
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    const headers = new Headers(options.headers);
    assert.equal(headers.has("Cookie"), false);
    assert.equal(headers.has("Authorization"), false);
    assert.match(headers.get("Accept"), /xml/);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(rss, { headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "set-cookie": "session=private-session",
    } });
  });
  assert.deepEqual(result, {
    board: "health", board_url: "https://bbs.byr.cn/board/health",
    rss_url: "https://bbs.byr.cn/rss/board-health", http_status: 200,
    content_type: "application/rss+xml; charset=utf-8", result: "OK",
    feed_title: "中文", last_build_date: "Mon, 19 Oct 2026 12:00:00 GMT",
    threads: [{
      article_id: "123", article_url: "https://bbs.byr.cn/article/Health/123",
      title: "Example & question", author: "Demo", published_at: "Mon, 19 Oct 2026 11:00:00 GMT",
    }],
  });
  assert.equal(/private body|private-session/.test(JSON.stringify(result)), false);
  assert.equal(calls, 1);
});

test("RSS 解码支持实测 GBK HTTP 头、XML gb2312 声明和 XML 默认 UTF-8", async () => {
  const gbk = (xml) => {
    const [before, after] = xml.split("中文");
    return Buffer.concat([Buffer.from(before), Buffer.from("d6d0cec4", "hex"), Buffer.from(after)]);
  };
  for (const [body, type] of [
    [gbk(rss.replace('encoding="UTF-8"', 'encoding="gb2312"')), "text/xml; charset=GBK"],
    [gbk(rss.replace('encoding="UTF-8"', 'encoding="gb2312"')), "text/xml"],
    [gbk(rss), "text/xml; charset=GBK"], // HTTP charset 优先。
    [rss, "application/rss+xml"],
    [rss.replace(' encoding="UTF-8"', ""), "application/xml"],
    ["\ufeff" + rss, "text/xml"],
    [Buffer.from("\ufeff" + rss.replace("UTF-8", "UTF-16"), "utf16le"), "text/xml"],
  ]) {
    const result = await inspectBoardRss({ board: "Health" }, async () => new Response(body, {
      headers: { "content-type": type },
    }));
    assert.equal(result.result, "OK", type);
    assert.equal(result.feed_title, "中文", type);
  }
});

test("RSS 错误页不会伪装成空版面或泄露响应内容", async () => {
  for (const [body, status, expected] of [
    ["private forbidden", 403, "HTTP_ERROR"],
    ["<p>您未登录，请登录后继续操作</p>", 200, "AUTH_REQUIRED"],
    ["<html><body>private maintenance</body></html>", 200, "UNPARSED_PAGE"],
    [rss.slice(0, -6), 200, "UNPARSED_PAGE"],
    [rss.replace("/article/Health/123", "/article/Other/123"), 200, "UNPARSED_PAGE"],
  ]) {
    const result = await inspectBoardRss({ board: "Health" }, async () => new Response(body, {
      status, headers: { "content-type": "text/xml; charset=utf-8" },
    }));
    assert.equal(result.result, expected);
    assert.equal(result.http_status, status);
    assert.equal(result.feed_title, null);
    assert.equal(result.last_build_date, null);
    assert.deepEqual(result.threads, []);
    assert.equal(Object.hasOwn(result, "content"), false);
    assert.equal(JSON.stringify(result).includes(body), false);
  }
});

test("公开 RSS 传输也限制站点和路径，拒绝请求注入", async () => {
  let calls = 0;
  for (const url of [
    "https://example.com/rss/board-Health", "http://bbs.byr.cn/rss/board-Health",
    "https://user:pass@bbs.byr.cn/rss/board-Health", "https://bbs.byr.cn/board/Health",
    "https://bbs.byr.cn/rss/board-Health?x=1", "https://bbs.byr.cn/rss/board-Health#fragment",
    "https://bbs.byr.cn/rss/board-Health/Other", "https://bbs.byr.cn/rss/board-%49Whisper",
  ]) {
    await assert.rejects(fetchForumRss(url, async () => { calls++; }), { message: "URL_INVALID" });
  }
  assert.equal(calls, 0);
});

test("RSS 继续使用传输的大小上限、限流、解码和安全网络错误", async () => {
  let cancelled = false;
  const oversized = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  for (const [request, expected] of [
    [async () => rssResponse(oversized), "RESPONSE_TOO_LARGE"],
    [async () => new Response("too many requests", { status: 429 }), "RATE_LIMITED"],
    [async () => rssResponse(Buffer.from("c7ebcef0c6b5b7b1b5c7c2bc", "hex")), "RATE_LIMITED"],
    [async () => rssResponse(Buffer.from([0xff])), "DECODE_ERROR"],
    [async () => { throw new Error("private diagnostic"); }, "REQUEST_FAILED"],
  ]) {
    let calls = 0;
    await assert.rejects(inspectBoardRss({ board: "Health" }, (...args) => {
      calls++;
      return request(...args);
    }), { message: expected });
    assert.equal(calls, 1);
  }
  assert.equal(cancelled, true);
});

test("RSS 超时保持 15 秒并归一成 REQUEST_TIMEOUT", async (t) => {
  t.mock.method(AbortSignal, "timeout", (ms) => {
    assert.equal(ms, 15_000);
    return AbortSignal.abort(new DOMException("expired", "TimeoutError"));
  });
  await assert.rejects(inspectBoardRss({ board: "Health" }, async (_url, options) => {
    options.signal.throwIfAborted();
  }), { message: "REQUEST_TIMEOUT" });
});
