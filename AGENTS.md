# Agents — read this first

## Constitution (binding)

**Read and follow [`CONSTITUTION.md`](./CONSTITUTION.md).**

Hard rule: **one AI task = one branch + one linked worktree. Worker builds are
local; only a clean integration worktree may install the canonical app.**

```bash
./scripts/new-ai-worktree.sh ... # create isolated worker branch + worktree
./scripts/verify-worker.sh       # worker test + local build/PipiUI.app
./scripts/ship-app.sh            # integration-only canonical install
```

`make-app.sh` and `scripts/build-app.sh` are local-only and must never install
under `/Applications`. Do not claim delivery from worker-local validation.
Only successful `scripts/ship-app.sh` supports “done / open the app”.

## Quick map

| Need | Where |
|------|--------|
| Project rules | `CONSTITUTION.md` |
| Build / run docs | `README.md` → 构建运行 |
| Create isolated AI workspace | `./scripts/new-ai-worktree.sh --help` |
| Worker test + local package | `./scripts/verify-worker.sh` |
| Local package only | `./make-app.sh` |
| Canonical integration install | `./scripts/ship-app.sh` |
| Dev loop only | `swift run` |

macOS 14+ · SwiftPM · each worktree owns `.build/` and `build/`; canonical user
target remains `/Applications/PipiUI.app`.
