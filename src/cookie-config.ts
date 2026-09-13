const MAX_COOKIE_LENGTH = 8 * 1024;

export function readCookie(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.BYR_COOKIE;
  if (raw === undefined || raw === "") throw new Error("AUTH_REQUIRED");

  if (
    typeof raw !== "string" ||
    raw.length > MAX_COOKIE_LENGTH ||
    /[^\x20-\x7e]/.test(raw)
  ) {
    throw new Error("COOKIE_INVALID");
  }

  const cookie = raw.trim();
  if (cookie === "") throw new Error("AUTH_REQUIRED");
  if (/^cookie:/i.test(cookie)) throw new Error("COOKIE_INVALID");

  for (const part of cookie.split(";")) {
    const pair = part.trim();
    const separator = pair.indexOf("=");
    if (separator < 1 || /\s/.test(pair.slice(0, separator))) {
      throw new Error("COOKIE_INVALID");
    }
  }

  return cookie;
}
