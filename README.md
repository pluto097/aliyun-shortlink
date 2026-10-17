<div align="center">

# aliyun-shortlink

**一套代码，首选跑在阿里云 ESA「函数和 Pages」+ 边缘存储 Edge KV 上的短链服务**
（同一份核心也可部署到阿里云函数计算 FC 3.0 与 Cloudflare Pages）

零运行时依赖 · 单一核心 · 多端入口 · 自带落地页

</div>

---

## 这个项目解决什么问题

Cloudflare 上的短链开源项目很多（本项目参考了
[yusukebe/url-shortener](https://github.com/yusukebe/url-shortener) 与
[Aethersailor/cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker)），
但它们都强依赖 Cloudflare KV，无法搬到阿里云。

本项目把**业务核心**与**平台适配**彻底拆开：

- 核心只认 Web 标准的 `Request -> Response`；
- 平台差异（事件格式、KV 绑定、单文件限制、HTTP 服务器）全部收敛到薄薄的适配层；
- 存储抽象成 5 个可切换后端：**阿里云 ESA 边缘 KV**、Cloudflare KV、阿里云 OSS、Upstash Redis、内存。

于是同一份 `src/` 在三种运行时上行为完全一致，包括落地页、API、限流、CORS 与错误码。

## 特性

| | 能力 |
| --- | --- |
| ☁️ | **ESA 首选**：`esa.jsonc` + 一条构建命令，即可用 Git 集成或控制台部署到阿里云边缘函数 |
| 🎯 | **多端同构**：ESA 边缘函数 / FC 3.0（内置运行时 + Web 函数）/ Cloudflare Pages & Workers 共用核心 |
| 🗃️ | **5 种存储**：ESA Edge KV、Cloudflare KV、阿里云 OSS（无 SDK，自实现 V1 签名）、Upstash Redis、内存 |
| 📦 | **零依赖**：没有 `node_modules`；除 ESA 因"单文件"限制需要一次打包外，其它平台无需构建 |
| 🔗 | **两套 API**：现代 JSON API + 兼容 cf-shortlink-worker 的 `POST /short`（base64 表单） |
| 🎨 | **内置落地页**：毛玻璃风格、简繁英三语、深色模式、一键复制，全部内联无外部资源 |
| 🛡️ | **防滥用**：按 IP 固定窗口限流、可选创建口令、域名黑名单、URL 严格校验 |
| ⚡ | **写穿缓存**：分布式 KV 最终一致，也不会出现"刚创建就 404" |
| ♻️ | **平滑迁移**：能直接读取其它短链项目写在 KV 里的「裸 URL」旧数据 |
| ✅ | **84 个测试**：路由、校验、CORS、限流、5 个适配器、各类平台入口与打包产物（`node --test`，零依赖） |

## 架构

```
              浏览器 / curl / 你的脚本
                        │
        ┌───────────────▼─────────────────────────────────────────┐
        │  平台入口层（只做格式与打包，不含业务逻辑）              │
        │  esa/entry.mjs          阿里云 ESA 边缘函数（首选）      │
        │    └ scripts/build-esa.mjs 打成单文件 esa/dist/edge.js  │
        │  functions/[[path]].js  Cloudflare Pages                │
        │  worker.mjs             Cloudflare Workers              │
        │  fc/index.js            FC 内置运行时 (event v1)        │
        │  fc/server.mjs          FC Web 函数 / 本地 / 容器        │
        └───────────────┬─────────────────────────────────────────┘
                        │  createApp(env).handle(Request) → Response
        ┌───────────────▼─────────────────────────────────────────┐
        │  核心  src/app.mjs                                      │
        │  路由 · URL 校验 · 短码分配 · 去重 · 限流 · 写穿缓存     │
        │  src/http.mjs  src/config.mjs  src/codes.mjs  src/ui.mjs │
        └───────────────┬─────────────────────────────────────────┘
                        │  LinkStore 统一键空间：k/ 链接 · d/ 去重 · r/ 限流
        ┌───────────────┴────────┬──────────────┬─────────────┬────────────┐
        ▼                        ▼              ▼             ▼            ▼
     esakv                     cfkv          upstash         oss         memory
   阿里云 ESA 边缘 KV      Cloudflare KV    Redis REST    阿里云 OSS   本地/测试
   （键名自动编码）                                          （V1 签名）
```

关键设计：适配器只负责存/取**字符串**，值的格式、键空间、TTL 与惰性过期全部由 `LinkStore`
统一处理；新增一种存储只需实现 4 个方法。

## 快速开始（本地，1 分钟）

要求 Node.js >= 18.17。**不需要 `npm install`**（项目没有任何依赖）。

```bash
npm run dev          # 等价于 node fc/server.mjs --dev
# [shortlink] storage=memory listening on http://127.0.0.1:8787
```

打开 <http://127.0.0.1:8787> 就是落地页。也可以直接调 API：

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

## 部署

| 目标 | 存储 | 文档 |
| --- | --- | --- |
| **阿里云 ESA「函数和 Pages」**（首选） | 边缘存储 Edge KV | [docs/DEPLOY-ALIYUN-ESA.md](docs/DEPLOY-ALIYUN-ESA.md) |
| 阿里云函数计算 FC 3.0 | OSS | [docs/DEPLOY-ALIYUN-FC.md](docs/DEPLOY-ALIYUN-FC.md) |
| Cloudflare Pages / Workers | KV | [docs/DEPLOY-CLOUDFLARE-PAGES.md](docs/DEPLOY-CLOUDFLARE-PAGES.md) |

ESA 的最短路径：

```bash
cp esa/env.example.json esa/env.json   # 填 ESA_KV_NAMESPACE / BASE_URL
npm run build:esa                      # -> esa/dist/edge.js（单文件，约 75 KB）
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

各平台使用**完全相同**的变量名，差异只在"怎么传进去"：

- **Cloudflare**：`wrangler.toml` 的 `[vars]` + 控制台密钥
- **阿里云 FC**：控制台环境变量
- **阿里云 ESA**：**没有运行时变量**，只能构建期注入（构建环境变量或 `esa/env.json`），**改值需重新构建部署**

必填性标记：**必填** = 不填跑不起来；**条件必填** = 取决于你的资源名/域名；
**建议** = 不填能跑但线上通常需要；**可选** = 不填即默认行为。
ESA 侧的逐项详解（含"不填会怎样"与配置校验方法）见
[ESA 部署文档](docs/DEPLOY-ALIYUN-ESA.md#构建环境变量必读)。

### 核心

| 变量 | 必填性 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `STORAGE` | 可选 | `auto` | 存储后端：`esakv` / `cfkv` / `oss` / `upstash` / `memory`；`auto` 按 `cfkv → esakv → oss → upstash → memory` 探测（ESA 上自动选中 `esakv`） |
| `BASE_URL` | 建议 | 请求的 Host | 决定返回的 `shortUrl` 用哪个域名，尾部 `/` 自动去掉；绑定自定义域名后应设为该域名 |
| `CREATE_TOKEN` | 可选 | 空 | 设置后创建接口需 `Authorization: Bearer <token>` 或 `X-Admin-Token`；**跳转与查询始终公开** |
| `LOCAL_CACHE_TTL_SEC` | 可选 | `300` | 本实例缓存"刚创建"链接的秒数，`0` 关闭；用于掩盖分布式 KV 的同步延迟（ESA 最迟 300 s、Cloudflare 约 60 s） |

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

| 后端 | 该后端必填的变量 | 可选变量 |
| --- | --- | --- |
| 阿里云 ESA Edge KV | `ESA_KV_NAMESPACE`（**条件必填**：默认 `shortlink`，存储空间名不同时必须填） | — |
| Cloudflare KV | KV 绑定 `LINKS`（**必填**，在 `wrangler.toml` 的 `[[kv_namespaces]]` 里声明） | — |
| 阿里云 OSS | `OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`（**必填**） | `OSS_ENDPOINT`（默认 `oss-cn-hangzhou.aliyuncs.com`）、`OSS_PREFIX`（默认 `shortlink/`）、`OSS_SECURITY_TOKEN`（STS 临时令牌） |
| Upstash Redis | `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`（**必填**，也接受 `KV_REST_API_URL` / `KV_REST_API_TOKEN`） | — |

自动探测顺序：`cfkv`（存在 `LINKS` 绑定）→ `esakv`（运行时有全局 `EdgeKV`）→ `oss` → `upstash` → `memory`。

> ESA 构建时只会把**白名单内**的键写进产物，变量名拼错会被静默忽略（不会报错也不会生效）。
> 白名单即上表全部变量，外加 `OSS_*`、`UPSTASH_*`、`KV_REST_*` 前缀。

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
├─ src/                    业务核心（所有平台共用）
│  ├─ app.mjs              路由、创建、跳转、校验
│  ├─ http.mjs             Response 工具、CORS、限流、口令校验
│  ├─ config.mjs           环境变量归一化
│  ├─ codes.mjs            短码生成与保留字
│  ├─ ui.mjs               落地页 / 404 页（内联 CSS+JS）
│  ├─ sha1.mjs             纯 JS SHA-1 / HMAC-SHA1 / Base64（OSS 签名用）
│  ├─ sha256.mjs           SHA-256（去重索引与长键哈希）
│  └─ store/               存储抽象与 5 个适配器（esakv/cfkv/oss/upstash/memory）
├─ esa/                    阿里云 ESA 入口
│  ├─ entry.mjs            边缘函数入口（export default { fetch }）
│  ├─ env.example.json     配置模板
│  └─ dist/edge.js         构建产物（不提交）
├─ esa.jsonc               ESA「函数和 Pages」项目配置
├─ scripts/build-esa.mjs   零依赖单文件打包器
├─ functions/[[path]].js   Cloudflare Pages 入口
├─ worker.mjs              Cloudflare Workers 入口（可选）
├─ fc/                     阿里云 FC 入口
│  ├─ index.js             内置运行时 handler（CJS，动态 import 核心）
│  ├─ event.mjs            event v1 ↔ Request/Response
│  ├─ server.mjs           node:http 服务（Web 函数 / 本地）
│  └─ bootstrap            自定义运行时启动脚本
├─ test/                   测试（node --test）
├─ test-support/           测试辅助模块（不会被当作测试文件）
├─ docs/                   API 与各平台部署文档
├─ wrangler.toml           Pages 配置
├─ wrangler.worker.jsonc   Workers 配置（可选）
└─ s.yaml                  Serverless Devs（FC 3.0）配置
```

## 测试

```bash
npm test          # 等价于 node --test
```

84 个用例，覆盖：

- 路由与状态码、HEAD 无 body、尾斜杠归一化、保留字、404 页面
- URL 校验（协议、内嵌凭据、长度、域名黑名单）与自定义短码冲突
- 创建口令（Bearer / `X-Admin-Token`）、限流窗口与 `Retry-After`、去重
- CORS 三种模式、旧版 `/short` 兼容
- 存储：内存 TTL/容量、Cloudflare KV 绑定映射、Upstash REST 协议、OSS 签名（用 `node:crypto` 独立复算校验）
- **ESA**：键编码单射性与字符集、Edge KV 适配器、计数器内嵌过期、长键哈希、自动探测
- **写穿缓存**：写入即读、过期、容量上界、删除剔除
- **打包产物**：单文件、无 import 残留、单一 `export default`、体积达标，并在模拟 ESA 运行时
  （stub `EdgeKV`）中跑通创建 → 302 → 404 → `/healthz` → 落地页，校验所有 key 合规
- 平台入口：FC event v1 双向转换、Pages `onRequest`、Workers `fetch`、Node HTTP 服务器真实端到端

## 设计说明与已知限制

- **只有 ESA 需要构建**：边缘函数是单文件、且没有运行时环境变量，故有 `scripts/build-esa.mjs`；
  其余平台零构建。该打包器是"按依赖顺序拼接 + 校验顶层重名"，不是完整 bundler——
  它只对本仓库这种无循环依赖、无重名的代码成立，遇到重名会直接报错而不是产出坏代码。
- **写穿缓存**：分布式 KV 的写入是异步可见的（ESA 最迟 300 s，Cloudflare 约 60 s）。`LinkStore` 会把
  本实例刚写的链接缓存在内存里，避免"创建后立刻打开 404"；跨节点仍受 KV 同步延迟影响。
- **限流按「创建」计数**：跳转不受限流影响，避免误伤正常访问；被 401 拒绝的请求也会计入配额，
  防止暴力猜口令。ESA 的 KV 没有 TTL，**ESA 上建议 `RL_MAX_REQ=0`**，改用 ESA 自带频次控制。
- **Cloudflare KV 最终一致**：同一自定义短码在极短时间内并发创建有极小概率重复写入；限流计数为
  「读改写」，属于近似值。**OSS / ESA KV 无原子计数**，同理。
- **OSS 适配器**：签名与请求形状由单元测试用 `node:crypto` 独立复算验证，但**未经真实凭据压测**；
  首次部署后请按「部署后自检」跑一遍。
- **重定向为 302 + `no-store`**：不缓存，便于后续修改或删除短链。
- 落地页内联脚本含有内联样式/脚本，故未设置严格 CSP；如你的场景需要，请自行加 hash 或 nonce。

### 已验证到什么程度

- **Cloudflare**：用 `wrangler pages dev`（wrangler 4.151.0 / workerd + 本地 KV）实测通过落地页、
  创建、KV 持久化、302、404、旧版 `/short`、CORS 预检与 429 限流。
- **阿里云 FC**：`git archive` 生成的 zip 解压后，按 `fc/index.handler` 直接调用成功。
- **阿里云 ESA**：打包产物在**模拟运行时**（stub `EdgeKV`）中跑通全流程，键编码、体积与
  「无 import 残留 / 单一 default export」均经断言校验。
- **本机没有阿里云与 Cloudflare 的账号凭据，未执行任何线上部署**。ESA 首次上线请按
  [自检清单](docs/DEPLOY-ALIYUN-ESA.md#上线自检按顺序执行) 逐项确认。

## 与参考项目的关系

- 短码生成、去重与「`POST /short` + base64」的 API 形状，参考
  [Aethersailor/cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker)
  （AGPL-3.0，本项目为独立实现，仅借鉴接口约定与产品思路）。
- 「单一核心 + Pages Functions + 落地页」的组织方式，参考
  [yusukebe/url-shortener](https://github.com/yusukebe/url-shortener)。
- 平台运行时契约依据官方文档：
  [ESA 函数和 Pages](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/what-is-functions-and-pages)、
  [ESA 边缘存储 API](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/edge-storage-api)、
  [FC HTTP 触发器](https://help.aliyun.com/zh/functioncompute/http-trigger-invoking-function)。

## License

[MIT](LICENSE)
