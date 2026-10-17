# 部署到阿里云 ESA「函数和 Pages」+ 边缘存储 Edge KV

> **这是本项目首选的部署方式。** ESA 的「函数和 Pages」相当于阿里云版的 Cloudflare Workers/Pages，
> 边缘存储 Edge KV 的形态也几乎和 Cloudflare KV 一致（`get`/`put`/`delete`）。

## 为什么需要一条构建命令

ESA 的边缘函数有三条硬约束，决定了配置不能像 Cloudflare 那样用环境变量在运行时注入：

| 约束 | 影响 |
| --- | --- |
| 代码包是**单个 JS 文件**（≤ 4 MB），ESA 不做模块解析 | 必须把 `src/` 打包成一个文件 |
| 函数**没有运行时环境变量**绑定 | 配置必须在**构建期**写进代码 |
| 开发语言 JS(ES6)，入口是 `export default { fetch }` | 入口用 ESM 默认导出 |

`scripts/build-esa.mjs`（零依赖，~250 行）负责：把 `src/` + `esa/entry.mjs` 拼成 `esa/dist/edge.js`，
并把配置以 `const ESA_BUILD_ENV = {...}` 写进产物头部。

```bash
npm run build:esa        # 等价于 node scripts/build-esa.mjs
# [build:esa] 14 modules -> esa\dist\edge.js (75.3 KB)
# [build:esa] config keys baked in: STORAGE, ESA_KV_NAMESPACE, BASE_URL, RL_MAX_REQ
```

配置来源（后者覆盖前者）：
1. `esa/env.json`（本地用，已在 `.gitignore` 中）
2. **构建环境变量**（`process.env`，仅白名单键；Pages 项目里配置）

## 前置准备

1. **域名已接入 ESA**：函数通过域名或路由对外提供服务，没有接入域名无法绑定。
2. **开通边缘存储**：ESA 控制台 → 左侧 **边缘计算和 AI** → **KV 存储** → 开通。
3. **创建存储空间（Namespace）**：例如命名 `shortlink`，这个名字就是 `ESA_KV_NAMESPACE`。

> 存储空间名 ≠ 函数名，也 ≠ Pages 项目名，三者互相独立。

## 方式 A：Git 集成（推荐）

1. 把仓库推到 GitHub。
2. ESA 控制台 → **边缘计算和 AI** → **函数和 Pages** → **创建 Pages** → 导入该仓库。
3. 仓库根目录的 [`esa.jsonc`](../esa.jsonc) 会被自动识别，并成为**配置的唯一来源**（控制台里对应项会失效）：

   ```jsonc
   {
     "name": "shortlink",
     "entry": "./esa/dist/edge.js",
     "installCommand": "",
     "buildCommand": "node scripts/build-esa.mjs",
     "assets": { "directory": "./public" }
   }
   ```

   - `installCommand` 为空字符串 → 跳过安装（本项目零依赖，装也没东西可装）。
   - `entry` 指向**构建产物**：构建脚本先跑，再按该路径取函数文件。
4. **构建环境变量**（控制台 → Pages 项目 → 构建配置 → 环境变量）：

   | 变量 | 示例值 | 说明 |
   | --- | --- | --- |
   | `STORAGE` | `esakv` | 使用 ESA 边缘 KV |
   | `ESA_KV_NAMESPACE` | `shortlink` | 第 3 步创建的存储空间名 |
   | `BASE_URL` | `https://s.example.com` | 短链域名，建议显式设置 |
   | `PAGE_TITLE` | `ShortLink` | 可选 |
   | `RL_MAX_REQ` | `0` | **建议 0**，原因见下文"限制与建议" |
   | `LOCAL_CACHE_TTL_SEC` | `300` | 写穿缓存时长，默认即 300 |
   | `CREATE_TOKEN` | 随机串 | 可选：创建短链需要口令 |

5. 触发部署，等待构建完成。公开预览域名需带 token 访问，正式使用请**绑定自定义域名**。
6. 绑定域名后把 `BASE_URL` 改成该域名并重新部署。

## 方式 B：控制台单函数（不想接 Git）

1. 本地准备配置：

   ```bash
   cp esa/env.example.json esa/env.json    # 然后按需修改
   npm run build:esa
   ```

2. ESA 控制台 → **边缘计算和 AI** → **函数** → 创建函数（或创建应用），把 `esa/dist/edge.js` 的内容
   粘贴/上传进去。
3. 为函数配置**域名**或**路由**，把流量指向它。
4. 注意：配置是烘焙进代码的，**改配置必须重新构建并重新上传**。

## 目录约定

| 路径 | 作用 |
| --- | --- |
| `esa/entry.mjs` | ESA 入口，`export default { fetch(request) }` |
| `esa/env.example.json` | 配置模板（提交进仓库） |
| `esa/env.json` | 本地配置（**不提交**） |
| `esa/dist/edge.js` | 构建产物（**不提交**） |
| `public/` | 静态资源目录，目前只有 `robots.txt` |
| `esa.jsonc` | ESA Pages 项目配置 |

两个必须遵守的约定：

- **不要在 `public/` 放 `index.html`**。静态资源优先于函数，`/index.html` 会遮蔽落地页。
- **不要在 `esa.jsonc` 里设置 `notFoundStrategy`**。一旦设置，浏览器导航请求会绕过函数直接返回静态页，
  落地页与 404 页面都会失效。

## 上线自检（按顺序执行）

```bash
# 1) 健康检查
curl -s https://s.example.com/healthz      # 期望 ok

# 2) 创建
curl -s -X POST https://s.example.com/api/shorten \
  -H 'content-type: application/json' -d '{"url":"https://example.com"}'

# 3) 立刻访问（验证写穿缓存）
curl -sI https://s.example.com/<code>      # 期望 302 + location

# 4) 等待约 1 分钟后，换成手机热点/另一地区再访问一次（验证 KV 已同步到其它节点）
```

5. 控制台 → KV 存储 → 进入命名空间 → 应能看到形如 `k_2f<code>` 的 key。
   `/` 为什么变成 `_2f`：ESA 的 key 只允许 `[A-Za-z0-9_-]`，适配器会把其他字符按 UTF-8 字节编码成 `_hh`。

## 限制与建议（ESA 与 Cloudflare 的关键差异）

| 项目 | ESA 表现 | 本项目的处理 |
| --- | --- | --- |
| 代码包 | 单文件 ≤ 4 MB | 产物约 75 KB |
| 执行 | 响应 ≤ 120 s，网关等待 10 s，单次 fetch 子请求 ≤ 4 | 短链服务只有 1 次内部操作，远低于限制 |
| KV key | 仅 `[A-Za-z0-9_-]`，≤ 512 B | 适配器自动编码（`k/AbC` → `k_2fAbC`） |
| KV TTL | **不支持** | 链接过期时间写在值里，读取时惰性判断 |
| KV 一致性 | 最终一致，通常数秒，最迟 300 s | **写穿缓存**保证"创建后立刻打开"必定成功 |
| 容量 | 单空间 1 GB、账号 10 GB | 短链数据极小 |

**强烈建议 `RL_MAX_REQ=0` 关闭应用层限流**，改用 ESA 自带的 WAF / 频次控制。原因是 ESA KV 没有 TTL：
限流计数对象不会自己过期，长期运行会持续累积（虽然过期时间已写在值里、不会误拦，但会占空间）。

同理，去重（`DEDUP_TTL_SEC`）也只建议在 Cloudflare KV / Redis 上开启。

## 与 Cloudflare 的概念对照

| Cloudflare | 阿里云 ESA |
| --- | --- |
| Workers / Pages Functions | 函数和 Pages（边缘函数） |
| `env.LINKS`（KV 绑定） | `new EdgeKV({ namespace })`（内置 API，无绑定概念） |
| `wrangler.toml` / `wrangler deploy` | `esa.jsonc` + 控制台 / Git 集成 |
| 运行时环境变量绑定 | **无** → 构建期注入 |
| KV 支持 TTL | **不支持 TTL** |

## 排错

| 现象 | 原因与处理 |
| --- | --- |
| 部署后访问是 404 HTML 但看不到落地页 | `public/index.html` 存在遮蔽了函数，或 `esa.jsonc` 设了 `notFoundStrategy` |
| 创建返回 500 | 看函数日志：多为构建环境变量没注入（产物内 `ESA_BUILD_ENV` 为空）或 `ESA_KV_NAMESPACE` 名字不对 |
| `EdgeKV is not available in this runtime` | 把函数部署成了普通 FC 函数，而不是 ESA 边缘函数；ESA 才注入 `EdgeKV` 全局 |
| `STORAGE=esakv requires ESA_KV_NAMESPACE` | 构建时没给 `ESA_KV_NAMESPACE`，默认值是 `shortlink`，注意与实际命名空间一致 |
| 跳转域名是预览域名而不是你的域名 | 没设置 `BASE_URL` |
| 创建成功但另一地区访问 404 | KV 还没同步（最迟 300 s）；同节点靠写穿缓存不受影响 |
| 创建返回 429 | `RL_MAX_REQ` 阈值到了；建议设 `0` 改用 ESA 风控 |
| 构建报 `duplicate top-level declaration` | 有人给 `src/` 引入了同名顶层变量，打包器拒绝拼接（这是保护） |
| 构建报超过 4 MB | 产物异常膨胀，检查是否误把大文件 import 进 `src/` |

## 其它部署方式（可选）

本项目核心与 ESA 无关，同一份 `src/` 也跑在：

- 阿里云函数计算 FC 3.0 + OSS → [DEPLOY-ALIYUN-FC.md](DEPLOY-ALIYUN-FC.md)
- Cloudflare Pages + KV → [DEPLOY-CLOUDFLARE-PAGES.md](DEPLOY-CLOUDFLARE-PAGES.md)
