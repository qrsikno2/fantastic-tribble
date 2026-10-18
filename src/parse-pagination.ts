import { DomUtils, parseDocument } from "htmlparser2";
import { sameForumPath } from "./forum-path.js";

type Element = ReturnType<typeof DomUtils.findAll>[number];
type Node = ReturnType<typeof parseDocument>["children"][number];

type Pagination = { page: number; total_pages: number };

function hasClass(node: Element, name: string): boolean {
  return (node.attribs.class ?? "").split(/\s+/).includes(name);
}

function plainText(node: Element | undefined): string | null {
  if (node === undefined) return null;
  return DomUtils.innerText(node).replace(/\s+/g, " ").trim() || null;
}

function positiveInteger(value: string | null): number | null {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function forumUrl(href: string | undefined): URL | null {
  if (!href) return null;
  try {
    const url = new URL(href, "https://bbs.byr.cn");
    return url.origin === "https://bbs.byr.cn" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function unparsed(): never {
  throw new Error("UNPARSED_PAGE");
}

// nForum 的 page-main 始终显示首尾页；不能把帖子行内的 threads-tab 当作页面分页。
export function parsePagination(nodes: Node[], path: string): Pagination {
  const pagers = DomUtils.findAll((node) => node.name === "ol" && hasClass(node, "page-main"), nodes);
  if (pagers.length === 0) return unparsed();
  let result: Pagination | undefined;
  for (const pager of pagers) {
    const items = DomUtils.getElementsByTagName("li", pager.children, false);
    const selected = items.filter((node) => hasClass(node, "page-select"));
    if (selected.length !== 1) return unparsed();
    const page = positiveInteger(plainText(selected[0]));
    if (page === null) return unparsed();
    let lastNumber = 0;
    let omitted = false;
    let previous = false;
    let next = false;
    for (const [index, item] of items.entries()) {
      if (hasClass(item, "page-omit")) {
        if (plainText(item) !== "..." || lastNumber === 0 || omitted || next) return unparsed();
        omitted = true;
        continue;
      }
      const anchors = DomUtils.getElementsByTagName("a", item.children, false);
      if (anchors.length !== 1) return unparsed();
      const anchor = anchors[0];
      const label = plainText(anchor);
      const number = positiveInteger(label);
      const isSelected = hasClass(item, "page-select");
      if (isSelected) {
        if (number !== page || anchor.attribs.href !== undefined) return unparsed();
      } else {
        if (!hasClass(item, "page-normal")) return unparsed();
        const target = number ?? (label === "<<" ? page - 1 : label === ">>" ? page + 1 : null);
        const url = forumUrl(anchor.attribs.href);
        if (target === null || url === null || !sameForumPath(url.pathname, path) ||
          positiveInteger(url.searchParams.get("p")) !== target) return unparsed();
      }
      if (label === "<<" && index === 0 && page > 1) {
        previous = true;
        continue;
      }
      if (label === ">>" && index === items.length - 1 && !omitted) {
        next = true;
        continue;
      }
      if (number === null || number <= lastNumber || next ||
        (lastNumber === 0 ? number !== 1 : (number > lastNumber + 1) !== omitted)) {
        return unparsed();
      }
      lastNumber = number;
      omitted = false;
    }
    // 校验首尾页、省略号和前后页，防止不完整/变更后的分页栏导致页数低估。
    const total_pages = lastNumber;
    if (omitted || total_pages < page || previous !== (page > 1) || next !== (page < total_pages)) {
      return unparsed();
    }
    if (result !== undefined && (result.page !== page || result.total_pages !== total_pages)) {
      return unparsed();
    }
    result = { page, total_pages };
  }
  return result!;
}
