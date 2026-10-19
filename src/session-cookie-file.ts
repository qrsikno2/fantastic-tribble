import { randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
import type { SerializedCookieJar } from "tough-cookie";

export type StoredSession = {
  version: 1;
  seed_hash: string | null;
  invalidated?: boolean;
  jar: SerializedCookieJar;
};

const MAX_SESSION_BYTES = 128 * 1024;

function storageError(): Error {
  return new Error("SESSION_STORAGE_ERROR");
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSession(value: unknown): asserts value is StoredSession {
  if (!isObject(value) || value.version !== 1 ||
    (value.seed_hash !== null && (typeof value.seed_hash !== "string" || !/^[a-f0-9]{64}$/.test(value.seed_hash))) ||
    (value.invalidated !== undefined && typeof value.invalidated !== "boolean") ||
    !isObject(value.jar) || typeof value.jar.version !== "string" || !value.jar.version ||
    !Array.isArray(value.jar.cookies)) throw storageError();
  const jar = value.jar;
  for (const name of ["rejectPublicSuffixes", "enableLooseMode", "allowSpecialUseDomain", "allowSecureOnLocal"]) {
    if (jar[name] !== undefined && typeof jar[name] !== "boolean") throw storageError();
  }
  if (jar.storeType !== undefined && jar.storeType !== null && typeof jar.storeType !== "string") throw storageError();
  for (const cookie of jar.cookies as unknown[]) {
    if (!isObject(cookie) || typeof cookie.key !== "string" || cookie.key === "") throw storageError();
    for (const name of ["value", "domain", "path", "sameSite"]) {
      if (cookie[name] !== undefined && typeof cookie[name] !== "string") throw storageError();
    }
    // tough-cookie's fromJSON accepts invalid dates, then toJSON throws when it
    // calls toISOString. Validate before constructing a jar from persisted data.
    // Its serialized date fields explicitly support the string "Infinity".
    for (const name of ["creation", "lastAccessed", "expires"]) {
      const date = cookie[name];
      if (date !== undefined && (typeof date !== "string" ||
        (date !== "Infinity" && !Number.isFinite(Date.parse(date))))) throw storageError();
    }
    for (const name of ["secure", "httpOnly", "hostOnly", "pathIsDefault"]) {
      if (cookie[name] !== undefined && typeof cookie[name] !== "boolean") throw storageError();
    }
    if (cookie.maxAge !== undefined && cookie.maxAge !== "Infinity" && cookie.maxAge !== "-Infinity" &&
      (typeof cookie.maxAge !== "number" || !Number.isFinite(cookie.maxAge))) throw storageError();
  }
}

function checkFile(stats: Stats): void {
  if (!stats.isFile() || (process.getuid !== undefined && stats.uid !== process.getuid())) throw storageError();
}

// Check every ancestor, not just the final directory. Node's path-based filesystem
// API cannot prevent another process from replacing an ancestor between checks.
async function checkDirectories(directory: string, create: boolean): Promise<boolean> {
  const root = parse(directory).root;
  let current = root;
  for (const component of relative(root, directory).split(sep).filter(Boolean)) {
    current = join(current, component);
    let stats: Stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (!create) return false;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!(isObject(mkdirError) && mkdirError.code === "EEXIST")) throw mkdirError;
      }
      stats = await lstat(current);
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw storageError();
  }
  return true;
}

async function checkTarget(path: string): Promise<void> {
  try {
    checkFile(await lstat(path));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export async function loadSessionCookieFile(path: string): Promise<StoredSession | null> {
  let handle: FileHandle | undefined;
  try {
    const target = resolve(path);
    if (!await checkDirectories(dirname(target), false)) return null;
    try {
      // NONBLOCK ensures a malicious FIFO is rejected by fstat without hanging.
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    const stats = await handle.stat();
    checkFile(stats);
    if (stats.size > MAX_SESSION_BYTES) throw storageError();
    if ((stats.mode & 0o7777) !== 0o600) await handle.chmod(0o600);
    const buffer = Buffer.alloc(MAX_SESSION_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > MAX_SESSION_BYTES) throw storageError();
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
    validateSession(value);
    await handle.close();
    handle = undefined;
    return value;
  } catch {
    throw storageError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function saveSessionCookieFile(path: string, state: StoredSession): Promise<void> {
  let handle: FileHandle | undefined;
  let temporary: string | undefined;
  let temporaryStats: Stats | undefined;
  try {
    validateSession(state);
    const content = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(content, "utf8") > MAX_SESSION_BYTES) throw storageError();
    const target = resolve(path);
    const directory = dirname(target);
    await checkDirectories(directory, true);
    await checkTarget(target);
    const candidate = join(directory, `.${basename(target)}.${randomBytes(12).toString("hex")}.tmp`);
    handle = await open(candidate, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    temporary = candidate;
    temporaryStats = await handle.stat();
    await handle.chmod(0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (!await checkDirectories(directory, false)) throw storageError();
    await checkTarget(target);
    await rename(temporary, target);
    temporary = undefined;
  } catch {
    throw storageError();
  } finally {
    await handle?.close().catch(() => undefined);
    if (temporary !== undefined && temporaryStats !== undefined) {
      // Only remove the file created by this operation, even after a failed rename.
      try {
        const stats = await lstat(temporary);
        if (stats.ino === temporaryStats.ino && stats.dev === temporaryStats.dev) await unlink(temporary);
      } catch {
        // Keep the original normalized error; cleanup must not expose paths.
      }
    }
  }
}
