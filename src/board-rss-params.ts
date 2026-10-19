import { validateBoardParams } from "./board-params.js";

export type BoardRssInput = { board: string };

export function validateBoardRssParams(input: BoardRssInput): BoardRssInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("参数必须是对象");
  }
  const { board } = validateBoardParams({ board: input.board });
  if (board.toLowerCase() === "iwhisper") throw new Error("RSS_UNAVAILABLE");
  return { board };
}

export function buildBoardRssUrl(input: BoardRssInput): string {
  const { board } = validateBoardRssParams(input);
  return `https://bbs.byr.cn/rss/board-${encodeURIComponent(board)}`;
}
