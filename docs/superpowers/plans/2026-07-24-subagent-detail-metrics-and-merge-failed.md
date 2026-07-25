# Subagent 详情一行指标 + 合并失败交回主 Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Subagent 详情头压成一行指标，并在自动/手动 merge 失败时注入 `[worktree-merge-failed]` 让主 Agent 自处理。

**Architecture:** `SubagentInfo` 累加 usage；详情头只渲染标题+派生指标，审核条条件显示。`SubagentStore.mergeWorktree` 失败时回调 `ChatSession`，经现有 `sendPrompt`/队列注入消息；成功静默。更新 `BossPrompt` 自处理纪律。

**Tech Stack:** SwiftUI / SwiftPM / XCTest；现有 `TokenFormat`、`TokenLedger.UsageSnapshot`、`ChatSession.sendPrompt`。

**Spec:** `docs/superpowers/specs/2026-07-24-subagent-detail-metrics-line-design.md`

## Global Constraints

- 合并成功不发消息；失败才注入 `[worktree-merge-failed]`
- Boss 优先自处理，少烦用户
- 成功编译可运行 app ⇒ 刷新 `build/PipiUI.app`（`./make-app.sh` 或 `./scripts/build-app.sh`）
- 不改列表行、不挪 merge 到右键、不引入圆环

---

### Task 1: SubagentInfo usage 累加 + 派生指标

**Files:**
- Modify: `Sources/PipiUI/SubagentStore.swift` (`SubagentInfo`, `handle` `"usage"`)
- Test: `Tests/PipiUITests/SubagentUsageMetricsTests.swift`（新建）

**Interfaces:**
- Produces: `SubagentInfo.contextTokens`, `contextWindow`, `totalInput/Output/CacheRead/CacheWrite`
- Produces: `var cacheHitRate: Double?`, `var totalTokens: Int`（或等价计算属性）
- Produces: `SubagentMetricsLine` 纯函数文案（可放同文件或小 helper）：`title` + optional `context` / `cache` / `sum` 字符串

- [ ] **Step 1: 写失败测试** — 两轮 usage 后 Σ、缓存命中、contextTokens；无 usage 时派生为 nil/0；指标行文案格式
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现字段、CodingKeys、usage 累加、派生属性、文案 helper**
- [ ] **Step 4: 测试通过**

---

### Task 2: 详情头 UI 压成一行 + 条件审核条

**Files:**
- Modify: `Sources/PipiUI/Views/SubagentPanel.swift` (`AgentDetailView` 顶部)
- Optional: 若需查 `contextWindow`，从 `ChatSession`/`AppStore` 传入 `resolveContextWindow: (String?) -> Int?`，或在 store usage 时由 session 注入模型表

**Interfaces:**
- Consumes: Task 1 派生字段与文案 helper
- Produces: 默认一行；`canReviewWorktree` 时第二行审核条；去掉任务书/model/turns/cost/时长常驻

- [ ] **Step 1: 改 `AgentDetailView` 头部为 metrics 行 + 条件 `worktreeMeta`**
- [ ] **Step 2: 降低 detail `minHeight`**
- [ ] **Step 3: 编译确认；补/改任何因 API 变动的测试**

---

### Task 3: merge 失败回调 + ChatSession 注入

**Files:**
- Modify: `Sources/PipiUI/SubagentStore.swift` (`mergeWorktree`, callback, 可选去重)
- Modify: `Sources/PipiUI/ChatSession.swift`（绑定 `onWorktreeMergeFailed` → 组装消息 → `sendPrompt`）
- Test: `Tests/PipiUITests/WorktreeMergeFailedMessageTests.swift`（新建，测消息格式/解析；store 回调可用 spy）

**Interfaces:**
- Produces: `SubagentStore.onWorktreeMergeFailed: ((SubagentInfo, String) -> Void)?`
- Produces: `WorktreeMergeFailedMessage.format(agent:error:) -> String` 与 `parse(_:)`（可选，供 UI）
- Consumes: `ChatSession.sendPrompt`

- [ ] **Step 1: 写失败测试** — format 前缀与字段；成功路径不触发 callback（可用 store + stub merge 若可测，否则只测 format + 手动验证 merge 失败分支调用 callback）
- [ ] **Step 2: 实现 format、merge 失败时 callback、ChatSession 绑定**
- [ ] **Step 3: 测试通过**

---

### Task 4: 聊天气泡 + BossPrompt

**Files:**
- Modify: `Sources/PipiUI/BossPrompt.swift`
- Modify: `Sources/PipiUI/MessageActions.swift`（排除前缀）
- Modify: `Sources/PipiUI/Views/MessageViews.swift`（折叠卡片，可复用 subagent-done 风格）
- Test: 扩展 `MessageActionsTests` / `SelfTest` 或新建小测试

- [ ] **Step 1: 写测试** — MessageActions 对 `[worktree-merge-failed]` 返回 false；BossPrompt 含关键句
- [ ] **Step 2: 实现 UI 折叠 + BossPrompt 修订**
- [ ] **Step 3: 测试通过**

---

### Task 5: 打包验收

- [ ] **Step 1: `./scripts/build-app.sh`（或测试 + `./make-app.sh`）**
- [ ] **Step 2: `stat` 确认 `build/PipiUI.app` 新于改动源文件**
- [ ] **Step 3: 更新 spec 状态为已实现（可选）
