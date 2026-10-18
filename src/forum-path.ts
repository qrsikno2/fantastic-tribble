// 论坛会把请求中的版面名转换为规范大小写；只忽略版面名这一段的大小写。
// origin、查询参数和 fragment 仍由调用者分别校验。
export function sameForumPath(actual: string, expected: string): boolean {
  const actualParts = actual.split("/");
  const expectedParts = expected.split("/");
  return expectedParts.length >= 3 && expectedParts[0] === "" &&
    ["board", "article"].includes(expectedParts[1]) &&
    actualParts.length === expectedParts.length &&
    actualParts.every((part, index) => index === 2
      ? part.toLowerCase() === expectedParts[index].toLowerCase()
      : part === expectedParts[index]);
}
