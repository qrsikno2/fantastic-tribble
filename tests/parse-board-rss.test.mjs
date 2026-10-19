import assert from "node:assert/strict";
import test from "node:test";
import { parseBoardRss } from "../dist/parse-board-rss.js";
import { boardRss, rssItem } from "./fixtures/board-rss.mjs";

const reject = (xml) => assert.throws(() => parseBoardRss(xml, "Health"), { message: "UNPARSED_PAGE" });

test("RSS解析中文、XML实体和直接item，并保留规范版名", () => {
  assert.deepEqual(parseBoardRss(boardRss(), "health"), {
    feed_title: "示例论坛健康版",
    last_build_date: "Sat, 01 Jan 2000 01:00:00 GMT",
    threads: [{
      article_id: "123", title: "示例 & 健康 保健",
      article_url: "https://bbs.byr.cn/article/Health/123",
      author: "demo-author", published_at: "Sat, 01 Jan 2000 00:00:00 GMT",
    }],
  });
});

test("CDATA标题按文本读取，忽略description和嵌套item，缺失元数据为null", () => {
  const xml = boardRss(`<extension>${rssItem}</extension><item>
    <title><![CDATA[ 示例 <标签> & 标题 ]]></title>
    <link>https://bbs.byr.cn/article/HEALTH/456</link>
    <description><item><title>嵌套正文</title></item></description>
  </item>`).replace(/<lastBuildDate>.*?<\/lastBuildDate>/, "");
  assert.deepEqual(parseBoardRss(xml, "Health"), {
    feed_title: "示例论坛健康版", last_build_date: null,
    threads: [{ article_id: "456", title: "示例 <标签> & 标题",
      article_url: "https://bbs.byr.cn/article/HEALTH/456", author: null, published_at: null }],
  });
});

test("具备RSS身份字段的合法空channel返回空列表", () => {
  assert.deepEqual(parseBoardRss(boardRss(""), "Health").threads, []);
  assert.deepEqual(parseBoardRss(boardRss("").replace(/<description>.*?<\/description>/,
    "<description/>"), "Health").threads, []);
  for (const tag of ["title", "description", "link"]) {
    reject(boardRss("").replace(new RegExp(`<${tag}>.*?<\\/${tag}>`), ""));
  }
});

test("错误页、错误RSS结构、缺少或重复必需字段都拒绝", () => {
  for (const xml of [
    "", "<html><body>系统维护</body></html>", "<rss version='2.0'><channel/></rss>",
    boardRss().replace('version="2.0"', 'version="1.0"'),
    `<wrapper>${boardRss().replace(/<\?xml.*?\?>/, "")}</wrapper>`,
    boardRss().replace("</channel>", "</channel><channel/>"),
    boardRss().replace("</rss>", "</rss><rss/>"),
    boardRss().replace("<title>示例 &amp; 健康 &#x4FDD;&#20581;</title>", "<title/>"),
    boardRss().replaceAll("</item>", "<link>https://bbs.byr.cn/article/Health/456</link></item>"),
    boardRss().replace("<author>demo-author</author>", "<author><b>嵌套作者</b></author>"),
  ]) reject(xml);
});

test("channel与item链接只允许指定本站HTTPS版面和无前导零正整数帖子号", () => {
  const article = "https://bbs.byr.cn/article/Health/123";
  for (const link of [
    "https://bbs.byr.cn/article/Other/123", "https://example.com/article/Health/123",
    "http://bbs.byr.cn/article/Health/123", "https://user:pass@bbs.byr.cn/article/Health/123",
    "/article/Health/123", "//bbs.byr.cn/article/Health/123", `${article}?p=1`, `${article}#reply`,
    `${article}?`, `${article}#`, `${article}/`, "https://bbs.byr.cn/Article/Health/123",
    "https://bbs.byr.cn/article/Health/0", "https://bbs.byr.cn/article/Health/0123",
    "https://bbs.byr.cn/article/Health/-1", "https://bbs.byr.cn/article/Health/1.2",
    "https://bbs.byr.cn/article/Other/../Health/123",
  ]) reject(boardRss().replace(article, link));
  for (const link of [
    "https://bbs.byr.cn/board/Other", "https://example.com/board/Health",
    "http://bbs.byr.cn/board/Health", "https://user@bbs.byr.cn/board/Health",
    "https://bbs.byr.cn/board/Health?p=1", "https://bbs.byr.cn/board/Health#fragment",
    "https://bbs.byr.cn/Board/Health", "/board/Health",
  ]) reject(boardRss().replace("https://bbs.byr.cn/board/Health", link));
});

test("截断、标签错配、未闭合CDATA或注释及损坏XML不被容错为成功", () => {
  const xml = boardRss();
  for (const malformed of [
    xml.slice(0, -1), xml.replace("</channel>", ""), xml.replaceAll("</item>", "</wrong>"),
    xml.replaceAll("</item>", "</unknown></item>"), xml.replace("]]>", ""),
    `${xml}<!-- truncated`, `${xml}<`, `${xml}not XML`,
    xml.replace('version="2.0"', "version=2.0"),
    xml.replace('version="2.0"', 'version="2.0" version="2.0"'),
    xml.replace("&amp;", "&unknown;"), xml.replace("&amp;", "&"),
    xml.replace("&amp;", "&#0;"), xml.replace("&amp;", "&#x110000;"),
    xml.replace("</channel>", "<!-- invalid -- comment --></channel>"),
    xml.replace("<rss", "<!DOCTYPE rss SYSTEM 'file:///not-read'><rss"),
  ]) reject(malformed);
});
