import assert from "node:assert/strict";
import test from "node:test";
import { inspectBoardDirectory } from "../dist/inspect-board-directory.js";

const fakeEnv = Object.freeze({ BYR_COOKIE: "session=fake-directory-tests" });
const origin = "https://bbs.byr.cn";
const rootUrl = `${origin}/section/ajax_list.json?root=list-section&bo=1`;
const sectionUrl = (section) => `${origin}/section/ajax_list.json?root=sec-${section}&bo=1`;
const jsonResponse = (value) => new Response(JSON.stringify(value), {
  headers: { "content-type": "application/json;charset=utf-8" },
});
const textResponse = (value, status = 200) => new Response(value, {
  status,
  headers: { "content-type": "text/html;charset=utf-8" },
});

function assertFailure(result, expected) {
  assert.equal(result.result, expected);
  assert.deepEqual(result.boards, []);
  assert.equal(result.total_boards, null);
  assert.equal(Object.hasOwn(result, "content"), false);
}

test("默认列出全部分区版面，保留中文名称、固定站点 URL，并合并跨区重复版面", async () => {
  const calls = [];
  const replies = [
    [{ name: 0, desc: "本站站务" }, { name: "1", desc: "北邮校园" }],
    [{ name: "Advice", desc: "意见与建议" }, { name: "Shared_Board-1", desc: "共同版面" }],
    [{ name: "BUPT", desc: "北邮校园" }, { name: "Shared_Board-1", desc: "共同版面" }],
  ];
  const result = await inspectBoardDirectory(undefined, async (url, options) => {
    calls.push(url);
    assert.equal(new Headers(options.headers).get("Cookie"), fakeEnv.BYR_COOKIE);
    assert.equal(options.redirect, "error");
    return jsonResponse(replies[calls.length - 1]);
  }, fakeEnv);
  assert.deepEqual(calls, [rootUrl, sectionUrl("0"), sectionUrl("1")]);
  assert.equal(result.result, "OK");
  assert.equal(result.section, null);
  assert.equal(result.http_status, 200);
  assert.equal(result.total_boards, 3);
  assert.deepEqual(result.sections, [
    { section: "0", name: "本站站务", section_url: `${origin}/section/0` },
    { section: "1", name: "北邮校园", section_url: `${origin}/section/1` },
  ]);
  assert.deepEqual(result.boards, [
    { board: "Advice", name: "意见与建议", board_url: `${origin}/board/Advice`, sections: ["0"] },
    { board: "Shared_Board-1", name: "共同版面", board_url: `${origin}/board/Shared_Board-1`, sections: ["0", "1"] },
    { board: "BUPT", name: "北邮校园", board_url: `${origin}/board/BUPT`, sections: ["1"] },
  ]);
  assert.equal(JSON.stringify(result).includes(fakeEnv.BYR_COOKIE), false);
});

test("指定分区先验证根目录，再只读取选中分区，共两次请求", async () => {
  const calls = [];
  const input = Object.freeze({ section: "Zone_1-test" });
  const result = await inspectBoardDirectory(input, async (url) => {
    calls.push(url);
    return jsonResponse(calls.length === 1
      ? [{ name: 0, desc: "本站站务" }, { name: "Zone_1-test", desc: "测试分区" }]
      : [{ name: "Talking", desc: "谈天说地" }]);
  }, fakeEnv);
  assert.deepEqual(calls, [rootUrl, sectionUrl("Zone_1-test")]);
  assert.equal(result.result, "OK");
  assert.equal(result.section, "Zone_1-test");
  assert.equal(result.total_boards, 1);
  assert.deepEqual(result.sections, [
    { section: "Zone_1-test", name: "测试分区", section_url: `${origin}/section/Zone_1-test` },
  ]);
  assert.deepEqual(result.boards[0].sections, ["Zone_1-test"]);
  assert.deepEqual(input, { section: "Zone_1-test" });
});

test("未知分区返回 SECTION_NOT_FOUND，不请求根目录之外的地址", async () => {
  const calls = [];
  const result = await inspectBoardDirectory({ section: "9" }, async (url) => {
    calls.push(url);
    return jsonResponse([{ name: 0, desc: "本站站务" }]);
  }, fakeEnv);
  assert.deepEqual(calls, [rootUrl]);
  assertFailure(result, "SECTION_NOT_FOUND");
});

test("有效分区中的空数组是真实空列表", async () => {
  let calls = 0;
  const result = await inspectBoardDirectory({}, async () => jsonResponse(++calls === 1
    ? [{ name: 0, desc: "本站站务" }]
    : []), fakeEnv);
  assert.equal(result.result, "OK");
  assert.equal(result.total_boards, 0);
  assert.deepEqual(result.boards, []);
  assert.equal(calls, 2);
});

test("非法参数在读取 Cookie 或发出请求之前拒绝", async () => {
  let cookieReads = 0;
  let calls = 0;
  const env = { get BYR_COOKIE() { cookieReads++; throw new Error("must not read cookie"); } };
  const request = async () => { calls++; return jsonResponse([]); };
  for (const input of [
    null, [], "0", 0, false,
    ...["", " ", "0\n", "../0", "0/Other", "0?bo=1", "0#x", "%30", "https://example.com", "中文", "_0", "-0", 0, null, [], {}]
      .map((section) => ({ section })),
  ]) {
    await assert.rejects(inspectBoardDirectory(input, request, env), undefined, JSON.stringify(input));
  }
  assert.equal(cookieReads, 0);
  assert.equal(calls, 0);
});

test("缺少认证不发请求，网络异常不暴露 Cookie 或底层异常", async () => {
  let calls = 0;
  await assert.rejects(inspectBoardDirectory({}, async () => { calls++; }, {}), { message: "AUTH_REQUIRED" });
  assert.equal(calls, 0);
  await assert.rejects(inspectBoardDirectory({}, async () => {
    throw new Error(`private failure ${fakeEnv.BYR_COOKIE}`);
  }, fakeEnv), { message: "REQUEST_FAILED" });
});

test("认证失败、HTTP 错误及未知根结构均不输出成功或原始正文", async () => {
  for (const [expected, response] of [
    ["AUTH_REQUIRED", () => textResponse("<p>您未登录，请登录后继续操作</p>")],
    ["HTTP_ERROR", () => textResponse("private-root-data", 503)],
    ["UNPARSED_PAGE", () => textResponse("<p>private-root-data</p>")],
    ["UNPARSED_PAGE", () => textResponse('{"private-root-data":')],
    ["UNPARSED_PAGE", () => jsonResponse({ data: [] })],
    ["UNPARSED_PAGE", () => jsonResponse([])],
    ["UNPARSED_PAGE", () => jsonResponse(null)],
  ]) {
    let calls = 0;
    const result = await inspectBoardDirectory({}, async () => { calls++; return response(); }, fakeEnv);
    assertFailure(result, expected);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes("private-root-data"), false);
  }
});

test("目录中的恶意路径、非法字段及重复分区不触发任何子请求", async () => {
  const invalidItems = [
    null, [], {}, { name: "0" },
    ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "", "0\n", "../0", "//evil.example", "0?x=y", "https://evil.example", null, {}]
      .map((name) => ({ name, desc: "分区" })),
    ...["", null, 1, {}].map((desc) => ({ name: 0, desc })),
  ];
  const directories = invalidItems.map((item) => [{ name: 1, desc: "正常分区" }, item]);
  directories.push([{ name: 0, desc: "站务" }, { name: "0", desc: "重复站务" }]);
  for (const directory of directories) {
    const calls = [];
    const result = await inspectBoardDirectory({}, async (url) => {
      calls.push(url);
      return jsonResponse(directory);
    }, fakeEnv);
    assertFailure(result, "UNPARSED_PAGE");
    assert.deepEqual(calls, [rootUrl]);
  }
});

test("超过 32 个根分区时拒绝展开请求", async () => {
  let calls = 0;
  const directory = Array.from({ length: 33 }, (_, name) => ({ name, desc: `分区${name}` }));
  const result = await inspectBoardDirectory({}, async () => { calls++; return jsonResponse(directory); }, fakeEnv);
  assertFailure(result, "UNPARSED_PAGE");
  assert.equal(calls, 1);
});

test("版面列表结构或字段不合法及同分区重复版面均拒绝解析", async () => {
  const invalidItems = [
    null, [], {}, { name: "Talking" },
    ...["", "../Talking", "Talking\n", "Talking?x=1", "https://evil.example", null, 123]
      .map((name) => ({ name, desc: "测试版面" })),
    ...["", null, 1, {}].map((desc) => ({ name: "Talking", desc })),
  ];
  const lists = [null, {}, { boards: [] }, ...invalidItems.map((item) => [item]), [
    { name: "Talking", desc: "谈天说地" }, { name: "Talking", desc: "谈天说地" },
  ]];
  for (const list of lists) {
    let calls = 0;
    const result = await inspectBoardDirectory({}, async () => jsonResponse(++calls === 1
      ? [{ name: 0, desc: "本站站务" }]
      : list), fakeEnv);
    assertFailure(result, "UNPARSED_PAGE");
    assert.equal(calls, 2);
  }
});

test("后续分区失败时丢弃已读版面，并停止请求后面的分区", async () => {
  for (const [expected, response] of [
    ["AUTH_REQUIRED", () => textResponse("您未登录,请登录后继续操作")],
    ["HTTP_ERROR", () => textResponse("private-child-data", 403)],
    ["UNPARSED_PAGE", () => textResponse("private-child-data")],
    ["UNPARSED_PAGE", () => jsonResponse([{ name: "../unsafe", desc: "非法" }])],
  ]) {
    const calls = [];
    const result = await inspectBoardDirectory({}, async (url) => {
      calls.push(url);
      if (calls.length === 1) return jsonResponse([
        { name: 0, desc: "站务" }, { name: 1, desc: "校园" }, { name: 2, desc: "科技" },
      ]);
      if (calls.length === 2) return jsonResponse([{ name: "Advice", desc: "意见与建议" }]);
      return response();
    }, fakeEnv);
    assertFailure(result, expected);
    assert.deepEqual(calls, [rootUrl, sectionUrl("0"), sectionUrl("1")]);
    assert.equal(JSON.stringify(result).includes("private-child-data"), false);
  }
});

test("分区读取发生网络失败或限流时沿用归一错误且不重试", async () => {
  for (const [message, fail] of [
    ["REQUEST_FAILED", () => { throw new Error(fakeEnv.BYR_COOKIE); }],
    ["RATE_LIMITED", () => textResponse("Too Many Requests", 429)],
  ]) {
    let calls = 0;
    await assert.rejects(inspectBoardDirectory({}, async () => {
      calls++;
      return calls === 1 ? jsonResponse([{ name: 0, desc: "站务" }]) : fail();
    }, fakeEnv), { message });
    assert.equal(calls, 2);
  }
});
