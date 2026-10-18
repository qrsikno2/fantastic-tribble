import assert from "node:assert/strict";
import test from "node:test";
import { buildBoardUrl, validateBoardParams } from "../dist/board-params.js";
import { inspectBoard } from "../dist/inspect-board.js";

const fakeEnv = Object.freeze({ BYR_COOKIE: "session=fake-board-tests" });
const response = (body) => new Response(body, { headers: { "content-type": "text/html;charset=utf-8" } });

test("版面参数默认第1页，构造固定站点 p 参数，保留输入", () => {
  const input = Object.freeze({ board: "Board_1-test" });
  assert.deepEqual(validateBoardParams(input), { board: "Board_1-test", page: 1 });
  assert.equal(buildBoardUrl(input), "https://bbs.byr.cn/board/Board_1-test?p=1");
  assert.equal(buildBoardUrl({ board: "Talking", page: 42 }), "https://bbs.byr.cn/board/Talking?p=42");
  assert.equal(Object.hasOwn(input, "page"), false);
});

test("非法版面路径和非法页码在请求或读取 Cookie 前被拒绝", async () => {
  let calls = 0;
  const request = async () => { calls++; return response(""); };
  for (const input of [null, [], "Talking", {}, { board: "Talking/Other" },
    { board: "//example.com" }, { board: "Talking?mode=0" }, { board: "Talking\n" },
    ...[0, -1, 1.5, "2", null, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1].map((page) => ({ board: "Talking", page })),
  ]) {
    await assert.rejects(inspectBoard(input, request, {}));
  }
  assert.equal(calls, 0);
});

test("登录提示、HTTP错误和未知结构不返回成功或泄露响应正文", async () => {
  for (const [expected, request] of [
    ["AUTH_REQUIRED", () => response("<p>您未登录，请登录后继续操作</p>")],
    ["HTTP_ERROR", () => new Response("private forbidden", { status: 403 })],
    ["UNPARSED_PAGE", () => response("<p>private maintenance page</p>")],
  ]) {
    const result = await inspectBoard({ board: "Talking" }, request, fakeEnv);
    assert.equal(result.result, expected);
    assert.equal(result.total_pages, null);
    assert.deepEqual(result.threads, []);
    assert.equal(Object.hasOwn(result, "content"), false);
  }
});

test("缺少认证不发请求；底层网络错误只返回归一错误", async () => {
  let calls = 0;
  await assert.rejects(inspectBoard({ board: "Talking" }, async () => { calls++; }, {}), { message: "AUTH_REQUIRED" });
  assert.equal(calls, 0);
  await assert.rejects(inspectBoard({ board: "Talking" }, async () => { throw new Error(fakeEnv.BYR_COOKIE); }, fakeEnv),
    { message: "REQUEST_FAILED" });
});
