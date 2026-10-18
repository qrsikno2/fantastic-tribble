import assert from "node:assert/strict";
import test from "node:test";
import { parseThreadPage } from "../dist/parse-thread.js";
import { anonymousThreadHtml, threadHtml, threadPage } from "./fixtures/thread-page.mjs";

const parse = (html) => parseThreadPage(html, "Talking", "6454538");

test("帖子按主题、楼主、热门回复和当前页楼层分别返回", () => {
  const result = parse(threadHtml);
  assert.equal(result.page, 1);
  assert.equal(result.total_pages, 2);
  assert.equal(result.thread.topic, "示例主题 & 讨论");
  assert.deepEqual(Object.keys(result.thread).sort(), ["hot_replies", "original_post", "replies", "topic"]);
  assert.equal(result.thread.original_post.article_id, "6454538");
  assert.equal(result.thread.original_post.floor, 0);
  assert.equal(result.thread.original_post.author, "DemoOwner");
  assert.equal(result.thread.original_post.published_at, "Sun Oct 18 09:30:00 2026");
  assert.equal(result.thread.original_post.likes, null);
  assert.deepEqual(result.thread.replies.map((reply) => [reply.floor, reply.article_id]), [
    [1, "6454541"], [2, "6454542"], [3, "6454543"], [6, "6454551"],
  ]);
  assert.deepEqual(result.thread.replies.map((reply) => reply.likes), [0, 20, null, 5]);
  assert.deepEqual(Object.keys(result.thread.original_post).sort(), ["article_id", "author", "content", "floor", "likes", "published_at"]);
});

test("请求版面名与页面规范名大小写不同时仍解析分页、楼层和热门回复", () => {
  for (const page of [1, 2]) {
    // 不提供 body<ID> 备用标记，确保楼层 ID 来自大小写不同的回复链接。
    const html = threadPage({ page }).replaceAll("Talking", "IWhisper")
      .replaceAll(/\bbody[1-9][0-9]*\b/g, "");
    const expected = parseThreadPage(html, "IWhisper", "6454538");
    for (const board of ["iwhisper", "IWHISPER"]) {
      assert.deepEqual(parseThreadPage(html, board, "6454538"), expected);
    }
  }
});

test("忽略版面大小写仍拒绝其他站点、版面、文章、路由和分享链接参数", () => {
  const html = threadHtml.replaceAll("Talking", "IWhisper");
  const shareUrl = 'https://bbs.byr.cn/article/IWhisper/6454538';
  for (const invalid of [
    html.replace(`_u="${shareUrl}"`, '_u="https://example.com/article/IWhisper/6454538"'),
    html.replace(`_u="${shareUrl}"`, '_u="https://bbs.byr.cn/article/Other/6454538"'),
    html.replace(`_u="${shareUrl}"`, '_u="https://bbs.byr.cn/Article/IWhisper/6454538"'),
    html.replace(`_u="${shareUrl}"`, '_u="https://bbs.byr.cn/article/IWhisper/9999"'),
    html.replace(`_u="${shareUrl}"`, `_u="${shareUrl}?p=1"`),
    html.replace(`_u="${shareUrl}"`, `_u="${shareUrl}#reply"`),
    html.replace('href="/article/IWhisper/post/6454541"', 'href="/article/IWhisper/post/6454999"'),
    html.replace('href="/article/IWhisper/6454538?s=6454551"', 'href="/article/Other/6454538?s=6454551"'),
    html.replace('href="/article/IWhisper/6454538?s=6454551"', 'href="/Article/IWhisper/6454538?s=6454551"'),
    html.replace('href="/article/IWhisper/6454538?s=6454551"', 'href="/article/IWhisper/9999?s=6454551"'),
  ]) {
    assert.throws(() => parseThreadPage(invalid, "iwhisper", "6454538"), { message: "UNPARSED_PAGE" });
  }
});

test("正文去除发信头和来源，保留段落、用户签名、链接和图片信息", () => {
  const content = parse(threadHtml).thread.original_post.content;
  assert.match(content, /第一段正文。\n\n第二段 & 示例/);
  assert.match(content, /参考链接/);
  assert.match(content, /https:\/\/example\.com\/guide\?q=1&x=2/);
  assert.match(content, /示例图片/);
  assert.match(content, /\/upload\/demo\.png/);
  assert.match(content, /--\n这是用户签名/);
  for (const text of ["发信人:", "发信站:", "标  题:", "※ 来源:", "192.0.2.", "精彩回复", "同页热门内容", "跨页热门内容", "返回顶部", "此楼踩的人太多"]) {
    assert.equal(content.includes(text), false, `正文不应混入 ${text}`);
  }
  assert.doesNotMatch(content, /<\/?(?:br|a|img|font)\b/i);
});

test("热门回复按页面精选列表取独立回复ID，可以跨页并与普通楼层重复", () => {
  const { hot_replies: hot, replies } = parse(threadHtml).thread;
  assert.deepEqual(hot.map((reply) => [reply.article_id, reply.floor, reply.author, reply.likes]), [
    ["6454551", 6, "DemoSix", 5],
    ["6454568", 17, "DemoSeventeen", 4],
  ]);
  assert.equal(hot[0].published_at, null);
  assert.match(hot[0].content, /同页热门内容\n【 在 DemoOne 的大作中提到: 】\n: 引用文字/);
  assert.equal(replies.some((reply) => reply.article_id === hot[0].article_id), true);
  assert.equal(replies.some((reply) => reply.article_id === hot[1].article_id), false);
});

test("匿名版面热门作者留空时仍识别同一回复，保留各区域显示的作者", () => {
  const result = parseThreadPage(anonymousThreadHtml, "iwhisper", "6454538");
  assert.equal(result.page, 1);
  assert.equal(result.total_pages, 2);
  const { hot_replies: hot, replies } = result.thread;
  assert.deepEqual(hot.map(reply => reply.author), [null, null]);
  const same = replies.find(reply => reply.article_id === hot[0].article_id);
  assert.equal(same.floor, hot[0].floor);
  assert.equal(same.author, "IWhisper#123");
  assert.match(hot[0].content, /同页热门内容/);
  assert.match(hot[1].content, /跨页热门内容/);
});

test("普通楼层缺失作者时不与热门区域已显示的作者冲突", () => {
  const html = threadHtml.replace('<span class="a-u-name"><a href="/user/query/DemoSix">DemoSix</a></span>', "");
  const { hot_replies: hot, replies } = parse(html).thread;
  assert.equal(hot[0].author, "DemoSix");
  assert.equal(replies.find(reply => reply.article_id === hot[0].article_id).author, null);
});

test("两处作者均隐藏时仍以回复 ID 和楼层确认同一回复", () => {
  const html = anonymousThreadHtml.replaceAll(/<span class="a-u-name">[\s\S]*?<\/span>/g, "");
  const { hot_replies: hot, replies } = parseThreadPage(html, "iwhisper", "6454538").thread;
  assert.equal(hot[0].author, null);
  assert.equal(replies.find(reply => reply.article_id === hot[0].article_id).author, null);
});

test("允许缺失作者仍拒绝热门回复与普通楼层的 ID、楼层或已知作者冲突", () => {
  for (const html of [
    anonymousThreadHtml.replace('?s=6454551', '?s=6454999'),
    anonymousThreadHtml.replace('?s=6454551">第6楼', '?s=6454551">第7楼'),
    threadHtml.replace('<div class="a-nice-comment-id"><a href="/user/query/DemoSix">DemoSix</a>',
      '<div class="a-nice-comment-id"><a href="/user/query/DemoOther">DemoOther</a>'),
  ]) {
    const board = html.includes("IWhisper") ? "iwhisper" : "Talking";
    assert.throws(() => parseThreadPage(html, board, "6454538"), { message: "UNPARSED_PAGE" });
  }
});

test("没有精选区域时热门数组为空，不按点赞数猜测热门", () => {
  const { hot_replies, replies } = parse(threadPage({ includeHot: false })).thread;
  assert.deepEqual(hot_replies, []);
  assert.equal(replies.find((reply) => reply.floor === 2).likes, 20);
});

test("后续页只返回本页楼层，未出现的楼主和热门不补抓或猜测", () => {
  const result = parse(threadPage({ page: 2 }));
  assert.equal(result.page, 2);
  assert.equal(result.total_pages, 2);
  assert.equal(result.thread.topic, "示例主题 & 讨论");
  assert.equal(result.thread.original_post, null);
  assert.deepEqual(result.thread.hot_replies, []);
  assert.deepEqual(result.thread.replies.map((reply) => reply.floor), [17, 18]);
});

test("单页帖子能报告一页，页面缺失的作者和时间返回null", () => {
  const html = threadPage({ totalPages: 1, includeHot: false })
    .replaceAll(/<span class="a-u-name">[\s\S]*?<\/span>/g, "")
    .replaceAll(/发信人: [\s\S]*?站内<br><br>/g, "");
  const result = parse(html);
  assert.equal(result.total_pages, 1);
  assert.equal(result.thread.original_post.author, null);
  assert.equal(result.thread.original_post.published_at, null);
  assert.match(result.thread.original_post.content, /第一段正文/);
});

test("未知页面、身份不符和无法识别的楼层不会被当成成功帖子", () => {
  for (const html of [
    "", "<p>维护中</p>",
    threadHtml.replace('_u="https://bbs.byr.cn/article/Talking/6454538"', '_u="https://example.com/article/Talking/6454538"'),
    threadHtml.replace('_u="https://bbs.byr.cn/article/Talking/6454538"', '_u="https://bbs.byr.cn/article/Other/6454538"'),
    threadHtml.replace('_u="https://bbs.byr.cn/article/Talking/6454538"', '_u="https://bbs.byr.cn/article/Talking/9999"'),
    threadHtml.replace('<span class="a-pos">沙发</span>', '<span class="a-pos">未知楼层</span>'),
    threadHtml.replace('href="/article/Talking/post/6454541"', 'href="/article/Talking/post/6454999"'),
  ]) {
    assert.throws(() => parse(html), { message: "UNPARSED_PAGE" });
  }
});

test("无法确认分页或热门回复身份时返回解析失败", () => {
  for (const html of [
    threadHtml.replaceAll(/<ol class="page-main">[\s\S]*?<\/ol>/g, ""),
    threadHtml.replace('title="当前页">1</a>', 'title="当前页">2</a>'),
    threadHtml.replace('href="/article/Talking/6454538?s=6454551"', 'href="/article/Talking/9999?s=6454551"'),
  ]) {
    assert.throws(() => parse(html), { message: "UNPARSED_PAGE" });
  }
});
