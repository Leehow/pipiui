# 外部 CLI 作为 PipiUI 子进程 / 子代理：Codex / Claude Code / Cursor

日期：2026-08-26
范围：只评估主机（PipiUI Electron）能否 **spawn → 流式读事件 → 等最终结果**。不实现、不发包、不测真实付费调用。
方法：只跟官方文档、官方 GitHub、本机官方 CLI `--help`。第三方博客 / 论坛不作为事实依据（仅在「未知」里说明试过什么）。

本机探测版本（2026-08-26，`which` + `--version`）：

| 命令 | 路径 | 版本 |
|---|---|---|
| `codex` | `/Users/haoli/.npm-global/bin/codex` | `codex-cli 0.145.0` |
| `claude` | `/Users/haoli/.local/bin/claude` | `2.1.179 (Claude Code)` |
| `cursor` | `/Users/haoli/.local/bin/cursor` | `3.17.19`（IDE 启动器，不是 Agent CLI） |
| `cursor-agent` / `agent` | 同指向 `~/.local/share/cursor-agent/versions/2026.08.11-e8db854/cursor-agent` | `2026.08.11-e8db854` |

本机无 `man` 页：`man -w codex claude cursor-agent agent` 全部 “No manual entry”。

## 结论先行

三条 CLI **都有官方无头模式**，都可以被主机 spawn、读 stdout、等退出码。没有一条是「只能 TUI、没有 JSON」。

| CLI | 无头就绪 | 最大阻塞（1–2 条） |
|---|---|---|
| Codex (`codex exec`) | **ready** | 1）`codex exec` 默认只读沙箱，且默认要求 Git 仓库，未设 `--sandbox` / `--skip-git-repo-check` 会直接失败。2）官方没有「需要用户批准 vs 崩溃」的退出码表；本机 0.145.0 的 `exec` **不接受** `--ask-for-approval`。 |
| Claude Code (`claude -p`) | **ready** | 1）`-p` 的内置起始权限是 Manual：不配 `--allowedTools` / `--permission-mode` / `--dangerously-skip-permissions` 时，工具不会自动跑。2）若把未改过的 `claude` 预装进自家产品，官方要求走 Commercial ToS，且禁止替用户中转 Claude.ai 登录。 |
| Cursor Agent (`agent` / `cursor-agent`) | **partial** | 1）print 模式 **压制 thinking 事件**，主机看不到推理流。2）官方 ToS/AUP 一边写「禁止用 bot/script 自动访问」，一边官方文档又教 headless / CI；把 CLI 嵌进另一款产品再分发，没有像 Anthropic 那样的明确许可条款。 |

对 PipiUI 这种「用户本机已登录、主机只 spawn 用户自己的 CLI」的场景：三条在技术上都可行。若要 **随 App 分发 / 代用户登录 / 当自己的 agent 卖**，Claude 有明确产品嵌入条款；Codex 源码 Apache-2.0 且官方 SDK 点名 Electron；Cursor 最含糊，也最容易踩 ToS。

---

## 对照矩阵

| 问题 | Codex CLI | Claude Code CLI | Cursor Agent CLI |
|---|---|---|---|
| 产品名 / 主二进制 | Codex CLI / `codex` | Claude Code / `claude` | Cursor CLI / Cursor Agent；官方装的是 `agent` |
| 无头入口 | `codex exec`（别名 `codex e`） | `claude -p` / `--print` | `agent -p` / `--print` |
| 机器可读流 | `--json` → JSONL | `--output-format stream-json` | `--output-format stream-json` |
| 最终结果 | stdout 最后一条助手消息，或 `-o/--output-last-message`；JSON 里 `turn.completed` / `item` `agent_message` | `--output-format json` 的 `result`；stream 最后一行 `type=result` | `--output-format json` 的 `result`；stream 最后一条 `type=result` |
| 续聊 | `codex exec resume [SESSION_ID\|--last]` | `-c/--continue`，`-r/--resume` | `--resume [chatId]`，`--continue`，`agent resume` |
| 钉工作区 | `-C/--cd`，`--add-dir`，`--sandbox` | 进程 cwd；`--add-dir`；`--worktree`；无顶层 `--cwd` | `--workspace`；`--add-dir`；`--worktree` |
| 跳过批准 | `--dangerously-bypass-approvals-and-sandbox`（`exec`）；`--sandbox danger-full-access` | `--dangerously-skip-permissions`；`--permission-mode bypassPermissions` / `dontAsk` / `auto` | `-f/--force` / `--yolo`；`--trust` |
| 已登录本机能否直接 spawn | 能。`exec` 默认复用已存凭证 | 能（非 `--bare`）。`--bare` 不读 OAuth/钥匙串 | 能。也可用 `CURSOR_API_KEY` |
| 官方退出码 | 无完整表。`login status` 有凭证时 0；不在 Git 库且未 skip 时 `exec` 退出 1 | 成功 0，失败非 0；SIGTERM=143；`auth status` 已登录 0 / 未登录 1 | 成功 0，失败非 0；失败时 `json` 不吐对象 |
| 源码许可 | 仓库 Apache-2.0 | 闭源 CLI；使用受 Anthropic ToS 约束 | 闭源；Anysphere ToS + AUP |

---

## 1. Codex CLI（`codex`）

### 1.1 官方名、安装、二进制

- 官方产品名：**Codex CLI**。仓库 README：「Codex CLI is a coding agent from OpenAI that runs locally on your computer。」（[github.com/openai/codex README](https://github.com/openai/codex/blob/main/README.md)）
- 官方文档入口：[developers.openai.com/codex/cli](https://developers.openai.com/codex/cli)
- 安装（同一 README）：
  - `curl -fsSL https://chatgpt.com/codex/install.sh | sh`
  - `npm install -g @openai/codex`
  - `brew install --cask codex`
  - GitHub Release 平台包，解压后改名为 `codex`
- 二进制名：本机与官方文档均为 **`codex`**。无头子命令是 **`codex exec`**，短名 **`codex e`**（本机 `codex --help`；[Non-interactive mode](https://developers.openai.com/codex/noninteractive)）。
- 另有 **`codex mcp-server`**（stdio MCP）、**`codex app-server`**（实验性 JSON-RPC / stdio / ws / unix）。官方 SDK 文档把「把 Codex 当编排里的一个专家」指向 MCP，把「在应用里控制 thread」指向 SDK（[SDK](https://developers.openai.com/codex/sdk)）。

### 1.2 无头 / 可编程调用：确切 flag

官方无头入口是 **`codex exec [OPTIONS] [PROMPT]`**，不是交互 TUI 的 `codex "..."`（[Non-interactive mode](https://developers.openai.com/codex/noninteractive)；本机 `codex exec --help`）。

本机 `codex exec --help`（0.145.0）列出的关键 flag（原文）：

| Flag | 官方/本机说明 |
|---|---|
| `[PROMPT]` 或 `-` / stdin | 无参数或 `-` 时从 stdin 读指令；若同时有 prompt 和管道，stdin 作为 `<stdin>` 块追加 |
| `--json` | 「Print events to stdout as JSONL」。别名 `--experimental-json` 出现在上游 `cli.rs`，本机 `--help` 只印 `--json` |
| `-o, --output-last-message <FILE>` | 把最后一条助手消息写入文件 |
| `--output-schema <FILE>` | 最终回答的 JSON Schema |
| `-C, --cd <DIR>` | 「Tell the agent to use the specified directory as its working root」 |
| `--add-dir <DIR>` | 额外可写目录 |
| `-s, --sandbox <MODE>` | `read-only` / `workspace-write` / `danger-full-access` |
| `--dangerously-bypass-approvals-and-sandbox` | 跳过确认且不沙箱。「EXTREMELY DANGEROUS」 |
| `--skip-git-repo-check` | 允许不在 Git 仓库里跑 |
| `--ephemeral` | 不把 session 写盘 |
| `--ignore-user-config` | 不读 `$CODEX_HOME/config.toml`；认证仍用 `CODEX_HOME` |
| `--ignore-rules` | 不加载 execpolicy `.rules` |
| `-m, --model`，`-p, --profile`，`-c, --config`，`--enable` / `--disable` | 模型 / profile / TOML 覆盖 / feature |

官方补充（[Non-interactive mode](https://developers.openai.com/codex/noninteractive)）：

- 默认 **`codex exec` 跑在 read-only sandbox**。
- 要改文件：`codex exec --sandbox workspace-write "..."`。
- `--full-auto` 已弃用，仅兼容并打印 warning；新脚本用 `--sandbox workspace-write`。
- 默认只把最终消息打到 stdout，进度打 stderr；`--json` 时 stdout 全部变成 JSONL。

**本机与文档不一致（已实测）：**

- 官方沙箱页写过非交互示例 `--sandbox read-only --ask-for-approval never`（[Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)）。
- 顶层 `codex --help` 有 `-a, --ask-for-approval`（`untrusted` / `on-request` / `never`）。
- **`codex exec --ask-for-approval never --help` 在 0.145.0 报错：`unexpected argument '--ask-for-approval'`。**
  无头路径要用 `--sandbox` 和/或 `--dangerously-bypass-approvals-and-sandbox`，不要假设 `exec` 继承了交互式的 `-a`。

没有 `--print` / `-p`（`-p` 在 Codex 里是 `--profile`）。

### 1.3 流式 / JSON 事件协议

有官方机器可读流。

- 文档：[Non-interactive mode — Make output machine-readable](https://developers.openai.com/codex/noninteractive)：`--json` 时 stdout 是 JSONL，事件类型包括 `thread.started`、`turn.started`、`turn.completed`、`turn.failed`、`item.*`、`error`。item 包括 agent messages、reasoning、command executions、file changes、MCP tool calls、web searches、plan updates。
- 规范源码（官方仓库，带 serde tag）：[`codex-rs/exec/src/exec_events.rs`](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs)

`ThreadEvent`（`#[serde(tag = "type")]`）：

| `type` | 含义（源码注释） |
|---|---|
| `thread.started` | 新 thread；带 `thread_id`，可 resume |
| `turn.started` | 一次 prompt 处理开始 |
| `turn.completed` | 回合完成；带 `usage` |
| `turn.failed` | 回合失败；带 `error` |
| `item.started` | 新 item，通常 in progress |
| `item.updated` | item 更新 |
| `item.completed` | item 终态（成功或失败） |
| `error` | 流上的不可恢复错误 |

`ThreadItemDetails`（`#[serde(tag = "type", rename_all = "snake_case")]`）：

| item `type` | 含义 |
|---|---|
| `agent_message` | 助手自然语言或 structured JSON 字符串 |
| `reasoning` | 推理摘要 |
| `command_execution` | 命令；完成时带 `exit_code`、`status`（`in_progress` / `completed` / `failed` / `declined`） |
| `file_change` | 补丁结果 |
| `mcp_tool_call` | MCP 工具 |
| `collab_tool_call` | 协作/子代理类工具 |
| `web_search` | 网页搜索 |
| `todo_list` | 计划清单 |
| `error` | 非致命错误 item |

官方 TypeScript SDK README：SDK「spawns the CLI and exchanges JSONL events over stdin/stdout」；`run()` 缓冲到回合结束，`runStreamed()` 给出中间进度（[sdk/typescript/README.md](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)）。
官方非交互文档的 sample 是 **整条 item**，不是 token delta。早期 PR #1603 也写过 `--json` 不打印单个 token。主机若要做「打字机」，应走 SDK `runStreamed()` 或自己解析 `item.updated`（若该版本会发），不要假设有 Claude 那种 `text_delta`。

### 1.4 Session resume

能。后一个进程可以接同一会话。

- `codex exec resume [SESSION_ID] [PROMPT]`；`--last` 取最近一条；`--all` 取消按 cwd 过滤（本机 `codex exec resume --help`）。
- 官方示例（[Non-interactive mode](https://developers.openai.com/codex/noninteractive)）：

```bash
codex exec "review the change for race conditions"
codex exec resume --last "fix the race conditions you found"
```

- `thread.started.thread_id`「Can be used to resume the thread later」（`exec_events.rs`）。
- SDK：`codex.resumeThread(threadId)`；thread 存在 `~/.codex/sessions`（[SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)）。
- `--ephemeral` 则不落盘，后续无法 resume。

### 1.5 工作目录 / 沙箱 / 权限

| 能力 | 依据 |
|---|---|
| 钉 cwd | `-C, --cd <DIR>`（本机 help；SDK `workingDirectory`） |
| 额外可写根 | `--add-dir` |
| 沙箱 | `--sandbox read-only \| workspace-write \| danger-full-access` |
| 全开 | `--dangerously-bypass-approvals-and-sandbox` |
| Git 保险 | 默认必须在 Git 仓库；否则「Not inside a trusted directory…」并退出。`--skip-git-repo-check` 可关（[Non-interactive mode](https://developers.openai.com/codex/noninteractive)；本机 help） |
| 隔离用户配置 | `--ignore-user-config`，`--ignore-rules`，`--ephemeral` |

默认：`exec` = read-only sandbox。官方低摩擦本地预设是 `--sandbox workspace-write --ask-for-approval on-request`，但这是交互/全局文档；本机 `exec` 不收 `--ask-for-approval`。

### 1.6 认证

- 本地登录：`codex login` 无 flag 时开浏览器做 ChatGPT OAuth；`--with-api-key` / `--with-access-token` 从 stdin 读（本机 `codex login --help`）。
- 缓存：`~/.codex/auth.json` 或 OS keyring；CLI 与 IDE 扩展共用；登出一边两边都要重登（[Authentication](https://developers.openai.com/codex/auth)）。
- **`codex exec` 默认复用已保存的 CLI 认证**（[Non-interactive mode](https://developers.openai.com/codex/noninteractive)）。用户本机已登录时，主机可以直接 spawn，不必再弹登录。
- 自动化：`CODEX_API_KEY` **只在 `codex exec` 生效**；官方要求只给这一条命令、不要当 job 级环境变量（同上）。
- ChatGPT 账号进 CI：种子 `auth.json` 并在跑完后写回刷新后的文件（[CI/CD auth](https://developers.openai.com/codex/auth/ci-cd-auth)）。

### 1.7 退出码

官方 **没有** `exec` 的「0=成功 / N=要批准 / M=崩溃」表。已证实：

| 情况 | 行为 | 来源 |
|---|---|---|
| `codex login status` 有凭证 | 退出 0 | [CLI reference](https://developers.openai.com/codex/cli/reference)（句子被截到 “exits with `0` when credentials are present”） |
| 不在 Git 仓库且未 skip、也未 yolo | 打 stderr 后 `exit(1)` | 官方「Git repository required」+ 上游 `lib.rs` 片段 |
| 配置 / `-c` 解析失败 | `exit(1)` | 上游 `lib.rs` 片段 |
| 必填 MCP 起不来 | 「exits with an error」 | [Non-interactive mode](https://developers.openai.com/codex/noninteractive) |
| `turn.failed` / `error` JSON 事件 | 流里有失败，**进程退出码未在文档写死** | 事件 schema |
| 命令被拒 | item `command_execution.status = declined` | `exec_events.rs`；**不是**独立进程退出码 |

**未知：** 无头遇到「需要人点批准」时，是卡住等 stdin、以非 0 退出，还是发 `declined`/`turn.failed` 后 0 退出。已试：官方 noninteractive / CLI reference / 本机 `exec --help`，都没有这张表。稳妥做法：无头一律 `--sandbox workspace-write`（或 yolo），并解析 `turn.failed` / `error`，不要只信退出码。

### 1.8 当 subagent 的限制

- 交互 `codex` 是 TUI；无头必须 `codex exec`。
- 默认只读 + Git 检查，不适合「随便开个目录就干活」。
- `--json` 是 item 级，不是 token 级。
- 本机 `exec` 没有 `--ask-for-approval`，不能在无头里精细设「never ask」。
- 官方更推荐的嵌入面是 **TypeScript SDK**（spawn CLI + JSONL）或 **MCP server**，不是自己解析 TUI（[SDK](https://developers.openai.com/codex/sdk)；[SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)）。SDK 原文：「useful for sandboxed hosts like Electron apps」。

### 1.9 许可 / ToS（包一层当嵌入 agent）

- 仓库：**Apache-2.0**（[LICENSE](https://github.com/openai/codex/blob/main/LICENSE)；README「This repository is licensed under the Apache-2.0 License」）。
- 官方 SDK 明确支持「Build Codex into your own internal tools」「Integrate Codex within your own application」，并点名 Electron 环境（[SDK](https://developers.openai.com/codex/sdk)；[SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)）。
- 后端仍受 OpenAI 服务条款约束。官方 [Service terms](https://openai.com/policies/service-terms/) 有 “Codex and Code Generation” 节（第三方开源许可可能覆盖生成代码），**没有**找到「禁止把 CLI 当子进程」的句子。
- **未知：** 用「Sign in with ChatGPT」订阅、再由第三方桌面 App spawn `codex exec` 卖给最终用户，是否一律允许。官方工程师在 GitHub Discussion 里说过许可偏宽松，但那不是条款正文。PipiUI 若只 spawn **用户自己已登录的本机 `codex`**，更接近官方「复用已存认证」的自动化路径。

---

## 2. Claude Code CLI（`claude`）

### 2.1 官方名、安装、二进制

- 官方产品名：**Claude Code**。无头页把 `claude -p` 称为 Agent SDK 的 CLI 用法（[Run Claude Code programmatically](https://code.claude.com/docs/en/headless)）。
- 二进制：**`claude`**（[Setup](https://code.claude.com/docs/en/setup)；本机 `--version`）。
- 安装（[Setup](https://code.claude.com/docs/en/setup)）：
  - macOS/Linux/WSL：`curl -fsSL https://claude.ai/install.sh | bash`
  - `brew install --cask claude-code`
  - Windows：`irm https://claude.ai/install.ps1 | iex` 或 `winget install Anthropic.ClaudeCode`
- 校验：`claude --version`，例 `2.1.211 (Claude Code)`。本机为 `2.1.179`。
- 可编程替代：`@anthropic-ai/claude-agent-sdk` / `claude-agent-sdk`。官方写：其他语言应 **「run the CLI as a subprocess」**，用 `-p` 和 `--output-format json`（[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)）。

### 2.2 无头 / 可编程调用：确切 flag

无头开关：**`-p` / `--print`**。「Print response and exit」。非交互（`-p` 或 stdout 非 TTY）会跳过 workspace trust 对话框（本机 `claude --help`；[headless](https://code.claude.com/docs/en/headless)）。

官方说 **不是所有 flag 都能和 `-p` 组合**：拒绝 `--bg`；带任务描述的 `--cloud` 也拒绝；`--cloud` + session ID + `-p` 只是往云会话塞一条消息然后退出（[headless](https://code.claude.com/docs/en/headless)）。

本机 `claude --help`（2.1.179）与官方 [CLI reference](https://code.claude.com/docs/en/cli-reference) 里，和无头最相关的 flag：

| Flag | 作用 |
|---|---|
| `-p, --print` | 非交互，打完退出 |
| `--output-format text\|json\|stream-json` | 仅 `--print`。默认 `text` |
| `--input-format text\|stream-json` | 仅 `--print`。stdin 实时输入 |
| `--include-partial-messages` | stream-json 下吐部分 chunk |
| `--include-hook-events` | stream-json 下吐 hook 生命周期 |
| `--verbose` | 覆盖配置里的 verbose（stream-json 文档要求带上） |
| `--json-schema <schema>` | 结构化输出 |
| `-c, --continue` | 继续当前目录最近一次对话 |
| `-r, --resume [value]` | 按 session ID/名字续 |
| `--fork-session` | 续的时候换新 session ID |
| `--session-id <uuid>` | 指定 UUID |
| `--no-session-persistence` | 仅 `--print`：不落盘、不能 resume |
| `--allowedTools` / `--disallowedTools` | 允许/拒绝工具（可带 `Bash(git *)` 这种模式） |
| `--permission-mode` | `acceptEdits` / `auto` / `bypassPermissions` / `default` / `dontAsk` / `plan` |
| `--dangerously-skip-permissions` | 绕过全部权限检查 |
| `--allow-dangerously-skip-permissions` | 把 bypass 放进模式循环，但不默认开 |
| `--add-dir` | 额外可读可写目录 |
| `-w, --worktree [name]` | 新 git worktree |
| `--bare` | 最小模式：跳过 hooks/skills/MCP/CLAUDE.md/钥匙串；Anthropic 认证只认 `ANTHROPIC_API_KEY` 或 `--settings` 里的 `apiKeyHelper` |
| `--max-budget-usd` | 仅 `--print` |
| `--replay-user-messages` | 双向 stream-json 时回显 user 消息 |

官方 CLI 表有、**本机 `--help` 没有**的（官方写明「`claude --help` does not list every flag」）：

- **`--permission-prompt-tool`**：非交互里用 MCP 工具回答权限提示。Claude 会等该 MCP 连上，默认最多 30s（`MCP_TIMEOUT`）（[CLI reference](https://code.claude.com/docs/en/cli-reference)）。
- **`--forward-subagent-text`**：stream-json 里转发子代理文本/thinking（需 v2.1.211+）。

没有 Codex 那种单独的 `exec` 子命令。`-p` 就是无头。

### 2.3 流式 / JSON 事件协议

有官方 NDJSON 流。

`--output-format`（[headless](https://code.claude.com/docs/en/headless)）：

- `text`：纯文本
- `json`：单个 JSON，含 `result`、session ID、metadata；可有 `total_cost_usd`、`structured_output`
- `stream-json`：每行一个 JSON 事件；**最后一行是 `result`**

官方推荐的实时 token 命令：

```bash
claude -p "Explain recursion" --output-format stream-json --verbose --include-partial-messages
```

文档用 jq 滤的形状：`.type == "stream_event"` 且 `.event.delta.type == "text_delta"`（[headless](https://code.claude.com/docs/en/headless)）。

官方在 CLI 页 **没有**完整「所有顶层 type」表（GitHub issue #24596 也在抱怨这件事）。完整事件参考在 Agent SDK：

[Stream responses in real-time](https://code.claude.com/docs/en/agent-sdk/streaming-output)

| 层 | 类型 | 含义 |
|---|---|---|
| SDK / CLI 顶层 | `stream_event` | 包一层 Claude API 原始流事件 |
| | `assistant` / `user` | 完整消息；子代理带 `parent_tool_use_id` |
| | `result` | 最终结果、费用、session |
| | `system` + `subtype=init` | 会话元数据（模型、工具、MCP…） |
| | `system` + `subtype=api_retry` | 可重试 API 错误（字段表在 headless） |
| | `system` + `subtype=compact_boundary` | 压缩边界（SDK） |
| | `prompt_suggestion` | `--prompt-suggestions` |
| | hook 事件 | `--include-hook-events` |
| `stream_event.event.type` | `message_start` / `content_block_start` / `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop` | Claude API 流 |
| delta | `text_delta` / `input_json_delta` | 文本 / 工具参数 |

开启 `--include-partial-messages` 时的顺序（SDK 文档）：`message_start` → 文本块 delta → 工具块 delta → `AssistantMessage` → 工具执行 → … → `ResultMessage`。

**未知（官方未给 CLI 专用 JSON Schema 文件）：** 每个顶层对象的必填字段全集。已试：headless、cli-reference、streaming-output。主机应按 SDK 文档解析，并忽略未知字段。

### 2.4 Session resume

能。后一个进程可以按 ID 续。

- `-c` / `--continue`：当前目录最近一次。`claude -p --continue` **会包含** `-p`/SDK/`/loop` 会话；交互 `--continue` 会跳过这些（[sessions](https://code.claude.com/docs/en/sessions)；[CLI reference](https://code.claude.com/docs/en/cli-reference)）。
- `-r` / `--resume <id>`：按 ID。官方（v2.1.223+）会跨项目找；之前只在当前项目/worktree（[headless — Continue conversations](https://code.claude.com/docs/en/headless)）：

```bash
session_id=$(claude -p "Start a review" --output-format json | jq -r '.session_id')
claude -p "Continue that review" --resume "$session_id"
```

- `--fork-session`：续的时候换新 ID。
- `--no-session-persistence`：不写盘，不能 resume。
- 续跑时 `--mcp-config`、`--settings`、`--plugin-dir`、`--add-dir` **不会从旧会话自动恢复**，要再传一遍（[sessions](https://code.claude.com/docs/en/sessions)）。
- SIGTERM 打断后 resume 会继续没做完的那一轮（[headless](https://code.claude.com/docs/en/headless)）。
- 双向多轮：`--input-format stream-json` + `--output-format stream-json`（flag 有，**stdin 消息 schema 官方 CLI 页几乎没写**；SDK 有 streaming input 文档）。

### 2.5 工作目录 / 沙箱 / 权限

| 能力 | 依据 |
|---|---|
| 主工作区 | **进程 cwd**。顶层 `claude` 的 `--help` / CLI 总表 **没有 `--cwd`**。`claude agents --cwd` 只过滤 agent view |
| 额外目录 | `--add-dir`：给文件权限，**不**自动发现那边的 `.claude/` 配置 |
| worktree | `-w, --worktree [name]` |
| 权限模式 | `--permission-mode`；`-p` 的内建起始模式是 **Manual（`default`），所有套餐如此**（[headless](https://code.claude.com/docs/en/headless) 权限节；[permission-modes](https://code.claude.com/docs/en/permission-modes)） |
| CI 白名单 | `--permission-mode dontAsk --allowedTools "..."` |
| 容器全开 | `--dangerously-skip-permissions`（官方要求外层容器/VM/sandbox runtime） |
| 脚本最小环境 | `--bare` |

`-p` **不弹** workspace trust，也 **不弹** 每个 MCP 的批准。没有 `--bare` 时，仍会跑项目 `.claude/settings.json` 的 hooks、连 `.mcp.json`（[headless](https://code.claude.com/docs/en/headless)）。

没有 OS 级 `--sandbox enabled` 这种 Cursor 式开关；沙箱是另一套 Bash sandbox / isolation 文档。

### 2.6 认证

- 首次交互：`claude` 开浏览器；`claude auth login` / `logout` / `status`（[authentication](https://code.claude.com/docs/en/authentication)；[CLI reference](https://code.claude.com/docs/en/cli-reference)）。
- 凭证：macOS Keychain；Linux `~/.claude/.credentials.json` mode 0600（[authentication](https://code.claude.com/docs/en/authentication)）。
- **非 `--bare` 的 `-p`：用本机已有登录。** 用户已登录时，主机可以直接 spawn。
- `--bare`：**不读 OAuth / 钥匙串**。Anthropic API 必须 `ANTHROPIC_API_KEY` 或 `--settings` 的 `apiKeyHelper`（[headless](https://code.claude.com/docs/en/headless)）。
- CI 长寿 token：`claude setup-token`（订阅；打印、不保存）（[CLI reference](https://code.claude.com/docs/en/cli-reference)）。
- `claude auth status`：默认 JSON；已登录 0，未登录 1（[CLI reference](https://code.claude.com/docs/en/cli-reference)）。

### 2.7 退出码

比另外两条写得清楚，但仍 **没有**「要批准 = 某个数字」：

| 情况 | 码 / 行为 | 来源 |
|---|---|---|
| 成功 | 0 | [headless](https://code.claude.com/docs/en/headless) |
| 失败（含缺认证） | 非 0；运行中失败会把失败写进 stdout 的 result | 同上 |
| 非法 flag | stderr 报错，开跑前退出 | 同上 |
| stdin > 10MB | 明确错误 + 非 0 | 同上 |
| 非法 `--json-schema` | 打 `Error: --json-schema is not a valid JSON Schema` 后退出 | 同上 |
| SIGTERM | **143**；当轮不记 result | 同上 |
| SIGINT / SDK `interrupt()` | 正常结束当轮 | 同上 |
| `claude auth status` | 已登录 0，未登录 1 | [CLI reference](https://code.claude.com/docs/en/cli-reference) |
| `claude ultrareview` | 成功 0，失败 1 | 同上 |
| `-p` 且没有 `--permission-prompt-tool` 时需要批准 | **没有提示可回退，该动作不跑，整次 run 继续** | [errors](https://code.claude.com/docs/en/errors) |

主机应：看退出码 **和** 最后一条 `result`（`is_error` / `subtype`）。不要把「工具被静默跳过」当成成功完成任务。

### 2.8 当 subagent 的限制

- `-p` 默认 Manual：不配允许列表或提权，编辑/Bash 不会自动发生。
- `--bare` 丢掉订阅登录，脚本要 API key。
- 后台 Bash 在最终 result 后约 5 秒被杀；后台子代理默认最多等 10 分钟（[headless](https://code.claude.com/docs/en/headless)）。
- CLI stream-json 的完整 type 表不全，要对齐 SDK 文档。
- `--input-format stream-json` 的 stdin 信封，官方 CLI 页几乎没写。
- `claude --help` 故意不全。
- 本机 2.1.179 低于文档里若干能力的最低版本（`--forward-subagent-text` 要 2.1.211；跨项目 resume 要 2.1.223）。

### 2.9 许可 / ToS

官方写得很硬（[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)）：

要把 Claude Code **预装或跑在自家产品/托管沙箱里**，除非另有书面约定，必须接受 [Commercial Terms](https://www.anthropic.com/legal/commercial-terms)，并且：

1. **不得修改 `claude` 二进制**；不得关掉内建认证方式（含 Claude 账号和用户自己的 API key）。
2. **不得代用户付费、转售、中转用量**。每个最终用户用自己的 API key / 订阅 / 3P 凭证。
3. 可以纯文本说「本产品预装/运行 Claude Code」，不能把 Claude Code/Anthropic 当自己的产品名或暗示官方合伙。

认证限制（同页 + [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)）：

- 第三方开发者 **不得** 在自己的应用里提供 Claude.ai 登录，也不得用 Free/Pro/Max 凭证代用户发请求。
- **不得** 收集、存储、中转 Claude.ai 凭证或 session token。
- 做产品应走 Console API key（或 Bedrock/Vertex/Foundry）。
- **不禁止** 最终用户在 **未修改的** `claude` 上用自己的订阅登录，包括平台按上述条件托管 Claude Code。

Commercial Terms A.1 允许 Customer「power products and services Customer makes available to its own customers」，但是用 **API/Commercial Services**，不是把消费者订阅重新包装（[Commercial Terms](https://www.anthropic.com/legal/commercial-terms)）。

**对 PipiUI：** spawn 用户本机已安装、已登录的 `claude -p`，落在「最终用户用未修改二进制 + 自己的订阅」这一侧。若 **打包进安装器、代登录、或把 Claude 当 PipiUI 自己的套餐卖**，官方要求 Commercial ToS + 上述两条硬限制。

---

## 3. Cursor CLI（`cursor` / `cursor-agent` / `agent`）

### 3.1 官方名、安装、二进制

- 官方产品名：**Cursor CLI** / 文档里的 **Cursor Agent CLI**（[overview](https://cursor.com/docs/cli/overview)；[output-format](https://cursor.com/docs/cli/reference/output-format)）。
- 官方安装后的命令是 **`agent`**，不是 `cursor`（[Installation](https://cursor.com/docs/cli/installation)）：

```bash
curl https://cursor.com/install -fsS | bash
agent --version
agent
```

- 本机：
  - `agent` 与 `cursor-agent` 是同一二进制的两个 symlink。
  - `cursor`（3.17.19）是 **IDE 启动器**（diff/goto/extensions）。子命令 **`cursor agent`** 才进入 Agent CLI，help 与 `cursor-agent --help` 同类。
- 文档里的 Cloud Agents API / `agent worker` 是另一条「云代理连回本机」线，不是「本地 spawn 一次 `-p`」。
- 隐藏命令 **`agent acp`**：按 ACP 在 stdio 上做 JSON-RPC（[using](https://cursor.com/docs/cli/using)；[parameters](https://cursor.com/docs/cli/reference/parameters)）。

**主机应 spawn `agent` 或 `cursor-agent`（或 `cursor agent`），不要 spawn 裸 `cursor`。**

### 3.2 无头 / 可编程调用：确切 flag

官方无头：[Using Headless CLI](https://cursor.com/docs/cli/headless)、[using — Non-interactive mode](https://cursor.com/docs/cli/using)。

本机 `cursor-agent --help` / `cursor agent --help`（2026.08.11-e8db854）与官方 [parameters](https://cursor.com/docs/cli/reference/parameters) 一致：

| Flag | 作用 |
|---|---|
| `-p, --print` | 「for scripts or non-interactive use」。help 写：有全部工具，包括 write 和 shell |
| `--output-format text\|json\|stream-json` | 仅 `--print`。默认 `text`。非 TTY stdout 或管道 stdin 时也可推断 print |
| `--stream-partial-output` | 仅 print + stream-json：字符级 delta |
| `--resume [chatId]` | 续会话 |
| `--continue` | 官方 = `--resume=-1` |
| `-f, --force` / `--yolo` | 「Force allow commands unless explicitly denied」 |
| `--trust` | 不提示，信任 workspace（changelog：无头在未信任目录会失败，除非 `--trust` 或 `--force`） |
| `--sandbox enabled\|disabled` | 覆盖配置 |
| `--workspace <path-or-name>` | 工作区，默认 cwd |
| `--add-dir` | 额外 workspace root |
| `-w, --worktree [name]` | `~/.cursor/worktrees/<reponame>/<name>` |
| `--api-key` / `CURSOR_API_KEY` | 认证 |
| `--approve-mcps` | 自动批准 MCP |
| `--mode plan\|ask`，`--plan` | 只读规划 / 问答 |
| `--model` | 模型 |

`create-chat`：建空会话并打印 ID（本机 help）。

Headless 文档与 using 页有一处 **官方互相打架**：

- [headless](https://cursor.com/docs/cli/headless)：「Without `--force`, changes are only proposed, not applied。」
- [using](https://cursor.com/docs/cli/using)：「Cursor has full write access in non-interactive mode。」

主机不要假设 `-p` 一定会改文件。要改文件，官方 headless 示例用 `-p --force`。

### 3.3 流式 / JSON 事件协议

有官方 NDJSON，字段表最完整（[Output format](https://cursor.com/docs/cli/reference/output-format)）。

**`json`（成功时一条对象 + 换行）：**

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 1234,
  "duration_api_ms": 1234,
  "result": "<full assistant text>",
  "session_id": "<uuid>",
  "request_id": "<optional>"
}
```

失败：非 0 退出，**stderr 一条错误，不吐合法 JSON**。

**`stream-json` 事件：**

| `type` | 内容 |
|---|---|
| `system` / `subtype=init` | `apiKeySource`（`env\|flag\|login`）、`cwd`、`session_id`、`model`、`permissionMode` |
| `user` | 用户 prompt |
| `assistant` | 默认：两次工具调用之间的完整一段。`--stream-partial-output` 时可能多段；只用「有 `timestamp_ms`、无 `model_call_id`」的 delta |
| `tool_call` / `started` \| `completed` | `call_id` + `tool_call.readToolCall` / `writeToolCall` / `function` |
| `result` / `subtype=success` | 成功终态 |

官方硬限制：

> **`thinking` events are suppressed in print mode and will not appear in any output format.**

失败时 stream 可能提前结束、没有终态 `result`。

### 3.4 Session resume

能。

- `--resume [chatId]`，`--continue`（=`--resume=-1`）
- `agent resume`：最近一次
- `agent ls`：列出再选
- `agent create-chat`：先拿 ID 再 resume（[overview](https://cursor.com/docs/cli/overview)；[using](https://cursor.com/docs/cli/using)；本机 help）

`session_id` 在一次执行内保持不变（[output-format](https://cursor.com/docs/cli/reference/output-format)）。

### 3.5 工作目录 / 沙箱 / 权限

| 能力 | 依据 |
|---|---|
| 钉工作区 | `--workspace`；否则 cwd |
| 额外根 | `--add-dir` |
| worktree | `-w/--worktree`，基线 `--worktree-base` |
| 沙箱 | `--sandbox enabled\|disabled`；`agent sandbox enable/disable/run`（run 默认无网） |
| 无头信任 | 未信任目录必须 `--trust` 或 `--force`，否则失败（[changelog](https://cursor.com/docs/cli/changelog)） |
| 改文件 | headless 文档要求 `--force`/`--yolo` |

交互式会在跑终端命令前问 y/n（[using](https://cursor.com/docs/cli/using)）。无头必须预授权。

### 3.6 认证

- `agent login`：开浏览器；`NO_OPEN_BROWSER=1` 只打 URL（本机 help；[Authentication](https://cursor.com/docs/cli/reference/authentication)）。
- 「credentials are securely stored locally」——官方没写清文件路径。
- 脚本：`CURSOR_API_KEY` 或 `--api-key`（[headless](https://cursor.com/docs/cli/headless)；[authentication](https://cursor.com/docs/cli/reference/authentication)）。
- Enterprise service account 也是设 `CURSOR_API_KEY`（[service accounts](https://cursor.com/docs/account/enterprise/service-accounts)）。
- `agent status` / `whoami`：`--format json|text`。
- **用户已 `agent login` 时，主机可以直接 spawn**（init 事件 `apiKeySource=login`）。

### 3.7 退出码

没有分项表。

| 情况 | 行为 | 来源 |
|---|---|---|
| 成功 | 0；headless 示例 `if [ $? -eq 0 ]` | [headless](https://cursor.com/docs/cli/headless) |
| `json`/`stream-json` 失败 | 非 0；stderr 错误；`json` 不吐对象；stream 可能没有终态 `result` | [output-format](https://cursor.com/docs/cli/reference/output-format) |
| 未信任 workspace | 非交互失败，提示用 `--trust`/`--force` | [changelog](https://cursor.com/docs/cli/changelog) |
| `agent worker` idle release | 文档写退出 0，方便 supervisor 拉起 | 本机 `worker --help` |

**未知：** 「等用户批准」有没有单独退出码。已试：parameters、headless、output-format、本机 `--help`。无头应带 `--force`/`--trust`，并解析 `result` / stderr，不要依赖专用码。

### 3.8 当 subagent 的限制

- **print 模式没有 thinking。** 主机做「思考中」只能猜，或不用 print、改走交互/ACP（ACP 是否吐 thinking：**未知**，未读完 ACP 页 schema）。
- 无 `--force` 时改文件行为，两份官网不一致。
- 未信任目录无头会失败。
- 裸 `cursor` 不是 Agent。
- 默认 `text` 只有最终一段，没有工具事件。
- `agent worker` 是云代理连回来，不是本地一次性 `-p`。

### 3.9 许可 / ToS

- [Terms of Service](https://cursor.com/terms-of-service)（2026-08-13）§1.5 Use Restrictions 包括：不得 reverse engineer / 改 / 做衍生；不得 rent、lease、lend、**sell the Service**；不得用 bot 探测等。
- [Acceptable Use Policy](https://cursor.com/acceptable-use-policy)（2026-08-11）禁止：
  - 「Modifying, copying, translating, **leasing, selling, reselling, distributing**…」
  - 「**Accessing the Service through automated or non-human means, whether through a bot, script, or otherwise**」
  - 「providing services that appear to be from you, when they are in fact from Anysphere」
- 同一套官方文档又明确教 **scripts、CI、GitHub Actions、`CURSOR_API_KEY`、`--print`**（[headless](https://cursor.com/docs/cli/headless)；[installation](https://cursor.com/docs/cli/installation)；[cli](https://cursor.com/cli)：「Write powerful scripts and automations」）。

**张力（必须写明）：** AUP 的 “bot/script” 句，和官方 Headless CLI 文档直接打架。按字面，PipiUI spawn `agent -p` 也是 script。合理读法是：官方支持的 CLI/CI 是允许的自动化，AUP 打的是爬虫/非官方客户端/转售。**这不是法律意见。** 官方 **没有** 类似 Anthropic 的「可以在产品里预装，只要二进制不改、用户自己登录」条款。

ToS 也没有「可以嵌进第三方 Electron 当子代理」的授权。§5.1：没有默示许可。

**对 PipiUI：** 本机用户已登录、spawn 官方 `agent`，最接近官方 headless 文档。把 Cursor 二进制打进安装包、或当 PipiUI 功能卖给别人，会被 §1.5 / AUP 的 sell/distribute/automated 条款打到。论坛帖不是一手条款，本文不引用。

---

## 对 PipiUI 主机契约的含义

假设契约是：spawn 子进程、流式展示、等终态、可选续跑、钉到某个项目目录。

| 需求 | Codex | Claude | Cursor |
|---|---|---|---|
| Spawn 无 TTY | `codex exec --json` | `claude -p --output-format stream-json --verbose` | `agent -p --output-format stream-json` |
| 文本流 | item 级；token 级靠 SDK | `stream_event` + `--include-partial-messages` | `--stream-partial-output`（无 thinking） |
| 工具事件 | `command_execution` / `mcp_tool_call` / `file_change` | `assistant` tool_use + `stream_event` | `tool_call` started/completed |
| 思考 | `reasoning` item | thinking block；子代理要 `--forward-subagent-text` | **print 模式没有** |
| 终态 | `turn.completed` / `turn.failed` + 退出码 | 最后一行 `result` + 退出码 | 最后一条 `result` 或非 0+stderr |
| 续跑 | `exec resume` + `thread_id` | `--resume $session_id` | `--resume` / `create-chat` |
| 钉目录 | `-C` | 设子进程 cwd + `--add-dir` | `--workspace` |
| 无人值守 | `--sandbox workspace-write` 或 yolo；`--skip-git-repo-check` | `--permission-mode dontAsk` + `--allowedTools`，或 skip-permissions | `--force --trust` |
| 用用户已有登录 | 默认可以 | 可以（别加 `--bare`） | 可以（或不设 `CURSOR_API_KEY`） |

推荐最小命令（研究结论，未在本机对模型实跑）：

```bash
# Codex
codex exec --json --sandbox workspace-write --skip-git-repo-check \
  -C /path/to/project "…"

# Claude
claude -p --output-format stream-json --verbose --include-partial-messages \
  --permission-mode dontAsk --allowedTools "Read,Edit,Bash" \
  "…"
# cwd = 子进程 workingDirectory

# Cursor
agent -p --output-format stream-json --stream-partial-output \
  --force --trust --workspace /path/to/project "…"
```

---

## 未知与已尝试

| 未知 | 已试 |
|---|---|
| Codex `exec` 卡住要批准时的进程退出码 | 官方 noninteractive、CLI reference、本机 `exec --help`；本机 `exec` 不接受 `--ask-for-approval` |
| Codex `--json` 是否保证有 token 级 `item.updated` | 官方 sample 只有整 item；SDK 用 `runStreamed()` |
| ChatGPT 订阅 + 第三方桌面包装 Codex 是否一律合规 | LICENSE、SDK 页、Service terms；没有产品嵌入专页 |
| Claude CLI stream-json 全部顶层 type 的 JSON Schema | headless、cli-reference、SDK streaming-output、errors |
| `--input-format stream-json` 的 stdin 信封 | CLI 表只有一行；headless 几乎不提 |
| Cursor print 模式能否用隐藏 flag 打开 thinking | output-format 写死 suppressed |
| Cursor AUP “bot/script” 与官方 headless 如何调和 | 只读了 AUP + headless/ToS，没有官方律师说明 |
| `agent acp` 的事件是否含 thinking | 只确认命令存在，没拉 ACP schema |
| 本机三套 CLI 对真实模型的退出码 | 研究约束：不发付费请求 |

---

## 来源

### 本机命令（2026-08-26）

- `codex --help` / `codex exec --help` / `codex exec resume --help` / `codex login --help` / `codex login status --help` / `codex mcp-server --help` / `codex app-server --help` / `codex exec --ask-for-approval never --help`（rejected）
- `claude --help` / `claude auth --help` / `claude auth status --help`
- `cursor --help` / `cursor agent --help` / `cursor-agent --help` / `cursor-agent create-chat|status|resume|login|worker --help`
- `codex --version`；`claude --version`；`cursor --version`；`agent --version`；`file`/`ls` 看 symlink
- `man -w`：无手册页

### 官方文档 / 仓库

**Codex**

- https://github.com/openai/codex/blob/main/README.md
- https://github.com/openai/codex/blob/main/LICENSE
- https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs
- https://developers.openai.com/codex/noninteractive
- https://developers.openai.com/codex/cli/reference
- https://developers.openai.com/codex/sdk
- https://developers.openai.com/codex/auth
- https://developers.openai.com/codex/auth/ci-cd-auth
- https://developers.openai.com/codex/environment-variables
- https://developers.openai.com/codex/concepts/sandboxing
- https://developers.openai.com/codex/agent-approvals-security
- https://openai.com/policies/service-terms/

**Claude Code**

- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/setup
- https://code.claude.com/docs/en/authentication
- https://code.claude.com/docs/en/permission-modes
- https://code.claude.com/docs/en/sessions
- https://code.claude.com/docs/en/errors
- https://code.claude.com/docs/en/legal-and-compliance
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/agent-sdk/streaming-output
- https://www.anthropic.com/legal/commercial-terms

**Cursor**

- https://cursor.com/docs/cli/overview
- https://cursor.com/docs/cli/installation
- https://cursor.com/docs/cli/headless
- https://cursor.com/docs/cli/using
- https://cursor.com/docs/cli/reference/parameters
- https://cursor.com/docs/cli/reference/output-format
- https://cursor.com/docs/cli/reference/authentication
- https://cursor.com/docs/cli/changelog
- https://cursor.com/docs/account/enterprise/service-accounts
- https://cursor.com/terms-of-service
- https://cursor.com/acceptable-use-policy
