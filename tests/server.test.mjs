import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";

const fakeEnv = { BYR_COOKIE: "session=fake-test-cookie" };

async function connect(t, request = async () => { throw new Error("unexpected request"); }, env = fakeEnv) {
  const server = createServer(request, env);
  const client = new Client({ name: "forumcp-tests", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

function payload(result) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  return JSON.parse(result.content[0].text);
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

test("tools/list exposes board info, paged thread lists, and the existing thread tool", async (t) => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), ["get_board_info", "get_board_threads", "get_thread"]);
  const info = tools.find(({ name }) => name === "get_board_info");
  const threads = tools.find(({ name }) => name === "get_board_threads");
  assert.deepEqual(info.inputSchema.required, ["board"]);
  assert.deepEqual(Object.keys(info.inputSchema.properties), ["board"]);
  assert.deepEqual(threads.inputSchema.required, ["board"]);
  assert.equal(threads.inputSchema.properties.page.minimum, 1);
  assert.equal(threads.inputSchema.properties.page.maximum, Number.MAX_SAFE_INTEGER);
});

test("invalid board and page arguments fail before any HTTP request", async (t) => {
  let calls = 0;
  const client = await connect(t, async () => {
    calls += 1;
    return htmlResponse("");
  });
  for (const args of [
    { board: "../Talking" },
    { board: "https://example.com" },
    { board: "Talking\n" },
    { board: "Talking", page: 0 },
    { board: "Talking", page: 1.5 },
    { board: "Talking", page: Number.MAX_SAFE_INTEGER + 1 },
    { board: "Talking", page: "2" },
  ]) {
    const result = await client.callTool({ name: "get_board_threads", arguments: args });
    assert.equal(result.isError, true, JSON.stringify(args));
  }
  assert.equal(calls, 0);
});

test("missing authentication is a controlled MCP tool error without fetching", async (t) => {
  let calls = 0;
  const client = await connect(t, async () => {
    calls += 1;
    return htmlResponse("");
  }, {});
  for (const name of ["get_board_info", "get_board_threads"]) {
    const result = await client.callTool({ name, arguments: { board: "Talking" } });
    assert.equal(result.isError, true);
    assert.deepEqual(payload(result), { result: "AUTH_REQUIRED" });
  }
  assert.equal(calls, 0);
});

test("HTTP, login, and unknown pages are exposed as MCP errors", async (t) => {
  for (const [html, status, expected] of [
    ["unavailable", 503, "HTTP_ERROR"],
    ["您未登录,请登录后继续操作", 200, "AUTH_REQUIRED"],
    ["<html><body>unrecognized page</body></html>", 200, "UNPARSED_PAGE"],
  ]) {
    const client = await connect(t, async () => htmlResponse(html, status));
    const result = await client.callTool({ name: "get_board_threads", arguments: { board: "Talking" } });
    const data = payload(result);
    assert.equal(result.isError, true);
    assert.equal(data.result, expected);
    assert.equal(data.http_status, status);
    assert.deepEqual(data.threads, []);
  }
});

test("network failures do not expose exception details or Cookie values", async (t) => {
  const client = await connect(t, async () => { throw new Error(`private request: ${fakeEnv.BYR_COOKIE}`); });
  const result = await client.callTool({ name: "get_board_info", arguments: { board: "Talking" } });
  assert.equal(result.isError, true);
  assert.deepEqual(payload(result), { result: "REQUEST_FAILED" });
  assert.equal(JSON.stringify(result).includes(fakeEnv.BYR_COOKIE), false);
});

test("forum rate limiting is a controlled MCP error, not an encoding failure", async (t) => {
  const client = await connect(t, async () => new Response(Buffer.from("c7ebcef0c6b5b7b1b5c7c2bc", "hex"), {
    headers: { "content-type": "text/html; charset=UTF-8" },
  }));
  const result = await client.callTool({ name: "get_board_threads", arguments: { board: "Talking", page: 2 } });
  assert.equal(result.isError, true);
  assert.deepEqual(payload(result), { result: "RATE_LIMITED" });
});

test("get_thread keeps its raw HTML response contract", async (t) => {
  const html = "<html><body>existing article output</body></html>";
  let calls = 0;
  const client = await connect(t, async () => {
    calls += 1;
    return htmlResponse(html);
  });
  const result = await client.callTool({ name: "get_thread", arguments: { board: "Talking", article_id: "6454538" } });
  assert.notEqual(result.isError, true);
  assert.deepEqual(payload(result), {
    article_url: "https://bbs.byr.cn/article/Talking/6454538",
    http_status: 200,
    content_type: "text/html; charset=utf-8",
    result: "UNPARSED_PAGE",
    content: html,
  });
  assert.equal(calls, 1);
});
