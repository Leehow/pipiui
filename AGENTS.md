# Agents — read this first

## Constitution (binding)

**Read and follow [`CONSTITUTION.md`](./CONSTITUTION.md).**

### Default product UI: Electron only (binding)

- Default UI, product, and acceptance work is the Electron edition
  (`Electron/packages/ui` → `build/PipiUI Electron.app`).
- The Swift/SwiftUI app is frozen. Do not add features, fix UI, keep
  Electron/Swift UI in parity, or package `build/PipiUI.app` unless the user
  explicitly asks for the Swift edition in the current turn.
- `Sources/PipiUI/PiExt` and `Sources/PipiUI/PiPhilosophy` are Swift-app
  mirrors of `Electron/resources/runtime/`. Do not sync them from Electron
  unless the user explicitly asks to update Swift.
- “打包 / 打开 App / 验收” without naming Swift means the Electron App and
  the `pipiui-electron-build` skill.

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

- This repository has standing user authorization for the exact canonical PipiUI Apps. A request
  to build, package, install, open, restart, or continue live acceptance testing authorizes the
  agent to gracefully quit the relevant canonical App, pass `--overwrite-running`, install the
  replacement, relaunch it, and continue the requested test. Do not ask for a separate or repeated
  overwrite/restart confirmation.
- Scope this authority to `/Users/haoli/leehow/code/pipiui/build/PipiUI.app` and
  `/Users/haoli/leehow/code/pipiui/build/PipiUI Electron.app` only. Never terminate unrelated Apps
  or broad process-name matches.
- Prefer the App's normal quit request and a bounded wait. If that fails and blocks an already
  requested lifecycle/test operation, terminate only the exact verified canonical-App PID; force
  termination is a last resort after another bounded wait. Record what was terminated and why.
- Analysis-only, source-only, or test-only requests do not imply a lifecycle operation. Do not
  invent restarts when they are unnecessary for the requested result.

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
```

### Electron packaging adapter (binding)

All Electron packaging goes through the `pipiui-electron-build` skill. Do not
invoke `electron-builder` by hand, and do not call
`./scripts/build-electron-app.sh` directly — reach it through the skill's
`release` mode.

```bash
~/.codex/skills/pipiui-electron-build/scripts/pipiui-electron-build fast-app  # host arch, signed, no DMG/ZIP
~/.codex/skills/pipiui-electron-build/scripts/pipiui-electron-build release   # dual arch + DMG/ZIP
```

The skill is the only path that carries the packaging invariants: it requires
`--overwrite-running` for a running canonical App (the standing lifecycle authorization above
allows the agent to supply it whenever packaging or live acceptance was requested), cleans its own staging tree (leaked
`.electron-fast-*` directories previously grew `build/` past 9GB), exports the
`PIPIUI_EMBEDDED_RUNTIME_TARGET` that selects the per-architecture Cua driver
slice, and checks the result against a size budget. A single-architecture App is
~610MB; it was 1.2GB before the packaging was slimmed, so a bundle near that size
is a regression to report, not a heavier build to ship. Read the skill's
`SKILL.md` before changing anything under `Electron/apps/electron/package.json`
`build`, `scripts/fetch-pi-runtime.mjs`, or `scripts/fetch-cua-driver.mjs` —
each holds a slimming invariant that an innocuous-looking edit silently undoes.

### npm 在本机会经代理死锁（binding）

本机 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:6152`。npm 默认 `maxsockets=15`
经它会死锁：连接建立后被静默丢弃且收不到 FIN，npm 逐个等满 `fetch-timeout`。

`Electron/.npmrc` 已钉死 `maxsockets=3`，`scripts/fetch-pi-runtime.mjs` 里那次
`--prefix` 安装另行显式传参（它跑在 .npmrc 作用域之外）。**不要移除这些限制，
也不要改用户的全局 npm 或代理配置。** 从别处调 npm 时自己带上 `--maxsockets 3`。

识别方法：卡死时 `node_modules` 与 `~/.npm/_cacache` 零写入、累计 CPU 时间冻结、
数百条 ESTABLISHED socket。**registry 全程可达（3-4 秒），所以连通性测试查不出来**
—— 要看 CPU 时间和写入量，别看能不能 ping 通。

### 快速打包（快速迭代）

默认打 Electron，不要走 Swift 的 `make-app.sh`。

```bash
~/.codex/skills/pipiui-electron-build/scripts/pipiui-electron-build fast-app --overwrite-running
```

- 只验证 Electron 工作区能否编译、不打包时，在 `Electron/` 跑对应 workspace build / 测试。
- Swift 的 `make-app.sh` / `./scripts/build-app.sh` 仅在用户明确要求更新 Swift App 时使用。

Do **not** report "done / open the app" if only `Electron/**/dist` or `.build/*` is fresh and `build/PipiUI Electron.app` is older than sources.

Verify after package:

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI\ Electron.app/Contents/MacOS/PipiUI\ Electron \
  <changed-source-files>
```

## Quick map

| Need | Where |
|------|--------|
| Project rules | `CONSTITUTION.md` |
| Build / run docs | `README.md` → 构建运行 |
| Default UI / package App | `pipiui-electron-build` skill → `fast-app` → `build/PipiUI Electron.app` |
| Electron release (dual arch + DMG/ZIP) | `pipiui-electron-build` skill → `release`；never `electron-builder` by hand |
| Swift App（frozen，仅用户点名时） | `./make-app.sh` → `build/PipiUI.app` |
| Worker/dev verification | Electron workspace build / test；Swift 仅在点名时 `swift build` / `swift test` |

macOS 14+ · default product is Electron (`build/PipiUI Electron.app`). The Swift App is frozen.
