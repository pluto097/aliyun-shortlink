# API 文档

Base URL 就是你的部署域名，例如 `https://s.example.com`。

所有响应都带 `x-content-type-options: nosniff`；JSON 响应带 `cache-control: no-store`。

## 认证

默认**公开可创建**。当环境变量 `CREATE_TOKEN` 被设置后，两个创建接口都需要口令，二选一：

```http
Authorization: Bearer <CREATE_TOKEN>
X-Admin-Token: <CREATE_TOKEN>
```

跳转（`GET /:code`）、元数据查询、落地页与健康检查**永远公开**，不受口令影响。
内置落地页在检测到该配置时会自动显示"访问口令"输入框，并把它作为 `Authorization` 头发出去。

> **私有模式（`ACCESS_KEY`）**：一旦设置，**所有 API 路径都要加前缀** ——
> `/{ACCESS_KEY}/api/shorten`、`/{ACCESS_KEY}/short`、`/{ACCESS_KEY}/api/links/:code`。
> 未带前缀的同名路径一律 `404`（API 形态返回 JSON）。短链跳转 `GET /:code` 与 `GET /healthz` 仍然公开。
> 也就是说：把本文档里所有路径前面加上 `/{ACCESS_KEY}`，其余契约完全不变。

## 限流

限流只作用于创建类接口，按客户端 IP 做固定窗口计数（`RL_WINDOW_SEC` / `RL_MAX_REQ`）。

```
x-ratelimit-limit: 10        # 每窗口配额
x-ratelimit-remaining: 7     # 剩余次数
x-ratelimit-reset: 34        # 距窗口重置的秒数
x-rl-remaining: 7            # 兼容 cf-shortlink-worker 的旧头
x-rl-reset-in: 34
retry-after: 34              # 仅在 429 时出现
```

`RL_MAX_REQ=0` 可完全关闭限流。

---

## POST /api/shorten

创建短链。

### 请求

`Content-Type: application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 是 | 目标长链，必须是 `http`/`https`，最长 8192 字符 |
| `code` | string | 否 | 自定义短码，`[A-Za-z0-9_-]{3,64}`，不能是保留字 |

也接受 `application/x-www-form-urlencoded` 与 `multipart/form-data`，字段名 `url`（别名 `longUrl`）与 `code`（别名 `slug`）。

### 响应 `201 Created`

```json
{
  "ok": true,
  "code": "yFK6hek",
  "shortUrl": "https://s.example.com/yFK6hek",
  "deduped": false
}
```

`deduped: true` 表示命中了 `DEDUP_TTL_SEC` 去重缓存，复用了已有短码。

### 示例

```bash
curl -s -X POST https://s.example.com/api/shorten \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $CREATE_TOKEN" \
  -d '{"url":"https://example.com/a/long/path","code":"hello"}'
```

```powershell
Invoke-RestMethod -Method Post https://s.example.com/api/shorten `
  -ContentType 'application/json' `
  -Body '{"url":"https://example.com/a/long/path"}'
```

```js
const response = await fetch('https://s.example.com/api/shorten', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com/a/long/path' }),
});
const { shortUrl } = await response.json();
```

---

## POST /short

兼容 [cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker) 的接口形态，方便已有脚本直接迁移。

> **内置落地页就是调用这个接口。** 页面把长链转成 URL-safe、无填充的 base64 放进 `FormData.longUrl`，
> 再判断返回的 `Code === 1`、取 `ShortUrl` 展示。所以网页不需要额外的 API，反之你的脚本照这个形状发也能用。

### 请求

`multipart/form-data` 或 `application/x-www-form-urlencoded`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `longUrl` | string | 是 | **Base64 编码**后的目标长链（支持标准与 URL-safe Base64） |

### 响应 `200 OK`

```json
{ "Code": 1, "ShortUrl": "https://s.example.com/AbCd123", "Message": "" }
```

失败时 `Code: 0`，`Message` 为原因，HTTP 状态码与主 API 一致（429 时仍带 `x-rl-*` 头）。

```bash
# Base64("https://example.com") = aHR0cHM6Ly9leGFtcGxlLmNvbQ==
curl -s -X POST https://s.example.com/short \
  -F 'longUrl=aHR0cHM6Ly9leGFtcGxlLmNvbQ=='
```

---

## GET /api/links/:code

查询短码元数据，短码不存在时返回 404。

```json
{
  "ok": true,
  "code": "yFK6hek",
  "url": "https://example.com/a/long/path",
  "createdAt": 1765939200,
  "expiresAt": 0
}
```

`createdAt` / `expiresAt` 为 Unix 秒；`expiresAt: 0` 表示永不过期。

---

## GET /:code

命中时返回 `302`：

```http
HTTP/1.1 302 Found
location: https://example.com/a/long/path
cache-control: no-store
referrer-policy: no-referrer
```

未命中时返回 `404` HTML 页面。`HEAD` 返回同样的状态与头，但无 body。

## GET /

返回落地页（单文件 HTML，含内联样式与脚本）。

## GET /healthz

返回纯文本 `ok`，用于探活与部署自检。

---

## 错误码

错误响应统一为：

```json
{ "ok": false, "error": { "code": "invalid_url", "message": "The URL must be an absolute http(s) URL." } }
```

| HTTP | `error.code` | 说明 |
| --- | --- | --- |
| 400 | `missing_url` | 缺少 `url` 字段 |
| 400 | `invalid_url` | 非 http/https、含内嵌凭据、或无法解析 |
| 400 | `invalid_json` | JSON 体无法解析或不是对象 |
| 400 | `invalid_form` | 既不是 JSON 也不是可解析的表单 |
| 400 | `invalid_code` | 自定义短码格式不合法 |
| 400 | `reserved_code` | 自定义短码是保留字（`api`、`short`、`healthz` 等） |
| 401 | `unauthorized` | 缺少或错误的创建口令 |
| 403 | `blocked_host` | 命中 `BLOCK_HOSTS` 黑名单 |
| 404 | `not_found` | 短码不存在（`/api/links/:code`） |
| 405 | `method_not_allowed` | 方法不支持，响应带 `allow` 头 |
| 409 | `code_taken` | 自定义短码已被占用 |
| 413 | `url_too_long` | 长链超过 8192 字符 |
| 413 | `payload_too_large` | 请求体过大 |
| 429 | `rate_limited` | 触发限流，带 `retry-after` |
| 500 | `internal_error` | 未预期的服务端错误 |
| 503 | `code_unavailable` | 连续多次随机短码碰撞，建议重试 |

## CORS

由 `CORS_MODE` 控制：

- `open`（默认）：`access-control-allow-origin: *`
- `list`：仅当请求 `Origin` 命中 `CORS_ORIGINS` 时才回显该 Origin，并加 `vary: origin`
- `off`：不加任何 CORS 头

预检请求（`OPTIONS`）返回 `204`。
