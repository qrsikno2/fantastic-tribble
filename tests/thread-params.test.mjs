import assert from "node:assert/strict";
import test from "node:test";
import { validateThreadParams } from "../dist/thread-params.js";

const valid = { board: "Talking", article_id: "6454538", page: 2 };

test("保留合法参数，返回新对象", () => {
  const input = Object.freeze({ ...valid });
  const result = validateThreadParams(input);
  assert.deepEqual(result, valid);
  assert.notEqual(result, input);
});

test("省略 page 或传 undefined 时默认为 1", () => {
  const input = Object.freeze({ board: "Talking", article_id: "6454538" });
  assert.deepEqual(validateThreadParams(input), { ...input, page: 1 });
  assert.equal(validateThreadParams({ ...input, page: undefined }).page, 1);
  assert.equal(Object.hasOwn(input, "page"), false);
});

test("文章 ID 不转换为数字；page 接受安全整数上界", () => {
  const input = {
    board: "Board_1-test",
    article_id: "90071992547409931234567890",
    page: Number.MAX_SAFE_INTEGER,
  };
  assert.deepEqual(validateThreadParams(input), input);
});

for (const input of [null, undefined, [], "Talking", 123]) {
  test(`拒绝非参数对象：${JSON.stringify(input)}`, () => {
    assert.throws(() => validateThreadParams(input), /参数必须是对象/);
  });
}

const invalidFields = {
  board: [undefined, null, 123, "", " ", " Talking", "Talking ", ".", "..",
    "../Talking", "Talking/Other", "Talking\\Other", "Talking?x=1", "Talking#x",
    "%2e%2e", "Talking\n", "谈天说地"],
  article_id: [undefined, null, 6454538, "", "0", "-1", "01", "1.5", "1e3",
    " 123", "123\n", "1/2"],
  page: [null, "1", true, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1],
};

for (const [field, values] of Object.entries(invalidFields)) {
  for (const value of values) {
    test(`拒绝非法 ${field}：${String(value)}`, () => {
      assert.throws(
        () => validateThreadParams({ ...valid, [field]: value }),
        new RegExp(field),
      );
    });
  }
}
