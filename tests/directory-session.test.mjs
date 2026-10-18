import assert from "node:assert/strict";
import test from "node:test";
import { createDirectorySession } from "../dist/directory-session.js";
import { inspectBoardDirectory } from "../dist/inspect-board-directory.js";

const rootUrl = "https://bbs.byr.cn/section/ajax_list.json?root=list-section&bo=1";
const childUrl = "https://bbs.byr.cn/section/ajax_list.json?root=sec-0&bo=1";
const initialCookie = "nforum[UTMPUSERID]=fake-user; nforum[UTMPKEY]=fake-key; nforum[UTMPNUM]=1; nforum[PASSWORD]=fake-password; preference=keep";
const fakeEnv = Object.freeze({ BYR_COOKIE: initialCookie });

function response(body = "[]", updates = [], status = 200) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  for (const update of updates) headers.append("set-cookie", update);
  return new Response(body, { status, headers });
}

function sentCookie(options) {
  return new Headers(options.headers).get("Cookie");
}

test("同一次目录查询使用刷新的三个会话字段，保留初始密码并忽略其他 Cookie", async () => {
  const seen = [];
  const result = await inspectBoardDirectory({}, async (_url, options) => {
    seen.push(sentCookie(options));
    if (seen.length === 1) return response(JSON.stringify([{ name: 0, desc: "本站站务" }]), [
      "nforum[UTMPKEY]=new-fake-key; Path=/; Secure; HttpOnly",
      "nforum[UTMPNUM]=2; Path=/section",
      "nforum[UTMPUSERID]=new-fake-user; Domain=.bbs.byr.cn; Path=/section/ajax_list.json",
      "nforum[PASSWORD]=replacement-password; Path=/",
      "preference=replace; Path=/",
      "arbitrary=do-not-send; Path=/",
    ]);
    return response(JSON.stringify([{ name: "Notice", desc: "站务公告" }]));
  }, fakeEnv);
  assert.equal(result.result, "OK");
  assert.equal(result.total_boards, 1);
  assert.deepEqual(seen, [initialCookie,
    "nforum[UTMPUSERID]=new-fake-user; nforum[UTMPKEY]=new-fake-key; nforum[UTMPNUM]=2; nforum[PASSWORD]=fake-password; preference=keep",
  ]);
  assert.equal(fakeEnv.BYR_COOKIE, initialCookie);
  for (const secret of ["fake-password", "new-fake-key", "new-fake-user", "replacement-password"]) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("刷新后的会话只活在单次目录调用中，每次新调用都重新使用环境变量", async () => {
  const seen = [];
  const request = async (url, options) => {
    seen.push(sentCookie(options));
    return url === rootUrl
      ? response(JSON.stringify([{ name: 0, desc: "本站站务" }]), ["nforum[UTMPKEY]=temporary-key; Path=/"])
      : response("[]");
  };
  assert.equal((await inspectBoardDirectory({}, request, fakeEnv)).result, "OK");
  assert.equal((await inspectBoardDirectory({}, request, fakeEnv)).result, "OK");
  const refreshed = initialCookie.replace("fake-key", "temporary-key");
  assert.deepEqual(seen, [initialCookie, refreshed, initialCookie, refreshed]);
  assert.deepEqual(fakeEnv, { BYR_COOKIE: initialCookie });
});

test("允许 host-only 或精确论坛域以及与目录地址匹配的 Path", async () => {
  for (const attributes of [
    "", "; Path=/", "; Path=/section", "; Path=/section/", "; Path=/section/ajax_list.json",
    "; Domain=bbs.byr.cn; Path=/", "; Domain=.bbs.byr.cn; Path=/", "; DOMAIN=BBS.BYR.CN; PATH=/section",
  ]) {
    const seen = [];
    const read = createDirectorySession(async (_url, options) => {
      seen.push(sentCookie(options));
      return response("[]", seen.length === 1 ? [`nforum[UTMPKEY]=scoped-key${attributes}`] : []);
    }, fakeEnv);
    await read(rootUrl);
    await read(childUrl);
    assert.deepEqual(seen, [initialCookie, initialCookie.replace("fake-key", "scoped-key")], attributes);
  }
});

test("其他域和不匹配的路径不能刷新当前目录会话", async () => {
  for (const attributes of [
    "; Domain=byr.cn; Path=/", "; Domain=.byr.cn; Path=/", "; Domain=evil.example; Path=/",
    "; Domain=bbs.byr.cn.evil.example; Path=/", "; Domain=other.bbs.byr.cn; Path=/",
    "; Path=/article", "; Path=/sect", "; Path=/section2", "; Path=section",
    "; Path=/section/ajax_list.json/extra",
  ]) {
    const seen = [];
    const read = createDirectorySession(async (_url, options) => {
      seen.push(sentCookie(options));
      return response("[]", seen.length === 1 ? [`nforum[UTMPKEY]=wrong-scope${attributes}`] : []);
    }, fakeEnv);
    await read(rootUrl);
    await read(childUrl);
    assert.deepEqual(seen, [initialCookie, initialCookie], attributes);
  }
});

test("HTTP 失败及登录提示页面的 Set-Cookie 不改变会话", async () => {
  for (const [body, status, expected] of [
    ["upstream failure", 503, "HTTP_ERROR"],
    ["您未登录,请登录后继续操作", 200, "AUTH_REQUIRED"],
  ]) {
    const seen = [];
    const read = createDirectorySession(async (_url, options) => {
      seen.push(sentCookie(options));
      return seen.length === 1
        ? response(body, ["nforum[UTMPKEY]=must-not-follow; Path=/"], status)
        : response();
    }, fakeEnv);
    assert.equal((await read(rootUrl)).result, expected);
    await read(childUrl);
    assert.deepEqual(seen, [initialCookie, initialCookie]);
  }
});

test("会话 Cookie 被删除或过期时停止目录查询并返回安全认证错误", async () => {
  for (const update of [
    "nforum[UTMPKEY]=; Path=/; Max-Age=0",
    "nforum[UTMPNUM]=; Path=/; Max-Age=-1",
    "nforum[UTMPUSERID]=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "nforum[UTMPKEY]=expired-fake-key; Path=/; Max-Age=0",
    "nforum[UTMPKEY]=expired-fake-key; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "nforum[UTMPKEY]=expired-fake-key; Path=/; Max-Age=invalid; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]) {
    let calls = 0;
    await assert.rejects(inspectBoardDirectory({}, async () => {
      calls++;
      return response(JSON.stringify([{ name: 0, desc: "本站站务" }]), [update]);
    }, fakeEnv), { message: "AUTH_REQUIRED" }, update);
    assert.equal(calls, 1);
  }
});

test("有效 Max-Age 优先于过期的 Expires，更新仍可供后续请求使用", async () => {
  const seen = [];
  const read = createDirectorySession(async (_url, options) => {
    seen.push(sentCookie(options));
    return response("[]", seen.length === 1 ? [
      "nforum[UTMPKEY]=still-valid; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
    ] : []);
  }, fakeEnv);
  await read(rootUrl);
  await read(childUrl);
  assert.deepEqual(seen, [initialCookie, initialCookie.replace("fake-key", "still-valid")]);
});

test("不接受的 Cookie 或作用域中的删除指令不会清除初始会话", async () => {
  const seen = [];
  const read = createDirectorySession(async (_url, options) => {
    seen.push(sentCookie(options));
    return response("[]", seen.length === 1 ? [
      "nforum[PASSWORD]=; Max-Age=0; Path=/",
      "arbitrary=; Max-Age=0; Path=/",
      "nforum[UTMPKEY]=; Max-Age=0; Domain=evil.example; Path=/",
      "nforum[UTMPNUM]=; Max-Age=0; Path=/article",
    ] : []);
  }, fakeEnv);
  await read(rootUrl);
  await read(childUrl);
  assert.deepEqual(seen, [initialCookie, initialCookie]);
});

test("非法会话值不会进入后续请求 Cookie 头", async () => {
  for (const value of ["", "has space", "has\ttab", '"quoted"', "comma,value", "back\\slash", "\u00ff"]) {
    const seen = [];
    const read = createDirectorySession(async (_url, options) => {
      seen.push(sentCookie(options));
      return response("[]", seen.length === 1 ? [`nforum[UTMPKEY]=${value}; Path=/`] : []);
    }, fakeEnv);
    await read(rootUrl);
    await read(childUrl);
    assert.deepEqual(seen, [initialCookie, initialCookie], JSON.stringify(value));
  }
});

test("刷新后超过 8 KiB 的 Cookie 被拒绝，不发后续请求且错误不泄露值", async () => {
  let calls = 0;
  const oversized = `secret-session-${"x".repeat(8192)}`;
  await assert.rejects(inspectBoardDirectory({}, async () => {
    calls++;
    return response(JSON.stringify([{ name: 0, desc: "本站站务" }]), [`nforum[UTMPKEY]=${oversized}; Path=/`]);
  }, fakeEnv), (error) => {
    assert.equal(error.message, "COOKIE_INVALID");
    assert.equal(String(error).includes("secret-session"), false);
    assert.equal(String(error).includes("fake-password"), false);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(fakeEnv.BYR_COOKIE, initialCookie);
});
