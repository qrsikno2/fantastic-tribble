import { buildBoardUrl, validateBoardParams, type BoardInput } from "./board-params.js";
import { fetchForumHtml } from "./forum-http.js";
import { parseBoardPage, type BoardThread } from "./parse-board.js";

export type BoardInspection = {
  board: string;
  board_url: string;
  http_status: number;
  content_type: string;
  result: "OK" | "AUTH_REQUIRED" | "HTTP_ERROR" | "UNPARSED_PAGE" | "PAGE_OUT_OF_RANGE";
  page: number;
  total_pages: number | null;
  threads: BoardThread[];
};

export async function inspectBoard(
  input: BoardInput,
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BoardInspection> {
  const params = validateBoardParams(input);
  const board_url = buildBoardUrl(params);
  const response = await fetchForumHtml(board_url, request, env);
  const base: BoardInspection = {
    ...params,
    board_url,
    http_status: response.http_status,
    content_type: response.content_type,
    result: response.result,
    total_pages: null,
    threads: [],
  };
  if (response.result !== "UNPARSED_PAGE") return base;
  try {
    const parsed = parseBoardPage(response.content, params.board);
    if (params.page > parsed.total_pages) {
      return { ...base, result: "PAGE_OUT_OF_RANGE", total_pages: parsed.total_pages };
    }
    if (parsed.page !== params.page) return base;
    return { ...base, ...parsed, result: "OK" };
  } catch {
    // 页面结构变化、权限错误等均不能伪装成空列表，也不输出原始 HTML。
    return base;
  }
}
