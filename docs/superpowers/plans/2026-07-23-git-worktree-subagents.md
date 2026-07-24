# L3 — Subagent git worktrees（隔离写代码）

日期：2026-07-23  
状态：首版完成（自动 worktree；无 UI 管理 / 无自动 merge）

## 目标

Subagent 默认在独立 git worktree 写代码，避免污染主工作区脏树；Boss 验收后再 merge。

## 行为

| 条件 | 结果 |
|------|------|
| 默认（git repo 内、无显式 cwd） | `git worktree add -b pipiui/<safeId> <toplevel>/.pi/worktrees/<safeId> HEAD` |
| 路径/分支已存在且有效 | 复用该 worktree |
| 冲突 | 后缀 `-<base36>` 再试 path 或 branch |
| 创建失败 | spawn 回落原 cwd，上报 `worktreeError` |
| `PIPIUI_WORKTREE=0` | 关闭自动 worktree |
| 工具参数显式 `cwd` | 尊重调用方，不 wrap |
| 非 git 目录 | 原 cwd，无 error |

**永不**自动：remove worktree、commit、merge 回主分支。

## 实现要点

### TS — `Sources/PipiUI/PiExt/subagent/index.ts`

- `safeId` / `gitSpawnSync` / `resolveSubagentWorktree` / `WorktreePlacement`
- `runSingleAgent`：agent 校验通过后、start report 前 resolve
- spawn：`cwd: spawnCwd`；env `PIPIUI_WORKTREE_PATH` / `PIPIUI_WORKTREE_BRANCH`
- start + end report：`worktreePath` / `worktreeBranch` / `worktreeError`
- tool description 说明默认隔离与关闭方式

### Swift

- `SubagentInfo` 三字段；`handle` start/end 解析
- `AgentDetailView`：branch + 缩短 path（`textSelection`）+ 橙色 error
- `GitRepo.worktreeAdd(branch:at:in:)` — CLI 封装 + 危险名拒绝

### Prompt

- Boss：工人默认 worktree/`pipiui/*`；验收后 merge；勿假设主工作区已改

## 未做（后续）

- 面板手动创建 / 切换 / 清理 worktree
- 主会话 `git_*` / snapshot cwd 跟随选中 worktree
- 清理策略与 list/remove UI
- 自动或半自动 merge 流程

## 验证

```bash
swift test --filter GitRepoTests
swift build
./make-app.sh
```

可选：临时目录手工 `git worktree add` 与 TS resolve 路径约定一致。
