import { DomUtils, parseDocument } from "htmlparser2";
import { buildArticleUrl } from "./article-url.js";
import { sameForumPath } from "./forum-path.js";
import { parsePagination } from "./parse-pagination.js";

type Element = ReturnType<typeof DomUtils.findAll>[number];
type Node = ReturnType<typeof parseDocument>["children"][number];

export type ThreadPost = {
  article_id: string;
  floor: number;
  author: string | null;
  published_at: string | null;
  content: string;
  likes: number | null;
};

export type Thread = {
  topic: string;
  original_post: ThreadPost | null;
  hot_replies: ThreadPost[];
  replies: ThreadPost[];
};

export type ThreadPage = { page: number; total_pages: number; thread: Thread };

function unparsed(): never { throw new Error("UNPARSED_PAGE"); }
function hasClass(node: Element, name: string): boolean {
  return (node.attribs.class ?? "").split(/\s+/).includes(name);
}
function elements(nodes: Node[], tag: string, className?: string): Element[] {
  return DomUtils.findAll(node => node.name === tag &&
    (className === undefined || hasClass(node, className)), nodes);
}
function direct(nodes: Node[], tag: string, className?: string): Element[] {
  return DomUtils.getElementsByTagName(tag, nodes, false)
    .filter(node => className === undefined || hasClass(node, className));
}
function one<T>(items: T[]): T { return items.length === 1 ? items[0] : unparsed(); }
function label(node: Element | undefined): string | null {
  return node === undefined ? null : DomUtils.innerText(node).replace(/\s+/g, " ").trim() || null;
}
function webUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://bbs.byr.cn");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}
function forumUrl(value: string | undefined): URL | null {
  const url = webUrl(value);
  return url?.origin === "https://bbs.byr.cn" ? url : null;
}
function floorNumber(value: string | null): number {
  const names: Record<string, number> = { "楼主": 0, "沙发": 1, "板凳": 2, "地板": 3 };
  if (value !== null && Object.hasOwn(names, value)) return names[value];
  const match = /^第\s*([1-9][0-9]*)\s*楼$/.exec(value ?? "");
  const floor = match === null ? NaN : Number(match[1]);
  return Number.isSafeInteger(floor) ? floor : unparsed();
}

// 只生成可读文本，不执行 HTML；保留正文换行、链接目标和图片信息。
function renderText(nodes: Node[]): string {
  const output: string[] = [];
  const stack: (Node | string)[] = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node === "string") { output.push(node); continue; }
    if (node.type === "text") { output.push(node.data); continue; }
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style") continue;
    if (["script", "style", "head", "iframe", "object", "template"].includes(node.name) ||
      node.attribs.id === "nice_view") continue;
    if (node.name === "br") { output.push("\n"); continue; }
    if (node.name === "img") {
      const url = webUrl(node.attribs.src);
      output.push(`[图片${node.attribs.alt ? `: ${node.attribs.alt}` : ""}]${url ? ` (${url.href})` : ""}`);
      continue;
    }
    const block = ["div", "p", "blockquote", "pre", "li", "tr", "h1", "h2", "h3"].includes(node.name);
    if (block) { output.push("\n"); stack.push("\n"); }
    if (node.name === "a") {
      const url = webUrl(node.attribs.href);
      if (url && label(node) !== url.href) stack.push(` (${url.href})`);
    }
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return output.join("").replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function postText(wrap: Element): Pick<ThreadPost, "content" | "published_at"> {
  let content = renderText(wrap.children);
  let published_at: string | null = null;
  // 仅剥离起始的完整论坛信头，正文中引用的发信站/标题不属于元数据。
  const header = /^发信人[:：][^\n]*\n标\s*题[:：][^\n]*\n发信站[:：][^\n]*?\(([^\n]+)\)[^\n]*(?:\n|$)/.exec(content);
  if (header) {
    published_at = header[1].trim() || null;
    content = content.slice(header[0].length).trim();
    // 来源是论坛追加的末尾行；不截断正文里的引用或用户签名。
    content = content.replace(/(?:^|\n)※ 来源:[^\n]*\[FROM:[^\n]*\]\s*$/, "").trim();
    content = content.replace(/(?:^|\n)--\s*$/, "").trim();
  }
  return { content, published_at };
}

function likes(nodes: Node[]): number | null {
  const anchors = elements(nodes, "a", "a-func-like");
  if (anchors.length === 0) return null;
  const match = /^赞\s*\(\s*(0|[1-9][0-9]*)\s*\)$/.exec(label(one(anchors)) ?? "");
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) ? count : null;
}

function parsePost(table: Element, board: string): { post: ThreadPost; wrap: Element } {
  const rows = [
    ...direct(table.children, "tr"),
    ...direct(table.children, "tbody").flatMap(body => direct(body.children, "tr")),
  ];
  const head = one(rows.filter(row => hasClass(row, "a-head")));
  const body = one(rows.filter(row => hasClass(row, "a-body")));
  const cell = one(direct(body.children, "td", "a-content"));
  const wrap = one(direct(cell.children, "div", "a-content-wrap"));
  const ids = elements(head.children, "a", "a-post").flatMap(anchor => {
    const url = forumUrl(anchor.attribs.href);
    if (!url || url.search || url.hash) return [];
    const id = /\/([1-9][0-9]*)$/.exec(url.pathname)?.[1];
    return id && sameForumPath(url.pathname, `/article/${board}/post/${id}`) ? [id] : [];
  });
  const bodyIds = (cell.attribs.class ?? "").split(/\s+/)
    .flatMap(name => /^body([1-9][0-9]*)$/.exec(name)?.slice(1) ?? []);
  const article_id = one([...new Set([...ids, ...bodyIds])]);
  const floor = floorNumber(label(one(elements(head.children, "span", "a-pos"))));
  const authors = elements(head.children, "span", "a-u-name");
  if (authors.length > 1) return unparsed();
  return { wrap, post: {
    article_id, floor, author: label(authors[0]), ...postText(wrap), likes: likes(head.children),
  } };
}

function parseHotReplies(wrap: Element, path: string): ThreadPost[] {
  const containers = direct(wrap.children, "div").filter(node => node.attribs.id === "nice_view");
  if (containers.length === 0) return [];
  const list = one(direct(one(containers).children, "div", "a-nice-comment"));
  const items = direct(list.children, "div", "a-nice-comment-item");
  const replies = items.map(item => {
    const cell = one(direct(item.children, "div", "a-nice-comment-cell"));
    const content = one(direct(cell.children, "div", "a-nice-comment-content"));
    // 导航来自热门回复的功能栏；正文链接不能伪造楼层和点赞。
    const funcs = one(direct(cell.children, "div")
      .flatMap(node => direct(node.children, "ul", "a-nice-comment-func")));
    const anchor = one(elements(funcs.children, "a", "a-nice-comment-floor"));
    const url = forumUrl(anchor.attribs.href);
    const id = url?.searchParams.get("s");
    if (!url || !sameForumPath(url.pathname, path) || url.hash || !id || !/^[1-9][0-9]*$/.test(id) ||
      [...url.searchParams.keys()].length !== 1) return unparsed();
    const floor = floorNumber(label(anchor));
    if (floor === 0) return unparsed();
    const authors = direct(cell.children, "div", "a-nice-comment-id");
    if (authors.length > 1) return unparsed();
    return { article_id: id, floor, author: label(authors[0]), published_at: null,
      content: renderText(content.children), likes: likes(funcs.children) };
  });
  validateUnique(replies);
  return replies;
}

function validateUnique(posts: ThreadPost[]): void {
  if (new Set(posts.map(post => post.article_id)).size !== posts.length ||
    new Set(posts.map(post => post.floor)).size !== posts.length) unparsed();
}

export function parseThreadPage(html: string, board: string, article_id: string): ThreadPage {
  const articleUrl = buildArticleUrl(board, article_id);
  const path = new URL(articleUrl).pathname;
  const document = parseDocument(html);
  const container = one(elements(document.children, "div", "b-content"));
  // 从页面树分离正文，后续标题和分页查找不受正文嵌套标记影响。
  DomUtils.removeElement(container);
  const heading = one(elements(document.children, "div", "b-head"));
  const share = one(DomUtils.findAll(node => node.attribs.id === "a_share", heading.children));
  const topic = share.attribs._c?.trim();
  const url = forumUrl(share.attribs._u);
  if (!topic || !url || !sameForumPath(url.pathname, path) || url.search || url.hash) return unparsed();
  // 分页来自帖子容器外的工具栏，不能由正文内的 HTML 提供。
  const pagination = parsePagination(document.children, path);
  const wrappers = direct(container.children, "div", "a-wrap");
  if (!wrappers.length) return unparsed();
  const parsed = wrappers.map(wrapper => parsePost(one(direct(wrapper.children, "table", "article")), board));
  const posts = parsed.map(item => item.post);
  validateUnique(posts);
  if (posts.some((post, i) => i > 0 && post.floor <= posts[i - 1].floor) ||
    (pagination.page === 1 ? posts[0].floor !== 0 : posts[0].floor === 0)) return unparsed();
  const original = parsed.find(item => item.post.floor === 0);
  if (original && original.post.article_id !== article_id) return unparsed();
  const hot_replies = original ? parseHotReplies(original.wrap, path) : [];
  for (const hot of hot_replies) {
    const same = posts.find(post => post.article_id === hot.article_id || post.floor === hot.floor);
    // 匿名版面的热门区域可能隐藏作者，普通楼层却显示匿名编号。
    // 缺失作者不构成冲突；两处均显示作者时才比较，且不补填隐藏的作者。
    if (same && (same.article_id !== hot.article_id || same.floor !== hot.floor ||
      (same.author !== null && hot.author !== null && same.author !== hot.author))) return unparsed();
  }
  return { ...pagination, thread: {
    topic, original_post: original?.post ?? null, hot_replies, replies: posts.filter(post => post.floor !== 0),
  } };
}
