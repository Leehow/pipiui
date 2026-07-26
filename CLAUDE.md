# Claude Code entrypoint

[`CONSTITUTION.md`](./CONSTITUTION.md) is binding and is the single source of
truth. Read it before changing code.

- Create one task branch + linked worktree with
  `./scripts/new-ai-worktree.sh --tool claude ... --base integration/green`.
- Work only inside that returned worktree.
- Verify with `./scripts/verify-worker.sh` (real debug compile + tests).
- Do not create a release App for ordinary validation. Use
  `--package-preview` only when a local runnable preview is explicitly needed.
- Report branch, base/head SHA, changed files, and exact validation results.
- Do not merge green into an active divergent task. Retire completed worktrees;
  create the next task from current green.
- Do not merge, ship, clean another workspace, or claim canonical delivery.

Only the integration owner may run `integrate-worker.sh`, promote green, merge
green to release-only main, and run `ship-app.sh`.
