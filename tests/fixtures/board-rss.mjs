// Entirely synthetic RSS: no copied forum posts or user data.
export const rssItem = `<item>
  <title>示例 &amp; 健康 &#x4FDD;&#20581;</title>
  <link>https://bbs.byr.cn/article/Health/123</link>
  <author>demo-author</author>
  <pubDate>Sat, 01 Jan 2000 00:00:00 GMT</pubDate>
  <description><![CDATA[<p>正文不会出现在粗列表中。</p>
    <item><title>伪造条目</title><link>https://example.com/</link></item>
  ]]></description>
</item>`;

export function boardRss(items = rssItem) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>示例论坛健康版</title>
  <description>用于测试的主题索引</description>
  <link>https://bbs.byr.cn/board/Health</link>
  <lastBuildDate>Sat, 01 Jan 2000 01:00:00 GMT</lastBuildDate>
  ${items}
</channel></rss>`;
}
