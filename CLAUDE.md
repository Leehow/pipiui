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
- Staging has exactly one lifecycle owner. Never run integration/promote while
  a Boss wave is active, and never start/resume Boss while external
  integration/promote owns staging. The shell lock does not coordinate with
  native `MainRepoSerialQueue`.
- Promote a Boss candidate only when the wave is terminal, no active/recovery
  agent remains, post-merge verify passed, and staging is clean.
- Do not merge, ship, clean another workspace, or claim canonical delivery.

Only the integration owner may run `integrate-worker.sh`, promote green, merge
green to release-only main, and run `ship-app.sh`.
