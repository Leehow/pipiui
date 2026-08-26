# CLI Subagent Workers 设计规格

日期：2026-08-26

状态：已批准，实现计划见 `docs/superpowers/plans/2026-08-26-cli-subagent-workers.md`

适用产品：Electron PipiUI

调研底稿：[`docs/research/2026-08-26-external-cli-subagents.md`](../../research/2026-08-26-external-cli-subagents.md)

扩展合约：[`docs/extension-architecture-v1.md`](../../extension-architecture-v1.md)

## 1. 一句话决策

Boss 可以把本机已安装、已登录的官方 coding CLI 派成**一等 Subagent**。v1 只落地 Cursor Agent（`agent acp`）。工人出现在现有 SubagentPanel，走现有 abort / 续跑 / worktree merge-discard。扩展拥有适配器与目录角色；bundled runtime 只增加一条可插拔 `WorkerLauncher` 缝。找不到 launcher 时响失败，**绝不回退成 Pi worker**。

## 2. 产品结果

主会话可以这样派：

```ts
subagent({
  subagent_type: "cursor",
  agentId: "fix-login",
  prompt: "在隔离 worktree 里修登录竞态，写完报告。",
})
```

用户在 SubagentPanel 看到 `fix-login` 开工、打字、调工具、结束。Abort 停的是 Cursor ACP 进程。续跑仍用 `agentId: "fix-login"`，不让 Boss 念 Cursor 的 UUID。

用户本机没有 `agent`、或没 `agent login` 时，工人直接失败，文案指向终端安装/登录。App 不代登录、不预装 Cursor 二进制、不当自己的套餐卖。

## 3. 已锁定的产品选择

| 选择 | 决定 |
|---|---|
| 路线 | C：扩展 + runtime launcher 缝，一等工人 |
| v1 适配器 | Cursor ACP（`agent acp`），不用 `--print` |
| 工作区 | 复用 PipiUI `.pi/worktrees` + `pipiui/<agentId>`；禁止 Cursor `--worktree` |
| 权限 | 隔离 worktree 内自动放行；出界拒绝；不新做审批 UI |
| 谁能派 | 仅主会话。`general-purpose` 仍只能派 `explore` / `general-purpose` |
| Claude / Codex | 只留同一 `WorkerLauncher` 接口，本版不写适配器 |

## 4. 目标与非目标

### 4.1 目标

- 让 `subagent_type: cursor` 成为目录里的真实角色，进入 SubagentPanel。
- 把各家 CLI 的协议差异关在适配器里；面板协议零新增。
- 身份遵守宪章 §7：模型只看见语义 slug；Cursor session id 只当内部续跑键。
- 可写范围锁在该工人的 PipiUI worktree。
- 扩展可关：下一新会话没有 `cursor` 类型，也没有 launcher。

### 4.2 非目标（v1）

- Claude / Codex 适配器。
- 权限/问答审批 UI。
- 把 `agent` 打进 App 或安装器。
- Cursor `--worktree`、`--print`、print 的 stream-json。
- 换主会话引擎（已退役的 Swift `AgentSessionBackend` 不复活）。
- L2 `host.api` / 扩展进 main。
- 把 Cursor 内部 `cursor/task` 映射成 PipiUI 子代理。
- 在 App 里做 Cursor 登录或中转凭证。
- 自定义 ToolPanel。设置页只放本机二进制覆盖。

## 5. 架构

三块，各管一层。

```
Renderer SubagentPanel
        ▲
        │ 现有 AgentEvent（start / log / log_delta / update / end）
Host pi-backend mapAgentEvent
        ▲
        │ pipiuiReport / host-bridge
Boss Pi  session（subagent/index.ts）
        │
        ├─ runtime === "pi"            → 今日 getPiInvocation
        └─ runtime === "external-cli"  → WorkerLauncher 注册表
                    │
                    ▼
         扩展 agent 半：Cursor ACP 适配器
                    │
                    ▼
         spawn: agent --trust acp
         cwd = PipiUI worktree
```

### 5.1 Bundled runtime：只出缝

新模块 `Electron/resources/runtime/pi-ext/subagent/external-cli/launcher.ts` 暴露：

```ts
type WorkerLauncherId = string; // "cursor"；后接 "claude" | "codex"

interface ExternalWorkerStart {
  agentId: string;
  runId: string;
  worktreePath: string;
  prompt: string;
  resumeSessionId?: string;
  binaryPath?: string;
  report: (event: AgentBridgeEventPayloadV1) => void;
}

interface ExternalWorkerHandle {
  abort(): Promise<void>;
}

interface WorkerLauncher {
  id: WorkerLauncherId;
  start(ctx: ExternalWorkerStart): Promise<ExternalWorkerHandle>;
}

function registerExternalWorkerLauncher(launcher: WorkerLauncher): void;
function getExternalWorkerLauncher(id: WorkerLauncherId): WorkerLauncher | undefined;
```

`subagent/index.ts` 在现有 placement / `validateAgentId` / timeout / closeout **之后**、`getPiInvocation` **之前**分叉：若 `agent.runtime === "external-cli"`，按 `agent.cli` 取 launcher。未注册则 `end/failed`，argv 不得出现 `pi --mode json`。

扩展 agent 半在 Boss 会话加载时调用 `registerExternalWorkerLauncher`。禁用扩展不热卸当前会话；下一新会话不再挂 `-e`，注册表为空。

### 5.2 扩展：用户开关 + Cursor 适配器

包 id：`pipiui-cli-subagents`。

```
Electron/packages/pipiui-cli-subagents/
├── pipiui-extension.json
├── agent/
│   ├── index.ts          # 注册 launcher
│   ├── cursor-acp.ts     # JSON-RPC 客户端
│   ├── path-gate.ts      # 权限路径门
│   └── session-map.ts    # slug ↔ Cursor session id
└── agents/cursor/AGENT.md
```

按现有 bundled 扩展同步进 `Electron/resources/runtime/extensions/`。capabilities：`settings.read`、`settings.write`。不申请 L2。不拿完整 `window.pipiHost`。

`pipiui-extension.json` 贡献 `agent.agents: ["agents/cursor/AGENT.md"]`，以及 App-scope 设置：

- `ext.pipiui-cli-subagents.cursor.binary`：可选。空则 PATH 解析 `agent`，再 `cursor-agent`。不要 spawn 裸 `cursor`（那是 IDE 启动器）。

### 5.3 AGENT.md 契约

`agents.ts` 的 `STANDARD_FIELDS` 增加 `runtime`、`cli`。缺省 `runtime` 为 `pi`（所有现有包不变）。

允许值：

- `runtime: pi`（缺省）
- `runtime: external-cli`，且必须有 `cli: cursor`（v1；后接 `claude` / `codex`）

未知 `runtime` / 缺 `cli` / `cli` 无对应 launcher：**校验错误，进不了目录**，或 dispatch 时响失败。不得解释成 Pi。

`cursor` 包声明：

```yaml
schema: 1
name: cursor
description: Cursor CLI worker via ACP. Isolated PipiUI worktree. Use when the user wants Cursor's agent to implement a slice.
mode: worker
runtime: external-cli
cli: cursor
capabilities:
  filesystem: workspace-write
  shell: true
  web: true
  mcp: false
  desktop: none
  delegation: false
worktree: isolated
deliverable: implementation
delegates: false
```

`tools:` 对外部工人无意义（子进程不是 Pi）。省略。能力块只约束 **dispatch / worktree 策略**。

正文必须写明：无人值守、不要问人、不要再派子代理、只改当前 cwd。

### 5.4 身份

| 谁看见 | 是什么 |
|---|---|
| Boss / 面板 / `agentId` | 模型起的语义 slug（`validateAgentId`，2–24，`[a-z0-9][a-z0-9_-]*`） |
| 内部 `runId` | 现有不透明 run id |
| Cursor `sessionId` | ACP UUID，只写项目家映射文件 |

映射文件：`{projectRoot}/.pi/agent/cli-subagents/<agentId>.json`

```json
{
  "agentId": "fix-login",
  "cli": "cursor",
  "cursorSessionId": "sess_…",
  "worktreePath": "/…/.pi/worktrees/fix-login",
  "updatedAt": 1770000000000
}
```

禁止把 Cursor UUID 当作 `agentId`。禁止写入 `~/.pi`。

## 6. 数据流

一次委派，工人侧只换 launcher。dispatch、slug 门、worktree placement、timeout、stall、closeout 复用现有路径。

```
Boss subagent(type=cursor, agentId=fix-login)
  → placement（.pi/worktrees + pipiui/fix-login）
  → WorkerLauncher.start
  → spawn: agent --trust acp    cwd = worktree
  → initialize
  → authenticate({ methodId: "cursor_login" })
  → session/new 或 session/load
  → 写映射文件
  → session/prompt(AGENT.md 正文 + 无人值守约束 + Boss brief)
  → session/update… → pipiuiReport
  → session/prompt 返回 stopReason
  → 现有 closeout
  → pipiuiReport end
```

`session/new` 的 `cwd` 必须是 PipiUI worktree。新 worktree 未信任，故 spawn 带 `--trust`。不传 `--worktree`，不传 `--print`。

不注入 Pi philosophy 层（那是给 Pi 子进程的环境与 prompt 补丁）。外部工人只吃上面的 `session/prompt` 拼装。

### 6.1 续跑

1. 映射文件有 `cursorSessionId`。
2. `initialize` 声明 `loadSession`。
3. 调用 `session/load`。ACP 会回放历史；适配器**丢掉回放**，面板只画本 `runId`。
4. 任一条件不满足：`session/new`，当新 run。不得把错会话装成续跑。

### 6.2 事件映射

只译成现有 `pipiuiReport` / `AgentEvent`。不新开面板协议。

| 来源 | 面板 |
|---|---|
| `agent_message_chunk` | `log_delta` `itemType: text` |
| thought / reasoning chunk（若 ACP 有） | `log_delta` `itemType: thinking` |
| 无 thinking 事件 | 不编造思考流 |
| `tool_call` started / completed | `log` `tool` / `toolResult`，带 `toolCallId` |
| `plan` / `cursor/update_todos` | `update`（activity / 一句摘要），不当新工人 |
| `cursor/task` | 一行 `log` 文本；**不**再派 PipiUI 子代理 |
| `session/prompt` `stopReason` | `end`：`end_turn`→ok，`cancelled`→aborted，其它→failed |

### 6.3 必须回答的阻塞 RPC

不回就会把无人值守卡死。

| 回调 | v1 行为 |
|---|---|
| `session/request_permission` | 见 §7；入界 `allow-once`，出界 `reject-once` |
| `cursor/ask_question` | `{ outcome: "skipped", reason: "unattended-subagent" }`；问题摘要写 log |
| `cursor/create_plan` | 自动接受；plan 文本写 log |

### 6.4 Abort

`abortAgent` / 超时 / 用户停：

1. 发 `session/cancel`，有界等待 `cancelled`。
2. 超时则 SIGTERM 整个进程组。
3. 再有界等待后 SIGKILL。
4. `end` `aborted`。

### 6.5 Closeout

- 累积的最终助手文本走现有 done TLDR；全文可经 `subagent_status full:true` 拉取。
- 适配器把全文写入 `.pi/findings/<agentId>.md`。
- `deliverable: implementation` 复用现有 worktree verify。Cursor 自己没有 attested verify 时，`verified` 按现有 `verifiedStateFor` 计算，不编造。
- 进程非 0 且没有可用 `stopReason`：`end/failed`，stderr 截断进 `errorMessage`。

## 7. 路径门

`path-gate.ts` 纯函数。permission 请求里出现的路径：

1. 相对路径先相对该工人 `worktreePath`。
2. `realpath`（能解析则解析；断链按拼接后的规范化路径判）。
3. 结果必须等于 worktree 根，或为其子路径。
4. 显式 `--add-dir` 白名单（v1 默认空；主项目 checkout **不**自动加入）。
5. symlink 逃出 worktree 算出界。
6. 请求没有路径（纯 shell 且无法绑定路径）：v1 **拒绝**。工人 brief 要求用文件工具改 worktree 内文件；无路径的任意 shell 不自动放行。

入界 → `allow-once`。出界 → `reject-once`，并打一条 `tool` 错误 log。

## 8. 失败分类

全部进 `end/failed`（或 dispatch 同步错误），文案可操作。禁止静默改走 Pi。

| 情况 | 文案方向 |
|---|---|
| 找不到 `agent` / `cursor-agent` | 安装 Cursor Agent CLI，或在设置里填 `ext.pipiui-cli-subagents.cursor.binary` |
| 未登录 / `authenticate` 失败 | 终端运行 `agent login` |
| worktree 创建失败 | 沿用现有 isolation 失败文案 |
| ACP handshake / `initialize` 失败 | 附截断 stderr |
| 未知 `runtime` / `cli` / launcher 未注册 | 点名缺失的 launcher，不启动进程 |
| 扩展已禁用 | 目录里没有 `cursor`；派未知类型走现有响失败 |

## 9. 产品与许可约束

只 spawn **用户本机**官方 `agent` / `cursor-agent`。

- 不把 Cursor 打进 `build/PipiUI Electron.app`。
- 不代用户登录、不中转 Cursor 凭证。
- 不当 PipiUI 自己的 agent 套餐出售 Cursor。

Cursor ToS/AUP 与官方 headless 文档存在张力（见调研底稿 §3.9）。本设计采用与官方 Headless / ACP 文档一致的读法：用户已安装、已登录的官方 CLI，由本机脚本/宿主 spawn。这不是法律意见。若产品要预装或转售，必须先另开许可结论，不得在实现里「顺便打进包」。

## 10. 测试

不打真实 Cursor API。ACP 侧用 fixture 子进程吐 JSON-RPC。

必须钉住：

1. `agents.ts`：`runtime` / `cli` 解析；未知值拒绝；缺省仍为 `pi`。
2. 注册表：有适配器可派；禁用扩展后下一会话派 `cursor` 响失败。
3. Fixture：文本流、工具起止、入界放行、出界拒绝、无路径 shell 拒绝、`ask_question` skip、`create_plan` 接受、`session/cancel`→aborted。
4. 映射文件：slug → UUID；`session/load` 回放被丢掉。
5. 路径门：symlink 逃逸、相对路径、worktree 外绝对路径。
6. **禁止回退：** launcher 缺失时子进程 argv 不含 `pi --mode json`。
7. 身份：`agentId` 仍走 `validateAgentId`；映射里的 UUID 从不进入 `agentId` 字段。

现有 Pi worker 测试不得改语义。新测放在 `subagent/test/` 与扩展 `test/`。

## 11. 实现落点（文件地图）

| 文件 | 动作 |
|---|---|
| `Electron/resources/runtime/pi-ext/subagent/external-cli/launcher.ts` | 新建注册表 + 类型 |
| `Electron/resources/runtime/pi-ext/subagent/index.ts` | spawn 分叉；不改 Pi 路径语义 |
| `Electron/resources/runtime/pi-ext/subagent/agents.ts` | `runtime` / `cli` 字段 |
| `Electron/packages/pipiui-cli-subagents/**` | 新建扩展 |
| `Electron/resources/runtime/extensions/pipiui-cli-subagents/**` | bundled 同步产物 |
| `Electron/scripts/sync-bundled-extension.mjs` | 纳入同步名单（若现有名单是显式的） |
| `Electron/packages/pi-backend` 测试 | 扩展扫描 / manifest 校验 |

不改 `SubagentPanel.tsx`，除非现有事件字段缺了映射所需的东西（v1 假定现有 `text` / `thinking` / `tool` / `toolResult` 足够）。

## 12. 验收

1. 扩展启用、本机已 `agent login`：主会话派 `subagent_type: cursor` + 合法 `agentId`，SubagentPanel 出现该工人，worktree 在 `.pi/worktrees`。
2. Abort 后进程退出，状态 `aborted`。
3. 再派同一 `agentId`：走映射续跑，不新建错会话（或在不能 load 时明确新 run）。
4. 扩展禁用后新会话：派 `cursor` 响失败。
5. 无二进制 / 未登录：响失败，不回退 Pi。
6. 时间戳验收仅在主工作区打包后、且用户要求打开 App 时适用。本规格的实现迭代以 Electron workspace 测试为准，直到被要求打包。

## 13. 决策记录

- 2026-08-26：走路线 C，不做工具桥、不做「Pi 再 bash 调 CLI」。
- 2026-08-26：v1 适配器选 Cursor ACP，因官方 stdio 协议且 print 模式压制 thinking。
- 2026-08-26：工作区用 PipiUI worktree，避免 `~/.cursor/worktrees` 与 SubagentStore 抢所有权。
- 2026-08-26：隔离 worktree 内自动放行，不新做审批面（易用性优先；写范围已被 worktree 锁住）。
- 2026-08-26：无路径 shell 默认拒绝，避免「自动放行」变成 worktree 外任意命令。
- 2026-08-26：只 spawn 用户本机官方 CLI，不预装。
