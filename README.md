# fantastic-tribble

面向北邮人论坛的轻量级只读 MCP 服务。

`fantastic-tribble` 计划为 Hermes 提供结构化的论坛文章读取能力：Hermes 只需要提交版面、文章 ID 和页码，服务负责认证、请求、解码、解析和错误归一化。项目针对低资源服务器设计，默认采用按需请求、单页读取和无状态运行方式。

> [!IMPORTANT]
> 项目目前处于早期开发阶段。HTTP 请求与认证配置链路已建立，但帖子正文解析、分页和 MCP 协议入口尚未完成，因此当前版本还不能作为 Hermes MCP 服务使用。

## 设计目标

- **固定数据源**：仅访问 `https://bbs.byr.cn`，调用方不能指定任意主机或请求路径。
- **最小工具接口**：目标接口为 `get_thread(board, article_id, page = 1)`。
- **凭据与内容分离**：Hermes 只传文章参数，Cookie 由 MCP 进程环境提供。
- **低资源占用**：不常驻浏览器，不依赖数据库、Redis 或向量索引。
- **保守失败**：未知页面不会被当作成功结果；HTTP 200 也必须继续检查页面语义。
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

目标数据流：

```text
board + article_id + page
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
     标题、正文与回复解析
            │
            ▼
       MCP 结构化结果
```

## 能力矩阵

| 能力 | 状态 | 说明 |
|---|---|---|
| TypeScript 工具链 | 已完成 | 支持严格类型检查、编译和 Node.js 测试 |
| 参数校验 | 已完成 | 校验 `board`、`article_id` 和 `page` |
| 固定文章地址 | 已完成 | 仅生成北邮人论坛文章路径 |
| HTTP 请求 | 已完成 | 15 秒超时、2 MiB 响应上限、拒绝自动跳转 |
| Cookie 配置 | 已完成 | 统一读取 `process.env.BYR_COOKIE` |
| 中文解码 | 已完成 | 根据响应声明处理 GBK、UTF-8 等编码 |
| 登录态实测 | 待验证 | 尚未使用真实 Cookie 验证服务器登录态 |
| 正文与回复解析 | 规划中 | 当前只区分登录提示、HTTP 错误和未知页面 |
| 分页 | 规划中 | 当前请求函数只接受 `page = 1` |
| MCP 工具注册 | 规划中 | 尚未提供 stdio MCP 入口 |
| Hermes 集成 | 规划中 | 尚未形成可用的 Hermes MCP 配置 |

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

运行当前离线示例：

```sh
npm start
```

当前 `npm start` 只展示参数校验结果和生成的文章地址，不访问论坛，也不会打印 Cookie。

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

未来接入 Hermes 时，由对应 MCP 服务配置显式传入 `BYR_COOKIE`。程序侧仍然只读取：

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
│   ├── cookie-config.ts   # BYR_COOKIE 读取与安全校验
│   ├── inspect-article.ts # HTTP 请求、响应限制与页面分类
│   └── index.ts           # 当前离线演示入口
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
| `src/cookie-config.ts` | `BYR_COOKIE` 读取与安全校验 |
| `src/inspect-article.ts` | HTTP 请求、响应限制与页面分类 |
| `src/index.ts` | 当前离线演示入口 |
| `.env.example` | 不含凭据的公开配置模板 |

模块保持单一职责：参数、地址、认证和传输相互分离，后续正文解析及 MCP 层不会直接处理 Cookie 字符串。

## 安全模型

### 凭据边界

- Cookie 只从 `BYR_COOKIE` 读取，不属于 `get_thread` 的工具参数。
- `.env` 已被 Git 忽略；`.env.example` 只能保留空值或假数据。
- `.env` 是明文凭据文件，`chmod 600` 只能限制文件访问，不能提供加密保护。
- 与 MCP 同属一个系统用户且拥有 shell 权限的进程，仍可能读取该用户的环境变量或文件。

### 网络边界

- 请求目标由代码固定为 `https://bbs.byr.cn`。
- 版面和文章 ID 必须通过运行时校验，不能注入协议、主机或额外路径。
- 自动重定向被拒绝，Cookie 不会跟随跳转发送到其他地址。
- 单次响应在解码前限制为 2 MiB，请求超时为 15 秒。
- 不自动重试，不存储响应中的 `Set-Cookie`，不把底层异常或凭据原样返回。

### 内容边界

论坛内容属于不可信外部输入。后续解析层只提取数据，不执行页面脚本，也不会把帖子文字解释为 MCP 控制指令。

## 错误模型

当前请求链路使用有限错误码，避免向调用方泄露底层信息：

| 错误 | 含义 |
|---|---|
| `AUTH_REQUIRED` | 未配置 Cookie，或服务器仍返回登录提示 |
| `COOKIE_INVALID` | Cookie 格式、字符或长度不符合要求 |
| `PAGE_NOT_SUPPORTED` | 当前版本收到第一页以外的请求 |
| `HTTP_ERROR` | 服务器返回非 2xx HTTP 状态 |
| `REQUEST_TIMEOUT` | 请求或响应读取超过 15 秒 |
| `RESPONSE_TOO_LARGE` | 响应正文超过 2 MiB |
| `DECODE_ERROR` | 响应字符编码无法可靠解码 |
| `REQUEST_FAILED` | 网络、流读取或重定向等未分类失败 |
| `UNRECOGNIZED_PAGE` | 响应成功但页面语义尚无法识别 |

Cookie 语法通过校验并不等于登录态有效；只有真实授权请求成功并完成页面解析后，才能确认读帖链路可用。

## 开发

```sh
npm run check   # 仅进行 TypeScript 类型检查
npm run build   # 将 src/*.ts 编译到 dist/
npm test        # 编译并自动发现、运行全部测试
npm start       # 运行当前离线示例
```

自动测试使用假 Cookie 和临时 `.env`。涉及 HTTP 传输的集成测试仅访问本机回环服务，不读取项目中的真实 `.env`，也不访问北邮人论坛。

## 路线图

1. 使用本地真实 `BYR_COOKIE` 验证登录态能否跨设备复用。
2. 根据授权页面建立脱敏 HTML 样本，解析标题、正文、楼层、作者和时间。
3. 验证论坛分页参数并实现单页读取。
4. 将正式读帖流程注册为 `get_thread` MCP 工具。
5. 通过 stdio 接入同机部署的 Hermes。
6. 在 2 核 2 GiB 目标服务器上测量实际内存、延迟和失败行为。

## 使用边界

本项目定位为个人、低频、只读的论坛辅助工具。使用者应仅访问自己有权查看的内容，并遵守论坛规则。项目不计划提供批量爬取、附件下载、用户资料采集、发帖、回复、私信或绕过访问控制的功能。
