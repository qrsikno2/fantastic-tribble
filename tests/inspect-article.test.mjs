import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { inspectArticle as inspectWithEnvironment } from "../dist/inspect-article.js";

const fakeEnv = Object.freeze({ BYR_COOKIE: "nforum[UTMPUSERID]=demo; session=fake==" });

function inspectArticle(input, request) {
  return inspectWithEnvironment(input, request, fakeEnv);
}

const input = { board: "Talking", article_id: "6454538", page: 1 };
const loginGbk = Buffer.from("c4faceb4b5c7c2bc2cc7ebb5c7c2bcbaf3bcccd0f8b2d9d7f7", "hex");

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html;charset=GBK" },
  });
}

test("Cookie 仅发送到固定站点；HTTP 200 登录页仍是登录失效", async () => {
  let calls = 0;
  const result = await inspectArticle(input, async (url, options) => {
    calls++;
    assert.equal(url, "https://bbs.byr.cn/article/Talking/6454538");
    assert.equal(options.method, "GET");
    const headers = new Headers(options.headers);
    assert.equal(headers.get("X-Requested-With"), "XMLHttpRequest");
    assert.equal(headers.get("Cookie"), fakeEnv.BYR_COOKIE);
    assert.equal(headers.has("Authorization"), false);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    return htmlResponse(loginGbk);
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    article_url: "https://bbs.byr.cn/article/Talking/6454538",
    http_status: 200,
    content_type: "text/html;charset=GBK",
    result: "AUTH_REQUIRED",
  });
  assert.equal(JSON.stringify(result).includes("您未登录"), false);
});

test("支持响应声明的 UTF-8，丢弃 Set-Cookie，不回传原始 HTML", async () => {
  const result = await inspectArticle(input, async () => new Response(
    "<p>您未登录,请登录后继续操作</p>",
    { headers: { "content-type": 'text/html; charset="utf-8"', "set-cookie": "secret=fake" } },
  ));
  assert.equal(result.result, "AUTH_REQUIRED");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("没有 charset 时按已观察到的站点 GBK 处理", async () => {
  const result = await inspectArticle(input, async () => new Response(loginGbk));
  assert.equal(result.result, "AUTH_REQUIRED");
});

test("非登录提示页面（含空页面）标记为尚未解析", async () => {
  for (const body of ["<html>Other page</html>", "", null]) {
    const result = await inspectArticle(input, async () => htmlResponse(body));
    assert.equal(result.result, "UNPARSED_PAGE");
  }
});

test("非 2xx 返回 HTTP_ERROR，停止读取正文", async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const result = await inspectArticle(input, async () => htmlResponse(body, 403));
  assert.equal(result.result, "HTTP_ERROR");
  assert.equal(result.http_status, 403);
  assert.equal(cancelled, true);
});

test("page>1 和非法参数在请求前拒绝", async () => {
  let calls = 0;
  const request = async () => { calls++; return htmlResponse(""); };
  await assert.rejects(inspectArticle({ ...input, page: 2 }, request), /PAGE_NOT_SUPPORTED/);
  await assert.rejects(inspectArticle({ ...input, board: "../Talking" }, request), /board/);
  assert.equal(calls, 0);
});

test("响应分块合计超过 2 MiB 时取消读取", async () => {
  let cancelled = false;
  let count = 0;
  const body = new ReadableStream({
    pull(controller) {
      count++;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(inspectArticle(input, async () => htmlResponse(body)), /RESPONSE_TOO_LARGE/);
  assert.equal(cancelled, true);
  assert.ok(count <= 4);
});

test("响应大小恰好等于上限仍可检查", async () => {
  const result = await inspectArticle(input, async () => htmlResponse(new Uint8Array(2 * 1024 * 1024)));
  assert.equal(result.result, "UNPARSED_PAGE");
});

test("网络或重定向错误不重试、不回显原始错误", async () => {
  let calls = 0;
  await assert.rejects(inspectArticle(input, async () => {
    calls++;
    throw new Error("private diagnostic");
  }), { message: "REQUEST_FAILED" });
  assert.equal(calls, 1);
});

test("流读取失败转为安全错误", async () => {
  const body = new ReadableStream({ start(controller) { controller.error(new Error("private stream error")); } });
  await assert.rejects(inspectArticle(input, async () => htmlResponse(body)), { message: "REQUEST_FAILED" });
});

test("超时信号设为 15 秒并产生独立错误，不实际等待", async (t) => {
  t.mock.method(AbortSignal, "timeout", (ms) => {
    assert.equal(ms, 15_000);
    return AbortSignal.abort(new DOMException("expired", "TimeoutError"));
  });
  await assert.rejects(inspectArticle(input, async (_url, options) => {
    options.signal.throwIfAborted();
    return htmlResponse("");
  }), { message: "REQUEST_TIMEOUT" });
});

test("无法识别的编码或损坏的编码字节单独报错", async () => {
  for (const response of [
    new Response("body", { headers: { "content-type": "text/html;charset=invalid-encoding" } }),
    new Response(new Uint8Array([255]), { headers: { "content-type": "text/html;charset=utf-8" } }),
  ]) {
    await assert.rejects(inspectArticle(input, async () => response), { message: "DECODE_ERROR" });
  }
});


test("Cookie 缺失或非法时不发送请求", async () => {
  let calls = 0;
  const request = async () => { calls++; return htmlResponse(""); };
  await assert.rejects(inspectWithEnvironment(input, request, {}), { message: "AUTH_REQUIRED" });
  await assert.rejects(inspectWithEnvironment(input, request, { BYR_COOKIE: "fake\r\nheader" }), { message: "COOKIE_INVALID" });
  assert.equal(calls, 0);
});

test("包含凭据的底层错误不会被原样抛给调用者", async () => {
  await assert.rejects(inspectArticle(input, async () => {
    throw new Error(fakeEnv.BYR_COOKIE);
  }), { message: "REQUEST_FAILED" });
});

test("真实 Node fetch 能发送显式 Cookie，但不会跟随跳转（仅本机回环）", async (t) => {
  let receivedCookie;
  let requests = 0;
  let redirect = false;
  const server = createServer((req, res) => {
    requests++;
    receivedCookie = req.headers.cookie;
    if (redirect) {
      res.writeHead(302, { location: "/other" });
      res.end();
    } else {
      res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
      res.end("您未登录,请登录后继续操作");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const localUrl = `http://127.0.0.1:${server.address().port}/article`;
  const request = (url, options) => {
    assert.equal(url, "https://bbs.byr.cn/article/Talking/6454538");
    // 仅测试中把传输目标换成本地服务，绝不向论坛发送假 Cookie。
    return fetch(localUrl, options);
  };
  const result = await inspectArticle(input, request);
  assert.equal(result.result, "AUTH_REQUIRED");
  assert.equal(receivedCookie, fakeEnv.BYR_COOKIE);
  assert.equal(JSON.stringify(result).includes(fakeEnv.BYR_COOKIE), false);
  redirect = true;
  await assert.rejects(inspectArticle(input, request), { message: "REQUEST_FAILED" });
  assert.equal(requests, 2);
});
