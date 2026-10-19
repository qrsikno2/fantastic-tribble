import { DomUtils, parseDocument } from "htmlparser2";
import { buildArticleUrl } from "./article-url.js";
import { validateBoardParams } from "./board-params.js";

type Element = ReturnType<typeof DomUtils.findAll>[number];
type Node = ReturnType<typeof parseDocument>["children"][number];

export type BoardRssThread = {
  article_id: string;
  title: string;
  article_url: string;
  author: string | null;
  published_at: string | null;
};

function unparsed(): never {
  throw new Error("UNPARSED_PAGE");
}

const invalidXmlCharacter = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;

function validateEntities(value: string): void {
  if (/&(?!(?:amp|lt|gt|apos|quot|#[0-9]+|#x[0-9A-Fa-f]+);)/.test(value)) unparsed();
  for (const match of value.matchAll(/&#(x[0-9A-Fa-f]+|[0-9]+);/g)) {
    const point = match[1].startsWith("x") ? parseInt(match[1].slice(1), 16) : Number(match[1]);
    if (point > 0x10ffff || invalidXmlCharacter.test(String.fromCodePoint(point))) unparsed();
  }
}

// htmlparser2 deliberately recovers incomplete XML. Check the lexical envelope first
// so a truncated feed cannot become a successful, possibly empty board listing.
// DTDs are unnecessary for this feed; only XML's built-in entities are accepted.
function validateXml(xml: string): void {
  if (invalidXmlCharacter.test(xml)) unparsed();
  const stack: string[] = [];
  const opening = /<([A-Za-z_][A-Za-z0-9_.:-]*)(?:[\t\n\r ]+[A-Za-z_][A-Za-z0-9_.:-]*[\t\n\r ]*=[\t\n\r ]*(?:"[^"<]*"|'[^'<]*'))*[\t\n\r ]*\/?>/y;
  const closing = /<\/([A-Za-z_][A-Za-z0-9_.:-]*)[\t\n\r ]*>/y;
  let roots = 0;
  let position = xml.startsWith("\uFEFF") ? 1 : 0;
  while (position < xml.length) {
    if (xml[position] !== "<") {
      const next = xml.indexOf("<", position);
      const end = next < 0 ? xml.length : next;
      const value = xml.slice(position, end);
      if ((stack.length === 0 && value.trim()) || value.includes("]]>")) unparsed();
      validateEntities(value);
      position = end;
      continue;
    }
    if (xml.startsWith("<!--", position) || xml.startsWith("<![CDATA[", position)) {
      const comment = xml.startsWith("<!--", position);
      const start = position + (comment ? 4 : 9);
      const end = xml.indexOf(comment ? "-->" : "]]>", start);
      if (end < 0 || (!comment && stack.length === 0)) unparsed();
      const value = xml.slice(start, end);
      if (comment && (value.includes("--") || value.endsWith("-"))) unparsed();
      position = end + 3;
      continue;
    }
    if (xml.startsWith("<?", position)) {
      const end = xml.indexOf("?>", position + 2);
      if (end < 0 || !/^<\?[A-Za-z_][A-Za-z0-9_.:-]*(?:\s|\?)/.test(xml.slice(position, end + 2))) unparsed();
      position = end + 2;
      continue;
    }
    if (xml.startsWith("</", position)) {
      closing.lastIndex = position;
      const match = closing.exec(xml);
      if (match === null || stack.pop() !== match[1]) unparsed();
      position = closing.lastIndex;
      continue;
    }
    opening.lastIndex = position;
    const match = opening.exec(xml);
    if (match === null) unparsed();
    const names = new Set<string>();
    for (const attribute of match[0].matchAll(/([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      if (names.has(attribute[1])) unparsed();
      names.add(attribute[1]);
      validateEntities(attribute[2] ?? attribute[3]);
    }
    if (stack.length === 0) roots++;
    if (!match[0].endsWith("/>")) stack.push(match[1]);
    position = opening.lastIndex;
  }
  if (stack.length !== 0 || roots !== 1) unparsed();
}

function elements(nodes: Node[], name: string): Element[] {
  return DomUtils.getElementsByTagName(name, nodes, false);
}

function field(parent: Element, name: string, required = false): string | null {
  const matches = elements(parent.children, name);
  if (matches.length > 1 || (required && matches.length !== 1)) return unparsed();
  if (matches.length === 0) return null;
  if (DomUtils.findAll(() => true, matches[0].children).length > 0) return unparsed();
  return DomUtils.textContent(matches[0]).replace(/\s+/g, " ").trim() || null;
}

function parseItem(item: Element, board: string): BoardRssThread {
  const title = field(item, "title", true);
  const link = field(item, "link", true);
  const match = link?.match(/^https:\/\/bbs\.byr\.cn\/article\/([A-Za-z][A-Za-z0-9_-]*)\/([1-9][0-9]*)$/);
  if (!title || !match || match[1].toLowerCase() !== board.toLowerCase()) return unparsed();
  return {
    article_id: match[2],
    title,
    article_url: buildArticleUrl(match[1], match[2]),
    author: field(item, "author"),
    published_at: field(item, "pubDate"),
  };
}

export function parseBoardRss(xml: string, board: string): {
  feed_title: string;
  last_build_date: string | null;
  threads: BoardRssThread[];
} {
  validateBoardParams({ board });
  validateXml(xml);
  const document = parseDocument(xml, { xmlMode: true, decodeEntities: true });
  const roots = elements(document.children, "rss");
  if (roots.length !== 1 || roots[0].attribs.version !== "2.0") return unparsed();
  const channels = elements(roots[0].children, "channel");
  if (channels.length !== 1) return unparsed();
  const channel = channels[0];
  const title = field(channel, "title", true);
  const link = field(channel, "link", true);
  const match = link?.match(/^https:\/\/bbs\.byr\.cn\/board\/([A-Za-z][A-Za-z0-9_-]*)$/);
  if (!title || !match || match[1].toLowerCase() !== board.toLowerCase() ||
    elements(channel.children, "description").length !== 1) return unparsed();
  return {
    feed_title: title,
    last_build_date: field(channel, "lastBuildDate"),
    threads: elements(channel.children, "item").map((item) => parseItem(item, board)),
  };
}
