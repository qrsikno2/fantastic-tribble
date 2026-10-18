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

function jsonResponse(data) {
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json; charset=utf-8" } });
}

test("tools/list exposes the board directory, board info, paged thread lists, and thread tool", async (t) => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), ["get_board_info", "get_board_threads", "get_thread", "list_boards"]);
  const directory = tools.find(({ name }) => name === "list_boards");
  const info = tools.find(({ name }) => name === "get_board_info");
  const threads = tools.find(({ name }) => name === "get_board_threads");
  assert.deepEqual(directory.inputSchema.required ?? [], []);
  assert.deepEqual(Object.keys(directory.inputSchema.properties), ["section"]);
  assert.equal(directory.inputSchema.properties.section.type, "string");
  assert.equal(directory.annotations.readOnlyHint, true);
  assert.deepEqual(info.inputSchema.required, ["board"]);
  assert.deepEqual(Object.keys(info.inputSchema.properties), ["board"]);
  assert.deepEqual(threads.inputSchema.required, ["board"]);
  assert.equal(threads.inputSchema.properties.page.minimum, 1);
  assert.equal(threads.inputSchema.properties.page.maximum, Number.MAX_SAFE_INTEGER);
});

test("list_boards returns all boards by default or only the requested section", async (t) => {
  const sections = [
    { section: "0", name: "本站站务", section_url: "https://bbs.byr.cn/section/0" },
    { section: "1", name: "北邮校园", section_url: "https://bbs.byr.cn/section/1" },
  ];
  const boards = [
    { board: "Notice", name: "站务公告", board_url: "https://bbs.byr.cn/board/Notice", sections: ["0"] },
    { board: "Talking", name: "谈天说地", board_url: "https://bbs.byr.cn/board/Talking", sections: ["1"] },
  ];
  for (const section of [undefined, "1"]) {
    const urls = [];
    const client = await connect(t, async (url) => {
      urls.push(url);
      switch (url) {
        case "https://bbs.byr.cn/section/ajax_list.json?root=list-section&bo=1":
          return jsonResponse([{ name: 0, desc: "本站站务" }, { name: 1, desc: "北邮校园" }]);
        case "https://bbs.byr.cn/section/ajax_list.json?root=sec-0&bo=1":
          return jsonResponse([{ name: "Notice", desc: "站务公告" }]);
        case "https://bbs.byr.cn/section/ajax_list.json?root=sec-1&bo=1":
          return jsonResponse([{ name: "Talking", desc: "谈天说地" }]);
        default:
          throw new Error(`unexpected request: ${url}`);
      }
    });
    const result = await client.callTool(section === undefined
      ? { name: "list_boards" }
      : { name: "list_boards", arguments: { section } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(payload(result), {
      section: section ?? null,
      sections: section === undefined ? sections : [sections[1]],
      boards: section === undefined ? boards : [boards[1]],
      total_boards: section === undefined ? 2 : 1,
      http_status: 200,
      content_type: "application/json; charset=utf-8",
      result: "OK",
    });
    assert.deepEqual(urls, section === undefined ? [
      "https://bbs.byr.cn/section/ajax_list.json?root=list-section&bo=1",
      "https://bbs.byr.cn/section/ajax_list.json?root=sec-0&bo=1",
      "https://bbs.byr.cn/section/ajax_list.json?root=sec-1&bo=1",
    ] : [
      "https://bbs.byr.cn/section/ajax_list.json?root=list-section&bo=1",
      "https://bbs.byr.cn/section/ajax_list.json?root=sec-1&bo=1",
    ]);
  }
});

test("invalid directory sections fail before any HTTP request", async (t) => {
  let calls = 0;
  const client = await connect(t, async () => {
    calls += 1;
    return jsonResponse([]);
  });
  for (const section of ["", "../1", "https://example.com", "1\n", "a b", 1, null, [], {}]) {
    const result = await client.callTool({ name: "list_boards", arguments: { section } });
    assert.equal(result.isError, true, JSON.stringify(section));
  }
  assert.equal(calls, 0);
});

test("an unknown section is a controlled MCP error without requesting board lists", async (t) => {
  let calls = 0;
  const client = await connect(t, async () => {
    calls += 1;
    return jsonResponse([{ name: 0, desc: "本站站务" }]);
  });
  const result = await client.callTool({ name: "list_boards", arguments: { section: "missing" } });
  assert.equal(result.isError, true);
  assert.deepEqual(payload(result), {
    section: "missing", sections: [], boards: [], total_boards: null,
    http_status: 200, content_type: "application/json; charset=utf-8", result: "SECTION_NOT_FOUND",
  });
  assert.equal(calls, 1);
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
  for (const name of ["get_board_info", "get_board_threads", "list_boards"]) {
    const result = await client.callTool({ name, arguments: name === "list_boards" ? {} : { board: "Talking" } });
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
    for (const name of ["get_board_threads", "list_boards"]) {
      const result = await client.callTool({ name, arguments: name === "list_boards" ? {} : { board: "Talking" } });
      const data = payload(result);
      assert.equal(result.isError, true);
      assert.equal(data.result, expected);
      assert.equal(data.http_status, status);
      assert.deepEqual(name === "list_boards" ? data.boards : data.threads, []);
    }
  }
});

test("malformed directory JSON is an MCP error with no partial data or response-body disclosure", async (t) => {
  for (const failAt of [1, 2, 3]) {
    let calls = 0;
    const privateBody = `invalid JSON containing ${fakeEnv.BYR_COOKIE}`;
    const client = await connect(t, async () => {
      calls += 1;
      return calls === failAt
        ? new Response(privateBody, { headers: { "content-type": "application/json; charset=utf-8" } })
        : jsonResponse(calls === 1
          ? [{ name: 0, desc: "本站站务" }, { name: 1, desc: "北邮校园" }]
          : [{ name: "Notice", desc: "站务公告" }]);
    });
    const result = await client.callTool({ name: "list_boards", arguments: {} });
    assert.equal(result.isError, true);
    assert.deepEqual(payload(result), {
      section: null, sections: [], boards: [], total_boards: null,
      http_status: 200, content_type: "application/json; charset=utf-8", result: "UNPARSED_PAGE",
    });
    assert.equal(JSON.stringify(result).includes(fakeEnv.BYR_COOKIE), false);
    assert.equal(JSON.stringify(result).includes(privateBody), false);
    assert.equal(calls, failAt);
  }
});

test("network failures do not expose exception details or Cookie values", async (t) => {
  const client = await connect(t, async () => { throw new Error(`private request: ${fakeEnv.BYR_COOKIE}`); });
  for (const name of ["get_board_info", "list_boards"]) {
    const result = await client.callTool({ name, arguments: name === "list_boards" ? {} : { board: "Talking" } });
    assert.equal(result.isError, true);
    assert.deepEqual(payload(result), { result: "REQUEST_FAILED" });
    assert.equal(JSON.stringify(result).includes(fakeEnv.BYR_COOKIE), false);
  }
});

test("forum rate limiting is a controlled MCP error, not an encoding failure", async (t) => {
  for (const request of [
    async () => new Response(Buffer.from("c7ebcef0c6b5b7b1b5c7c2bc", "hex"), {
      headers: { "content-type": "text/html; charset=UTF-8" },
    }),
    async () => htmlResponse("too many requests", 429),
  ]) {
    const client = await connect(t, request);
    for (const name of ["get_board_threads", "list_boards"]) {
      const result = await client.callTool({ name, arguments: name === "list_boards" ? {} : { board: "Talking", page: 2 } });
      assert.equal(result.isError, true);
      assert.deepEqual(payload(result), { result: "RATE_LIMITED" });
    }
  }
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
