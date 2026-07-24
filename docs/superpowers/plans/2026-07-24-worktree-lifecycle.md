# Worktree lifecycle — merge/discard + auto-merge on ok

日期：2026-07-24
状态：已实现（含产品默认 auto-merge on ok）

## 目标

成功（ok）默认自动 merge 进主项目并删除 worktree；失败/中止保留 wt 便于续作。UI 合并/丢弃作手动兜底。

## 行为

| 条件 | lifecycle |
|------|-----------|
| end ok + pendingReview + bindMainProject | 自动 mergeWorktree → merged |
| failed/aborted/interrupted | 保留 pendingReview |
| GUI merge/discard | 手动兜底 |

永不 push remote。

## 实现

- SubagentStore.bindMainProject + handle end ok auto-merge
- ChatSession.init 接线
- BossPrompt / panel fallback

## 验证

swift test --filter GitRepoTests && ./make-app.sh
