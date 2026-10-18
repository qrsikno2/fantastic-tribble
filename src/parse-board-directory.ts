import { validateBoardParams } from "./board-params.js";

export type ForumSection = { section: string; name: string; section_url: string };
export type DirectoryBoard = { board: string; name: string; board_url: string; sections: string[] };

export function isSectionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) && !/\s/.test(value);
}

function unparsed(): never {
  throw new Error("UNPARSED_PAGE");
}

function entries(content: string): { name: unknown; desc: string }[] {
  const data: unknown = JSON.parse(content);
  if (!Array.isArray(data)) return unparsed();
  return data.map((item: unknown) => {
    if (typeof item !== "object" || item === null || Array.isArray(item) ||
      !("name" in item) || !("desc" in item) ||
      typeof item.desc !== "string" || item.desc.trim() === "") return unparsed();
    return { name: item.name, desc: item.desc.trim() };
  });
}

export function parseSections(content: string): ForumSection[] {
  const items = entries(content);
  // 限制一次全站目录查询的请求数；结构变化不能触发无界请求。
  if (items.length === 0 || items.length > 32) return unparsed();
  const seen = new Set<string>();
  return items.map(({ name, desc }) => {
    const section = typeof name === "number" && Number.isSafeInteger(name) && name >= 0
      ? String(name)
      : name;
    if (!isSectionId(section) || seen.has(section)) return unparsed();
    seen.add(section);
    return { section, name: desc, section_url: `https://bbs.byr.cn/section/${encodeURIComponent(section)}` };
  });
}

export function parseDirectoryBoards(content: string, section: string): DirectoryBoard[] {
  if (!isSectionId(section)) return unparsed();
  const seen = new Set<string>();
  return entries(content).map(({ name, desc }) => {
    if (typeof name !== "string" || seen.has(name)) return unparsed();
    validateBoardParams({ board: name });
    seen.add(name);
    return {
      board: name,
      name: desc,
      board_url: `https://bbs.byr.cn/board/${encodeURIComponent(name)}`,
      sections: [section],
    };
  });
}
