// Synthetic content matching the observed forum markup; no real users or post bodies.
const board = "Talking";
const articleId = "100001";
const articlePath = `/article/${board}/${articleId}`;

function likesLink(id, likes) {
  return likes === null ? "" : `<a class="a-func-like" href="/article/${board}/ajax_voteup/${id}.json">赞(${likes})</a>`;
}

function hotReply({ id, floor, author, content, likes }) {
  return `<div class="a-nice-comment-item">
    <a class="a-nice-comment-face" href="/user/query/${author}"><img src="/face/${author}.jpg"></a>
    <div class="a-nice-comment-cell">
      <div class="a-nice-comment-id"><a href="/user/query/${author}">${author}</a></div>
      <div class="a-nice-comment-content">${content}</div>
      <div><ul class="a-func a-nice-comment-func"><li><a class="a-nice-comment-floor" href="${articlePath}?s=${id}">第${floor}楼</a></li><li>${likesLink(id, likes)}</li></ul></div>
    </div>
  </div>`;
}

const hotReplies = `<div id="nice_view" class="corner">
  <div class="a-nice-comment-divline"><h3>精彩回复</h3></div>
  <div class="a-nice-comment">${hotReply({ id: "100007", floor: 6, author: "DemoSix", content: "同页热门内容<br>【 在 DemoOne 的大作中提到: 】<br>: 引用文字", likes: 5 })}${hotReply({ id: "100018", floor: 17, author: "DemoSeventeen", content: "跨页热门内容", likes: 4 })}</div>
</div>`;

function post({ id, floor, author, content, likes = null, hot = "" }) {
  const floorLabel = ["楼主", "沙发", "板凳", "地板"][floor] ?? `第${floor}楼`;
  return `<div class="a-wrap corner"><table class="article">
    <tr class="a-head"><td class="a-left"><span class="a-u-name"><a href="/user/query/${author}">${author}</a></span></td>
      <td><ul class="a-func"><li><a class="a-post" href="/article/${board}/post/${id}">回复</a></li><li>${likesLink(id, likes)}</li></ul><span class="a-pos">${floorLabel}</span></td></tr>
    <tr class="a-body"><td class="a-left"><div class="a-u-uid">虚构昵称</div></td>
      <td class="a-content body${id}"><div class="a-content-wrap">发信人: ${author} (虚构昵称), 信区: ${board}<br>标&nbsp;&nbsp;题: ${floor === 0 ? "" : "Re: "}示例主题 &amp; 讨论<br>发信站: 北邮人论坛 (Sat Jan 01 12:00:00 2000), 站内<br><br>${content}<br><br><font class="f003">※ 来源:·北邮人论坛 <a href="http://bbs.byr.cn">http://bbs.byr.cn</a>·[FROM: 192.0.2.*]</font><font class="f000"><br></font>${hot}</div></td>
      <td class="a-content2 body${id}" style="display:none"><div class="a-background">此楼踩的人太多已被折叠。</div></td></tr>
    <tr class="a-bottom"><td></td><td><ul class="a-status"><li>${likesLink(id, likes)}</li></ul><a href="#">返回顶部</a></td></tr>
  </table></div>`;
}

export function threadPage({ page = 1, totalPages = 2, includeHot = true } = {}) {
  const previous = page > 1 ? `<li class="page-normal"><a href="${articlePath}?p=${page - 1}" title="上一页">&lt;&lt;</a></li>` : "";
  const next = page < totalPages ? `<li class="page-normal"><a href="${articlePath}?p=${page + 1}" title="下一页">&gt;&gt;</a></li>` : "";
  const numbers = Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => n === page
    ? `<li class="page-select"><a title="当前页">${n}</a></li>`
    : `<li class="page-normal"><a href="${articlePath}?p=${n}" title="转到第${n}页">${n}</a></li>`).join("");
  const pagination = `<ol class="page-main">${previous}${numbers}${next}</ol>`;
  const posts = page === 1 ? [
    post({ id: articleId, floor: 0, author: "DemoOwner", content: '第一段正文。<br><br>第二段 &amp; 示例，<a href="https://example.com/guide?q=1&amp;x=2">参考链接</a><br><img src="/upload/demo.png" alt="示例图片"><br>--<br>这是用户签名', hot: includeHot ? hotReplies : "" }),
    post({ id: "100002", floor: 1, author: "DemoOne", content: "沙发回复", likes: 0 }),
    post({ id: "100003", floor: 2, author: "DemoTwo", content: "板凳回复", likes: 20 }),
    post({ id: "100004", floor: 3, author: "DemoThree", content: "地板回复" }),
    post({ id: "100007", floor: 6, author: "DemoSix", content: "同页热门内容<br>【 在 DemoOne 的大作中提到: 】<br>: 引用文字", likes: 5 }),
  ] : [
    post({ id: "100018", floor: 17, author: "DemoSeventeen", content: "跨页热门内容", likes: 4 }),
    post({ id: "100019", floor: 18, author: "DemoEighteen", content: "后续页回复" }),
  ];
  return `<div class="b-head"><span id="a_share" _u="https://bbs.byr.cn${articlePath}" _c="示例主题 &amp; 讨论">分享到:</span></div>${pagination}<div class="b-content">${posts.join("")}</div>${pagination}`;
}

export const threadHtml = threadPage();

// Anonymous boards show a pseudonym on ordinary floors but an empty author link
// in the hot-reply list. Keep this fixture synthetic, including IDs and content.
export const anonymousThreadHtml = threadHtml.replaceAll("Talking", "IWhisper")
  .replaceAll("DemoSix", "IWhisper#123")
  .replaceAll("DemoSeventeen", "IWhisper#456")
  .replaceAll(/(<div class="a-nice-comment-id">)<a[^>]*>[^<]*<\/a>/g,
    '$1<a href="/user/query/"></a>');
