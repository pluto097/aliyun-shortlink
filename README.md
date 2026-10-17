<div align="center">

# aliyun-shortlink

**专为阿里云 ESA「函数和 Pages」+ 边缘存储 Edge KV 编写的短链服务**

零运行时依赖 · 单文件边缘函数 · 自带落地页

</div>

---

## 这个项目解决什么问题

Cloudflare 上的短链开源项目很多（本项目参考了
[yusukebe/url-shortener](https://github.com/yusukebe/url-shortener) 与
[Aethersailor/cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker)），
但它们都强依赖 Cloudflare 的运行时与 KV，无法直接搬到阿里云。

本项目只做一件事：把短链服务跑在**阿里云 ESA「函数和 Pages」+ 边缘存储 Edge KV** 上。
业务核心只认 Web 标准的 `Request -> Response`，平台差异（单文件限制、键名规则、无 TTL、
无运行时环境变量）全部收敛在入口与适配层里；本地预览用同一份核心 + 内存存储。

## 特性

| | 能力 |
| --- | --- |
| ☁️ | **为 ESA 而生**：只有 `esa.jsonc` + 一条构建命令，即可用 Git 集成或控制台部署到 ESA 边缘函数 |
| 🗃️ | **边缘存储 Edge KV**：键名自动编码（`k/AbC` → `k_2fAbC`），无 TTL 时靠惰性过期 |
| 📦 | **零依赖**：没有 `node_modules`；除 ESA 因「单文件」限制需要一次打包外，无需构建 |
| 🔗 | **两套 API**：现代 JSON API + 兼容 cf-shortlink-worker 的 `POST /short`（base64 表单） |
| 🎨 | **落地页**：采用 [cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker) 的界面（毛玻璃卡片、简繁英三语、深色模式、复制 + toast），已署名并遵循 AGPL-3.0 |
| 🛡️ | **防滥用**：按 IP 固定窗口限流、可选创建口令、私有模式、域名黑名单、URL 严格校验 |
| ⚡ | **写穿缓存**：Edge KV 最终一致，也不会出现「刚创建就 404」 |
| ♻️ | **平滑迁移**：能直接读取其它短链项目写在 KV 里的「裸 URL」旧数据 |
| ✅ | **77 个测试**：路由、校验、CORS、限流、私有模式、Edge KV 适配器、打包产物、落地页契约与本地服务器（`node --test`，零依赖） |

## 架构

```
              浏览器 / curl / 你的脚本
                        │
        ┌───────────────▼─────────────────────────────────────────┐
        │  ESA 入口层（只做格式与打包，不含业务逻辑）              │
        │  esa/entry.mjs   边缘函数入口（export default { fetch }）│
        │    └ scripts/build-esa.mjs 打成单文件 esa/dist/edge.js  │
        └───────────────┬─────────────────────────────────────────┘
                        │  createApp(env).handle(Request) → Response
        ┌───────────────▼─────────────────────────────────────────┐
        │  核心  src/app.mjs                                      │
        │  路由 · URL 校验 · 短码分配 · 去重 · 限流 · 写穿缓存     │
        │  src/http.mjs  src/config.mjs  src/codes.mjs  src/ui.mjs │
        └───────────────┬─────────────────────────────────────────┘
                        │  LinkStore 统一键空间：k/ 链接 · d/ 去重 · r/ 限流
        ┌───────────────┴─────────────────────────────────────────┐
        ▼                                                         ▼
      esakv                                                    memory
   阿里云 ESA 边缘 KV（生产）                          本地预览 / 测试
   （键名自动编码）                                    （进程内，重启即丢）
```

关键设计：适配器只负责存/取**字符串**，值的格式、键空间、TTL 与惰性过期全部由 `LinkStore`
统一处理；生产只用 Edge KV，内存适配器只服务本地预览与测试。

## 快速开始（本地，1 分钟）

要求 Node.js >= 18.17。**不需要 `npm install`**（项目没有任何依赖）。

```bash
npm run dev          # 等价于 node scripts/serve.mjs
# [shortlink] storage=memory listening on http://127.0.0.1:8787
# [shortlink] local preview: storage=memory, data is lost on exit
```

本地进程里没有 Edge KV，所以预览服务器默认使用内存存储。打开 <http://127.0.0.1:8787>
就是落地页，也可以直接调 API：

```bash
curl -s -X POST http://127.0.0.1:8787/api/shorten \
     -H 'content-type: application/json' \
     -d '{"url":"https://example.com/a/very/long/path"}'
# {"ok":true,"code":"yFK6hek","shortUrl":"http://127.0.0.1:8787/yFK6hek","deduped":false}

curl -sI http://127.0.0.1:8787/yFK6hek | head -3
# HTTP/1.1 302 Found
# location: https://example.com/a/very/long/path
```

```powershell
# PowerShell 版本
Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/shorten `
  -ContentType 'application/json' -Body '{"url":"https://example.com"}'
```

想换端口：设置环境变量 `PORT`（bash：`PORT=9000 npm run dev`；PowerShell：`$env:PORT=9000; npm run dev`）。
本地预览同样读 `process.env`，所以 `PAGE_TITLE`、`BASE_URL` 等变量在这里也生效。

## 部署

只支持一个目标：**阿里云 ESA「函数和 Pages」+ 边缘存储 Edge KV**，
完整步骤见 [docs/DEPLOY-ALIYUN-ESA.md](docs/DEPLOY-ALIYUN-ESA.md)。

最短路径：

```bash
cp esa/env.example.json esa/env.json   # 填 ESA_KV_NAMESPACE / BASE_URL
npm run build:esa                      # -> esa/dist/edge.js（单文件，约 69 KB）
```

然后把仓库接到 ESA 的 Pages 项目即可（`esa.jsonc` 已配好 entry / buildCommand / 静态目录），
或在控制台新建边缘函数、把 `esa/dist/edge.js` 内容贴进去。

> ESA 的边缘函数是**单个 JS 文件**且**没有运行时环境变量**，所以配置在构建期注入。
> 细节与两种部署方式见 [ESA 部署文档](docs/DEPLOY-ALIYUN-ESA.md)。

### 部署后自检

```bash
curl -s https://你的域名/healthz                       # ok
curl -s -X POST https://你的域名/api/shorten \
     -H 'content-type: application/json' -d '{"url":"https://example.com"}'
curl -sI https://你的域名/<上一步返回的 code>           # 302 + location
```

## 环境变量

ESA **没有运行时环境变量**：这些值在构建期（`npm run build:esa`）被序列化进
`esa/dist/edge.js` 的 `const ESA_BUILD_ENV = {...}`，**改任何值都必须重新构建 + 重新部署**。

配置来源（后者覆盖前者）：

1. `esa/env.json`（本地文件，已 gitignore）
2. 构建环境变量（`process.env`，仅白名单键；ESA Pages 项目里配置）

必填性标记：**必填** = 不填跑不起来；**条件必填** = 取决于你的资源名/域名；
**建议** = 不填能跑但线上通常需要；**可选** = 不填即默认行为。
ESA 侧的逐项详解（含「不填会怎样」与配置校验方法）见
[ESA 部署文档](docs/DEPLOY-ALIYUN-ESA.md#构建环境变量必读)。

### 核心

| 变量 | 必填性 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `STORAGE` | 可选 | `auto` | 存储后端：`esakv` / `memory`；`auto` 在运行时有全局 `EdgeKV` 时选 `esakv`，否则 `memory`（ESA 构建的入口在未设置时直接锁定 `esakv`） |
| `BASE_URL` | 建议 | 请求的 Host | 决定返回的 `shortUrl` 用哪个域名，尾部 `/` 自动去掉；绑定自定义域名后应设为该域名 |
| `CREATE_TOKEN` | 可选 | 空 | 设置后创建接口需 `Authorization: Bearer <token>` 或 `X-Admin-Token`；**跳转与查询始终公开**。落地页会自动多出「访问口令」输入框 |
| `ACCESS_KEY` | 可选 | 空（公开） | **私有模式**：设置后落地页与所有 API 只在 `/{ACCESS_KEY}/` 下可达，`/` 与未带前缀的 API 返回 404；**短链跳转仍公开**。详见[私有模式](#私有模式访问密钥) |
| `LOCAL_CACHE_TTL_SEC` | 可选 | `300` | 本实例缓存「刚创建」链接的秒数，`0` 关闭；用于掩盖 Edge KV 的同步延迟（最迟 300 s） |

### 界面

| 变量 | 必填性 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `PAGE_TITLE` | 可选 | `ShortLink` | 落地页标题，同时用于浏览器标签与 404 页标题 |
| `PAGE_ICON` | 可选 | `🔗` | 落地页图标与 favicon（填 Emoji） |
| `PAGE_DESC` | 可选 | `Simple, fast, and secure short links.` | 落地页副标题，同时作为 `meta description` |

### 安全与限流

| 变量 | 必填性 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `CORS_MODE` | 可选 | `open` | `open` 任意站点可跨域读 / `list` 仅白名单 / `off` 不发 CORS 头；只影响浏览器 JS 调 API，跳转不依赖它 |
| `CORS_ORIGINS` | 可选 | 空 | `list` 模式允许的 Origin，逗号分隔且需带协议（`https://a.com`） |
| `RL_WINDOW_SEC` | 可选 | `60` | 限流窗口长度（秒） |
| `RL_MAX_REQ` | 可选 | `10` | 窗口内每 IP 允许的**创建**次数，超限 429 + `retry-after`；`0` 关闭（ESA 建议 `0`，因 KV 无 TTL） |
| `CODE_LENGTH` | 可选 | `7` | 随机短码长度（4–32）；越短碰撞越多，碰撞会自动重试 5 次 |
| `DEDUP_TTL_SEC` | 可选 | `0` | 大于 0 时同一长链在该秒数内复用同一短码；ESA 建议保持关闭（去重索引无 TTL 会累积） |
| `BLOCK_HOSTS` | 可选 | 空 | 目标 host 的正则黑名单，逗号分隔，命中返回 403 `blocked_host` |

### 存储

| 后端 | 说明 | 必填的变量 |
| --- | --- | --- |
| 阿里云 ESA Edge KV | 生产唯一后端 | `ESA_KV_NAMESPACE`（**条件必填**：默认 `shortlink`，存储空间名不同时必须填） |
| 内存 | 仅本地预览与测试，重启即丢 | 无 |

> ESA 构建时只会把**白名单内**的键写进产物（`scripts/build-esa.mjs` 的 `ENV_KEYS`），
> 变量名拼错会被静默忽略（不会报错也不会生效）。白名单就是上面各表里的全部变量。

## 私有模式（访问密钥）

个人使用时可以把整个管理面藏起来：设置 `ACCESS_KEY` 后，**落地页与全部 API 只在 `/{ACCESS_KEY}/` 下可达**。

```bash
# 生成一个强随机密钥（URL 安全，16 位）
node -e "console.log(require('node:crypto').randomBytes(12).toString('base64url'))"
```

设好之后的行为：

| 请求 | 设了 `ACCESS_KEY` | 未设置 |
| --- | --- | --- |
| `GET /` | **404** | 落地页 |
| `GET /{key}`、`GET /{key}/` | 落地页 | 404 |
| `POST /{key}/api/shorten`、`POST /{key}/short` | 创建短链 | — |
| `GET /{key}/api/links/:code` | 查询元数据 | — |
| `POST /api/shorten`、`POST /short`（无前缀） | **404（JSON）** | 正常 |
| `GET /{code}` | **302（短链仍公开）** | 302 |
| `GET /healthz` | 200 `ok`（公开） | 200 |

要点：

- **短链保持公开**：分享出去的 `https://域名/{code}` 不需要密钥，短码依旧只有 7 位。
  如果你连短链也想藏，把 `BASE_URL` 写成 `https://域名/{key}` 即可（`/{key}/{code}` 同样能跳转）。
- **不泄露**：404 响应里不含密钥；私有模式下 404 页面也不渲染「返回首页」链接；落地页带
  `referrer-policy: no-referrer`，点短链不会把密钥带给目标站点。
- **密钥在 URL 里**：会进入浏览器历史与平台访问日志，请用 ≥16 位随机串，别截图外发；
  需要更换时改 `ACCESS_KEY` 并重新构建部署（ESA 的配置是构建期注入的）。
- 密钥必须是 4–64 位 `A-Z a-z 0-9 - _`，否则**启动即报错**（不会静默退回公开模式）。
- 与 `CREATE_TOKEN` 可叠加：路径密钥挡住整个入口，口令再挡创建接口。私有模式下通常不再需要后者。

## API

完整文档见 [docs/API.md](docs/API.md)，速查：

| 方法与路径 | 说明 |
| --- | --- |
| `POST /api/shorten` | 创建短链，JSON `{url, code?}`，返回 `201 {ok, code, shortUrl, deduped}` |
| `POST /short` | 兼容 cf-shortlink-worker：表单 `longUrl`=base64，返回 `{Code, ShortUrl, Message}` |
| `GET /api/links/:code` | 查询短码元数据 |
| `GET /:code` | 302 跳转（`cache-control: no-store`） |
| `GET /` · `GET /healthz` | 落地页 · 健康检查 |

错误统一为 `{ok:false, error:{code, message}}`，并配合 HTTP 状态码：
`400 invalid_url/missing_url/invalid_code/reserved_code`、
`401 unauthorized`、`403 blocked_host`、`409 code_taken`、
`413 url_too_long`、`429 rate_limited`、`500 internal_error`。

## 项目结构

```
├─ src/                    业务核心
│  ├─ app.mjs              路由、创建、跳转、校验
│  ├─ http.mjs             Response 工具、CORS、限流、口令校验
│  ├─ config.mjs           环境变量归一化
│  ├─ codes.mjs            短码生成与保留字
│  ├─ ui.mjs               落地页 / 404 页（内联 CSS+JS）
│  ├─ sha256.mjs           SHA-256（去重索引与长键哈希）
│  └─ store/               存储抽象与 2 个适配器（esakv / memory）
├─ esa/                    阿里云 ESA 入口
│  ├─ entry.mjs            边缘函数入口（export default { fetch }）
│  ├─ env.example.json     配置模板
│  └─ dist/edge.js         构建产物（不提交）
├─ esa.jsonc               ESA「函数和 Pages」项目配置
├─ scripts/
│  ├─ build-esa.mjs        零依赖单文件打包器
│  └─ serve.mjs            本地预览服务器（内存存储）
├─ public/robots.txt       静态资源
├─ test/                   测试（node --test）
├─ test-support/           测试辅助模块（不会被当作测试文件）
└─ docs/                   API 与 ESA 部署文档
```

## 测试

```bash
npm test          # 等价于 node --test
```

77 个用例，覆盖：

- 路由与状态码、HEAD 无 body、尾斜杠归一化、保留字、404 页面
- URL 校验（协议、内嵌凭据、长度、域名黑名单）与自定义短码冲突
- 创建口令（Bearer / `X-Admin-Token`）、限流窗口与 `Retry-After`、去重
- CORS 三种模式、旧版 `/short` 兼容
- **私有模式**：`ACCESS_KEY` 前缀路由、404 不泄露密钥、前缀边界与大小写、公开短链、
  `/healthz` 与预检保持公开、与 `CREATE_TOKEN` 叠加、密钥校验
- **落地页**：上游 UI 标记齐全（表单/主题/语言/结果区）、配置转义（标题/描述/图标）、
  口令框按需出现、三语字典同键同语言、前端 URL-safe base64 载荷契约
- 存储：内存 TTL/容量、Edge KV 适配器（键编码单射性与字符集、长键哈希、计数器内嵌过期）、自动探测
- **写穿缓存**：写入即读、过期、容量上界、删除剔除
- **打包产物**：单文件、无 import 残留、单一 `export default`、体积达标、模块只来自 `esa/` 与 `src/`，
  并在模拟 ESA 运行时（stub `EdgeKV`）中跑通创建 → 302 → 404 → `/healthz` → 落地页，校验所有 key 合规
- 本地服务器：真实 HTTP 上的创建 → 302 → HEAD → 落地页 → CORS 预检

## 设计说明与已知限制

- **落地页来自上游**：`src/ui.mjs` 逐字取自
  [cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker) 的 `landingHtml()`
  （commit `4623ac19d93f1aef361d0825b7aada9a50ee91da`，Copyright (c) 2025 Aethersailor，AGPL-3.0），
  只做了 6 处已在 [NOTICE](NOTICE) 与文件头标注的修改：配置转义、按需口令框、footer 指向本项目、
  `noindex`、`sessionStorage` 兜底、私有模式路径前缀。因此**本仓库自 v2.0.0 起整体以 AGPL-3.0 分发**，
  v1.1.0 及更早为 MIT。
  网页表单直接调用既有的 `POST /short` 接口（`FormData.longUrl` = URL-safe 无填充 base64）。
  网页只提供长链输入与（按需出现的）访问口令框；**自定义短码只能通过 `POST /api/shorten` 的 `code` 字段使用**。
- **ESA 必须构建**：边缘函数是单文件、且没有运行时环境变量，故有 `scripts/build-esa.mjs`。
  该打包器是「按依赖顺序拼接 + 校验顶层重名」，不是完整 bundler——它只对本仓库这种无循环依赖、
  无重名的代码成立，遇到重名会直接报错而不是产出坏代码。
- **写穿缓存**：Edge KV 的写入是异步可见的（最迟 300 s）。`LinkStore` 会把本实例刚写的链接
  缓存在内存里，避免「创建后立刻打开 404」；跨节点仍受 KV 同步延迟影响。
- **限流按「创建」计数**：跳转不受限流影响，避免误伤正常访问；被 401 拒绝的请求也会计入配额，
  防止暴力猜口令。ESA 的 KV 没有 TTL，**建议 `RL_MAX_REQ=0`**，改用 ESA 自带频次控制。
- **无原子计数**：限流计数是「读改写」，属于近似值；同一自定义短码在极短时间内并发创建有极小概率重复写入。
- **重定向为 302 + `no-store`**：不缓存，便于后续修改或删除短链。
- 落地页内联脚本含有内联样式/脚本，故未设置严格 CSP；如你的场景需要，请自行加 hash 或 nonce。

### 已验证到什么程度

- **打包产物**：在**模拟运行时**（stub `EdgeKV`）中跑通全流程，键编码、体积与
  「无 import 残留 / 单一 default export」均经断言校验。
- **本地服务器**：`scripts/serve.mjs` 在真实 HTTP 上完成创建 → 302 → HEAD → 落地页 → CORS 预检。
- **本机没有阿里云账号凭据，未执行任何线上部署**。ESA 首次上线请按
  [自检清单](docs/DEPLOY-ALIYUN-ESA.md#上线自检按顺序执行) 逐项确认。

## 与参考项目的关系

- **落地页界面**：`src/ui.mjs` 是
  [Aethersailor/cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker)
  `landingHtml()` 的逐字移植（commit `4623ac19`，Copyright (c) 2025 Aethersailor，AGPL-3.0）。
  该项目的 `POST /short` 契约（base64 表单 + `{Code, ShortUrl}`）也被本项目完整实现，
  所以界面脚本无需改动即可工作。修改点见 [NOTICE](NOTICE)。
- 短码生成、去重与「`POST /short` + base64」的 API 形状，同样参考该项目
  （本项目为独立实现，仅借鉴接口约定与产品思路）。
- 「单一核心 + Pages 函数 + 落地页」的组织方式，参考
  [yusukebe/url-shortener](https://github.com/yusukebe/url-shortener)。
- 平台运行时契约依据官方文档：
  [ESA 函数和 Pages](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/what-is-functions-and-pages)、
  [ESA 边缘存储 API](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/edge-storage-api)。

## License

[GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）。

落地页界面逐字取自 [cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker)，
版权与修改点见 [NOTICE](NOTICE)。tag `v1.1.0` 及更早的提交仍按 MIT 授权。
