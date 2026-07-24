# Worktree lifecycle — merge/discard after review

日期：2026-07-24  
状态：已实现

## 目标

Subagent 自动 worktree（L3）闭环：工人结束后进入 **pendingReview**，用户/组长在 GUI **确认合并或丢弃** 后删除 worktree，避免树无限增长；续作同一 agentId 复用已有 worktree。

## 状态机（WorktreeLifecycle）

```
none → active (agent running in wt)
     → pendingReview (agent ended ok/failed/aborted/interrupted，仍有 wt)
     → merged (已 merge + remove wt)
     → discarded (拒绝合并，仅 remove wt，不 merge)
```

| 条件 | lifecycle |
|------|-----------|
| start 且有 path | `active` |
| end / interrupted 且仍有 path | `pendingReview` |
| GUI 合并成功 | `merged`（path/branch 可保留作历史） |
| GUI 丢弃成功 | `discarded` |

**不**自动 merge / push。冲突时 merge 失败且 **不** remove worktree。

## 实现

### A. `GitRepo.swift`

- `mergeBranch(_:into:)` — `git merge --no-edit`（非 ff-only）
- `worktreeRemove(at:in:force:)` — 默认 `--force`
- `worktreeList` / `parseWorktreeListPorcelain`
- `diffStat(from:to:in:)` — `git diff --stat from...to`
- `deleteLocalBranch` / `commitAllIfDirty`（merge 前尽力提交脏树）
- argv 校验：拒绝 branch/path 以 `-` 开头

### B. `SubagentStore`

- `WorktreeLifecycle` + `SubagentInfo.worktreeLifecycle`（Codable 兼容旧 JSON）
- `mergeWorktree(agentId:mainProjectURL:)` / `discardWorktree(...)`
- start 同 id 续作 → 回到 `active`
- `worktreeDiffStat` 供面板折叠展示
- **永不**在 `handle(end)` 里自动 merge

### C. UI `SubagentPanel`

- 注入 `projectURL`（主 worktree）
- pendingReview：`合并到主分支` / `丢弃 worktree`（确认框）
- lifecycle 徽章：工作中 / 审核中 / 已合并 / 已丢弃
- 可选 `diff --stat`

### D. TS `resolveSubagentWorktree`

1. preferred path 已是 git → 复用  
2. `git worktree list` 中已有 `pipiui/<id>`（或 `pipiui/<id>-*`）→ 复用该 path  
3. 否则 `worktree add`  
进程仍新 spawn，仅 cwd/branch 续上。

### E. BossPrompt

四步：派工 → `[subagent-done]` 验收 → **GUI 点合并** 才算进主树 → 合并后删树；失败可同 branch 续派。

## 验证

```bash
swift test --filter GitRepoTests
swift build
./make-app.sh
```

## 非目标

- 不引入 libgit2  
- 不自动 merge / 不 push remote  
- 不恢复 LLM context（仅 worktree 续写）  
- 不做完整 merge conflict 三维编辑器  
