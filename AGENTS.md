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
| Package Electron App (primary checkout only) | `pipiui-electron-build` skill → `fast-app` (host arch) or `release` (dual arch + DMG/ZIP); never `electron-builder` by hand |
| 快速打包（跳过测试） | `./scripts/build-app.sh --skip-tests`（或 `./make-app.sh`） |
| Worker/dev verification | `swift run` / `swift build` / `swift test` |

macOS 14+ · SwiftPM + Electron · the only product bundles are `/Users/haoli/leehow/code/pipiui/build/PipiUI.app` and `/Users/haoli/leehow/code/pipiui/build/PipiUI Electron.app`.
