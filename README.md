# fantastic-tribble

面向北邮人论坛的轻量级只读 MCP 服务。

`fantastic-tribble` 通过 stdio MCP 提供北邮人论坛版面目录、版面查询和结构化帖子读取。调用方可先列出版面，再提交版面英文名及页码，服务负责认证、请求、解码、解析和错误归一化。项目针对低资源服务器设计，采用按需请求和无状态运行方式；帖子列表和帖子正文每次只读取一页。需要原始 HTML 时单独调用 `get_raw_website`。

> [!IMPORTANT]
> 项目目前处于早期开发阶段。已提供版面目录、版面页数查询、指定页帖子列表和结构化帖子读取，并使用本地认证验证了 `Talking` 的前两页及其中一个帖子的前两页，以及 `IWhisper` 中一个匿名帖的第一页。`get_thread` 已移除原始 HTML `content`，改为返回主题、楼主发言、热门回复和当前页各楼回复；原始 HTML 迁移至 `get_raw_website`。更多帖子样式和 Hermes 客户端联调尚待验证。

## 设计目标

- **固定数据源**：仅访问 `https://bbs.byr.cn`，调用方不能指定任意主机或请求路径。
- **工具接口**：`list_boards(section?)`、`get_board_threads(board, page = 1)`、`get_thread(board, article_id, page = 1)` 和 `get_raw_website(board, article_id, page = 1)`。
- **凭据与内容分离**：Hermes 只传查询参数，Cookie 由 MCP 进程环境提供。
- **低资源占用**：不常驻浏览器，不依赖数据库、Redis 或向量索引。
- **保守解析**：结构化接口在 HTTP 200 后继续检查页面语义；原始网页接口的成功仅表示获取成功。
- **可测试性**：网络函数和环境变量均可注入，自动测试不依赖真实论坛账号。

## 架构

```text
┌─────────────┐      stdio MCP      ┌───────────────────┐
│   Hermes    │ ──────────────────▶ │ fantastic-tribble │
└─────────────┘                     └────────┬──────────┘
                                            │
                                   参数校验 │ 认证配置
                                            │
                                   固定站点 HTTP GET
                                            │
                                            ▼
                                 https://bbs.byr.cn
```

版面查询数据流：

```text
      board + page
            │
            ▼
       参数校验与地址构造
            │
            ▼
      BYR_COOKIE 认证请求
            │
            ▼
       GBK / UTF-8 解码
            │
            ▼
      分页栏与帖子列表解析
            │
            ▼
       MCP 结构化结果
```

## 能力矩阵

| 能力 | 状态 | 说明 |
|---|---|---|
| TypeScript 工具链 | 已完成 | 支持严格类型检查、编译和 Node.js 测试 |
| 参数校验 | 已完成 | 校验英文版面名、文章 ID 和安全正整数页码 |
| 固定站点地址 | 已完成 | 仅生成北邮人论坛版面和文章路径 |
| HTTP 请求 | 已完成 | 15 秒超时、2 MiB 响应上限、拒绝自动跳转 |
| Cookie 配置 | 已完成 | 统一读取 `process.env.BYR_COOKIE` |
| 中文解码 | 已完成 | 根据响应声明处理 GBK、UTF-8 等编码 |
| 登录态实测 | 部分验证 | 本地 Cookie 可读取 `Talking` 前两页；快速连续请求会触发论坛限流 |
| 版面目录 | 已完成 | 列出全部或指定分区的版面英文名、中文名和链接，不读取帖子 |
| 版面页数查询 | 已完成 | 从当前账号所见分页栏读取 `total_pages`，不遍历所有页 |
| 版面帖子列表 | 已完成 | 按 `page` 读取帖子标题、链接及页面提供的元数据 |
| 正文与回复解析 | 已完成 | `get_thread` 返回主题、楼主、页面精选热门回复及当前页楼层 |
| 帖子内部翻页 | 已完成 | 两个帖子接口均接受安全正整数 `page`，每次只读取一页 |
| 原始网页读取 | 已完成 | `get_raw_website` 单独返回解码后的原始 HTML |
| MCP 工具注册 | 已完成 | 通过 stdio 提供四个只读工具 |
| Hermes 集成 | 待验证 | 使用下方 stdio 配置，尚未完成真实客户端联调 |

## 快速开始

### 环境要求

当前开发环境：

- Node.js 26
- npm 12

安装锁定依赖：

```sh
npm ci --ignore-scripts
```

类型检查、编译和测试：

```sh
npm run check
npm run build
npm test
```

启动 stdio MCP 服务：

```sh
npm start
```

服务等待标准输入中的 MCP 消息，在工具被调用时请求论坛。stdout 用于 MCP 协议，不输出启动提示或 Cookie。MCP 客户端应直接启动 Node.js（见下方配置），避免包管理器的运行提示混入协议输出。

## 版面查询工具

这里的“分组”对应论坛版面，`board` 填英文版面名，例如 `Talking`。版面名不区分大小写，例如 `iwhisper` 和 `IWhisper` 均可使用；服务校验页面链接时兼容论坛返回的规范大小写。页码从 1 开始；读取帖子列表时每次只请求一页，不批量抓取整个版面。

### 列出有哪些版面

工具名：`list_boards`

列出全部版面，无须先知道英文版面名：

```json
{}
```

也可以只列出一个分区的版面（分区编号使用字符串）：

```json
{"section":"1"}
```

成功结果包含 `result: "OK"`、`section`（全站查询为 `null`）、`total_boards`、`sections` 和 `boards`，以及 HTTP 状态与内容类型：

| 字段 | 含义 |
|---|---|
| `sections[].section`、`name`、`section_url` | 分区编号、中文名称和链接，可用编号缩小下次查询范围 |
| `boards[].board`、`name`、`board_url` | 版面英文名、中文名称和固定站点链接；`board` 可直接传给其他工具 |
| `boards[].sections` | 版面所属分区编号数组；跨区出现的同一版面合并为一条 |
| `total_boards` | 本次返回的去重版面数 |

服务先请求分区目录，再顺序读取所选分区的版面目录。当前全站有 10 个分区，因此默认调用需要 11 次小型目录请求；指定分区需要 2 次。论坛接口直接展开子目录，服务不抓取帖子、不并发请求、不自动重试。最多接受 32 个分区，超过时返回 `UNPARSED_PAGE`。

目录查询会在本次调用的内存中接收论坛刷新的三个会话 Cookie（`nforum[UTMPKEY]`、`nforum[UTMPNUM]`、`nforum[UTMPUSERID]`），避免后续目录请求继续使用旧会话而反复登录。只接受匹配论坛域名和目录路径的更新，不接受密码 Cookie 更新，不修改环境变量或 `.env`，调用结束即丢弃。

任一分区请求或解析失败，整个调用返回 MCP 错误，不把部分目录当作完整结果；未知分区返回 `SECTION_NOT_FOUND`。正常的空分区返回 `result: "OK"`、`boards: []` 和 `total_boards: 0`。目录以论坛返回的信息为准，列出版面不保证当前账号可以读取其中的所有帖子。

### 查询版面信息、页数和帖子列表

工具名：`get_board_threads`

```json
{"board":"Talking","page":2}
```

省略 `page` 时读取第 1 页。一次请求同时返回 `board`、`board_url`、当前页 `page`、总页数 `total_pages`、`http_status`、`content_type`、`result: "OK"` 和 `threads` 数组，不需要另行查询版面信息。

`get_board_info` 已合并到此工具并移除。原调用 `get_board_info({"board":"Talking"})` 的客户端改为调用 `get_board_threads({"board":"Talking"})`，即可取得原有元数据及第一页帖子列表；更新后需重启 MCP 服务并刷新客户端工具列表。

`total_pages` 表示本次请求时当前账号看到的总页数；服务不会逐页验证所有页面都能访问。权限、帖子数量和论坛状态变化都可能影响后续查询。无法识别页面时会返回错误状态，不猜测总页数。

`threads` 中每条帖子的字段如下：

| 字段 | 含义 |
|---|---|
| `article_id`、`article_url` | 帖子 ID 和固定站点链接，可用于后续 `get_thread` 调用 |
| `title` | 帖子标题 |
| `author`、`published_at` | 作者和页面显示的发帖时间 |
| `reply_count` | 回复数 |
| `is_pinned` | 是否为置顶帖子 |
| `last_reply_at`、`last_reply_author` | 页面显示的最后回复时间和回复者 |

页面缺失的元数据返回 `null`，日期保留页面文本，不补全年份或推断时区。超出已识别的页数会返回 `PAGE_OUT_OF_RANGE`；无法可靠确认页码或列表结构时返回 `UNPARSED_PAGE`。版面工具的失败结果使用 MCP `isError: true`；错误状态下不能把空 `threads` 当成空版面。

论坛可能对连续查询返回“请勿频繁登录”，服务会返回 `RATE_LIMITED`，调用方应稍后重试。服务不自动重试；需要总页数和帖子列表时，直接调用一次 `get_board_threads` 即可同时获取两者。

## 帖子查询工具

### 读取结构化帖子

工具名：`get_thread`

```json
{"board":"Talking","article_id":"6454538","page":1}
```

省略 `page` 时读取第一页；传入 `"page": 2` 可读取第二页。成功结果包含 `board`、`article_id`、`page`、`article_url`、`http_status`、`content_type`、`result: "OK"`、`total_pages` 和 `thread`：

| `thread` 字段 | 含义 |
|---|---|
| `topic` | 帖子主题 |
| `original_post` | 当前页出现的楼主发言；后续页没有楼主时为 `null` |
| `hot_replies` | 页面“精彩回复”区域中的热门回复；没有该区域时为 `[]` |
| `replies` | 当前页各楼回复，按楼层排列，不重复加入楼主发言 |

`original_post` 和两个回复数组使用同一发言结构：

| 字段 | 含义 |
|---|---|
| `article_id` | 该条发言自己的文章 ID；回复 ID 与主题帖 ID 不同 |
| `floor` | 楼层号：楼主为 0，沙发为 1，板凳为 2，地板为 3，其余取页面楼层号 |
| `author` | 页面中的作者，缺失时为 `null` |
| `published_at` | 发信头中的时间原文，缺失时为 `null`；不推断时区 |
| `content` | 可读正文文本，保留换行、引用、用户签名、链接地址和图片信息 |
| `likes` | 页面提供的“赞”数量，缺失时为 `null`；楼主好评积分不算点赞数 |

正文会移除标准发信头和末尾来源信息，楼主正文中不会混入嵌套的“精彩回复”。热门回复来自论坛明确提供的精选列表，不根据点赞数推断；可能包含其他页的回复，也可能与 `replies` 中的同一楼重复。热门列表没有显示时间时，其 `published_at` 为 `null`。

匿名版面的热门列表可能不显示作者，此时该条热门回复的 `author` 为 `null`；同一楼在普通回复中显示的匿名编号仍按原文保留，不用其他区域的信息补填缺失作者。

每次调用只请求指定的一页，不遍历整帖，也不为后续页额外读取楼主或热门区域。`total_pages` 是本次页面报告的总页数。失败结果的 `thread` 为 `null`，并使用 MCP `isError: true`；页码超出已识别的总页数时返回 `PAGE_OUT_OF_RANGE`，无法可靠识别页面或确认页码时返回 `UNPARSED_PAGE`。无论成功或失败，`get_thread` 均不返回原始 HTML `content`。

### 读取原始网页

工具名：`get_raw_website`

```json
{"board":"Talking","article_id":"6454538","page":2}
```

返回 `board`、`article_id`、`page`、`article_url`、`http_status`、`content_type`、`result` 和 `content`。其中 `content` 是按响应编码解码后的原始页面 HTML，不经过帖子正文提取；它不返回 `thread` 或 `total_pages`。参数与 `get_thread` 一致，访问地址仍限定为北邮人论坛的文章路径，不接受任意网址。

此接口的 `result: "OK"` 只表示页面请求成功且没有识别到登录失效，不能据此确认页面是有效帖子或请求页码存在。它不检查帖子结构或分页，维护页等未知页面也可能返回 `OK`。HTTP、登录和限流等已识别错误仍使用 MCP 错误结果。原来依赖 `get_thread.content` 的调用方应迁移至此接口。

## 认证配置

### 本地开发

复制公开模板：

```sh
cp .env.example .env
chmod 600 .env
```

编辑 `.env`：

```dotenv
BYR_COOKIE="name=value; other=value"
```

只填写浏览器发送给 `bbs.byr.cn` 的 `Cookie` 请求头值：

- 不包含 `Cookie:` 前缀；
- 不使用服务器响应中的 `Set-Cookie` 原文；
- 不把真实值写入聊天、日志或 Git；
- Cookie 更新后需要重启进程。

启动脚本使用 Node.js 的 `--env-file-if-exists=.env` 加载本地配置。进程已有的环境变量优先于 `.env` 文件。

### Hermes

在 Hermes 或其他支持 stdio 的 MCP 客户端中配置进程与环境变量，例如（替换为实际项目绝对路径）：

```json
{
  "mcpServers": {
    "forumcp": {
      "command": "node",
      "args": ["/absolute/path/to/forumcp/dist/index.js"],
      "env": {"BYR_COOKIE": "name=value; other=value"}
    }
  }
}
```

具体配置入口以所用客户端为准。先执行 `npm run build`，再启动客户端。程序侧统一读取：

```ts
process.env.BYR_COOKIE
```

因此本地 `.env` 和 Hermes 环境变量共用同一套认证代码。Hermes 不需要、也不应该在每次工具调用时提交 Cookie。

## 项目结构

```text
.
├── src/
│   ├── thread-params.ts   # 三参数类型与运行时校验
│   ├── article-url.ts     # 固定论坛文章地址构造
│   ├── board-params.ts    # 版面参数校验和分页地址构造
│   ├── cookie-config.ts   # BYR_COOKIE 读取与安全校验
│   ├── forum-http.ts      # 共享的受限 HTTP 请求、解码与页面分类
│   ├── inspect-article.ts # 帖子单页请求和结构化结果
│   ├── parse-thread.ts    # 主题、楼主、热门和当前页楼层解析
│   ├── raw-website.ts     # 原始文章页 HTML 读取
│   ├── parse-pagination.ts # 版面与帖子共用的分页验证
│   ├── parse-board.ts     # 版面分页与帖子列表 HTML 解析
│   ├── inspect-board.ts   # 版面单页请求、分页和帖子列表
│   ├── parse-board-directory.ts # 分区及版面目录 JSON 校验
│   ├── inspect-board-directory.ts # 全站/指定分区目录及跨区去重
│   ├── directory-session.ts # 仅目录调用内使用的临时会话刷新
│   ├── server.ts          # MCP 工具注册及可注入的服务工厂
│   └── index.ts           # stdio MCP 入口
├── tests/                 # Node.js 内置测试运行器用例
├── .env.example           # 不含凭据的公开配置模板
├── package.json           # npm scripts 与开发依赖
└── tsconfig.json          # TypeScript 编译配置
```

核心模块：

| 文件 | 职责 |
|---|---|
| `src/thread-params.ts` | 三参数类型与运行时校验 |
| `src/article-url.ts` | 固定论坛文章地址构造 |
| `src/board-params.ts` | 版面参数校验及 `?p=` 分页地址构造 |
| `src/cookie-config.ts` | `BYR_COOKIE` 读取与安全校验 |
| `src/forum-http.ts` | 共享的 HTTP 请求、响应限制、解码与页面分类 |
| `src/inspect-article.ts` | 帖子单页请求、分页检查和结构化结果 |
| `src/parse-thread.ts` | 主题、楼主发言、热门回复及当前页楼层解析 |
| `src/raw-website.ts` | 原始文章页 HTML 读取 |
| `src/parse-pagination.ts` | 版面与帖子共用的分页验证 |
| `src/parse-board.ts` | 版面分页和帖子列表解析 |
| `src/inspect-board.ts` | 版面单页请求及结构化结果 |
| `src/parse-board-directory.ts` | 分区及版面目录 JSON 校验 |
| `src/inspect-board-directory.ts` | 顺序读取目录、按分区筛选及跨区去重 |
| `src/directory-session.ts` | 仅目录调用内使用的临时会话刷新，不持久化 Cookie |
| `src/server.ts` | 四个 MCP 工具及可注入的服务工厂 |
| `src/index.ts` | stdio MCP 入口 |
| `.env.example` | 不含凭据的公开配置模板 |

模块保持单一职责：参数、地址、认证和传输相互分离，正文解析及 MCP 层不会直接处理 Cookie 字符串。

## 安全模型

### 凭据边界

- Cookie 只从 `BYR_COOKIE` 读取，不属于任何工具的参数。
- `.env` 已被 Git 忽略；`.env.example` 只能保留空值或假数据。
- `.env` 是明文凭据文件，`chmod 600` 只能限制文件访问，不能提供加密保护。
- 与 MCP 同属一个系统用户且拥有 shell 权限的进程，仍可能读取该用户的环境变量或文件。

### 网络边界

- 请求目标由代码固定为 `https://bbs.byr.cn`。
- 版面和文章 ID 必须通过运行时校验，不能注入协议、主机或额外路径。
- 自动重定向被拒绝，Cookie 不会跟随跳转发送到其他地址。
- 单次响应在解码前限制为 2 MiB，请求超时为 15 秒。
- 不自动重试；目录查询仅在单次调用内更新三个会话 Cookie，其他工具不接收 `Set-Cookie`，所有工具都不持久化认证信息或原样返回底层异常、凭据。

### 内容边界

论坛内容属于不可信外部输入。解析层只提取数据，不执行页面脚本，也不会把帖子文字解释为 MCP 控制指令。调用方应同样将标题、正文文本和原始 HTML 当作外部数据处理。

## 错误模型

当前请求链路使用有限错误码，避免向调用方泄露底层信息：

| 错误 | 含义 |
|---|---|
| `AUTH_REQUIRED` | 未配置 Cookie，或服务器仍返回登录提示 |
| `COOKIE_INVALID` | Cookie 格式、字符或长度不符合要求 |
| `PAGE_OUT_OF_RANGE` | 版面或结构化帖子请求页码超过页面报告的总页数 |
| `SECTION_NOT_FOUND` | 指定分区不在论坛返回的分区目录中 |
| `HTTP_ERROR` | 服务器返回非 2xx HTTP 状态 |
| `REQUEST_TIMEOUT` | 请求或响应读取超过 15 秒 |
| `RATE_LIMITED` | 论坛返回 HTTP 429 或已确认的“请勿频繁登录”提示，需稍后重试 |
| `RESPONSE_TOO_LARGE` | 响应正文超过 2 MiB |
| `DECODE_ERROR` | 响应字符编码无法可靠解码 |
| `REQUEST_FAILED` | 网络、流读取或重定向等未分类失败 |
| `UNPARSED_PAGE` | 版面目录、帖子/版面页面结构或页码无法确认 |

Cookie 语法通过校验并不等于登录态有效；只有真实授权请求成功并完成页面解析后，才能确认读帖链路可用。

## 开发

```sh
npm run check   # 仅进行 TypeScript 类型检查
npm run build   # 将 src/*.ts 编译到 dist/
npm test        # 编译并自动发现、运行全部测试
npm start       # 启动 stdio MCP 服务
```

自动测试覆盖参数校验、认证配置、HTTP 传输、版面目录合并、帖子结构解析、原始网页接口、MCP 工具注册和错误处理，使用假 Cookie、虚构帖子页面和临时 `.env`。帖子用例包括正文与热门回复分离、楼层编号、可缺失元数据、分页和未知结构拒绝。MCP 测试通过内存传输验证工具发现、结构化帖子调用、目录调用和错误返回；涉及 HTTP 传输的集成测试仅访问本机回环服务。测试不读取项目中的真实 `.env`，也不访问北邮人论坛。版面页数和帖子列表的成功解析另有授权登录后的实测验证。

2026-10-18 额外进行了少量只读实测：`Talking` 第 1、2 页分别成功解析，分页栏当时报告 163 页，每页返回 30 条记录；未遍历全部页面。快速连续请求曾触发 GBK 编码却标注 UTF-8 的“请勿频繁登录”响应，已加入独立的 `RATE_LIMITED` 处理和回归测试。以上计数随论坛内容变化。

同日实测 `list_boards` 默认全站查询成功：11 次目录请求返回 10 个分区、286 个去重版面，其中包含 `Linux（Linux操作系统）` 和 `Talking（谈天说地）`。目录查询使用调用内临时会话后可连续完成；未逐版面验证帖子读取权限，目录数量可能变化。

同日只读验证了 `Talking` 中一个帖子的前两页：第一页解析出楼主、2 条热门回复（第 6、17 楼）和普通回复第 1–9 楼；第二页的楼主为 `null`、热门数组为空、普通回复为第 10–19 楼，页面报告共 2 页。这验证了热门回复可以跨页及后续页只返回本页内容；实测范围仅限该帖，不代表其他版面或所有帖子样式均已验证。

同日复现并修复了 `IWhisper` 匿名帖的 `UNPARSED_PAGE`：热门区域作者留空，而同一回复的普通楼层显示匿名编号，旧校验误判为作者冲突。修复后通过 MCP `get_thread` 只读复测该帖第一页，单次请求返回 `OK`、当前页 1、总页数 2、楼主、9 条普通回复和 4 条热门回复。缺失作者仍返回 `null`，回复 ID、楼层及两处均显示的作者仍须一致；未验证该帖第二页。

## 路线图

1. 在目标部署机器上验证登录态能否跨设备复用。
2. 扩展授权实测至其他版面、末页和空版面。
3. 扩展帖子解析验证至其他版面和更多页面样式。
4. 通过 stdio 完成同机部署的 Hermes 联调。
5. 在 2 核 2 GiB 目标服务器上测量实际内存、延迟和失败行为。

## 使用边界

本项目定位为个人、低频、只读的论坛辅助工具。使用者应仅访问自己有权查看的内容，并遵守论坛规则。项目不计划提供批量爬取、附件下载、用户资料采集、发帖、回复、私信或绕过访问控制的功能。
