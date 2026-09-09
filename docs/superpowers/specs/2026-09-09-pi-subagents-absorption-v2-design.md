# pi-subagents 选择性吸收 v2 设计

日期：2026-09-09

状态：已批准（用户拍板「A + B」），本文即实现依据

适用产品：Electron PipiUI，`pi-ext/subagent` 扩展

前一版：[`docs/plans/2026-08-11-subagent-selective-absorption-v1.md`](../../plans/2026-08-11-subagent-selective-absorption-v1.md)（对 v0.45.2，结论「吸收不换底」）

上游：[`nicobailon/pi-subagents` v0.66.0](https://github.com/nicobailon/pi-subagents/tree/v0.66.0)（MIT）

## 1. 一句话决策

**不把 pi-subagents 换进 PipiUI 的 subagent 底层；只吸收它证明有效的四条语义，并让它的 agent 定义文件能一键导入。** 调度器、`agentId` 语义身份、UI 投影、worktree 生命周期、Boss ledger 全部不动。

被否决的路线（记录以免再问）：整体换底。原因见会话结论：模型面契约相反（上游把 chain/parallel 改成让模型写 JS `workflowScript`）、身份规则冲突（上游按 opaque runId 寻址，违反宪章 §7）、上游不是给宿主嵌的（一天一版、无 semver 承诺）。

## 2. 缺口核对（决定做什么）

先对照代码，再决定写什么。五项候选里三项 PipiUI 已经有：

| 上游语义 | PipiUI 现状 | 结论 |
|---|---|---|
| acceptance gate / `gate` 验证命令 | `verify` 在 worker 退出后于其 cwd 执行，exit code 进 `[subagent-done]`；失败时 `evaluateAutoMergeReadinessV1` 跳过自动合并，回 `needs-fixer`/`resume-worker`；合并后再跑一次 | **已有**，不做 |
| retained resume | 同 `agentId` 再派即续跑，`subagent_status` 列出可续跑 worker | **已有**，不做 |
| fork 上下文 | `fork: true` 把 Boss 会话经 pi `--fork` 复制给 worker | **已有**；缺「剥掉 Anthropic 签名 thinking 块」，pi 核心也不剥 | 做 A2 |
| `contact_supervisor` 子问父 | 无。worker 只收一条 prompt，没有任何子专用工具能阻塞等 Boss 回答；现有 Supervisor 是一个隐藏的、无工具的 LLM 会话，只做事件过滤 | **缺** | 做 A3 |
| `toolBudget` / `usageBudget` | 无。只有 `timeoutSecs`（软）与「只读转 12 轮」stall 上限；用量只显示不执行 | **缺** | 做 A4 |

B（agent 定义导入）：PipiUI 没有任何外来格式导入路径；现有 `subagent_manage` 的 `validate/scaffold/install` 是唯一的安装缝。

## 3. 四个切片

### B. `subagent_manage({ action: "import" })`

- 输入：`source`（文件或目录路径，绝对或相对会话 cwd）或 `sample`（vendored 样例名，`*` 为全部）；`scope: user|project`；可选 `as`（改名，仅单文件）、`mode`、`deliverable`、`dryRun`、`overwrite`。
- 转换是纯函数 `convertPiSubagentDefinition`（`agent-import.ts`），无 fs、无 env。规则全部机械：
  - 工具名 → capabilities：`edit|write` → `filesystem: workspace-write`；否则 `read|grep|find|ls` → `read-only`；`bash` → `shell`；五个 web 工具 → `web`；`subagent` 或 `allowNestedSubagents: true` → `delegation`（五个派工工具整组给）；`mcp:server/tool` → `mcp_server_tool`；`contact_supervisor` 丢弃并注明「PipiUI 由运行时发 `ask_boss`」；其余未知工具丢弃并列出。`tools:` 省略 = pi 默认内建集。
  - `mode` = `workspace-write` ? `worker` : `read-only`；`worktree` 随之；`deliverable` 默认 worker→implementation、read-only→report，可由参数覆盖。**不按名字猜。**
  - `model` 只在带 `provider/` 前缀时保留；`thinking` 保留（PipiUI 现只按派工参数生效）。
  - `runner.type` 为 `external-cli`/`external-job` → 错误 `unsupported-runner`，整文件跳过。
  - 每个被丢弃的字段/工具都进结果的 `dropped[]`，并写进包目录旁的 `IMPORT.json`（来源、sha256、转换器版本、丢弃清单）。
- 草稿走 `validateAgentDefinition` + 现有 `installDraft` 原子安装；与 bundled 角色同名 → 错误并提示 `as`。
- 六个上游原生 agent 原样 vendored 到 `pi-ext/agent-samples/pi-subagents/`，记录见同目录 `PI_SUBAGENTS_UPSTREAM.md`，许可证进 `ThirdPartyNotices/`。它们**不是** bundled 角色，不导入不进目录。

### A3. 子问父：`ask_boss` / `subagent_reply`

- worker 侧工具 `ask_boss({ question, choices?, context? })`，仅 `PIPIUI_DEPTH > 0` 注册，由运行时发给每个 worker（`desktop-tool-policy` 的 host-issued 集合），不由 frontmatter 授予。
- 阻塞语义：写 `question` 文件后每 500ms 轮询 `answer`，默认 10 分钟超时（`PIPIUI_ASK_BOSS_TIMEOUT_MS`）。超时/abort 返回 isError 文本「无回答，按最佳判断继续并在最终报告里写明假设」，**不杀 run**。
- 传输：`{projectRoot}/.pi/agent-questions/<agentId>/<runId>/q-<n>.json` 与 `a-<n>.json`（与 `.pi/agent-sessions`、`.pi/agent-prompts` 同层，符合宪章 §6）。文件是权威；父侧从子进程 stdout 的 `tool_execution_start` 事件拿到快路径，看门狗 tick 兜底扫未答问题。
- Boss 侧：收到 `[subagent-question] agentId=… runId=… qid=…` 消息（走现有 followUp/steer 投递），用 `subagent_reply({ agentId, runId, answer, questionId? })` 回答；`subagent_status` 列出待答问题。
- 等答期间 worker 不算 stall：stall/liveness 判定把「有未答问题」视为等待，不触发 Supervisor abort。
- UI：现有 `activity` 字符串显示 `ask_boss: <问题摘要>`，`log` 事件带问题全文；协议零新增字段。

### A4. 预算

- 派工参数 `toolBudget: { soft?, hard, block? }`（`SubagentParams`/`tasks[]`/chain 步骤同形）。校验：`hard ≥ 1`，`soft ≤ hard`，`block` 缺省 `["read","grep","find","ls"]`，`"*"` 全阻。
- 传输 `PIPIUI_TOOL_BUDGET=<json>` 到子进程；子侧 `tool_call` 钩子计数：到 `soft` 一次性 `sendUserMessage(..., { deliverAs: "steer" })` 提醒收尾；超 `hard` 对 `block` 内工具返回 `{ block: true, reason }`。**最终文本永不阻断，run 不结束。**
- 父侧按 `tool_execution_start` 计数，`[subagent-done]` 加一行 `Tool budget: N calls (soft S, hard H) → within|soft-reached|hard-reached`。
- `usageBudget: { tokens?: {soft?, hard}, costUsd?: {soft?, hard} }`：父侧按 `usage` 报告评估；soft → 一次 `[subagent-budget]` 通知 Boss；hard → 走 `timeoutSecs` 同一条 abort 路径，`stopReason = "usage_budget"`，恢复分类 `continue-slice`。文档同上游：**不要给写角色设 hard**。

### A2. fork 时剥签名 thinking

- 纯模块 `fork-sanitize.ts`：读会话 JSONL，对 Anthropic 来源（`provider === "anthropic"` / `api === "anthropic-messages"` / `model` 以 `anthropic/` 开头）的 assistant 消息删掉 `redacted_thinking` 与带签名的 `thinking` 块；内容为空的消息整条删。其它内容不动。
- 接线：fork 决定后若源文件含此类块，写一份净化副本到 `.pi/agent-sessions/forks/<agentId>.<runId>.jsonl` 作 `--fork` 源；若子模型是 Anthropic，强制 `--thinking off` 并在派工回执加 `[fork-thinking-off]`。非 Anthropic 子模型不改 thinking。

## 4. 非目标

- 不装、不 vendor 上游代码；不引 `workflowScript`、missions、FleetView、watchdog。
- 不改 `agentId`/`runId` 身份、`agent_event` 协议字段集、Swift/Electron 投影。
- 不实现 external-cli runner（另一份已批准规格）。
- 不给 bundled 角色改名换prompt。

## 5. 验收

- `node --experimental-strip-types --test Electron/resources/runtime/pi-ext/subagent/test/*.test.ts` 全绿，含新增 `agent-import`、`boss-question`、`tool-budget`、`fork-sanitize` 测试。
- 六个 vendored 样例全部能 dryRun 转换且经 `validateAgentDefinition` 零 error；external-cli 样例（未 vendored）的合成用例返回 `unsupported-runner`。
- `subagent_status` 输出与 `[subagent-done]` 在无预算/无问题时逐字节不变（回归）。

## 6. 落地记录（2026-09-09）

| 切片 | 文件 | 测试 |
|---|---|---|
| B 导入 | `subagent/agent-import.ts`（纯转换 + `renderPackageDraft` 共用序列化器）、`subagent/agent-management.ts`（`action: "import"`、`IMPORT.json`）、`pi-ext/agent-samples/pi-subagents/*.md`（六个上游原生 agent）、`agent-samples/PI_SUBAGENTS_UPSTREAM.md`、`ThirdPartyNotices/pi-subagents-LICENSE.txt` | `test/agent-import.test.ts`（20） |
| A3 子问父 | `subagent/boss-question.ts`（文件契约 + 两个工具）、`index.ts`（`PIPIUI_QUESTION_DIR` 下发、`toolcall_end` 快路径、看门狗 stall 豁免、`timeoutSecs` 豁免、终态清理、`subagent_status` 待答行）、`desktop-tool-policy.mjs`（`hasAskBoss` host-issued）、`active-tools.ts`（活动摘要） | `test/boss-question.test.ts`（9） |
| A4 预算 | `subagent/tool-budget.ts`、`index.ts`（三个派工形态的 `toolBudget`/`usageBudget` 参数、fail-closed 解析、`PIPIUI_TOOL_BUDGET` 下发、子侧 `tool_call` 钩子、父侧计数、`usage` 流评估与 `usage_budget` abort）、`done-message.ts`（两行汇总） | `test/tool-budget.test.ts`（7） |
| A2 fork 净化 | `subagent/fork-sanitize.ts`、`index.ts`（`--fork` 前净化副本到 `.pi/agent-sessions/forks/`，Anthropic 子模型 `--thinking off`）、`done-message.ts`（一行汇总） | `test/fork-sanitize.test.ts`（6） |

全套 917 用例 915 通过；两条失败与本次无关且在 HEAD 快照上同样复现：`dispatch-model` 的「bare tasks[] wave」需要 git-capability worktree placement provider（测试环境缺）；`nested-background-lifecycle` 的三条 real-seam 用例在并行全量跑时偶发超时，单独运行 6/6 通过。宿主侧 vitest（packaging-contract、agent-catalog、agent-frontmatter-policy）36/36。

未做、留给后续：`[subagent-done]` 里汇总本次 run 提了几个问题/几个超时；`inflight-prompt` 的 Boss 回合尾块显示待答问题；`usageBudget` 的「下一安全点」而非立即 abort。
