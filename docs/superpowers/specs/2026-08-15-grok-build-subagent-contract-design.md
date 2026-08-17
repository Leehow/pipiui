# Grok Build 派工合同 — 设计规格

日期：2026-08-15  
状态：**已由用户批准（A 方案）。**

## 摘要

PipiUI 的 `subagent` 对模型暴露 `task` / `title` / `agent` / `worktree` 等自有字段，并拦截 explore 上的 isolation。Grok 4.6 按 Grok Build `TaskToolInput` 的肌肉记忆填 `prompt` / `description` / `subagent_type` / `isolation`，于是狂报缺 `task` 或 Execution override。

A：所有模型只看见一把 `subagent`，字段与 [Grok Build `TaskToolInput`](https://github.com/xai-org/grok-build/blob/main/crates/common/xai-tool-types/src/task.rs) 对齐。内部仍走现有一人一棵树、写完合并。

## 模型可见字段

| 字段 | 约束 |
|---|---|
| `prompt` | 必填，完整 brief |
| `description` | 必填，3–5 词标签 |
| `subagent_type` | 可选，默认 `general-purpose` |
| `run_in_background` | 可选，默认 `true` |
| `isolation` | `worktree` \| `none` |
| `cwd` | 可选 |
| `resume_from` | 可选，续跑已有工人 |

工具名仍为 `subagent`。并行 = 同一轮多次调用。`subagent_parallel` 不再写进工具说明与哲学范例（实现可暂留注册以免无谓拆测试，但不作为合同）。

## Isolation

- 可写（bundled `general-purpose`）：默认 `worktree` → 现有隔离树 + 合并。
- 只读（explore / plan / reviewer 等）：不建树。带 `isolation` 不报错；`worktree` 空操作。
- `isolation=none`：共享工作区，不再要求 `noWorktreeReason`。

## 内部映射

`prompt→task`，`description→title`，`subagent_type→agent`，`isolation=worktree→isolated`，`resume_from→agentId`，`run_in_background→background`。  
`agentId` / `verify` 运行时生成或省略。未知 `subagent_type`（像 `electron-pkg`）若像 agentId，则当作 id，并按 isolation 推断 explore / general-purpose。

旧字段名（`task` / `title` / `agent` / `worktree` / `background`）只在 sanitizer 再认，**不得写进公开 schema 的 property 列表**。Grok 4.6 按 Grok Build `TaskToolInput` 认工具；公开字段一旦混入 `task`/`agent`/`title`，它就不再把这把工具当 `spawn_subagent`，思考里写「要派」却只发 `read`/`grep`。DeepSeek 能直接填 `prompt`/`description`（2026-08-15 `2c82dadd`）。别名进 schema 会牺牲 Grok，不能再做。

## 各家家用合同（2026-08-15 对照）

公开 `subagent` 只跟 **Claude / Cursor / Grok 这一族**对齐。别的家用字段只进 sanitizer，不准进 property 列表。

| 来源 | 工具名 | 家用字段 | 和公开合同 |
|---|---|---|---|
| Grok Build `TaskToolInput` | `task` / `spawn_subagent` | `prompt`, `description`, `subagent_type`, `isolation`, `resume_from` | 已对齐 |
| Claude Code `TaskInput`（工具现名 `Agent`，旧名 `Task`） | `description`, `prompt`, `subagent_type`, `run_in_background`, `resume` | 同族，已对齐 |
| Cursor Task | 同 Claude 族（`prompt` / `description` / `subagent_type`） | 同族 |
| OpenAI Codex `spawn_agent` v1 | `message` 或 `items`, `agent_type` | **另一族**。sanitizer 尚未映射 |
| OpenAI Codex `spawn_agent` v2 | `task_name` + `message`, `agent_type` | **另一族**。sanitizer 尚未映射 |
| DeepSeek / Qwen / Kimi / GLM / Doubao | 无自家 Task 工具 | 跟我们广告的 schema 走。历史会话里的 `{task,agent,title}` 是旧 PipiUI 教的，不是厂商合同 |

本仓会话实证：合同切换到 Grok 字段之后（17:37 UTC），DeepSeek / Qwen / GPT-5.6 Terra / Grok 4.6 的成功 `subagent` 全是 `prompt`+`description`。GLM-5.3 绕开单发、改走仍用旧名的 `subagent_chain`（`{agent,task}`）。

下一步若 Codex 开始空调用或只吐 `message`/`agent_type`：只在 sanitizer 映射，不要把这些名字写进公开 schema。

## `subagent_chain` item 对齐（2026-08-15 深夜落地）

预言应验：单发修好当晚，Grok 4.6 在生产改走 `subagent_chain` 时全部失败——只发 `{"chain":[{"agent":"general-purpose"}]}`，缺 `task`。A/B 探针：要求必填长字段名 `task` 时 0/5 到达（其它可选字段全填、唯独跳过 `task`）；同一工具改名 `prompt`+`description` 后 6/6 到达。这是字段名级别的行为，不是 schema 复杂度问题。

落地：`ChainItem` 公开 property 列表改为 `prompt`（必填）/ `description`（必填）/ `subagent_type` / `isolation` / `agentId` / `cwd` / `verify` / `thinking` / `heartbeatSecs` / `timeoutSecs` / `desktop`。旧名 `{agent, task, title, worktree, noWorktreeReason}` 只在 sanitizer 再认（`adoptGrokBuildDispatch` 逐 item 映射），内部 runner 仍读 `agent`/`task`。legacy item 缺 `description` 时由 brief 派生，stats 里 title 因此不再为 null（`test-subagent-dispatch-stats` 已随断言更新）。

实弹验收（修后真 schema 直连 xai `grok-4.6`，只挂 `subagent_chain`）：3/3 正确派链，每步完整 `prompt` + 3–5 词 `description` + `subagent_type`，第二步正确引用 `{previous}`；wire schema required=`["prompt","description"]`，无旧名。

## 不做

不搬 personas、capability 沙箱、Rust 协调器。`subagent_status` / abort / resolve / chain 仍用现名。

## 验收

用 2026-08-15 现场 payload（只填 title、带 isolation 的 explore、自定义 agent 名）回放：不再 `must have required properties task`，不再 `Execution override … only available to the bundled general-purpose`。只读不建树；可写默认进树。
