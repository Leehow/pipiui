# L3 — Subagent git worktrees

日期：2026-07-23
状态：完成（自动 worktree + 成功自动 merge；UI merge/discard 兜底）

## 行为

| agent end ok + worktree | 自动 merge + remove |
| failed/aborted/interrupted | 保留 pendingReview |
| 手动兜底 | 面板合并/丢弃 |

## 验证

swift test --filter GitRepoTests && ./make-app.sh
