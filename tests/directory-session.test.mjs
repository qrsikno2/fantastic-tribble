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

function values(header, name) {
  return header.split(/;\s*/).filter((pair) => pair.startsWith(`${name}=`)).map((pair) => pair.slice(name.length + 1));
}

test("同一次目录查询使用刷新会话，合并密码和普通Cookie且不改写env", async () => {
  const seen = [];
  const result = await inspectBoardDirectory({}, async (_url, options) => {
    seen.push(new Headers(options.headers).get("Cookie"));
    if (seen.length === 1) return response(JSON.stringify([{ name: 0, desc: "本站站务" }]), [
      "nforum[UTMPKEY]=new-fake-key; Path=/; Secure; HttpOnly",
      "nforum[UTMPNUM]=2; Path=/",
      "nforum[UTMPUSERID]=fake-user; Domain=.bbs.byr.cn; Path=/",
      "nforum[PASSWORD]=replacement-password; Path=/",
      "preference=replace; Path=/", "extra=new-value; Path=/",
    ]);
    return response(JSON.stringify([{ name: "Notice", desc: "站务公告" }]));
  }, fakeEnv);
  assert.equal(result.result, "OK");
  assert.equal(result.total_boards, 1);
  for (const [name, value] of [
    ["nforum[UTMPKEY]", "new-fake-key"], ["nforum[UTMPNUM]", "2"],
    ["nforum[UTMPUSERID]", "fake-user"], ["nforum[PASSWORD]", "replacement-password"],
    ["preference", "replace"], ["extra", "new-value"],
  ]) assert.deepEqual(values(seen[1], name), [value]);
  assert.equal(fakeEnv.BYR_COOKIE, initialCookie);
  for (const secret of ["fake-password", "new-fake-key", "replacement-password"]) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("独立目录调用默认使用内存session，多请求共享更新而不同调用隔离", async () => {
  const seen = [];
  const request = async (url, options) => {
    seen.push(new Headers(options.headers).get("Cookie"));
    return url === rootUrl
      ? response(JSON.stringify([{ name: 0, desc: "本站站务" }]), ["nforum[UTMPKEY]=temporary-key; Path=/"])
      : response("[]");
  };
  assert.equal((await inspectBoardDirectory({}, request, fakeEnv)).result, "OK");
  assert.equal((await inspectBoardDirectory({}, request, fakeEnv)).result, "OK");
  assert.deepEqual(seen.map((header) => values(header, "nforum[UTMPKEY]")), [
    ["fake-key"], ["temporary-key"], ["fake-key"], ["temporary-key"],
  ]);
  assert.deepEqual(fakeEnv, { BYR_COOKIE: initialCookie });
});

test("host-only和精确论坛域会话按Path匹配，不把不同路径同名Cookie压平", async () => {
  for (const attributes of [
    "", "; Path=/", "; Path=/section", "; Path=/section/", "; Path=/section/ajax_list.json",
    "; Domain=bbs.byr.cn; Path=/", "; Domain=.bbs.byr.cn; Path=/", "; DOMAIN=BBS.BYR.CN; PATH=/section",
  ]) {
    const seen = [];
    const read = createDirectorySession(async (_url, options) => {
      seen.push(new Headers(options.headers).get("Cookie"));
      return response("[]", seen.length === 1 ? [`nforum[UTMPKEY]=scoped-key${attributes}`] : []);
    }, fakeEnv);
    await read(rootUrl);
    await read(childUrl);
    const expected = /Path=\/(?:;|$)/i.test(attributes) ? ["scoped-key"] : ["scoped-key", "fake-key"];
    assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), expected, attributes);
  }
});

test("其他域和不适用当前路径的登录Cookie不能刷新目录会话", async () => {
  for (const attributes of [
    "; Domain=byr.cn; Path=/", "; Domain=.byr.cn; Path=/", "; Domain=evil.example; Path=/",
    "; Domain=bbs.byr.cn.evil.example; Path=/", "; Domain=other.bbs.byr.cn; Path=/",
    "; Path=/article", "; Path=/sect", "; Path=/section2", "; Path=/section/ajax_list.json/extra",
  ]) {
    const seen = [];
    const read = createDirectorySession(async (_url, options) => {
      seen.push(new Headers(options.headers).get("Cookie"));
      return response("[]", seen.length === 1 ? [`nforum[UTMPKEY]=wrong-scope${attributes}`] : []);
    }, fakeEnv);
    await read(rootUrl);
    await read(childUrl);
    assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), ["fake-key"], attributes);
  }
});

test("HTTP失败及登录提示页面的Set-Cookie不改变会话", async () => {
  for (const [body, status, expected] of [
    ["upstream failure", 503, "HTTP_ERROR"], ["您未登录,请登录后继续操作", 200, "AUTH_REQUIRED"],
  ]) {
    const seen = [];
    const read = createDirectorySession(async (_url, options) => {
      seen.push(new Headers(options.headers).get("Cookie"));
      return seen.length === 1 ? response(body, ["nforum[UTMPKEY]=must-not-follow; Path=/"], status) : response();
    }, fakeEnv);
    assert.equal((await read(rootUrl)).result, expected);
    await read(childUrl);
    assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), ["fake-key"]);
  }
});

test("明确删除或过期关键Cookie时停止目录查询，不重新使用旧env", async () => {
  for (const update of [
    "nforum[UTMPKEY]=; Path=/; Max-Age=0", "nforum[UTMPNUM]=; Path=/; Max-Age=-1",
    "nforum[UTMPUSERID]=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "nforum[PASSWORD]=; Path=/; Max-Age=0",
    "nforum[UTMPKEY]=expired-fake-key; Path=/; Max-Age=0",
    "nforum[UTMPKEY]=expired-fake-key; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "nforum[UTMPKEY]=expired-fake-key; Path=/; Max-Age=invalid; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]) {
    let calls = 0;
    const read = createDirectorySession(async () => { calls++; return response("[]", [update]); }, fakeEnv);
    await assert.rejects(read(rootUrl), { message: "AUTH_REQUIRED" }, update);
    await assert.rejects(read(childUrl), { message: "AUTH_REQUIRED" }, update);
    assert.equal(calls, 1);
  }
});

test("有效Max-Age优先于过期Expires", async () => {
  const seen = [];
  const read = createDirectorySession(async (_url, options) => {
    seen.push(new Headers(options.headers).get("Cookie"));
    return response("[]", seen.length === 1 ? [
      "nforum[UTMPKEY]=still-valid; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
    ] : []);
  }, fakeEnv);
  await read(rootUrl);
  await read(childUrl);
  assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), ["still-valid"]);
});

test("游客响应不覆盖已有登录态，同时允许普通偏好更新", async () => {
  const seen = [];
  const read = createDirectorySession(async (_url, options) => {
    seen.push(new Headers(options.headers).get("Cookie"));
    return response("[]", seen.length === 1 ? [
      "nforum[UTMPUSERID]=guest; Path=/", "nforum[UTMPKEY]=guest-key; Path=/",
      "nforum[PASSWORD]=; Max-Age=0; Path=/", "preference=guest-theme; Path=/",
    ] : []);
  }, fakeEnv);
  await read(rootUrl);
  await read(childUrl);
  assert.deepEqual(values(seen[1], "nforum[UTMPUSERID]"), ["fake-user"]);
  assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), ["fake-key"]);
  assert.deepEqual(values(seen[1], "nforum[PASSWORD]"), ["fake-password"]);
  assert.deepEqual(values(seen[1], "preference"), ["guest-theme"]);
});

test("刷新后Cookie超过8KiB时拒绝后续请求且不泄露值", async () => {
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
