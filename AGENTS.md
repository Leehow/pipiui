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

### User-authorized PipiUI host lifecycle (binding)

- The running PipiUI host process belongs to the current user. Agents/workers must never
  execute `kill`, `pkill`, `killall`, Force Quit, `NSRunningApplication.terminate()`,
  `NSRunningApplication.forceTerminate()`, or an equivalent mechanism against it.
- After a build, package, or update, package only and tell the user to quit and reopen PipiUI
  manually; never automatically open, launch, or relaunch it.
- The sole exception is an explicit current-user request to terminate or restart PipiUI. Never
  infer that request or invent termination/restart as a verification step.

Hard rule: **only the primary checkout `/Users/haoli/leehow/code/pipiui` may create runnable Apps.** All other linked/temporary worktrees must verify with `swift build` / `swift test` or Electron workspace builds only and must never create `build/PipiUI.app` or `build/PipiUI Electron.app`.

### Worktree ownership adapter (binding)

- `.pi/worktrees/*` worktrees on `pipiui/*` branches are owned by the in-app
  `SubagentStore`. External Codex cleanup must not adopt, race, or close them,
  especially while a persisted agent is active.
- External Codex and Team Lead worktrees (including sibling `pipiui-wt/*` or
  `.worktrees/*` paths on `codex/*` branches) must be created, audited, and
  closed through `/Users/haoli/.codex/scripts/codex-worktree-lifecycle`.
- Linked worktrees remain build/test-only. The primary checkout below remains
  the sole location allowed to package `build/PipiUI.app` or `build/PipiUI Electron.app`.

```bash
cd /Users/haoli/leehow/code/pipiui
./make-app.sh              # the sole release .app location
./scripts/build-app.sh              # test (optional skip) then make-app.sh
./scripts/build-electron-app.sh     # Electron → build/PipiUI Electron.app
```

### 快速打包（快速迭代）

- `make-app.sh` 本身**不跑测试**，直接 release 打包 → 就是快速打包。
- 需要跳过测试时用 `./scripts/build-app.sh --skip-tests`（等价快速打包）。
- 依赖 SwiftPM **增量缓存**：不要每次 `swift clean`/删 `.build`。首次全量编译慢（约 90s+），之后只重编改动文件，秒级。
- **增量只对公共接口未变的小改动有效**：重构/大范围改动会触发全量重编，耗时不可避免（无捷径，除非分布式构建/更强硬件）。
- **并行 agent 构建已隔离**：可写 worker 各在独立 worktree，`.build` 各自独立，互不干扰；主仓打包用主仓自己的 `.build`。不要假设共享增量会产生冲突。
- 耗时来源：release 编译（首次或重构）为主；`cua-driver` 下载与 `make-icon` 均有缓存，非瓶颈。
- 只验证代码能否编译、不打包时，用 `swift build`（增量，最快），不要跑 `make-app.sh`。

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
| Package Electron App (primary checkout only) | `./scripts/build-electron-app.sh` → `build/PipiUI Electron.app` |
| 快速打包（跳过测试） | `./scripts/build-app.sh --skip-tests`（或 `./make-app.sh`） |
| Worker/dev verification | `swift run` / `swift build` / `swift test` |

macOS 14+ · SwiftPM + Electron · the only product bundles are `/Users/haoli/leehow/code/pipiui/build/PipiUI.app` and `/Users/haoli/leehow/code/pipiui/build/PipiUI Electron.app`.
