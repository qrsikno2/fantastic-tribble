import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("npm package includes the executable and current compiled modules without credentials or stale files", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "forumcp-pack-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../", import.meta.url));
  // npm test already builds; skip lifecycle scripts to avoid a recursive build.
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
    "pack", "--dry-run", "--ignore-scripts", "--json", "--cache", directory,
  ], { cwd: root, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const [packed] = Array.isArray(report) ? report : Object.values(report);
  const files = packed.files.map(file => file.path).sort();
  const compiled = readdirSync(join(root, "src"))
    .filter(file => file.endsWith(".ts"))
    .map(file => `dist/${file.replace(/\.ts$/, ".js")}`);
  assert.deepEqual(files, ["README.md", "package.json", ...compiled].sort());
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.bin[pkg.name], "dist/index.js");
  assert.ok(readFileSync(join(root, pkg.bin[pkg.name]), "utf8").startsWith("#!/usr/bin/env node\n"));
});
