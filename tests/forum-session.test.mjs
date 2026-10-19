import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createForumSession } from "../dist/forum-session.js";

const rootUrl = "https://bbs.byr.cn/section/ajax_list.json?root=list-section&bo=1";
const articleUrl = "https://bbs.byr.cn/article/Health/123";
const initialCookie = "nforum[UTMPUSERID]=fake-user; nforum[UTMPKEY]=fake-key; nforum[UTMPNUM]=1; nforum[PASSWORD]=fake-password; preference=keep";
const fakeEnv = Object.freeze({ BYR_COOKIE: initialCookie });

function response(updates = [], body = "[]", status = 200) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  for (const update of updates) headers.append("set-cookie", update);
  return new Response(body, { status, headers });
}

function values(init, name) {
  const header = typeof init === "string" ? init : new Headers(init.headers).get("Cookie");
  return (header ?? "").split(/;\s*/).filter((pair) => pair.startsWith(`${name}=`)).map((pair) => pair.slice(name.length + 1));
}

async function temporaryFile(t) {
  const directory = await mkdtemp(join(tmpdir(), "forum-session-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "data", "session-cookie.txt");
}

test("session惰性初始化；非法URL在读取凭据前拒绝，缺少或显式空凭据不发请求", async () => {
  let reads = 0;
  let calls = 0;
  const env = Object.defineProperty({}, "BYR_COOKIE", { get() { reads++; throw new Error("private env"); } });
  const request = async () => { calls++; return response(); };
  const lazy = createForumSession(request, env, { cookieFile: null });
  assert.equal(reads, 0);
  await assert.rejects(lazy("https://example.com/article/Health/123"), { message: "URL_INVALID" });
  assert.equal(reads, 0);
  for (const value of [{}, { BYR_COOKIE: "" }, { BYR_COOKIE: "   " }]) {
    await assert.rejects(createForumSession(request, value, { cookieFile: null })(rootUrl), { message: "AUTH_REQUIRED" });
  }
  assert.equal(calls, 0);
});

test("全局session合并Set-Cookie，跨目录和帖子请求使用更新值并以0600保存", async (t) => {
  const cookieFile = await temporaryFile(t);
  const seen = [];
  const read = createForumSession(async (url, init) => {
    seen.push({ url, init });
    return response(seen.length === 1 ? [
      "nforum[UTMPKEY]=rotated-key; Path=/; Secure; HttpOnly; SameSite=Lax",
      "nforum[PASSWORD]=rotated-password; Path=/",
      "preference=new-theme; Path=/", "tracking=some-value; Path=/",
    ] : []);
  }, fakeEnv, { cookieFile });
  const result = await read(rootUrl);
  await read(articleUrl);
  assert.deepEqual(values(seen[1].init, "nforum[UTMPKEY]"), ["rotated-key"]);
  assert.deepEqual(values(seen[1].init, "nforum[PASSWORD]"), ["rotated-password"]);
  assert.deepEqual(values(seen[1].init, "preference"), ["new-theme"]);
  assert.deepEqual(values(seen[1].init, "tracking"), ["some-value"]);
  const saved = JSON.parse(await readFile(cookieFile, "utf8"));
  const key = saved.jar.cookies.find((cookie) => cookie.key === "nforum[UTMPKEY]");
  assert.equal(key.value, "rotated-key");
  assert.equal(key.path, "/");
  assert.equal(key.domain, "bbs.byr.cn");
  assert.equal(key.secure, true);
  assert.equal(key.httpOnly, true);
  assert.equal(key.sameSite, "lax");
  assert.equal((await stat(cookieFile)).mode & 0o777, 0o600);
  for (const secret of ["rotated-key", "rotated-password", "fake-password"]) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.equal(fakeEnv.BYR_COOKIE, initialCookie);
});

test("重启同env或无env恢复文件；新env主动重置，显式空env不恢复旧账号", async (t) => {
  const cookieFile = await temporaryFile(t);
  await createForumSession(async () => response(["nforum[UTMPKEY]=saved-key; Path=/"]), fakeEnv, { cookieFile })(rootUrl);
  for (const env of [fakeEnv, {}]) {
    await createForumSession(async (_url, init) => {
      assert.deepEqual(values(init, "nforum[UTMPKEY]"), ["saved-key"]);
      return response();
    }, env, { cookieFile })(articleUrl);
  }
  let calls = 0;
  for (const blank of ["", "   "]) {
    await assert.rejects(createForumSession(async () => { calls++; return response(); },
      { BYR_COOKIE: blank }, { cookieFile })(rootUrl), { message: "AUTH_REQUIRED" });
  }
  assert.equal(calls, 0);
  const replacement = initialCookie.replace("fake-user", "other-user").replace("fake-key", "new-seed-key");
  await createForumSession(async (_url, init) => {
    assert.deepEqual(values(init, "nforum[UTMPUSERID]"), ["other-user"]);
    assert.deepEqual(values(init, "nforum[UTMPKEY]"), ["new-seed-key"]);
    return response(["preference=new-account; Path=/"]);
  }, { BYR_COOKIE: replacement }, { cookieFile })(rootUrl);
  await createForumSession(async (_url, init) => {
    assert.deepEqual(values(init, "nforum[UTMPUSERID]"), ["other-user"]);
    return response();
  }, {}, { cookieFile })(rootUrl);
});

test("不同Path的同名cookie同时保存并仅按请求路径发送；其他域不进入jar", async (t) => {
  const cookieFile = await temporaryFile(t);
  const seen = [];
  const read = createForumSession(async (_url, init) => {
    seen.push(init);
    return response(seen.length === 1 ? [
      "preference=article-theme; Path=/article; Expires=Thu, 01 Jan 2099 00:00:00 GMT",
      "host-only=allowed; Path=/", "domain-cookie=allowed; Domain=.bbs.byr.cn; Path=/",
      "bad-domain=do-not-send; Domain=evil.example; Path=/",
      "parent-domain=do-not-send; Domain=byr.cn; Path=/",
    ] : []);
  }, fakeEnv, { cookieFile });
  await read(rootUrl);
  await read(articleUrl);
  await read(rootUrl);
  assert.deepEqual(values(seen[1], "preference"), ["article-theme", "keep"]);
  assert.deepEqual(values(seen[2], "preference"), ["keep"]);
  assert.deepEqual(values(seen[1], "bad-domain"), []);
  assert.deepEqual(values(seen[1], "parent-domain"), []);
  const saved = JSON.parse(await readFile(cookieFile, "utf8"));
  const scoped = saved.jar.cookies.find((cookie) => cookie.key === "preference" && cookie.path === "/article");
  assert.equal(new Date(scoped.expires).getUTCFullYear(), 2099);
  await createForumSession(async (_url, init) => {
    assert.deepEqual(values(init, "preference"), ["article-theme", "keep"]);
    return response();
  }, fakeEnv, { cookieFile })(articleUrl);
});

test("无PASSWORD响应允许同用户会话轮换，游客batch不能覆盖任一登录字段", async () => {
  for (const password of [null, "nforum[PASSWORD]=; Path=/; Max-Age=0", "nforum[PASSWORD]=guest-fake-password; Path=/"]) {
    const seen = [];
    const read = createForumSession(async (_url, init) => {
      seen.push(init);
      if (seen.length === 1) return response(["nforum[UTMPKEY]=rotated-key; Path=/"]);
      if (seen.length === 2) return response([
        "nforum[UTMPUSERID]=guest; Path=/", "nforum[UTMPKEY]=guest-key; Path=/",
        "nforum[UTMPNUM]=0; Path=/", ...(password === null ? [] : [password]),
        "preference=guest-theme; Path=/",
      ]);
      return response();
    }, fakeEnv, { cookieFile: null });
    await read(rootUrl);
    await read(articleUrl);
    await read(rootUrl);
    assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), ["rotated-key"]);
    assert.deepEqual(values(seen[2], "nforum[UTMPKEY]"), ["rotated-key"]);
    assert.deepEqual(values(seen[2], "nforum[UTMPUSERID]"), ["fake-user"]);
    assert.deepEqual(values(seen[2], "nforum[PASSWORD]"), ["fake-password"]);
    assert.deepEqual(values(seen[2], "preference"), ["guest-theme"]);
  }
});

test("新身份只有完整且当前路径可用的四个登录字段才可替换，不能混用旧账号会话", async () => {
  const identity = ["nforum[UTMPUSERID]=other-user; Path=/", "nforum[UTMPKEY]=other-key; Path=/", "nforum[UTMPNUM]=2; Path=/"];
  for (const [updates, accepted] of [
    [identity, false],
    [[identity[0], "nforum[PASSWORD]=other-password; Path=/"], false],
    [[...identity, "nforum[PASSWORD]=other-password; Path=/article"], false],
    [[identity[0].replace("Path=/", "Path=/section"), ...identity.slice(1), "nforum[PASSWORD]=other-password; Path=/"], false],
    [[...identity, "nforum[PASSWORD]=other-password; Path=/"], true],
  ]) {
    const seen = [];
    const read = createForumSession(async (_url, init) => {
      seen.push(init);
      return response(seen.length === 1 ? updates : []);
    }, fakeEnv, { cookieFile: null });
    await read(rootUrl);
    await read(articleUrl);
    assert.deepEqual(values(seen[1], "nforum[UTMPUSERID]"), [accepted ? "other-user" : "fake-user"]);
    assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), [accepted ? "other-key" : "fake-key"]);
    assert.deepEqual(values(seen[1], "nforum[PASSWORD]"), [accepted ? "other-password" : "fake-password"]);
  }
});

test("切换到限路径的新账号后不再保留旧账号；其他路径无完整凭据时不发请求", async () => {
  const seen = [];
  const read = createForumSession(async (_url, init) => {
    seen.push(init);
    return response(seen.length === 1 ? [
      "nforum[UTMPUSERID]=scoped-user; Path=/section", "nforum[UTMPKEY]=scoped-key; Path=/section",
      "nforum[UTMPNUM]=2; Path=/section", "nforum[PASSWORD]=scoped-password; Path=/section",
    ] : []);
  }, fakeEnv, { cookieFile: null });
  await read(rootUrl);
  await read(rootUrl);
  assert.deepEqual(values(seen[1], "nforum[UTMPUSERID]"), ["scoped-user"]);
  assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), ["scoped-key"]);
  await assert.rejects(read(articleUrl), { message: "AUTH_REQUIRED" });
  assert.equal(seen.length, 2);
});

test("HTTP错误、登录提示和网络失败不接收Set-Cookie；队列失败后仍可继续", async () => {
  for (const failure of [
    () => response(["nforum[UTMPKEY]=bad-key; Path=/"], "private body", 503),
    () => response(["nforum[UTMPKEY]=bad-key; Path=/"], "您未登录,请登录后继续操作"),
    () => { throw new Error("private transport secret"); },
  ]) {
    const seen = [];
    const read = createForumSession(async (_url, init) => {
      seen.push(init);
      return seen.length === 1 ? failure() : response();
    }, fakeEnv, { cookieFile: null });
    try {
      const result = await read(rootUrl);
      assert.notEqual(result.result, "UNPARSED_PAGE");
    } catch (error) {
      assert.equal(error.message, "REQUEST_FAILED");
      assert.equal(String(error).includes("private transport"), false);
    }
    await read(articleUrl);
    assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), ["fake-key"]);
  }
});

test("并发调用串行到响应正文读取与会话合并结束，后请求发送新会话", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const firstStarted = new Promise((resolve) => { started = resolve; });
  const seen = [];
  const read = createForumSession(async (_url, init) => {
    seen.push(init);
    if (seen.length > 1) return response();
    const stream = new ReadableStream({
      async start(controller) {
        started();
        await gate;
        controller.enqueue(new TextEncoder().encode("[]"));
        controller.close();
      },
    });
    return response(["nforum[UTMPKEY]=concurrent-key; Path=/"], stream);
  }, fakeEnv, { cookieFile: null });
  const first = read(rootUrl);
  await firstStarted;
  const second = read(articleUrl);
  await Promise.resolve();
  assert.equal(seen.length, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(seen.length, 2);
  assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), ["concurrent-key"]);
});

test("关键Cookie明确删除会持久失效，后续或重启不能回退原env", async (t) => {
  const cookieFile = await temporaryFile(t);
  let calls = 0;
  const read = createForumSession(async () => {
    calls++;
    return response(["nforum[UTMPKEY]=; Path=/; Max-Age=0"]);
  }, fakeEnv, { cookieFile });
  await assert.rejects(read(rootUrl), { message: "AUTH_REQUIRED" });
  await assert.rejects(read(articleUrl), { message: "AUTH_REQUIRED" });
  await assert.rejects(createForumSession(async () => { calls++; return response(); }, fakeEnv,
    { cookieFile })(rootUrl), { message: "AUTH_REQUIRED" });
  assert.equal(calls, 1);
});

test("Max-Age优先Expires，读取和重启都不延长期限", async (t) => {
  const cookieFile = await temporaryFile(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  let calls = 0;
  await createForumSession(async () => {
    calls++;
    return response(["nforum[UTMPKEY]=short-lived; Path=/; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
  }, fakeEnv, { cookieFile })(rootUrl);
  t.mock.timers.tick(30_000);
  const restored = createForumSession(async (_url, init) => {
    calls++;
    assert.deepEqual(values(init, "nforum[UTMPKEY]"), ["short-lived"]);
    return response(["preference=later-save; Path=/"]);
  }, fakeEnv, { cookieFile });
  await restored(rootUrl);
  t.mock.timers.tick(31_000);
  await assert.rejects(restored(rootUrl), { message: "AUTH_REQUIRED" });
  await assert.rejects(createForumSession(async () => { calls++; return response(); }, fakeEnv,
    { cookieFile })(rootUrl), { message: "AUTH_REQUIRED" });
  assert.equal(calls, 2);
});

test("删除其他路径不存在的登录Cookie不会使原会话失效", async () => {
  const seen = [];
  const read = createForumSession(async (_url, init) => {
    seen.push(init);
    return response(seen.length === 1 ? ["nforum[UTMPKEY]=; Path=/section; Max-Age=0"] : []);
  }, fakeEnv, { cookieFile: null });
  await read(rootUrl);
  await read(articleUrl);
  assert.deepEqual(values(seen[1], "nforum[UTMPKEY]"), ["fake-key"]);
});

test("较窄路径有效cookie不抹去根路径过期信息，普通更新后其他路径仍拒绝过期会话", async (t) => {
  const cookieFile = await temporaryFile(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  let calls = 0;
  const read = createForumSession(async () => {
    calls++;
    return response(calls === 1 ? [
      "nforum[UTMPKEY]=short-root-key; Path=/; Max-Age=30",
      "nforum[UTMPKEY]=long-section-key; Path=/section; Max-Age=120",
    ] : ["preference=updated-after-expiry; Path=/"]);
  }, fakeEnv, { cookieFile });
  await read(rootUrl);
  t.mock.timers.tick(31_000);
  await read(rootUrl);
  await assert.rejects(read(articleUrl), { message: "AUTH_REQUIRED" });
  await assert.rejects(createForumSession(async () => { calls++; return response(); }, fakeEnv,
    { cookieFile })(articleUrl), { message: "AUTH_REQUIRED" });
  assert.equal(calls, 2);
});

test("同批同作用域PASSWORD先删除后有效时以最终值为准", async () => {
  const seen = [];
  const read = createForumSession(async (_url, init) => {
    seen.push(init);
    return response(seen.length === 1 ? [
      "nforum[PASSWORD]=; Path=/; Max-Age=0", "nforum[PASSWORD]=final-password; Path=/",
    ] : []);
  }, fakeEnv, { cookieFile: null });
  await read(rootUrl);
  await read(articleUrl);
  assert.deepEqual(values(seen[1], "nforum[PASSWORD]"), ["final-password"]);
});

test("损坏的持久文件不会被旧env静默覆盖或泄露内容", async (t) => {
  const cookieFile = await temporaryFile(t);
  await mkdir(dirname(cookieFile), { recursive: true });
  await writeFile(cookieFile, "private-invalid-session-json", { mode: 0o600 });
  let calls = 0;
  await assert.rejects(createForumSession(async () => { calls++; return response(); }, fakeEnv,
    { cookieFile })(rootUrl), { message: "SESSION_STORAGE_ERROR" });
  assert.equal(calls, 0);
  assert.equal(await readFile(cookieFile, "utf8"), "private-invalid-session-json");
});

test("保存失败不提交新内存会话，恢复可写后请求仍使用旧值", async (t) => {
  const cookieFile = await temporaryFile(t);
  const seen = [];
  const read = createForumSession(async (_url, init) => {
    seen.push(init);
    return response(seen.length === 1 ? ["preference=initial-save; Path=/"]
      : seen.length === 2 ? ["nforum[UTMPKEY]=must-not-commit; Path=/"] : []);
  }, fakeEnv, { cookieFile });
  await read(rootUrl);
  const original = await readFile(cookieFile, "utf8");
  await rename(cookieFile, `${cookieFile}.saved`);
  await mkdir(cookieFile);
  await assert.rejects(read(articleUrl), { message: "SESSION_STORAGE_ERROR" });
  await rm(cookieFile, { recursive: true });
  await rename(`${cookieFile}.saved`, cookieFile);
  await read(rootUrl);
  assert.deepEqual(values(seen[2], "nforum[UTMPKEY]"), ["fake-key"]);
  const after = JSON.parse(await readFile(cookieFile, "utf8"));
  const before = JSON.parse(original);
  assert.deepEqual(after.jar.cookies.map(({ key, value, path }) => ({ key, value, path })),
    before.jar.cookies.map(({ key, value, path }) => ({ key, value, path })));
});
