import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("入口正常退出，仅向 stderr 输出诊断", () => {
  const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const result = spawnSync(process.execPath, [entry], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    board: "Talking",
    article_id: "6454538",
    page: 1,
    article_url: "https://bbs.byr.cn/article/Talking/6454538",
  });
});
