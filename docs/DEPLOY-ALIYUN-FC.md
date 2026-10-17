# 部署到阿里云函数计算 FC 3.0

阿里云没有 Cloudflare KV 那样的绑定，所以本项目为 FC 提供了两条运行形态与一套**原生 OSS 存储**：

| 形态 | 入口 | handler / 启动命令 | 适用 |
| --- | --- | --- | --- |
| **A. 内置运行时 + HTTP 触发器**（推荐） | `fc/index.js` | `fc/index.handler` | 最省事，事件为 FC 的 `v1` HTTP 结构 |
| **B. Web 函数** | `fc/server.mjs` | `node fc/server.mjs`，端口 `9000` | 想按传统 HTTP 服务方式运行 |
| C. Serverless Devs | `s.yaml` | — | 命令行一键部署/更新 |

两者共用同一份核心代码与同一套环境变量，行为与 Cloudflare Pages 部署完全一致。

## 0. 准备存储：OSS

1. **创建 Bucket**：与函数**同地域**（降低延迟），读写权限设为**私有**。
2. **创建 RAM 用户**并授予最小权限（把 `your-bucket` 换成你的 Bucket 名）：

   ```json
   {
     "Version": "1",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["oss:GetObject", "oss:PutObject", "oss:DeleteObject"],
         "Resource": ["acs:oss:*:*:your-bucket/shortlink/*"]
       }
     ]
   }
   ```

3. 记下该 RAM 用户的 **AccessKeyId / AccessKeySecret**。
4. **建议配置生命周期规则**：前缀 `shortlink/r/`，过期 1 天后删除对象。
   这一前缀下是限流计数（OSS 无原子计数，过期时间写在值里，但对象本身需要生命周期来清理）。

## 1A. 内置运行时 + HTTP 触发器（推荐）

### 上传代码

在仓库根目录打包，`git archive` 只包含被 git 跟踪的文件，天然排除 `.git` 等无关内容：

```bash
git archive --format=zip -o shortlink.zip HEAD
```

### 控制台配置

1. 函数计算 → **函数** → **创建函数** → 选择 **内置运行时** → 运行环境 **Node.js 20**（或 18）。
2. **函数入口（Handler）** 填：

   ```
   fc/index.handler
   ```

3. **代码**：上传上一步的 `shortlink.zip`。
4. **触发器**：创建 **HTTP 触发器**，认证方式选 **无需认证**，方法勾选
   `GET`、`POST`、`HEAD`、`OPTIONS`。
5. **环境变量**：

   | 变量 | 值 |
   | --- | --- |
   | `STORAGE` | `oss` |
   | `BASE_URL` | `https://s.example.com`（你的域名或函数 URL） |
   | `OSS_BUCKET` | `your-bucket` |
   | `OSS_ENDPOINT` | `oss-cn-hangzhou.aliyuncs.com`（与 Bucket 地域一致） |
   | `OSS_PREFIX` | `shortlink/` |
   | `OSS_ACCESS_KEY_ID` | 第 0 步的 AccessKeyId |
   | `OSS_ACCESS_KEY_SECRET` | 第 0 步的 AccessKeySecret |
   | `RL_MAX_REQ` / `RL_WINDOW_SEC` | `10` / `60`（可选） |
   | `CREATE_TOKEN` | 需要私有时设置（可选） |

6. 规格：内存 `128 MB`、超时 `60 s` 即可。

> 为什么 handler 是 `fc/index.handler`：FC 用 CommonJS 语义加载 `fc/index.js`，
> 该文件再动态 `import()` ESM 核心；`fc/package.json` 里声明了 `"type": "commonjs"`，
> 所以仓库根目录的 `"type": "module"` 不会影响它。

## 1B. Web 函数

1. 函数计算 → 创建函数 → **Web 函数** → 运行环境 **Node.js 20**。
2. **启动命令**：`node fc/server.mjs`
3. **监听端口**：`9000`（也可用环境变量 `PORT` 覆盖）
4. 代码上传与环境变量同 1A。

> 使用 Web 函数时无需关心 HTTP 触发器的方法白名单，所有请求都会进你的 HTTP 服务。

## 1C. Serverless Devs（命令行）

```bash
npm i -g @serverless-devs/s
s config add           # 录入 AccessKey，命名建议 default
s deploy               # 读取 s.yaml，按 .fcignore 打包并创建/更新
```

`s.yaml` 已经写好 `handler: fc/index.handler`、`runtime: nodejs20`、HTTP 触发器与占位环境变量，
把其中注释掉的 `OSS_*`、`BASE_URL` 填好再 `s deploy`。

> 请不要把 AccessKey 提交进 `s.yaml`（仓库里默认注释掉了 OSS 凭据）。
> 更稳妥的做法是 `s.yaml` 里不写密钥，改为在 FC 控制台配置环境变量。

## 验证

```bash
# 把 FC_URL 换成你的函数 URL 或自定义域名
curl -s $FC_URL/healthz                                  # ok
curl -s -X POST $FC_URL/api/shorten \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
curl -sI $FC_URL/<上一步返回的 code>                      # 302 + location
```

## 排错

| 现象 | 原因与处理 |
| --- | --- |
| `Cannot find module '/code/fc/index.js'` | Handler 写成了 `index.handler`，应为 `fc/index.handler` |
| `Cannot find module './event.mjs'` / `../src/...` | zip 里缺少 `src/` 或 `fc/` 目录；用 `git archive` 重新打包 |
| 日志出现 `[shortlink] using the in-memory store` | 存储没生效：`STORAGE=oss` 或 `OSS_*` 变量缺失/拼错。**数据会随实例重启丢失** |
| `OSS GET shortlink/k/... failed with 403` | RAM 权限不足，或 Bucket 与 `OSS_ENDPOINT` 地域不匹配 |
| `SignatureDoesNotMatch` | AccessKey 与 Bucket 不属于同一账号，或机器时间偏差过大 |
| `OSS 404` | 正常未命中；若刚创建就 404，检查 `OSS_PREFIX` 是否与写入时一致 |
| 跳转域名不对 | 没设置 `BASE_URL`，回退成了请求域名（函数 URL） |
| 创建返回 `429` | 触发限流，调 `RL_MAX_REQ`/`RL_WINDOW_SEC` 或设 `RL_MAX_REQ=0` |
| 冷启动偏慢 | 首次调用要加载核心模块；实例复用后恢复正常。可配置预留实例缓解 |

## 关于凭据

- 当前支持在环境变量里传**长期 AccessKey**，或用 `OSS_SECURITY_TOKEN` 传入 STS 临时令牌。
- **通过 FC 函数角色自动获取临时 AK 的能力尚未接线**（需要从 `context.credentials` 注入，
  属于后续工作）；现阶段请使用 RAM 用户 AccessKey，并严格限制到单个 Bucket 前缀。
