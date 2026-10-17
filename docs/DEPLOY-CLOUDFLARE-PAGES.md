# 部署到 Cloudflare Pages

> **这是可选后端。** 本项目首选的部署目标是
> [阿里云 ESA「函数和 Pages」+ 边缘 KV](DEPLOY-ALIYUN-ESA.md)；
> Cloudflare 通道保持可用，适合已有 Cloudflare 账号/域名的场景。

> 读完大概需要 5 分钟。本项目零依赖、无构建步骤，Pages 会直接使用仓库里的
> `functions/[[path]].js` 与 `public/`，不需要 `npm install`、不需要 `npm run build`。

## 方式一：Git 集成（推荐）

1. 把仓库推到 GitHub/GitLab。
2. Cloudflare 控制台 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
3. 构建设置：
   - **Framework preset**: `None`
   - **Build command**: 留空
   - **Build output directory**: `public`
4. **Create a KV namespace**：控制台 → **Workers & Pages** → **KV** → **Create a namespace**，命名（例如 `shortlink-links`）。
5. 回到 Pages 项目 → **Settings** → **Functions** → **KV namespace bindings** → **Add binding**：
   - **Variable name**: `LINKS`（必须完全一致）
   - **KV namespace**: 选择第 4 步创建的命名空间
6. **Settings** → **Environment variables** 添加 `BASE_URL`（如 `https://s.example.com`）等变量，
   `CREATE_TOKEN` 这类密钥用 **Add secret** 添加。
7. 重新部署一次（Deployments → Retry deployment），让绑定生效。

## 方式二：命令行（wrangler）

```bash
# 0) 登录（会打开浏览器）
npx wrangler login

# 1) 创建 KV 命名空间，记下输出的 id
npx wrangler kv namespace create LINKS
```

把返回的 `id` 填进仓库根目录的 `wrangler.toml`，取消注释这段：

```toml
[[kv_namespaces]]
binding = "LINKS"
id = "0123456789abcdef0123456789abcdef"
```

```bash
# 2) 本地预览（在真实 Workers 运行时里跑，包含 KV 模拟）
npx wrangler pages dev public --kv LINKS

# 3) 部署（项目名自定，wrangler.toml 里 name = "shortlink"）
npx wrangler pages deploy --project-name shortlink
```

> 如果你的 wrangler 版本要求显式目录，用
> `npx wrangler pages deploy public --project-name shortlink`。
> `functions/` 目录由 wrangler 从当前工作目录自动识别，不需要额外参数。

本仓库的 Pages 入口已用 **wrangler 4.151.0（workerd 本地运行时）** 实测通过：

```bash
npx wrangler pages dev public --port 8788 --kv LINKS --compatibility-date 2025-01-01
```

实测覆盖：落地页、创建短链、KV 持久化（`/api/links/:code` 读回）、302 跳转、404 页面、
旧版 `POST /short`、CORS 预检、以及 429 限流。

部署完成后：
- 默认域名是 `https://<project>.pages.dev`；
- 绑定自定义域名后，把 `BASE_URL` 设成该域名，否则短链会按请求域名生成。

## 环境变量速查

最小可用配置只需要 KV 绑定。建议再设置：

```toml
[vars]   # wrangler.toml，非密钥
BASE_URL = "https://s.example.com"
RL_MAX_REQ = "10"
RL_WINDOW_SEC = "60"
```

密钥（不要写进 `wrangler.toml`）：

```bash
npx wrangler pages secret put CREATE_TOKEN
npx wrangler pages secret put ACCESS_KEY     # 私有模式：页面与 API 只在 /{ACCESS_KEY}/ 下可达（可选）
```

完整变量列表见 [README](../README.md#环境变量)。

## 验证

```bash
curl -s https://s.example.com/healthz            # ok
curl -s -X POST https://s.example.com/api/shorten \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
curl -sI https://s.example.com/<code>            # 302 + location
```

## 排错

| 现象 | 原因与处理 |
| --- | --- |
| 创建短链成功但重启后数据消失 | 日志出现 `[shortlink] using the in-memory store`：KV 绑定名不是 `LINKS` 或未绑定到当前环境（Production/Preview 分别要绑） |
| `500 internal_error` | 看 Pages → Deployments → Functions 日志；通常是 KV 绑定缺失或存储配置错误 |
| 短链域名不对 | 没有设置 `BASE_URL`，回退成了请求头里的域名 |
| 创建返回 `401` | 设置了 `CREATE_TOKEN`，请求需要 `Authorization: Bearer <token>` |
| 创建返回 `429` | 触发限流；调 `RL_MAX_REQ` / `RL_WINDOW_SEC`，或设 `RL_MAX_REQ=0` 关闭 |

> 想先不接 KV 快速试跑？把 `STORAGE=memory` 即可，但 Pages 会随时回收 isolate，数据不保证留存，仅供演示。

## 可选：部署成普通 Worker

不想用 Pages Functions 时，仓库还提供了 Workers 入口：

```bash
npx wrangler deploy -c wrangler.worker.jsonc
```

把 `wrangler.worker.jsonc` 里的 `REPLACE_WITH_KV_NAMESPACE_ID` 换成真实 KV id 即可。
