# 部署到阿里云 ESA「函数和 Pages」+ 边缘存储 Edge KV

> **这是本项目唯一的部署目标。** 边缘函数负责跑短链服务，边缘存储 Edge KV 负责存链接
> （`get` / `put` / `delete` 三个操作就够了）。

## 为什么需要一条构建命令

ESA 的边缘函数有三条硬约束，决定了配置不能在运行时注入：

| 约束 | 影响 |
| --- | --- |
| 代码包是**单个 JS 文件**（≤ 4 MB），ESA 不做模块解析 | 必须把 `src/` 打包成一个文件 |
| 函数**没有运行时环境变量**绑定 | 配置必须在**构建期**写进代码 |
| 开发语言 JS(ES6)，入口是 `export default { fetch }` | 入口用 ESM 默认导出 |

`scripts/build-esa.mjs`（零依赖）负责：把 `src/` + `esa/entry.mjs` 拼成 `esa/dist/edge.js`，
并把配置以 `const ESA_BUILD_ENV = {...}` 写进产物头部。

```bash
npm run build:esa        # 等价于 node scripts/build-esa.mjs
# [build:esa] 10 modules -> esa\dist\edge.js (68.6 KB)
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
4. **构建环境变量**（控制台 → Pages 项目 → 构建配置 → 环境变量）。

   ESA 的边缘函数**没有运行时环境变量**，所有配置都在**构建期**写进产物，所以这一步不能省。
   最低限度只需要配置下面 3 个，完整清单与逐项作用见
   [构建环境变量（必读）](#构建环境变量必读)：

   | 变量 | 必填性 | 示例值 | 不填会怎样 |
   | --- | --- | --- | --- |
   | `ESA_KV_NAMESPACE` | **条件必填**（存储空间名不是 `shortlink` 时必填） | `shortlink` | 用默认名 `shortlink` 去读写；名字对不上则首次请求 500 |
   | `STORAGE` | 可选 | `esakv` | 留空即可：入口在未设置时直接锁定 `esakv`，缺 `EdgeKV` 会明确报错 |
   | `BASE_URL` | **建议** | `https://s.example.com` | 用请求的 Host 拼短链；绑定域名后会变成预览域名 |

5. 触发部署，等待构建完成。公开预览域名需带 token 访问，正式使用请**绑定自定义域名**。
6. 绑定域名后把 `BASE_URL` 改成该域名，**重新部署**（配置是烘焙进代码的，改值必须重新构建）。

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

## 构建环境变量（必读）

### 先说清楚三件事

1. **这些是构建期变量，不是运行时变量。** `scripts/build-esa.mjs` 会把它们序列化成产物第一行的
   `const ESA_BUILD_ENV = {...}`。**改任何值都必须重新构建 + 重新部署**，运行中的函数不会热更新。
2. **优先级**（后者覆盖前者）：
   代码内默认值 → `esa/env.json`（本地文件，已 gitignore）→ **构建环境变量（`process.env`，最高）**。
3. **只注入白名单键**，写错名字的变量会被**静默忽略**（不会报错，但也不会生效）。白名单就是下面表格里的
   所有变量（即 `scripts/build-esa.mjs` 的 `ENV_KEYS`）。

> 安全提示：配置值会以明文出现在 `esa/dist/edge.js` 里。`esa/dist/` 与 `esa/env.json` 都已在 `.gitignore`，
> 不要把产物文件提交进仓库。

### 必填性怎么读

| 标记 | 含义 |
| --- | --- |
| **必填** | 不填就直接不可用。**本页没有绝对必填项**——所有变量都有默认值，真正"必填"的只有 `ESA_KV_NAMESPACE`，且仅当你的存储空间名不等于默认的 `shortlink` 时 |
| **条件必填** | 取决于你的资源名/域名，不填就可能直接不可用（不是语法错误，而是运行时报错或结果不符合预期） |
| **建议** | 不填也能跑，但正式上线几乎一定需要 |
| **可选** | 不填就是默认行为，按需覆盖 |

### 变量清单

#### 连接与存储

| 变量 | 必填性 | 默认值 | 作用 | 不填 / 填错的后果 |
| --- | --- | --- | --- | --- |
| `ESA_KV_NAMESPACE` | **条件必填**（存储空间名 ≠ `shortlink` 时必填） | `shortlink` | 指定读写哪个边缘 KV 存储空间；必须与控制台「边缘计算和 AI → KV 存储」里创建的**存储空间名完全一致** | 名字对不上 → 创建/跳转返回 500，日志里能看到 EdgeKV 读写失败或命名空间不存在 |
| `STORAGE` | 可选 | `auto` | 存储后端：`esakv` / `memory`。`auto` 在运行时有全局 `EdgeKV` 时选 `esakv`，否则退回 `memory`；ESA 入口在未设置时直接锁定 `esakv`，缺 `EdgeKV` 会明确报错 | 生产**切勿设成 `memory`**：实例随时回收，数据必丢（`memory` 只用于本地预览与测试） |

#### 域名与页面

| 变量 | 必填性 | 默认值 | 作用 | 不填的后果 |
| --- | --- | --- | --- | --- |
| `BASE_URL` | **建议** | 请求的 Host | 决定返回给用户的 `shortUrl` 用哪个域名（尾部 `/` 会被去掉） | 用请求头里的域名：绑定自定义域名前是预览域名，之后才正确 |
| `PAGE_TITLE` | 可选 | `ShortLink` | 落地页标题，同时用作浏览器标签与 404 页标题 | 显示 `ShortLink` |
| `PAGE_ICON` | 可选 | `🔗` | 落地页图标与 favicon（填 Emoji） | 显示 🔗 |
| `PAGE_DESC` | 可选 | `Simple, fast, and secure short links.` | 落地页副标题，同时作为页面 `meta description` | 使用该英文默认描述 |

#### 安全

| 变量 | 必填性 | 默认值 | 作用 | 说明 |
| --- | --- | --- | --- | --- |
| `CREATE_TOKEN` | 可选 | 空（公开创建） | 设置后 `POST /api/shorten`、`POST /short` 必须带 `Authorization: Bearer <token>` 或 `X-Admin-Token: <token>`；**跳转与查询始终公开** | 值为明文写进产物；落地页会多出口令输入框 |
| `ACCESS_KEY` | 可选 | 空（公开） | 私有模式：设置后落地页与所有 API 只在 `/{ACCESS_KEY}/…` 下可达，`/` 与未带前缀的 API 返回 404；**短链跳转保持公开** | 同样写进产物；必须是 4–64 位 `A-Za-z0-9_-`，否则构建/启动直接报错；建议 ≥16 位随机串 |
| `CORS_MODE` | 可选 | `open` | `open` 任意站点可跨域读；`list` 仅白名单；`off` 不发 CORS 头 | 短链跳转不依赖 CORS，只有浏览器里的 JS 调 API 才需要 |
| `CORS_ORIGINS` | 可选 | 空 | `CORS_MODE=list` 时允许的 Origin，逗号分隔，**必须带协议**（`https://a.com`） | 仅在 `list` 模式下生效 |
| `BLOCK_HOSTS` | 可选 | 空 | 目标 URL 的 host 命中这些正则时拒绝创建（403 `blocked_host`），逗号分隔 | 例：`evil\.com,spam\.net`；非法正则会告警并跳过 |

#### 限流、去重与缓存

| 变量 | 必填性 | 默认值 | 作用 | ESA 上的注意 |
| --- | --- | --- | --- | --- |
| `RL_MAX_REQ` | 可选 | `10` | 每 IP 在窗口内允许的**创建**次数；超限返回 429 + `retry-after`；`0` 关闭限流 | **建议设 `0`**：ESA KV 无 TTL，计数对象不会自动过期，会持续累积 |
| `RL_WINDOW_SEC` | 可选 | `60` | 限流窗口长度（秒，1–86400） | 仅在 `RL_MAX_REQ > 0` 时有意义 |
| `DEDUP_TTL_SEC` | 可选 | `0`（关闭） | >0 时同一长链在 N 秒内复用同一短码（去重索引 `d/<sha256>`） | 同样因无 TTL 会累积，**建议保持 `0`** |
| `CODE_LENGTH` | 可选 | `7` | 随机短码长度（4–32） | 越短碰撞越多；碰撞会自动重试 5 次，仍失败返回 503 |
| `LOCAL_CACHE_TTL_SEC` | 可选 | `300` | 本实例内存缓存**刚创建**的链接多少秒，`0` 关闭 | 用于掩盖 KV 最终一致（最迟 300 s）造成的"刚建就 404"；只对本节点有效 |

### 怎么确认配置真的生效了

三种办法，从快到慢：

```bash
# 1) 看构建日志（最直接）
npm run build:esa
# [build:esa] config keys baked in: STORAGE, ESA_KV_NAMESPACE, BASE_URL, ...

# 2) 看产物第一行
head -c 300 esa/dist/edge.js      # 期望 const ESA_BUILD_ENV = {"STORAGE":"esakv",...}

# 3) 部署后看落地页标题是否变成你设置的 PAGE_TITLE
```

```powershell
# Windows PowerShell 版本
Get-Content esa/dist/edge.js -TotalCount 1
```

### 配置相关的常见故障

| 现象 | 原因 |
| --- | --- |
| 改了变量但行为没变 | 只改了控制台变量、没重新构建部署；或变量名拼错被白名单静默忽略 |
| 首次请求 500，日志提到 EdgeKV | `ESA_KV_NAMESPACE` 与存储空间名不一致，或该命名空间不存在 |
| 落地页标题/描述还是默认值 | `PAGE_TITLE` 等没进构建环境变量（检查构建日志的 keys 列表） |
| 短链域名是 `xxx.pages.esa...` 预览域名 | 没设 `BASE_URL`，或设了但没重新部署 |

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

## 限制与建议

| 项目 | ESA 表现 | 本项目的处理 |
| --- | --- | --- |
| 代码包 | 单文件 ≤ 4 MB | 产物约 69 KB |
| 执行 | 响应 ≤ 120 s，网关等待 10 s，单次 fetch 子请求 ≤ 4 | 短链服务只有 1 次内部操作，远低于限制 |
| KV key | 仅 `[A-Za-z0-9_-]`，≤ 512 B | 适配器自动编码（`k/AbC` → `k_2fAbC`） |
| KV TTL | **不支持** | 链接过期时间写在值里，读取时惰性判断 |
| KV 一致性 | 最终一致，通常数秒，最迟 300 s | **写穿缓存**保证"创建后立刻打开"必定成功 |
| 容量 | 单空间 1 GB、账号 10 GB | 短链数据极小 |

**强烈建议 `RL_MAX_REQ=0` 关闭应用层限流**，改用 ESA 自带的 WAF / 频次控制。原因是 ESA KV 没有 TTL：
限流计数对象不会自己过期，长期运行会持续累积（虽然过期时间已写在值里、不会误拦，但会占空间）。

同理，去重（`DEDUP_TTL_SEC`）在 ESA 上也建议保持 `0`。

## 排错

| 现象 | 原因与处理 |
| --- | --- |
| 部署后访问是 404 HTML 但看不到落地页 | `public/index.html` 存在遮蔽了函数，或 `esa.jsonc` 设了 `notFoundStrategy` |
| 创建返回 500 | 看函数日志：多为构建环境变量没注入（产物内 `ESA_BUILD_ENV` 为空）或 `ESA_KV_NAMESPACE` 名字不对 |
| `EdgeKV is not available in this runtime` | 没有跑在 ESA 边缘函数里：本地直接跑源码（本地请用 `npm run dev`），或把函数部署到了别的平台 |
| `STORAGE=esakv requires ESA_KV_NAMESPACE` | 构建时没给 `ESA_KV_NAMESPACE`，默认值是 `shortlink`，注意与实际命名空间一致 |
| 跳转域名是预览域名而不是你的域名 | 没设置 `BASE_URL` |
| 创建成功但另一地区访问 404 | KV 还没同步（最迟 300 s）；同节点靠写穿缓存不受影响 |
| 创建返回 429 | `RL_MAX_REQ` 阈值到了；建议设 `0` 改用 ESA 风控 |
| 构建报 `duplicate top-level declaration` | 有人给 `src/` 引入了同名顶层变量，打包器拒绝拼接（这是保护） |
| 构建报超过 4 MB | 产物异常膨胀，检查是否误把大文件 import 进 `src/` |
