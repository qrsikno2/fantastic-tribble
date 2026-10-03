// 调用时 page 可以省略。
export type ThreadInput = {
  board: string;
  article_id: string;
  page?: number;
};

// 校验后 page 一定存在。
export type ThreadParams = {
  board: string;
  article_id: string;
  page: number;
};

export function validateThreadParams(input: ThreadInput): ThreadParams {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("参数必须是对象");
  }

  const { board, article_id } = input;
  const page = input.page === undefined ? 1 : input.page;

  if (
    typeof board !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(board) ||
    /\s/.test(board)
  ) {
    throw new Error("board 必须以英文字母开头，且仅包含英文字母、数字、下划线或连字符");
  }

  if (
    typeof article_id !== "string" ||
    !/^[1-9][0-9]*$/.test(article_id) ||
    /\s/.test(article_id)
  ) {
    throw new Error("article_id 必须是无前导零的正整数字符串");
  }

  if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) {
    throw new Error("page 必须是安全正整数");
  }

  return { board, article_id, page };
}
