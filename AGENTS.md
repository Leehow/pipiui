# Agents — read this first

## Constitution (binding)

**Read and follow [`CONSTITUTION.md`](./CONSTITUTION.md).**

Hard rule: **external IDE tasks use one branch + one linked worktree. PipiUI
Boss uses its native lifecycle. Only a clean integration worktree may install
the canonical app.**

```bash
./scripts/new-ai-worktree.sh ...          # Codex/Claude/Cursor only
./scripts/verify-worker.sh                # real debug compile + tests
./scripts/verify-worker.sh --package-preview # explicit local release preview
./scripts/ship-app.sh                     # integration-only canonical install
```

`make-app.sh` and `scripts/build-app.sh` are local-only and must never install
under `/Applications`. Do not claim delivery from worker-local validation.
Only successful `scripts/ship-app.sh` supports “done / open the app”.

## PipiUI Boss native lifecycle (precedence)

- Open the Boss main session in a dedicated clean `codex/*` or `integration/*`
  integration worktree, not a shared dirty primary checkout or Git `main` used
  for active development.
- The native extension exclusively owns `.pi/worktrees/*` child creation/reuse,
  `pipiui/*` branches, attested structured verify, serialized auto-merge into
  the session project root, successful removal, and failed-worktree recovery.
  Every implementation brief must require a real compile plus relevant tests,
  never lint/diff-only; successful removal also reclaims that worktree's
  `.build`.
- Boss/native workers do not call `new-ai-worktree.sh` or manually merge.
  Verified runtime auto-merge is allowed; “worker may not merge” means leaf
  workers, not the Boss runtime.
- Merge/verify failure follows `BossPrompt.swift` same-agent/fixer recovery.
  BossPrompt/native runtime wins over conflicting generic external-IDE rules.
- Run `ship-app.sh` once only after Boss ledger/work is terminal and the
  integration worktree is clean.

## Quick map

| Need | Where |
|------|--------|
| Project rules | `CONSTITUTION.md` |
| Build / run docs | `README.md` → 构建运行 |
| Create external IDE workspace | `./scripts/new-ai-worktree.sh --help` |
| Worker default debug/test | `./scripts/verify-worker.sh` |
| Explicit local release preview | `./scripts/verify-worker.sh --package-preview` |
| PipiUI Boss children | Native extension / `BossPrompt.swift` |
| Local package only | `./make-app.sh` |
| Canonical integration install | `./scripts/ship-app.sh` |
| Dev loop only | `swift run` |

macOS 14+ · SwiftPM · each worktree owns `.build/` and `build/`; canonical user
target remains `/Applications/PipiUI.app`.

Branches build nothing by themselves. Separate worktree artifacts prevent
corruption but duplicate compilation when commands run: use focused validation,
limit/serialize build-heavy lanes, avoid shared SwiftPM scratch paths, and do
one final integration ship. Every code change still compiles and runs relevant
tests in its own worktree; only redundant release `.app` packaging is skipped.
