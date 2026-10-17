<div align="center">

# aliyun-shortlink

**一套代码，同时跑在阿里云函数计算 FC 3.0 与 Cloudflare Pages 上的短链服务**

零运行时依赖 · 无构建步骤 · 单一核心 · 双端入口 · 自带落地页

</div>

---

## 这个项目解决什么问题

Cloudflare 上的短链开源项目很多（本项目参考了
[yusukebe/url-shortener](https://github.com/yusukebe/url-shortener) 与
[Aethersailor/cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker)），
但它们都强依赖 Cloudflare KV，无法搬到阿里云。

本项目把**业务核心**与**平台适配**彻底拆开：

- 核心只认 Web 标准的 `Request -> Response`；
- 平台差异（事件格式、KV 绑定、HTTP 服务器）全部收敛到一层薄薄的适配器；
- 存储抽象成 4 个可切换后端，阿里云侧用**原生 OSS**、Cloudflare 侧用 **KV**，也可用 Upstash Redis 打通。

于是同一份 `src/`，在两端行为完全一致，包括落地页、API、限流、CORS 与错误码。

## 特性

| | 能力 |
| --- | --- |
| 🚀 | **零依赖、无构建**：没有 `node_modules`，不需要打包，FC 上传 zip 即用 |
| 🎯 | **双端一致**：`functions/[[path]].js`（Pages）与 `fc/index.js`（FC 内置运行时）共用核心 |
| 🗃️ | **4 种存储**：Cloudflare KV、阿里云 OSS（无 SDK，自实现 V1 签名）、Upstash Redis、内存（本地） |
| 🔗 | **两套 API**：现代 JSON API + 兼容 cf-shortlink-worker 的 `POST /short`（base64 表单） |
| 🎨 | **内置落地页**：毛玻璃风格、简繁英三语、深色模式、一键复制，全部内联无外部资源 |
| 🛡️ | **防滥用**：按 IP 固定窗口限流、可选创建口令、域名黑名单、URL 严格校验 |
| ♻️ | **平滑迁移**：能直接读取其它短链项目写在 KV 里的「裸 URL」旧数据 |
| ✅ | **67 个测试**：覆盖路由、校验、CORS、限流、4 个适配器与 3 个平台入口（`node --test`，零依赖） |

## 架构

```
              浏览器 / curl / 你的脚本
                        │
        ┌───────────────▼────────────────────────────────┐
        │  平台入口层（只做格式转换，不含业务逻辑）        │
        │  functions/[[path]].js  Cloudflare Pages        │
        │  worker.mjs             Cloudflare Workers      │
        │  fc/index.js            FC 内置运行时 (event v1)│
        │  fc/server.mjs          FC Web 函数 / 本地 / 容器│
        └───────────────┬────────────────────────────────┘
                        │  createApp(env).handle(Request) → Response
        ┌───────────────▼────────────────────────────────┐
        │  核心  src/app.mjs                             │
        │  路由 · URL 校验 · 短码分配 · 去重 · 限流       │
        │  src/http.mjs   src/config.mjs   src/codes.mjs  │
        │  src/ui.mjs（落地页与 404 页）                  │
        └───────────────┬────────────────────────────────┘
                        │  LinkStore 统一键空间：k/ 链接 · d/ 去重 · r/ 限流
        ┌───────────────┴────────┬──────────────┬──────────────┐
        ▼                        ▼              ▼              ▼
     memory                    cfkv          upstash          oss
   本地 / 测试            Cloudflare KV    Redis REST      阿里云 OSS
```

关键设计：适配器只负责存/取**字符串**，值的格式、键空间、TTL 与惰性过期全部由 `LinkStore`
统一处理，所以新增一种存储只需实现 4 个方法。

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

> `--dev` 使用内存存储，进程退出数据即清空，适合本地试用。
> 想本地持久化，把 `STORAGE` 指向 OSS 或 Upstash 即可（见下文）。

## 环境变量

两端使用**完全相同**的变量名，在 Cloudflare 填 `wrangler.toml` / 控制台，在 FC 填控制台环境变量。

### 核心

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `STORAGE` | `auto` | `auto` / `memory` / `cfkv` / `upstash` / `oss`，留空自动探测 |
| `BASE_URL` | 请求域名 | 短链域名，如 `https://s.example.com`；建议显式设置 |
| `CREATE_TOKEN` | 空 | 设置后创建接口需要口令；留空则公开可创建 |

### 界面

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PAGE_TITLE` | `ShortLink` | 页面标题 |
| `PAGE_ICON` | `🔗` | 页面图标（Emoji） |
| `PAGE_DESC` | `Simple, fast, and secure short links.` | 页面描述 |

### 安全与限流

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CORS_MODE` | `open` | `open` 全开 / `list` 白名单 / `off` 关闭 |
| `CORS_ORIGINS` | 空 | 仅 `list` 模式生效，逗号分隔 |
| `RL_WINDOW_SEC` | `60` | 限流窗口（秒） |
| `RL_MAX_REQ` | `10` | 窗口内每 IP 允许的**创建**次数，`0` 关闭限流 |
| `CODE_LENGTH` | `7` | 随机短码长度（4–32） |
| `DEDUP_TTL_SEC` | `0` | 大于 0 时启用长链去重，值为映射缓存秒数 |
| `BLOCK_HOSTS` | 空 | 域名黑名单，逗号分隔的正则，如 `evil\.com,spam\.net` |

### 存储

| 后端 | 变量 |
| --- | --- |
| Cloudflare KV | KV 绑定 `LINKS`（`wrangler.toml` 的 `[[kv_namespaces]]`） |
| 阿里云 OSS | `OSS_BUCKET`、`OSS_ENDPOINT`（默认 `oss-cn-hangzhou.aliyuncs.com`）、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_PREFIX`（默认 `shortlink/`）、`OSS_SECURITY_TOKEN`（STS 可选） |
| Upstash Redis | `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`（也接受 `KV_REST_API_URL` / `KV_REST_API_TOKEN`） |

自动探测顺序：`cfkv`（存在 `LINKS` 绑定）→ `oss` → `upstash` → `memory`。

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

## 部署

- **Cloudflare Pages** → [docs/DEPLOY-CLOUDFLARE-PAGES.md](docs/DEPLOY-CLOUDFLARE-PAGES.md)
- **阿里云函数计算 FC 3.0** → [docs/DEPLOY-ALIYUN-FC.md](docs/DEPLOY-ALIYUN-FC.md)

两边都是一条命令（Cloudflare）或一次上传/`s deploy`（阿里云），无需 `npm install`、无需构建产物。

### 部署后自检

```bash
curl -s https://你的域名/healthz                       # ok
curl -s -X POST https://你的域名/api/shorten \
     -H 'content-type: application/json' -d '{"url":"https://example.com"}'
curl -sI https://你的域名/<上一步返回的 code>           # 302 + location
```

## 项目结构

```
├─ src/                    业务核心（两端共用）
│  ├─ app.mjs              路由、创建、跳转、校验
│  ├─ http.mjs             Response 工具、CORS、限流、口令校验
│  ├─ config.mjs           环境变量归一化
│  ├─ codes.mjs            短码生成与保留字
│  ├─ ui.mjs               落地页 / 404 页（内联 CSS+JS）
│  ├─ sha1.mjs             纯 JS SHA-1 / HMAC-SHA1 / Base64（OSS 签名用）
│  └─ store/               存储抽象与 4 个适配器
├─ functions/[[path]].js   Cloudflare Pages 入口
├─ worker.mjs              Cloudflare Workers 入口（可选）
├─ fc/                     阿里云 FC 入口
│  ├─ index.js             内置运行时 handler（CJS，动态 import 核心）
│  ├─ event.mjs            event v1 ↔ Request/Response
│  ├─ server.mjs           node:http 服务（Web 函数 / 本地）
│  └─ bootstrap            自定义运行时启动脚本
├─ test/                   零依赖测试（node --test）
├─ docs/                   API 与部署文档
├─ wrangler.toml           Pages 配置
├─ wrangler.worker.jsonc   Workers 配置（可选）
└─ s.yaml                  Serverless Devs（FC 3.0）配置
```

## 测试

```bash
npm test          # 等价于 node --test
```

67 个用例，覆盖：

- 路由与状态码、HEAD 无 body、尾斜杠归一化、保留字、404 页面
- URL 校验（协议、内嵌凭据、长度、域名黑名单）与自定义短码冲突
- 创建口令（Bearer / `X-Admin-Token`）、限流窗口与 `Retry-After`、去重
- CORS 三种模式、旧版 `/short` 兼容
- 存储：内存 TTL/容量、Cloudflare KV 绑定映射、Upstash REST 协议、OSS 签名（用 `node:crypto` 独立复算校验）
- 平台入口：FC event v1 双向转换、Pages `onRequest`、Workers `fetch`、Node HTTP 服务器真实端到端

## 设计说明与已知限制

- **已在真实运行时验证**：Cloudflare 侧用 `wrangler pages dev`（wrangler 4.151.0 / workerd，真实 KV 本地模拟）
  跑通了落地页、创建、KV 持久化、302、404、旧版 `/short`、CORS 预检与限流；阿里云侧按 FC 3.0 `event v1`
  契约在 Node.js 中回放验证（本机没有阿里云凭据与 Cloudflare 账号，**未执行线上部署**）。
- **无需构建**：纯 ESM JavaScript（`fc/index.js` 为 CJS 以适配 FC 的 `require` 加载方式，内部动态 `import` ESM 核心）。
- **限流按「创建」计数**：跳转不受限流影响，避免误伤正常访问；被 401 拒绝的请求也会计入配额，防止暴力猜口令。
- **Cloudflare KV 最终一致**：同一自定义短码在极短时间内并发创建有极小概率重复写入；限流计数为「读改写」，属于近似值。
- **OSS 无原子计数**：限流计数同样是读改写，且过期时间写在值里；建议给 Bucket 配置生命周期规则自动清理 `shortlink/r/` 前缀（例如 1 天后删除）。
- **OSS 适配器**：签名与请求形状由单元测试用 `node:crypto` 独立复算验证，但**未经真实凭据压测**；首次部署后请按「部署后自检」跑一遍。
- **重定向为 302 + `no-store`**：不缓存，便于后续修改或删除短链。
- 落地页内联脚本含有内联样式/脚本，故未设置严格 CSP；如你的场景需要，请自行加 hash 或 nonce。

## 与参考项目的关系

- 短码生成、去重与「`POST /short` + base64」的 API 形状，参考
  [Aethersailor/cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker)（AGPL-3.0，本项目为独立实现，仅借鉴接口约定与产品思路）。
- 「单一核心 + Pages Functions + 落地页」的组织方式，参考
  [yusukebe/url-shortener](https://github.com/yusukebe/url-shortener)。
- 阿里云函数的运行时契约依据官方文档
  [HTTP 触发器调用函数](https://help.aliyun.com/zh/functioncompute/http-trigger-invoking-function) 与
  [创建 Web 函数](https://help.aliyun.com/zh/functioncompute/fc-3-0/user-guide/create-a-web-function) 实现。

## License

[MIT](LICENSE)
