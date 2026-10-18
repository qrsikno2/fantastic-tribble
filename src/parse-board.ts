import { DomUtils, parseDocument } from "htmlparser2";
import { buildArticleUrl } from "./article-url.js";
import { validateBoardParams } from "./board-params.js";

type Element = ReturnType<typeof DomUtils.findAll>[number];
type Node = ReturnType<typeof parseDocument>["children"][number];

export type BoardThread = {
  article_id: string;
  title: string;
  article_url: string;
  author: string | null;
  published_at: string | null;
  reply_count: number | null;
  is_pinned: boolean;
  last_reply_at: string | null;
  last_reply_author: string | null;
};

export type BoardPage = { page: number; total_pages: number; threads: BoardThread[] };

function hasClass(node: Element, name: string): boolean {
  return (node.attribs.class ?? "").split(/\s+/).includes(name);
}

function elements(nodes: Node[], tag: string, className?: string): Element[] {
  return DomUtils.findAll(
    (node) => node.name === tag && (className === undefined || hasClass(node, className)),
    nodes,
  );
}

function directElements(nodes: Node[], tag: string): Element[] {
  return DomUtils.getElementsByTagName(tag, nodes, false);
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

function authorName(cell: Element | undefined): string | null {
  if (cell === undefined) return null;
  const link = elements(cell.children, "a")[0];
  return link === undefined ? (plainText(cell)?.replace(/^\|\s*/, "") || null) : plainText(link);
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

// nForum 的 page-main 始终显示首尾页；不能把帖子行内的 threads-tab 当作版面分页。
function parsePagination(nodes: Node[], board: string): Pick<BoardPage, "page" | "total_pages"> {
  const pagers = elements(nodes, "ol", "page-main");
  if (pagers.length === 0) return unparsed();
  let result: Pick<BoardPage, "page" | "total_pages"> | undefined;
  for (const pager of pagers) {
    const items = directElements(pager.children, "li");
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
      const anchors = directElements(item.children, "a");
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
        if (target === null || url === null || url.pathname !== `/board/${board}` ||
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

function parseThread(row: Element, board: string): BoardThread {
  const titleCells = elements(row.children, "td", "title_9");
  if (titleCells.length !== 1) return unparsed();
  const anchor = directElements(titleCells[0].children, "a")[0];
  const url = forumUrl(anchor?.attribs.href);
  const match = url === null ? null : /^\/article\/([^/]+)\/([1-9][0-9]*)$/.exec(url.pathname);
  const title = plainText(anchor);
  if (match === null || match[1] !== board || title === null || url!.search || url!.hash) return unparsed();
  const dates = elements(row.children, "td", "title_10");
  const authors = elements(row.children, "td", "title_12");
  const replies = plainText(elements(row.children, "td", "title_11")[0]);
  const replyCount = replies !== null && /^(0|[1-9][0-9]*)$/.test(replies) ? Number(replies) : null;
  return {
    article_id: match[2],
    title,
    article_url: buildArticleUrl(board, match[2]),
    author: authorName(authors[0]),
    published_at: plainText(dates[0]),
    reply_count: replyCount !== null && Number.isSafeInteger(replyCount) ? replyCount : null,
    is_pinned: hasClass(row, "top") ||
      DomUtils.existsOne((node) => hasClass(node, "ico-pos-article-top"), row.children),
    last_reply_at: plainText(dates[1]),
    last_reply_author: authorName(authors[1]),
  };
}

export function parseBoardPage(html: string, board: string): BoardPage {
  validateBoardParams({ board });
  const document = parseDocument(html);
  const tables = elements(document.children, "table", "board-list");
  if (tables.length !== 1) return unparsed();
  const bodies = elements(tables[0].children, "tbody");
  if (bodies.length !== 1) return unparsed();
  const pagination = parsePagination(document.children, board);
  const rows = elements(bodies[0].children, "tr");
  if (rows.length === 0) return unparsed();
  if (rows.length === 1 && plainText(rows[0]) === "该版面没有任何主题") {
    const cells = directElements(rows[0].children, "td");
    if (pagination.total_pages !== 1 || cells.length !== 1 || cells[0].attribs.colspan !== "7" ||
      elements(rows[0].children, "a").length !== 0 || hasClass(cells[0], "title_9")) return unparsed();
    return { ...pagination, threads: [] };
  }
  return { ...pagination, threads: rows.map((row) => parseThread(row, board)) };
}
