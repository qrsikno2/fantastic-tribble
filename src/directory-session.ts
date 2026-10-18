import { readCookie } from "./cookie-config.js";
import { fetchForumHtml } from "./forum-http.js";

const SESSION_COOKIES = new Set(["nforum[UTMPKEY]", "nforum[UTMPNUM]", "nforum[UTMPUSERID]"]);
const DIRECTORY_PATH = "/section/ajax_list.json";

function refreshSession(cookie: string, updates: string[]): string {
  const pairs = new Map(cookie.split(";").map((part) => {
    const pair = part.trim();
    const separator = pair.indexOf("=");
    return [pair.slice(0, separator), pair.slice(separator + 1)];
  }));
  for (const update of updates) {
    const [pair, ...attributes] = update.split(";");
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator).trim();
    if (separator < 1 || !SESSION_COOKIES.has(name)) continue;
    const value = pair.slice(separator + 1).trim();
    const attrs = new Map(attributes.map((attribute) => {
      const index = attribute.indexOf("=");
      return index < 0
        ? [attribute.trim().toLowerCase(), ""]
        : [attribute.slice(0, index).trim().toLowerCase(), attribute.slice(index + 1).trim()];
    }));
    const domain = attrs.get("domain")?.toLowerCase().replace(/^\./, "");
    const path = attrs.get("path") ?? "/section";
    if ((domain !== undefined && domain !== "bbs.byr.cn") ||
      !(DIRECTORY_PATH === path || DIRECTORY_PATH.startsWith(path.endsWith("/") ? path : `${path}/`))) continue;
    // 只接收已确认的论坛会话字段；密码、其他域和其他路径的 Cookie 不更新。
    const maxAge = attrs.get("max-age");
    const expires = attrs.get("expires");
    const validMaxAge = maxAge !== undefined && /^-?\d+$/.test(maxAge);
    if ((validMaxAge && Number(maxAge) <= 0) ||
      (!validMaxAge && expires !== undefined && Date.parse(expires) <= Date.now())) {
      throw new Error("AUTH_REQUIRED");
    }
    if (!/^[\x21-\x7e]+$/.test(value) || /[",;\\]/.test(value)) continue;
    pairs.set(name, value);
  }
  return readCookie({ BYR_COOKIE: [...pairs].map(([name, value]) => `${name}=${value}`).join("; ") });
}

// 目录需要多个请求。仅在这次调用内使用论坛刷新的会话，避免旧 Cookie 反复触发登录限流。
export function createDirectorySession(request: typeof fetch, env: NodeJS.ProcessEnv) {
  let cookie: string | undefined;
  return async (url: string) => {
    cookie ??= readCookie(env);
    let updates: string[] = [];
    const response = await fetchForumHtml(url, async (input, init) => {
      const result = await request(input, init);
      if (result.ok) updates = result.headers.getSetCookie();
      return result;
    }, { BYR_COOKIE: cookie });
    if (response.result === "UNPARSED_PAGE" && updates.length > 0) cookie = refreshSession(cookie, updates);
    return response;
  };
}
