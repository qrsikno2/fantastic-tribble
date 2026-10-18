import { createDirectorySession } from "./directory-session.js";
import {
  isSectionId, parseDirectoryBoards, parseSections,
  type DirectoryBoard, type ForumSection,
} from "./parse-board-directory.js";

export type BoardDirectoryInput = { section?: string };
export type BoardDirectoryInspection = {
  section: string | null;
  sections: ForumSection[];
  boards: DirectoryBoard[];
  total_boards: number | null;
  http_status: number;
  content_type: string;
  result: "OK" | "AUTH_REQUIRED" | "HTTP_ERROR" | "UNPARSED_PAGE" | "SECTION_NOT_FOUND";
};

const DIRECTORY_URL = "https://bbs.byr.cn/section/ajax_list.json";

export async function inspectBoardDirectory(
  input: BoardDirectoryInput = {},
  request: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BoardDirectoryInspection> {
  if (typeof input !== "object" || input === null || Array.isArray(input) ||
    (input.section !== undefined && !isSectionId(input.section))) {
    throw new Error("section 必须是目录返回的分区编号字符串");
  }
  const section = input.section ?? null;
  const readDirectory = createDirectorySession(request, env);
  const response = await readDirectory(`${DIRECTORY_URL}?root=list-section&bo=1`);
  const base: BoardDirectoryInspection = {
    section, sections: [], boards: [], total_boards: null,
    http_status: response.http_status,
    content_type: response.content_type,
    result: response.result,
  };
  if (response.result !== "UNPARSED_PAGE") return base;

  let sections: ForumSection[];
  try {
    sections = parseSections(response.content);
  } catch {
    return base;
  }
  if (section !== null) {
    sections = sections.filter((entry) => entry.section === section);
    if (sections.length === 0) return { ...base, result: "SECTION_NOT_FOUND" };
  }

  const boards = new Map<string, DirectoryBoard>();
  // bo=1 由论坛展开子目录；按分区顺序读取，不请求帖子或自动重试。
  for (const entry of sections) {
    const result = await readDirectory(`${DIRECTORY_URL}?root=sec-${encodeURIComponent(entry.section)}&bo=1`);
    const failure = { ...base, http_status: result.http_status, content_type: result.content_type, result: result.result };
    if (result.result !== "UNPARSED_PAGE") return failure;
    try {
      for (const board of parseDirectoryBoards(result.content, entry.section)) {
        const previous = boards.get(board.board);
        if (previous === undefined) boards.set(board.board, board);
        else {
          if (previous.name !== board.name) return failure;
          previous.sections.push(entry.section);
        }
      }
    } catch {
      // 任一分区失败都不返回不完整列表，也不透传响应正文。
      return failure;
    }
  }
  return { ...base, sections, boards: [...boards.values()], total_boards: boards.size, result: "OK" };
}
