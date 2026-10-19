import assert from "node:assert/strict";
import { promises as fsPromises } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CookieJar } from "tough-cookie";
import { loadSessionCookieFile, saveSessionCookieFile } from "../dist/session-cookie-file.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "forumcp-session-file-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const jar = new CookieJar();
  await jar.setCookie("session=fake-secret; Domain=bbs.byr.cn; Path=/section; Secure; HttpOnly; Expires=Wed, 01 Jan 2031 00:00:00 GMT", "https://bbs.byr.cn/section/");
  await jar.setCookie("empty=; Path=/", "https://bbs.byr.cn/");
  return { directory, path: join(directory, "data", "session-cookie.txt"),
    state: { version: 1, seed_hash: "a".repeat(64), jar: await jar.serialize() } };
}

function storageError(error) {
  assert.equal(error.message, "SESSION_STORAGE_ERROR");
  assert.equal(Object.hasOwn(error, "path"), false);
  assert.equal(Object.hasOwn(error, "cause"), false);
  return true;
}

test("会话文件往返保留完整Cookie属性，新目录700且文件600", async (t) => {
  const { directory, path, state } = await fixture(t);
  await saveSessionCookieFile(path, state);
  assert.deepEqual(await loadSessionCookieFile(path), state);
  assert.equal((await lstat(join(directory, "data"))).mode & 0o777, 0o700);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  const restored = CookieJar.deserializeSync((await loadSessionCookieFile(path)).jar);
  assert.equal(await restored.getCookieString("https://bbs.byr.cn/section/list"), "session=fake-secret; empty=");
  assert.equal(await restored.getCookieString("https://bbs.byr.cn/article/Health/1"), "empty=");
  assert.deepEqual(await readdir(join(directory, "data")), ["session-cookie.txt"]);
});

test("缺失文件和父目录返回null，读取会收紧已有文件权限", async (t) => {
  const { directory, path, state } = await fixture(t);
  assert.equal(await loadSessionCookieFile(path), null);
  assert.deepEqual(await readdir(directory), []);
  await mkdir(join(directory, "data"));
  assert.equal(await loadSessionCookieFile(path), null);
  await writeFile(path, JSON.stringify(state), { mode: 0o644 });
  await chmod(path, 0o644);
  assert.deepEqual(await loadSessionCookieFile(path), state);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
});

test("坏JSON、未知版本、非法种子散列及损坏jar均归一为安全错误", async (t) => {
  const { directory, path, state } = await fixture(t);
  await mkdir(join(directory, "data"));
  for (const content of [
    "not-json-fake-secret", "null", "[]", "{}",
    JSON.stringify({ ...state, version: 2 }),
    JSON.stringify({ ...state, seed_hash: "not-a-hash-fake-secret" }),
    JSON.stringify({ ...state, invalidated: "not-boolean" }),
    JSON.stringify({ ...state, jar: {} }),
    JSON.stringify({ ...state, jar: { ...state.jar, cookies: "fake-secret" } }),
    JSON.stringify({ ...state, jar: { ...state.jar, cookies: [null] } }),
    JSON.stringify({ ...state, jar: { ...state.jar, cookies: [{ key: "session", value: 123 }] } }),
    Buffer.from([0xff, 0xfe]),
  ]) {
    await writeFile(path, content, { mode: 0o600 });
    await assert.rejects(loadSessionCookieFile(path), storageError);
  }
});

test("读取大小有界，超限存储拒绝且原文件保持不变", async (t) => {
  const { path, state } = await fixture(t);
  await saveSessionCookieFile(path, state);
  const original = await readFile(path);
  const oversized = structuredClone(state);
  oversized.jar.cookies[0].value = "s".repeat(128 * 1024);
  await assert.rejects(saveSessionCookieFile(path, oversized), storageError);
  assert.deepEqual(await readFile(path), original);
  await writeFile(path, " ".repeat(128 * 1024 + 1));
  await assert.rejects(loadSessionCookieFile(path), storageError);
});

test("三个日期字段拒绝Invalid Date，避免tough-cookie再次序列化时抛异常", async (t) => {
  const { path, state } = await fixture(t);
  await saveSessionCookieFile(path, state);
  const original = await readFile(path);
  for (const field of ["expires", "creation", "lastAccessed"]) {
    for (const date of ["invalid-date", "", "2026-99-99T00:00:00.000Z", "999999999999999999999", 123, null]) {
      const invalid = structuredClone(state);
      invalid.jar.cookies[0][field] = date;
      await assert.rejects(saveSessionCookieFile(path, invalid), storageError);
      assert.deepEqual(await readFile(path), original);
      await writeFile(path, JSON.stringify(invalid));
      await assert.rejects(loadSessionCookieFile(path), storageError);
      await writeFile(path, original);
    }
  }
});

test("合法日期及Infinity标记和有限Max-Age可被CookieJar安全恢复并序列化", async (t) => {
  const { path, state } = await fixture(t);
  for (const date of ["2031-01-01T00:00:00.000Z", "Infinity"]) {
    for (const maxAge of [-1, 0, 600, Number.MAX_VALUE, "Infinity", "-Infinity"]) {
      const valid = structuredClone(state);
      Object.assign(valid.jar.cookies[0], { expires: date, creation: date, lastAccessed: date, maxAge });
      await saveSessionCookieFile(path, valid);
      const loaded = await loadSessionCookieFile(path);
      assert.deepEqual(loaded, valid);
      const restored = CookieJar.deserializeSync(loaded.jar);
      assert.doesNotThrow(() => restored.serializeSync());
    }
  }
  for (const maxAge of [NaN, Infinity, -Infinity, "600", null, {}]) {
    const invalid = structuredClone(state);
    invalid.jar.cookies[0].maxAge = maxAge;
    await assert.rejects(saveSessionCookieFile(path, invalid), storageError);
  }
});

test("拒绝目标符号链接和非普通文件，既有文件内容及权限不受影响", async (t) => {
  const { directory, state } = await fixture(t);
  const source = join(directory, "original.txt");
  const link = join(directory, "session-link.txt");
  const folder = join(directory, "folder");
  await writeFile(source, "fake-secret-original", { mode: 0o644 });
  await symlink(source, link);
  await mkdir(folder);
  for (const path of [link, folder]) {
    await assert.rejects(loadSessionCookieFile(path), storageError);
    await assert.rejects(saveSessionCookieFile(path, state), storageError);
  }
  assert.equal(await readFile(source, "utf8"), "fake-secret-original");
  assert.equal((await lstat(source)).mode & 0o777, 0o644);
  assert.equal((await lstat(link)).isSymbolicLink(), true);
});

test("拒绝父目录及更高祖先的符号链接，不在链接目的地创建文件", async (t) => {
  const { directory, state } = await fixture(t);
  const actual = join(directory, "actual");
  const linked = join(directory, "linked");
  await mkdir(actual);
  await symlink(actual, linked);
  for (const path of [join(linked, "session.txt"), join(linked, "nested", "session.txt")]) {
    await assert.rejects(loadSessionCookieFile(path), storageError);
    await assert.rejects(saveSessionCookieFile(path, state), storageError);
  }
  assert.deepEqual(await readdir(actual), []);
});

test("更新原子替换现有文件，验证失败保留原文件且不留临时文件", async (t) => {
  const { directory, path, state } = await fixture(t);
  await saveSessionCookieFile(path, state);
  const firstInode = (await lstat(path)).ino;
  const next = structuredClone(state);
  next.seed_hash = null;
  next.invalidated = true;
  next.jar.cookies[0].value = "fake-updated";
  await saveSessionCookieFile(path, next);
  assert.notEqual((await lstat(path)).ino, firstInode);
  assert.deepEqual(await loadSessionCookieFile(path), next);
  const original = await readFile(path);
  await assert.rejects(saveSessionCookieFile(path, { ...state, version: 9 }), storageError);
  assert.deepEqual(await readFile(path), original);
  assert.deepEqual(await readdir(join(directory, "data")), ["session-cookie.txt"]);
});

test("I/O写入失败只暴露归一错误，不破坏已有文件", async (t) => {
  const { directory, path, state } = await fixture(t);
  await saveSessionCookieFile(path, state);
  const original = await readFile(path);
  await assert.rejects(saveSessionCookieFile(join(path, "child"), state), storageError);
  await assert.rejects(saveSessionCookieFile(join(directory, "\0fake-secret"), state), storageError);
  assert.deepEqual(await readFile(path), original);
  assert.deepEqual(await readdir(join(directory, "data")), ["session-cookie.txt"]);
});

test("临时文件写完后rename失败会清理临时文件并保留旧会话", async (t) => {
  const { directory, path, state } = await fixture(t);
  await saveSessionCookieFile(path, state);
  const original = await readFile(path);
  let reachedRename = false;
  const mocked = t.mock.method(fsPromises, "rename", async (source) => {
    reachedRename = true;
    assert.equal((await lstat(source)).mode & 0o777, 0o600);
    throw new Error(`fake-secret write failure at ${source}`);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(saveSessionCookieFile(path, { ...state, invalidated: true }), storageError);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(reachedRename, true);
  assert.deepEqual(await readFile(path), original);
  assert.deepEqual(await readdir(join(directory, "data")), ["session-cookie.txt"]);
});
