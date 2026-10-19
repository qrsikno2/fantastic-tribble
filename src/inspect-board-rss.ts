import { buildBoardRssUrl, validateBoardRssParams, type BoardRssInput } from "./board-rss-params.js";
import { fetchForumRss } from "./forum-http.js";
import { parseBoardRss, type BoardRssThread } from "./parse-board-rss.js";

export type BoardRssInspection = {
  board: string;
  board_url: string;
  rss_url: string;
  http_status: number;
  content_type: string;
  result: "OK" | "AUTH_REQUIRED" | "HTTP_ERROR" | "UNPARSED_PAGE";
  feed_title: string | null;
  last_build_date: string | null;
  threads: BoardRssThread[];
};

export async function inspectBoardRss(
  input: BoardRssInput,
  request: typeof fetch = fetch,
): Promise<BoardRssInspection> {
  const { board } = validateBoardRssParams(input);
  const rss_url = buildBoardRssUrl({ board });
  const response = await fetchForumRss(rss_url, request);
  const base: BoardRssInspection = {
    board,
    board_url: `https://bbs.byr.cn/board/${encodeURIComponent(board)}`,
    rss_url,
    http_status: response.http_status,
    content_type: response.content_type,
    result: response.result,
    feed_title: null,
    last_build_date: null,
    threads: [],
  };
  if (response.result !== "UNPARSED_PAGE") return base;
  try {
    return { ...base, ...parseBoardRss(response.content, board), result: "OK" };
  } catch {
    // 错误页或损坏的 RSS 不伪装成空列表，不返回原始 XML 或帖子正文。
    return base;
  }
}
