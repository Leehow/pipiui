# Agents — read this first

## Constitution (binding)

**Read and follow [`CONSTITUTION.md`](./CONSTITUTION.md).**

### Product priority: usability first (binding)

- The first milestone must be a real, end-to-end usable product flow. Get the
  core workflow working before adding optional security hardening.
- MVP flows must not require accounts, email/OTP verification, manually entered
  credentials, or infrastructure knowledge unless they are strictly necessary
  for the core function.
- Prefer the fewest understandable user steps. If a random link can complete the
  task directly, do not replace it with layered login, authorization, and pairing
  ceremonies.
- Keep the minimum safeguards needed to avoid obvious credential disclosure,
  destructive actions, and unauthorized access. Defer defense-in-depth, complex
  key governance, and additional identity layers until the usable flow is
  accepted.
- Any security design that adds a user step must identify a concrete,
  non-deferrable threat first. Otherwise it must not block the usable MVP.

Hard rule: **only the primary checkout `/Users/haoli/leehow/code/pipiui` may create a runnable App.** All other linked/temporary worktrees must verify with `swift build` / `swift test` only and must never create `build/PipiUI.app`.

### Worktree ownership adapter (binding)

- `.pi/worktrees/*` worktrees on `pipiui/*` branches are owned by the in-app
  `SubagentStore`. External Codex cleanup must not adopt, race, or close them,
  especially while a persisted agent is active.
- External Codex and Team Lead worktrees (including sibling `pipiui-wt/*` or
  `.worktrees/*` paths on `codex/*` branches) must be created, audited, and
  closed through `/Users/haoli/.codex/scripts/codex-worktree-lifecycle`.
- Linked worktrees remain build/test-only. The primary checkout below remains
  the sole location allowed to package `build/PipiUI.app`.

```bash
cd /Users/haoli/leehow/code/pipiui
./make-app.sh              # the sole release .app location
./scripts/build-app.sh     # test (optional skip) then make-app.sh
```

Do **not** report "done / open the app" if only `.build/*` is fresh and `build/PipiUI.app` is older than sources.

Verify after package:

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  <changed-source-files>
```

## Quick map

| Need | Where |
|------|--------|
| Project rules | `CONSTITUTION.md` |
| Build / run docs | `README.md` → 构建运行 |
| Package App (primary checkout only) | `./make-app.sh` → `build/PipiUI.app` |
| Test + package (primary checkout only) | `./scripts/build-app.sh` |
| Worker/dev verification | `swift run` / `swift build` / `swift test` |

macOS 14+ · SwiftPM · the only product bundle is `/Users/haoli/leehow/code/pipiui/build/PipiUI.app`.
