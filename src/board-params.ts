export type BoardInput = { board: string; page?: number };
export type BoardParams = { board: string; page: number };

export function validateBoardParams(input: BoardInput): BoardParams {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("参数必须是对象");
  }
  const { board } = input;
  const page = input.page === undefined ? 1 : input.page;
  if (
    typeof board !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(board) ||
    /\s/.test(board)
  ) {
    throw new Error("board 必须以英文字母开头，且仅包含英文字母、数字、下划线或连字符");
  }
  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) {
    throw new Error("page 必须是安全正整数");
  }
  return { board, page };
}

export function buildBoardUrl(input: BoardInput): string {
  const { board, page } = validateBoardParams(input);
  return `https://bbs.byr.cn/board/${encodeURIComponent(board)}?p=${page}`;
}
