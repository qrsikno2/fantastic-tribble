import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";
import { boardHtml } from "./fixtures/board-page.mjs";
import { threadPage } from "./fixtures/thread-page.mjs";

const fakeEnv = { BYR_COOKIE: "session=fake-test-cookie" };

test("get_board_threads returns metadata, current page, total pages and threads in one request", async (t) => {
  for (const page of [undefined, 2]) {
    const currentPage = page ?? 1;
    const boardUrl = `https://bbs.byr.cn/board/iwhisper?p=${currentPage}`;
    const html = currentPage === 1 ? boardHtml : boardHtml.replace(/<ol[\s\S]*?<\/ol>/, `<ol class="page-main">
      <li class="page-normal"><a href="/board/IWhisper?p=1">&lt;&lt;</a></li>
      <li class="page-normal"><a href="/board/IWhisper?p=1">1</a></li>
      <li class="page-select"><a>2</a></li>
    </ol>`);
    let calls = 0;
    const client = await connect(t, async (url) => {
      calls += 1;
      assert.equal(url, boardUrl);
      return htmlResponse(html);
    });
    const result = await client.callTool({
      name: "get_board_threads",
      arguments: page === undefined ? { board: "iwhisper" } : { board: "iwhisper", page },
    });
    assert.notEqual(result.isError, true);
    const data = payload(result);
    assert.equal(data.result, "OK");
    assert.equal(data.board, "iwhisper");
    assert.equal(data.board_url, boardUrl);
    assert.equal(data.page, currentPage);
    assert.equal(data.total_pages, 2);
    assert.equal(data.http_status, 200);
    assert.equal(data.content_type, "text/html; charset=utf-8");
    assert.equal(data.threads.length, 1);
    assert.equal(data.threads[0].article_id, "123");
    assert.equal(data.threads[0].article_url, "https://bbs.byr.cn/article/IWhisper/123");
    assert.equal(data.threads[0].title, "示例主题");
    assert.equal(calls, 1);
  }
});

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

test("tools/list exposes board tools and separate structured/raw article tools", async (t) => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), ["get_board_threads", "get_raw_website", "get_thread", "list_boards"]);
  const directory = tools.find(({ name }) => name === "list_boards");
  const threads = tools.find(({ name }) => name === "get_board_threads");
  assert.deepEqual(directory.inputSchema.required ?? [], []);
  assert.deepEqual(Object.keys(directory.inputSchema.properties), ["section"]);
  assert.equal(directory.inputSchema.properties.section.type, "string");
  assert.equal(directory.annotations.readOnlyHint, true);
  assert.deepEqual(threads.inputSchema.required, ["board"]);
  assert.deepEqual(Object.keys(threads.inputSchema.properties), ["board", "page"]);
  assert.equal(threads.inputSchema.properties.page.minimum, 1);
  assert.equal(threads.inputSchema.properties.page.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(threads.annotations.readOnlyHint, true);
  assert.equal(threads.annotations.openWorldHint, true);
  for (const name of ["get_thread", "get_raw_website"]) {
    const article = tools.find((tool) => tool.name === name);
    assert.deepEqual(article.inputSchema.required, ["board", "article_id"]);
    assert.deepEqual(Object.keys(article.inputSchema.properties), ["board", "article_id", "page"]);
    assert.equal(article.inputSchema.properties.article_id.type, "string");
    assert.equal(article.inputSchema.properties.page.minimum, 1);
    assert.equal(article.inputSchema.properties.page.maximum, Number.MAX_SAFE_INTEGER);
    assert.equal(article.annotations.readOnlyHint, true);
    assert.equal(article.annotations.openWorldHint, true);
  }
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
  for (const name of ["get_board_threads", "list_boards", "get_thread", "get_raw_website"]) {
    const result = await client.callTool({ name, arguments: name === "list_boards" ? {} : { board: "Talking", article_id: "6454538" } });
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
  for (const name of ["get_board_threads", "list_boards", "get_thread", "get_raw_website"]) {
    const result = await client.callTool({ name, arguments: name === "list_boards" ? {} : { board: "Talking", article_id: "6454538" } });
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
    for (const name of ["get_board_threads", "list_boards", "get_thread", "get_raw_website"]) {
      const result = await client.callTool({ name, arguments: name === "list_boards" ? {} : { board: "Talking", article_id: "6454538", page: 2 } });
      assert.equal(result.isError, true);
      assert.deepEqual(payload(result), { result: "RATE_LIMITED" });
    }
  }
});

test("get_raw_website preserves raw HTML and requests the selected article page", async (t) => {
  const html = "<!doctype html>\n<html><body>原始 HTML &amp; <script>const x = 1;</script></body></html>\n";
  let calls = 0;
  const client = await connect(t, async (url) => {
    calls += 1;
    assert.equal(url, "https://bbs.byr.cn/article/Talking/6454538?p=3");
    return htmlResponse(html);
  });
  const result = await client.callTool({ name: "get_raw_website", arguments: { board: "Talking", article_id: "6454538", page: 3 } });
  assert.notEqual(result.isError, true);
  assert.deepEqual(payload(result), {
    board: "Talking",
    article_id: "6454538",
    page: 3,
    article_url: "https://bbs.byr.cn/article/Talking/6454538?p=3",
    http_status: 200,
    content_type: "text/html; charset=utf-8",
    result: "OK",
    content: html,
  });
  assert.equal(calls, 1);
});

test("article tools reject malformed arguments before HTTP requests", async (t) => {
  let calls = 0;
  const client = await connect(t, async () => {
    calls += 1;
    return htmlResponse("");
  });
  const base = { board: "Talking", article_id: "6454538" };
  for (const name of ["get_thread", "get_raw_website"]) {
    for (const invalid of [
      { board: "../Talking" }, { board: "https://example.com" }, { board: "Talking\n" },
      { article_id: "0" }, { article_id: "01" }, { article_id: "1\n" },
      { article_id: "1/../../other" }, { article_id: "https://example.com" },
      { article_id: "-1" }, { article_id: "1.0" }, { article_id: 1 },
      { page: 0 }, { page: 1.5 }, { page: Number.MAX_SAFE_INTEGER + 1 }, { page: "2" },
    ]) {
      const result = await client.callTool({ name, arguments: { ...base, ...invalid } });
      assert.equal(result.isError, true, `${name}: ${JSON.stringify(invalid)}`);
    }
    for (const args of [{}, { url: "https://example.com" }, { board: "Talking" }, { article_id: "6454538" }]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, `${name}: ${JSON.stringify(args)}`);
    }
  }
  assert.equal(calls, 0);
});

test("get_thread reports unreadable pages without exposing raw HTML", async (t) => {
  for (const [html, status, expected] of [
    ["<html><body>private unknown page</body></html>", 200, "UNPARSED_PAGE"],
    ["<p>您未登录,请登录后继续操作</p>", 200, "AUTH_REQUIRED"],
    ["<html><body>private server failure</body></html>", 503, "HTTP_ERROR"],
  ]) {
    const client = await connect(t, async () => htmlResponse(html, status));
    const result = await client.callTool({ name: "get_thread", arguments: { board: "Talking", article_id: "6454538" } });
    const data = payload(result);
    assert.equal(result.isError, true);
    assert.equal(data.result, expected);
    assert.equal(data.http_status, status);
    assert.equal(Object.hasOwn(data, "content"), false);
    assert.equal(JSON.stringify(data).includes(html), false);
  }
});

test("get_thread returns topic, owner, hot replies, and requested-page floors without raw HTML", async (t) => {
  for (const page of [1, 2]) {
    let calls = 0;
    const html = threadPage({ page });
    const articleUrl = `https://bbs.byr.cn/article/Talking/6454538${page === 1 ? "" : `?p=${page}`}`;
    const client = await connect(t, async (url) => {
      calls += 1;
      assert.equal(url, articleUrl);
      return htmlResponse(html);
    });
    const result = await client.callTool({ name: "get_thread", arguments: { board: "Talking", article_id: "6454538", page } });
    const data = payload(result);
    assert.notEqual(result.isError, true);
    assert.equal(data.result, "OK");
    assert.equal(data.board, "Talking");
    assert.equal(data.article_id, "6454538");
    assert.equal(data.article_url, articleUrl);
    assert.equal(data.page, page);
    assert.equal(data.total_pages, 2);
    assert.equal(data.thread.topic, "示例主题 & 讨论");
    assert.deepEqual(data.thread.replies.map(({ floor }) => floor), page === 1 ? [1, 2, 3, 6] : [17, 18]);
    assert.deepEqual(data.thread.hot_replies.map(({ floor }) => floor), page === 1 ? [6, 17] : []);
    if (page === 1) {
      assert.equal(data.thread.original_post.floor, 0);
      assert.equal(data.thread.original_post.author, "DemoOwner");
      assert.match(data.thread.original_post.content, /第一段正文/);
    } else {
      assert.equal(data.thread.original_post, null);
    }
    assert.equal(Object.hasOwn(data, "content"), false);
    assert.equal(JSON.stringify(data).includes('<div class="b-head">'), false);
    assert.equal(calls, 1);
  }
});

test("get_raw_website reports HTTP and authentication failures as MCP errors", async (t) => {
  for (const [html, status, expected, content] of [
    ["<p>您未登录,请登录后继续操作</p>", 200, "AUTH_REQUIRED", "<p>您未登录,请登录后继续操作</p>"],
    ["private server failure", 503, "HTTP_ERROR", ""],
  ]) {
    const client = await connect(t, async () => htmlResponse(html, status));
    const result = await client.callTool({ name: "get_raw_website", arguments: { board: "Talking", article_id: "6454538" } });
    const data = payload(result);
    assert.equal(result.isError, true);
    assert.equal(data.result, expected);
    assert.equal(data.http_status, status);
    assert.equal(data.page, 1);
    assert.equal(data.article_url, "https://bbs.byr.cn/article/Talking/6454538");
    assert.equal(data.content, content);
  }
});
