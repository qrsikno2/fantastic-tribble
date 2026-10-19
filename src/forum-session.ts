import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Cookie, CookieJar, defaultPath, pathMatch, type SerializedCookieJar } from "tough-cookie";
import { readCookie } from "./cookie-config.js";
import { fetchForumHtml, type ForumHtmlResponse } from "./forum-http.js";
import { loadSessionCookieFile, saveSessionCookieFile, type StoredSession } from "./session-cookie-file.js";

export type ForumPageReader = (url: string) => Promise<ForumHtmlResponse>;
export type ForumSessionOptions = { cookieFile?: string | null };

const ORIGIN = "https://bbs.byr.cn";
const PASSWORD = "nforum[PASSWORD]";
const USER = "nforum[UTMPUSERID]";
const LOGIN_FIELDS = new Set([PASSWORD, USER, "nforum[USERID]", "nforum[UTMPKEY]", "nforum[UTMPNUM]"]);
const SESSION_FIELDS = [USER, "nforum[UTMPKEY]", "nforum[UTMPNUM]"];

function validateUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("URL_INVALID"); }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash ||
    !/^\/(?:section\/ajax_list\.json|board\/[A-Za-z][A-Za-z0-9_-]*|article\/[A-Za-z][A-Za-z0-9_-]*\/[1-9][0-9]*)$/.test(url.pathname)) {
    throw new Error("URL_INVALID");
  }
  return url;
}

function snapshot(jar: CookieJar): SerializedCookieJar {
  return jar.serializeSync()!;
}

function restore(data: SerializedCookieJar): CookieJar {
  try {
    if (!Array.isArray(data.cookies) || data.cookies.length > 256) throw new Error();
    for (const value of data.cookies) {
      const cookie = Cookie.fromJSON(value);
      if (!cookie || cookie.domain !== "bbs.byr.cn" || !cookie.path?.startsWith("/")) throw new Error();
      readCookie({ BYR_COOKIE: cookie.cookieString() });
    }
    return CookieJar.deserializeSync(data);
  } catch { throw new Error("SESSION_STORAGE_ERROR"); }
}

function seedJar(header: string): CookieJar {
  const jar = new CookieJar(undefined, { prefixSecurity: "strict" });
  try {
    // 导入的请求头没有属性。只作为本站根路径的初始 Cookie，不推测其原始期限。
    for (const pair of header.split(";")) jar.setCookieSync(`${pair.trim()}; Path=/; Secure`, ORIGIN);
  } catch { throw new Error("COOKIE_INVALID"); }
  return jar;
}

function liveCookies(jar: CookieJar, url: string): Cookie[] {
  // 保留过期登录项的记录供后续路径判断；不能因读取另一条路径就抹掉失效证据。
  return jar.getCookiesSync(url, { sort: true, expire: false })
    .filter((cookie) => (cookie.expiryTime() ?? Infinity) > Date.now());
}

function cookieHeader(jar: CookieJar, url: string): string {
  return readCookie({ BYR_COOKIE: liveCookies(jar, url).map((cookie) => cookie.cookieString()).join("; ") });
}

function activeCookies(jar: CookieJar, url: string): Map<string, Cookie> {
  const cookies = new Map<string, Cookie>();
  for (const cookie of liveCookies(jar, url)) {
    if (!cookies.has(cookie.key)) cookies.set(cookie.key, cookie);
  }
  return cookies;
}

function isGuest(value: string): boolean {
  return value === "" || /^(?:guest|anonymous)$/i.test(value);
}

function parseUpdates(headers: string[], url: URL): Cookie[] {
  const cookies: Cookie[] = [];
  const now = Date.now();
  for (const header of headers) {
    const cookie = Cookie.parse(header);
    if (!cookie || !cookie.key || /[^\x21-\x7e]|[",;\\]/.test(cookie.value) ||
      /[\s;=]/.test(cookie.key)) continue;
    if (cookie.domain !== null && cookie.canonicalizedDomain() !== "bbs.byr.cn") continue;
    cookie.path ??= defaultPath(url.pathname);
    if (LOGIN_FIELDS.has(cookie.key) && !pathMatch(url.pathname, cookie.path)) continue;
    // 固定接收时刻的有效期限，避免读取 jar 或重启导致 Max-Age 被重新计时。
    if (cookie.maxAge !== null) {
      const seconds = Number(cookie.maxAge);
      if (!Number.isFinite(seconds)) continue;
      const deadline = seconds <= 0 ? 0 : now + seconds * 1000;
      if (!Number.isFinite(deadline) || deadline > 8.64e15) continue;
      cookie.expires = new Date(deadline);
      cookie.maxAge = null;
    }
    cookies.push(cookie);
  }
  return cookies;
}

function hasExpiredLogin(jar: CookieJar, url: URL): boolean {
  const cookies = snapshot(jar).cookies.map((raw) => Cookie.fromJSON(raw)!);
  const now = Date.now();
  const applicable = cookies.filter((cookie) => pathMatch(url.pathname, cookie.path!));
  return applicable.some((cookie) => LOGIN_FIELDS.has(cookie.key) &&
    (cookie.expiryTime() ?? Infinity) <= now &&
    !applicable.some((replacement) => replacement.key === cookie.key &&
      !!replacement.value && (replacement.expiryTime() ?? Infinity) > now));
}

// 每个 MCP server 持有一个 reader。队列覆盖请求、响应读取、合并与落盘，避免旧响应覆盖新会话。
// 创建 reader 不读取环境变量/文件；RSS 不调用它，因此也不触碰认证状态。
export function createForumSession(
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
  options: ForumSessionOptions = {},
): ForumPageReader {
  let jar: CookieJar | undefined;
  let file: string | null;
  let seedHash: string | null = null;
  let invalidated = false;
  let needsSave = false;
  let queue: Promise<unknown> = Promise.resolve();

  async function initialize(): Promise<void> {
    if (jar !== undefined) return;
    const rawSeed = env.BYR_COOKIE;
    const seed = rawSeed === undefined ? undefined : readCookie({ BYR_COOKIE: rawSeed });
    const hash = seed === undefined ? null : createHash("sha256").update(seed).digest("hex");
    file = options.cookieFile === null ? null : resolve(options.cookieFile ?? env.BYR_COOKIE_FILE ?? "data/session-cookie.txt");
    const stored = file === null ? null : await loadSessionCookieFile(file);
    if (stored !== null && (seed === undefined || hash === stored.seed_hash)) {
      jar = restore(stored.jar);
      seedHash = stored.seed_hash;
      invalidated = stored.invalidated ?? false;
    } else {
      if (seed === undefined) throw new Error("AUTH_REQUIRED");
      // 不同的新环境 Cookie 是显式换号/重新登录；同一旧种子永远不覆盖已保存会话。
      jar = seedJar(seed);
      seedHash = hash;
      needsSave = true;
    }
  }

  async function commit(candidate: CookieJar, expired = false): Promise<void> {
    const state: StoredSession = { version: 1, seed_hash: seedHash, invalidated: expired, jar: snapshot(candidate) };
    if (state.jar.cookies.length > 256) throw new Error("COOKIE_INVALID");
    if (file !== null) await saveSessionCookieFile(file, state);
    jar = candidate;
    invalidated = expired;
    needsSave = false;
  }

  async function read(url: string): Promise<ForumHtmlResponse> {
    const target = validateUrl(url);
    await initialize();
    if (invalidated) throw new Error("AUTH_REQUIRED");
    if (hasExpiredLogin(jar!, target)) {
      await commit(jar!, true);
      throw new Error("AUTH_REQUIRED");
    }
    // 用副本做读取和更新。落盘失败时仍保留原内存状态。
    let candidate = restore(snapshot(jar!));
    const before = activeCookies(candidate, url);
    // 存储中已有登录字段时，不允许在作用域外只带偏好 Cookie 发游客请求。
    if (snapshot(candidate).cookies.some((cookie) => LOGIN_FIELDS.has(cookie.key!) &&
      !before.get(cookie.key!)?.value)) throw new Error("AUTH_REQUIRED");
    const header = cookieHeader(candidate, url);
    let updates: string[] = [];
    const response = await fetchForumHtml(url, async (input, init) => {
      const result = await request(input, init);
      if (result.ok) updates = result.headers.getSetCookie();
      return result;
    }, { BYR_COOKIE: header });
    if (response.result !== "UNPARSED_PAGE") return response;

    const parsed = parseUpdates(updates, target);
    // 先在探测副本中按顺序合并，检查最终有效 PASSWORD，不能被其它路径/已删除密码放行。
    const probe = restore(snapshot(candidate));
    const finalUpdates = new Map<string, Cookie>();
    for (const cookie of parsed) {
      try {
        if (probe.setCookieSync(cookie, url)) finalUpdates.set(JSON.stringify([cookie.domain, cookie.path, cookie.key]), cookie);
      } catch { /* 不接受非法属性或前缀，不透传其中的值。 */ }
    }
    const accepted = [...finalUpdates.values()];
    const after = activeCookies(probe, url);
    const guestBatch = accepted.some((cookie) =>
      [USER, "nforum[USERID]"].includes(cookie.key) && /^(?:guest|anonymous)$/i.test(cookie.value));
    const newPassword = accepted.some((cookie) => cookie.key === PASSWORD) &&
      after.has(PASSWORD) && !!after.get(PASSWORD)!.value &&
      accepted.some((cookie) => cookie.key === PASSWORD && cookie.value === after.get(PASSWORD)!.value &&
        cookie.path === after.get(PASSWORD)!.path && (cookie.expiryTime() ?? Infinity) > Date.now());
    const changedUser = [USER, "nforum[USERID]"].some((key) =>
      !!after.get(key)?.value && after.get(key)!.value !== before.get(key)?.value);
    const completeSwitch = !changedUser || (newPassword && SESSION_FIELDS.every((key) =>
      accepted.some((cookie) => cookie.key === key && cookie.value === after.get(key)?.value &&
        cookie.domain === after.get(PASSWORD)?.domain && cookie.path === after.get(PASSWORD)?.path)));
    const hadLogin = !!before.get(PASSWORD)?.value && !!before.get(USER)?.value && !isGuest(before.get(USER)!.value);
    if (changedUser && completeSwitch && !guestBatch) {
      const old = snapshot(candidate);
      candidate = restore({ ...old, cookies: old.cookies.filter((cookie) => !LOGIN_FIELDS.has(cookie.key!)) });
    }
    const deletedFields = new Set<string>();
    for (const cookie of accepted) {
      if (LOGIN_FIELDS.has(cookie.key)) {
        if (guestBatch || !completeSwitch) continue;
        const deleting = !cookie.value || (cookie.expiryTime() ?? Infinity) <= Date.now();
        if (deleting) {
          // 明确删除当前登录字段时标记失效，防止环境中的旧 Cookie 在重启后复活。
          if (snapshot(candidate).cookies.some((previous) => previous.key === cookie.key &&
            previous.domain === cookie.domain && previous.path === cookie.path)) deletedFields.add(cookie.key);
        } else if (!newPassword && (cookie.key === PASSWORD || !hadLogin)) continue;
      }
      candidate.setCookieSync(cookie, url);
    }
    const finalCookies = activeCookies(candidate, url);
    const expired = [...deletedFields].some((key) => !finalCookies.get(key)?.value);
    if (!expired) cookieHeader(candidate, url);
    if (needsSave || accepted.length > 0 || expired) await commit(candidate, expired);
    if (expired) throw new Error("AUTH_REQUIRED");
    return response;
  }

  return (url) => {
    const result = queue.then(() => read(url));
    queue = result.catch(() => undefined);
    return result;
  };
}
