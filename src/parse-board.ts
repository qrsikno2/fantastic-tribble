import { DomUtils, parseDocument } from "htmlparser2";
import { buildArticleUrl } from "./article-url.js";
import { validateBoardParams } from "./board-params.js";
import { parsePagination } from "./parse-pagination.js";
import { sameForumPath } from "./forum-path.js";

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

function parseThread(row: Element, board: string): BoardThread {
  const titleCells = elements(row.children, "td", "title_9");
  if (titleCells.length !== 1) return unparsed();
  const anchor = directElements(titleCells[0].children, "a")[0];
  const url = forumUrl(anchor?.attribs.href);
  const match = url === null ? null : /^\/article\/([^/]+)\/([1-9][0-9]*)$/.exec(url.pathname);
  const title = plainText(anchor);
  if (match === null || !sameForumPath(url!.pathname, `/article/${board}/${match[2]}`) ||
    title === null || url!.search || url!.hash) return unparsed();
  const dates = elements(row.children, "td", "title_10");
  const authors = elements(row.children, "td", "title_12");
  const replies = plainText(elements(row.children, "td", "title_11")[0]);
  const replyCount = replies !== null && /^(0|[1-9][0-9]*)$/.test(replies) ? Number(replies) : null;
  return {
    article_id: match[2],
    title,
    article_url: buildArticleUrl(match[1], match[2]),
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
  const pagination = parsePagination(document.children, `/board/${board}`);
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
