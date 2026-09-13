import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readCookie } from "../dist/cookie-config.js";

const fakeCookie = "nforum[UTMPUSERID]=demo; session=fake==; empty=";

test("读取环境变量，保留方括号名称及带等号的值", () => {
  const env = Object.freeze({ BYR_COOKIE: `  ${fakeCookie}  ` });
  assert.equal(readCookie(env), fakeCookie);
  assert.equal(env.BYR_COOKIE, `  ${fakeCookie}  `);
});

for (const value of [undefined, "", "   "]) {
  test(`缺少 Cookie：${String(value)}`, () => {
    assert.throws(() => readCookie({ BYR_COOKIE: value }), { message: "AUTH_REQUIRED" });
  });
}

for (const value of [
  null, 123, "session=fake\r\nX-Injected: yes", "session=fake\n", "session=fake\t",
  "session=中文", "missing_equals", "=fake", "bad name=fake", "session=fake;",
  "Cookie: session=fake", "Cookie:session=fake", "${BYR_COOKIE}", "${env:BYR_COOKIE}",
  `session=${"x".repeat(8192)}`,
]) {
  test(`非法 Cookie：${typeof value}，长度 ${String(value).length}`, () => {
    assert.throws(() => readCookie({ BYR_COOKIE: value }), { message: "COOKIE_INVALID" });
  });
}

test("接受恰好 8 KiB 的合法头值", () => {
  const value = `a=${"x".repeat(8190)}`;
  assert.equal(readCookie({ BYR_COOKIE: value }), value);
});

// 子进程只接收此处构造的环境、临时 .env；不继承真实 Cookie 或读取项目 .env。
function runWithFakeEnvironment(t, fileContent, env, expected) {
  const directory = mkdtempSync(join(tmpdir(), "fantastic-tribble-env-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  if (fileContent !== null) {
    writeFileSync(join(directory, ".env"), fileContent, { mode: 0o600 });
  }
  const moduleUrl = new URL("../dist/cookie-config.js", import.meta.url).href;
  const source = `
    import assert from "node:assert/strict";
    import { readCookie } from ${JSON.stringify(moduleUrl)};
    if (${JSON.stringify(expected)} === "AUTH_REQUIRED") {
      assert.throws(() => readCookie(), { message: "AUTH_REQUIRED" });
    } else {
      assert.equal(readCookie(), ${JSON.stringify(expected)});
    }
    console.log("OK");
  `;
  const result = spawnSync(process.execPath, [
    "--env-file-if-exists=.env", "--input-type=module", "-e", source,
  ], { cwd: directory, env, encoding: "utf8", timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "OK");
  assert.equal(result.stderr.includes("from-file"), false);
  assert.equal(result.stderr.includes("from-hermes"), false);
}

test("本地 .env 可以供统一读取函数使用", (t) => {
  runWithFakeEnvironment(t, 'BYR_COOKIE="session=from-file; preference=a#b"\n', {}, "session=from-file; preference=a#b");
});

test("Hermes 注入的环境变量优先于本地 .env", (t) => {
  runWithFakeEnvironment(t, 'BYR_COOKIE="session=from-file"\n', { BYR_COOKIE: "session=from-hermes" }, "session=from-hermes");
});

test("只有环境变量、没有 .env 时也可运行", (t) => {
  runWithFakeEnvironment(t, null, { BYR_COOKIE: "session=from-hermes" }, "session=from-hermes");
});

test("显式注入空值时不回退使用文件里的旧凭据", (t) => {
  runWithFakeEnvironment(t, 'BYR_COOKIE="session=from-file"\n', { BYR_COOKIE: "" }, "AUTH_REQUIRED");
});

test("两种来源都未配置时明确需要登录态", (t) => {
  runWithFakeEnvironment(t, null, {}, "AUTH_REQUIRED");
});

test("启动命令加载可选 .env，不恢复 probe", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.start, "node --env-file-if-exists=.env dist/index.js");
  assert.equal(Object.hasOwn(pkg.scripts, "probe"), false);
});
