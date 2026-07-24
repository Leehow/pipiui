# VCS / Git-first 路线图（Pipi UI）

> 任务本。Git 是一等公民：工具栏可见状态 → 给 agent 的结构化工具与 prompt 快照 → worktree / 远端轻量集成。  
> 不引入 libgit2；一律 `git` CLI（Swift `Process` / Node `spawnSync` + argv，无 shell 拼接）。

## 方向

- **用户面**：聊天工具栏一眼看到分支与脏状态，可本地 checkout、可选打开 GitHub。
- **Agent 面**：每次对话自动注入紧凑 `## Git (Pipi UI)` 快照；提供 `git_status` / `git_diff`（截断）工具，减少乱 shell。
- **演进**：L3 多 worktree 隔离任务；L4 轻量 GitHub（PR/checks 只读或半自动）；L5 不做完整 IDE-VCS。

## 层级定义

| Level | 名称 | 含义 |
|------|------|------|
| **L0** | 基线 | 项目目录即 cwd；无专用 Git UI/工具 |
| **L1** | Toolbar 分支 | `GitRepo` probe + `GitBranchMenu` 本地 checkout + GitHub 链接 |
| **L2** | 结构化 status/diff | 脏计数、ahead/behind、origin；`GitExtension` 工具 + prompt snapshot |
| **L3** | Worktree | 按任务/会话创建或附着 git worktree，隔离脏工作区 |
| **L4** | GitHub 轻量 | PR 列表/创建草稿、checks 摘要（`gh` 或 API），不做成完整 GitHub 客户端 |
| **L4b** | Action bot（低优） | 可选 CI 机器人评论/触发，非核心路径 |
| **L5** | 不做 | 完整 merge UI、交互式 rebase 编辑器、libgit2 绑定、替代 Tower/Fork |

## 非目标

- [ ] 不嵌入 libgit2 / SwiftGit2
- [ ] 不做完整 merge conflict 三维编辑器
- [ ] 不做交互式 rebase / cherry-pick GUI
- [ ] 不替代 `gh` / 浏览器做重度 Code Review
- [ ] 不在 L2 自动 commit / push（需用户或后续层级明确授权）

---

## L1 — Toolbar 分支（已完成）

- [x] `Sources/PipiUI/GitRepo.swift` — probe / checkout / pure parsers / github URL
- [x] `Sources/PipiUI/GitBranchStore.swift` — `@MainActor` 刷新 + app-active
- [x] `Sources/PipiUI/Views/GitBranchMenu.swift` — 工具栏 Menu
- [x] `ChatDetailView` 挂载 GitBranchMenu
- [x] `Tests/PipiUITests/GitRepoTests.swift`（L1 覆盖）
- [x] commit `7c6878e` — `feat(git): toolbar branch menu with local checkout and GitHub link`

## L2 — 结构化 status/diff + VCS 任务本（已完成）

- [x] `GitRepoStatus` 扩展：`isDirty`、staged/unstaged/untracked 计数、`ahead`/`behind`/`upstream`/`originURL`
- [x] 纯解析：`parsePorcelain`、`parseUpstreamCounts`
- [x] `promptSnapshot(status)` → 稳定标记 `## Git (Pipi UI)`
- [x] `diffStat` / `truncateDiffOutput`（默认 ~80KB / 行数截断）
- [x] `probe()` 填充全部新字段
- [x] UI：脏分支 `toolbarTitle` 加 `*`，help 带计数
- [x] `Sources/PipiUI/GitExtension.swift` — install → Application Support `pipiui-git.ts`
  - [x] tools: `git_status`、`git_diff`（~80KB 硬上限，截断注明）
  - [x] `before_agent_start` 注入 snapshot（防重复标记）
  - [x] `child_process.spawnSync` + argv，`cwd = process.cwd()`（项目目录）
- [x] 接线：`PiPlugin.Installed.gitExtension` + `installAll`；`ChatSession` 无条件 `-e`；`AppStore` 传入
- [x] 单测更新：`swift test --filter GitRepoTests`
- [x] 本文档 + 短 plan

## L3 — Worktree（自动隔离 + 审核后 merge/discard 闭环）

- [x] 设计（首版）：**按 subagent** 自动附着独立 worktree，不按会话绑定
  - 路径：`<toplevel>/.pi/worktrees/<safeId>`
  - 分支：`pipiui/<safeId>`（冲突时后缀）
  - 关闭：`PIPIUI_WORKTREE=0` 或工具显式 `cwd`
  - **不**自动 remove / commit / merge（合并须 GUI 确认）；**永不** push remote
- [x] TS：`resolveSubagentWorktree` + `runSingleAgent` 接线（spawn cwd / env / start+end report）
- [x] Swift bridge：`SubagentInfo.worktreePath|Branch|Error`；面板显示 branch + 缩短 path + 橙色 error
- [x] `GitRepo.worktreeAdd(branch:at:in:)` + 单测（temp init + worktree + 危险名拒绝）
- [x] **WorktreeLifecycle 闭环**（2026-07-24）
  - 状态机：`none → active → pendingReview → merged|discarded`
  - `GitRepo.mergeBranch` / `worktreeRemove` / `worktreeList` / `diffStat(from:to:)`
  - `SubagentStore.mergeWorktree` / `discardWorktree`（主 worktree 执行；冲突不删树）
  - UI：Subagents 详情「合并到主分支」「丢弃 worktree」+ lifecycle 徽章 + 可选 diff --stat
  - TS 续作：path 复用 + `worktree list` 按 branch `pipiui/<id>` 复用
  - BossPrompt 四步工作流；plan：`docs/superpowers/plans/2026-07-24-worktree-lifecycle.md`
- [ ] UI：手动创建 / 切换任意 worktree（与项目根关系；非 agent 路径）
- [ ] Agent snapshot / `git_*` tools 的 cwd 跟随选中 worktree（主会话仍是项目根）


## L4 — GitHub 轻量

- [ ] 探测 `gh` 或 token；失败时降级提示
- [ ] 只读：PR 列表、当前分支关联 PR、checks 摘要
- [ ] 半自动：创建 draft PR（明确用户确认）
- [ ] 不实现完整 review 批注 UI

## L4b — Action bot（低优先级）

- [ ] 可选：监听 PR / workflow 结论并汇总到会话
- [ ] 不默认开启；文档化权限与隐私

## L5 — 明确不做

- [x] 记录为非目标（见上表与「非目标」）

---

## 关键文件（L1–L3）

| 文件 | 层级 |
|------|------|
| `Sources/PipiUI/GitRepo.swift` | L1+L2+L3 worktreeAdd/merge/remove/list |
| `Sources/PipiUI/GitBranchStore.swift` | L1 |
| `Sources/PipiUI/Views/GitBranchMenu.swift` | L1+L2 dirty UI |
| `Sources/PipiUI/GitExtension.swift` | L2 |
| `Sources/PipiUI/PiPlugin.swift` | L2 接线 |
| `Sources/PipiUI/ChatSession.swift` | L2 接线 |
| `Sources/PipiUI/AppStore.swift` | L2 接线 |
| `Sources/PipiUI/PiExt/subagent/index.ts` | L3 resolve + branch 复用 |
| `Sources/PipiUI/SubagentStore.swift` | L3 lifecycle + merge/discard |
| `Sources/PipiUI/Views/SubagentPanel.swift` | L3 review UI |
| `Sources/PipiUI/BossPrompt.swift` | L3 worktree 四步闭环 |
| `Tests/PipiUITests/GitRepoTests.swift` | L1–L3 |
| `docs/superpowers/roadmap-vcs.md` | 本任务本 |
| `docs/superpowers/plans/2026-07-23-git-first-l2.md` | L2 短 plan |
| `docs/superpowers/plans/2026-07-23-git-worktree-subagents.md` | L3 首版 plan |
| `docs/superpowers/plans/2026-07-24-worktree-lifecycle.md` | L3 lifecycle plan |

## 验证口令

```bash
swift test --filter GitRepoTests
swift build
rg -n "gitExtension|GitExtension|git_status|promptSnapshot" Sources/PipiUI
./make-app.sh
```
