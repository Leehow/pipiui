# Agents — read this first

## Constitution (binding)

**Read and follow [`CONSTITUTION.md`](./CONSTITUTION.md).**

Hard rule: **external IDE tasks use one branch + one linked worktree. PipiUI
Boss uses its native lifecycle on integration/staging. Only fully tested
integration/green may reach release-only main.**

```bash
./scripts/init-integration-line.sh --base <committed-ref>
./scripts/new-ai-worktree.sh ...          # Codex/Claude/Cursor only
./scripts/verify-worker.sh                # real debug compile + tests
./scripts/integrate-worker.sh --branch ai/codex/...
./scripts/promote-green.sh                # full test + atomic green advance
./scripts/ship-app.sh                     # clean release main only
```

`make-app.sh` and `scripts/build-app.sh` are local-only and must never install
under `/Applications`. Do not claim delivery from worker-local validation.
Only successful `scripts/ship-app.sh` supports “done / open the app”.

## PipiUI Boss native lifecycle (precedence)

- Open the Boss main session in the dedicated clean `integration/staging`
  linked worktree, not a shared dirty primary checkout or Git `main`.
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
- After a terminal Boss wave with no active/recovery agent, post-merge verify
  complete, and clean staging, the integration owner runs `promote-green.sh`.
  Boss never auto-merges Git `main`.

## Shared integration line

- `main` is release-only; `integration/green` is the latest fully tested shared
  head; `integration/staging` is the only serial merge/test candidate.
- External workers start from explicit `--base integration/green`, compile and
  run relevant tests locally, then the integration owner runs
  `integrate-worker.sh` for one branch. It merges, runs full `swift test`, and
  atomically advances green only on pass.
- A failed merge/test leaves staging available for fixer/recovery while green
  and main remain unchanged. Staging must be restored and promoted before
  another worker is accepted.
- Active divergent tasks are not force-synchronized. Retire completed
  worktrees; create the next task from current green. Sync only while idle and
  clean.
- Final release is an explicit green → main merge outside helper scripts,
  followed by one `ship-app.sh` from clean main.

Hard lifecycle-owner gate: `integration/staging` has exactly one owner at a
time. While any Boss child, auto-merge, post-merge verify, or recovery is
active, do not run `integrate-worker.sh` or `promote-green.sh`. While either
shell workflow runs, do not start or resume a Boss wave. The
`pipiui-integration-line.lock` serializes shell helpers only; native
`MainRepoSerialQueue` does not use it. There is no reliable automatic
cross-runtime detector, so the integration owner must explicitly hand off
ownership before operating.

## Quick map

| Need | Where |
|------|--------|
| Project rules | `CONSTITUTION.md` |
| Build / run docs | `README.md` → 构建运行 |
| Initialize shared line | `./scripts/init-integration-line.sh --help` |
| Create external IDE workspace | `./scripts/new-ai-worktree.sh --help` |
| Worker default debug/test | `./scripts/verify-worker.sh` |
| Explicit local release preview | `./scripts/verify-worker.sh --package-preview` |
| PipiUI Boss children | Native extension / `BossPrompt.swift` |
| Merge one external worker | `./scripts/integrate-worker.sh --branch ...` |
| Test/promote completed Boss wave | `./scripts/promote-green.sh` |
| Local package only | `./make-app.sh` |
| Canonical release install | `./scripts/ship-app.sh` from clean main |
| Dev loop only | `swift run` |

macOS 14+ · SwiftPM · each worktree owns `.build/` and `build/`; canonical user
target remains `/Applications/PipiUI.app`.

Branches build nothing by themselves. Separate worktree artifacts prevent
corruption but duplicate compilation when commands run: use focused validation,
limit/serialize build-heavy lanes, avoid shared SwiftPM scratch paths, and do
one final integration ship. Every code change still compiles and runs relevant
tests in its own worktree; only redundant release `.app` packaging is skipped.
