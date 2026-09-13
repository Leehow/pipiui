# @pipiui/flapcode-extension

Flapcode（Codex 中转，Responses wire API）provider 插件。

## 凭证存放

API Key 是 `format: secret` 的扩展设置 `ext.flapcode.apiKey`：

1. 设置页 Flapcode 区块输入 key（密码框）；
2. host 校验后写入**扩展 secret vault**——不落 settings JSON、不落 `models.json`、不落 `auth.json`，IPC/快照只见 `true`（存在性标记）；
3. 会话 spawn 时 host 从 vault 读出，以环境变量 `EXT_FLAPCODE_APIKEY` 注入本扩展的 agent 进程；
4. `agent/provider.ts` 从该环境变量取 key，`authHeader: true` 以 `Authorization: Bearer` 发给中转站。

传输协议是标准 `openai-responses`（`POST {baseUrl}/responses`），不是 ChatGPT 后端的 `openai-codex-responses`。

## 实测结论（2026-09，真实 key 探测）

- **网关地址按账号下发**：文档写的 `codex.flapcode.com` 当前 TLS 握手即被拒（`unrecognized_name`）。每个账号的真实网关由 `https://flapcode.com/api/cli/config?provider=codex`（同一个 key 做 Bearer 认证，与官方 CLI 同一端点）返回，实测账号为 `https://codex.takemoon.com/v1`。插件默认该地址，并在启动时用 key 自动发现、不一致则以发现值重注册；`ext.flapcode.baseUrl` 用户设置永远优先。
- **`session-id` 请求头必需**：缺失时 400 `Missing or invalid session-id header`；pi 自带的 `session_id` / `x-session-id` affinity 头不被接受，所以插件固定注入一个每实例随机 UUID 的 `session-id` 头。
- **payload 要求**：`store:false`、`stream:true`、结构化 list `input` 缺一不可（分别 400）——pi 的 openai-responses streamer 原生全部满足。但中转站**拒绝未知参数**：pi 总会发送的 `max_output_tokens`（无 compat 开关）和 `prompt_cache_retention`（retention=long 时）都会 400 `Unsupported parameter`，插件用 `before_provider_request` 钩子剥离这两个（及防御性的 `prompt_cache_options`），并在模型 compat 里关掉 `supportsLongCacheRetention`。其余字段（`instructions`、`reasoning{effort,summary}`、`include[reasoning.encrypted_content]`、`prompt_cache_key`）均实测接受。
- **`GET /v1/models` 不存在（404）**：模型无法枚举；目录里五个模型（`gpt-5.6-sol` / `gpt-5.6-luna` / `gpt-5.6-terra` / `gpt-6-astra` / `gpt-5.5`）已逐个实测 `response.completed`。

## E2E 复测

```bash
FLAPCODE_KEY=sk-flapcode-… node e2e-flapcode.mjs
```

用 pi-ai 真实 streamer + 插件注册载荷 + 清洗器打一次活的中继请求，期望输出 `DONE stopReason=stop` 与 usage。

## 设置项

| key | 类型 | 说明 |
| --- | --- | --- |
| `ext.flapcode.apiKey` | secret | Flapcode API Key（`sk-flapcode-…`），存扩展 vault |
| `ext.flapcode.baseUrl` | string | 默认 `https://codex.takemoon.com/v1`，仅允许 HTTPS；设置后跳过自动发现 |

## 模型目录

默认 `gpt-5.6-sol`，另收录 `gpt-5.6-luna` / `gpt-5.6-terra` / `gpt-6-astra` / `gpt-5.5`，参数对齐 pi 内置 `openai-codex` 目录（272K 上下文、thinking 档位映射），全部经真实 key 逐个验证。

## 构建

```bash
npm run build -w @pipiui/flapcode-extension --maxsockets 3
```

postbuild 会把 manifest + 编译产物同步到 `Electron/resources/runtime/extensions/flapcode`，host 按目录扫描发现，无需注册表。
