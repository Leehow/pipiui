# Agents — read this first

## Constitution (binding)

**Read and follow [`CONSTITUTION.md`](./CONSTITUTION.md).**

### Default product UI: Electron only (binding)

- The only product is the Electron edition (`Electron/packages/ui` →
  `build/PipiUI.app`). The former Swift/SwiftUI app was retired in
  2026-08 and removed from the repo; do not reintroduce Swift targets,
  `Package.swift`, or `build/PipiUI.app`.
- `Electron/resources/runtime/` (pi-core-prompt + pi-ext + pi-philosophy) is the
  single source of truth for the bundled pi runtime.
- “打包 / 打开 App / 验收” means the Electron App and the
  `pipiui-electron-build` skill.

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

### Pi 按项目完全隔离（binding）

Pi 必须按打开的项目隔离，自己找自己项目的家。禁止使用全局 `~/.pi/agent`、
`~/.pi/coc-agent`，禁止把整个 Application Support `pi-agent` 当项目家。

- 项目隔离：每个打开项目的 sessions、skills、memory、resources、settings.json、trust.json、models-store.json 只存在于 `{projectRoot}/.pi/agent`，禁止跨写其他项目
- 明确例外（App-profile canonical）：所有打开项目共享 Electron App profile `pi-agent` 同一份 `.env`、`auth.json`、`models.json`
- 明确例外（host bookkeeping）：project list、调度队列、telemetry、agent-worktree projection 可留在 App profile
- 明确例外（扩展共享安装，窄）：核心能力扩展的不可变、内容寻址代码包与版本元数据（含 active/previous slot 与 receipt）可存放于 App-profile 共享存储，所有打开项目共用同一份只读代码；启用状态、授权、扩展设置、memory 数据、browser session、trust 仍严格按项目隔离（详见 `CONSTITUTION.md` §6）
- 新项目不得从 App profile 播种 `trust.json`；已有项目 trust 决定不得删除或改写
- chatrpgv4 的 `pi-coc`：`{chatrpgv4}/.pi/coc-agent`
- 禁止使用或写入全局 `~/.pi`。不要从 `~/.pi` 导入 packages，不要 `pi install` 到全局 `settings.json`，不要把整个项目家软链回全局家。

### User-authorized PipiUI host lifecycle (binding)

- This repository has standing user authorization for the exact canonical PipiUI Apps. A request
  to build, package, install, open, restart, or continue live acceptance testing authorizes the
  agent to gracefully quit the relevant canonical App, pass `--overwrite-running`, install the
  replacement, relaunch it, and continue the requested test. Do not ask for a separate or repeated
  overwrite/restart confirmation.
- Scope this authority to `/Users/haoli/leehow/code/pipiui/build/PipiUI.app`
  only. Never terminate unrelated Apps or broad process-name matches.
- Prefer the App's normal quit request and a bounded wait. If that fails and blocks an already
  requested lifecycle/test operation, terminate only the exact verified canonical-App PID; force
  termination is a last resort after another bounded wait. Record what was terminated and why.
- Analysis-only, source-only, or test-only requests do not imply a lifecycle operation. Do not
  invent restarts when they are unnecessary for the requested result.

Hard rule: **only the primary checkout `/Users/haoli/leehow/code/pipiui` may create runnable Apps.** All other linked/temporary worktrees must verify with Electron workspace builds/tests only and must never create `build/PipiUI.app`.

### Worktree ownership adapter (binding)

- `.pi/worktrees/*` worktrees on `pipiui/*` branches are owned by the in-app
  `SubagentStore`. External Codex cleanup must not adopt, race, or close them,
  especially while a persisted agent is active.
- External Codex and Team Lead worktrees (including sibling `pipiui-wt/*` or
  `.worktrees/*` paths on `codex/*` branches) must be created, audited, and
  closed through `/Users/haoli/.codex/scripts/codex-worktree-lifecycle`.
- Linked worktrees remain build/test-only. The primary checkout below remains
  the sole location allowed to package `build/PipiUI.app`.

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
slice, and checks the result against a size budget. The budget applies to the
core App with bundled plugins (`pipiui-runtime/extensions`, e.g. office 75MB,
code-retrieval) metered separately: a single-architecture core is ~750MB after
the Electron/Node LTS upgrade (was ~610MB before, 1.2GB before the original
slimming), so a core number near or past that is a regression to report, not a
heavier build to ship. Read the skill's
`SKILL.md` before changing anything under `Electron/apps/electron/package.json`
`build`, `scripts/fetch-pi-runtime.mjs`, or `scripts/fetch-cua-driver.mjs` —
each holds a slimming invariant that an innocuous-looking edit silently undoes.

### 修改 pipiui 自身不主动打包（binding）

修改本仓库代码的默认终点是：对应 Electron workspace 编译 / 测试通过并完成提交。
不要主动执行 `pipiui-electron-build`，不要重启或替换正在运行的 App。仅当用户明确
要求“打包 / 装包 / 打开 App 验收”时才走打包流程；也只有那时才适用下文“Verify
after package”的 mtime 检查。

### npm 在本机会经代理死锁（binding）

本机 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:6152`。npm 默认 `maxsockets=15`
经它会死锁：连接建立后被静默丢弃且收不到 FIN，npm 逐个等满 `fetch-timeout`。

`Electron/.npmrc` 已钉死 `maxsockets=3`，`scripts/fetch-pi-runtime.mjs` 里那次
`--prefix` 安装另行显式传参（它跑在 .npmrc 作用域之外）。**不要移除这些限制，
也不要改用户的全局 npm 或代理配置。** 从别处调 npm 时自己带上 `--maxsockets 3`。

识别方法：卡死时 `node_modules` 与 `~/.npm/_cacache` 零写入、累计 CPU 时间冻结、
数百条 ESTABLISHED socket。**registry 全程可达（3-4 秒），所以连通性测试查不出来**
—— 要看 CPU 时间和写入量，别看能不能 ping 通。

### 基础系统提示词已锁定（binding）

架构已完全扩展化，常驻核心只剩 pi 运行时、宿主，以及
`Electron/resources/runtime/pi-core-prompt/SYSTEM_BASE.md` 这一份基础提示词；它由宿主
无条件下发，关掉全部扩展后仍然存在，因此**不接受新增规则**。它只承载身份、扩展化架构，
以及在所有扩展关闭时仍成立的少数不变量。

要改提示词，默认改扩展：工作方法进 philosophy 层，随能力生效的规则进该扩展自己的 layer
目录，单工具的规则进 `promptGuidelines`。完整去处表与修订流程见
[`CONSTITUTION.md`](./CONSTITUTION.md) §8 与
`Electron/resources/runtime/pi-core-prompt/README.md`；`core-prompt-lock.test.ts` 用
digest 钉住内容，改动会显式失败。

### 稳定 ID 必须是语义 slug（binding）

凡 LLM 需要读取、复述、续接、跨调用引用的稳定 ID，必须是短、唯一、可读的语义
slug；禁止 UUID / 随机 hex / `agent-<random>`。分两类：caller-chosen 身份
（worker `agentId`、`plan.id`/task id、computer `sessionId`）由模型显式提供；
runtime-allocated 模型可见身份（如 pi-goal `goal_id`）可由运行时生成，但必须同样
短、可读、语义、唯一。随机/不透明 ID 只能用于模型无需命名的单次
runId/eventId/waveId/requestId、安全 token、浏览器 snapshot/element token、
临时文件和锁。详见 [`CONSTITUTION.md`](./CONSTITUTION.md) §7 与 bundled
philosophy 的 orchestration 层（有 runtime 测试钉住）。

### 快速打包（快速迭代）

```bash
~/.codex/skills/pipiui-electron-build/scripts/pipiui-electron-build fast-app --overwrite-running
```

- 只验证 Electron 工作区能否编译、不打包时，在 `Electron/` 跑对应 workspace build / 测试。

Do **not** report "done / open the app" if only `Electron/**/dist` is fresh and `build/PipiUI.app` is older than sources.

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
| 稳定 ID 规则（语义 slug） | `CONSTITUTION.md` §7 · philosophy `orchestration` 层 |
| 基础系统提示词（已锁定，勿改） | `CONSTITUTION.md` §8 · `Electron/resources/runtime/pi-core-prompt/` |
| 改提示词该改哪里 | `pi-core-prompt/README.md` 的去处表 —— 默认是哲学层，不是基础层 |
| Build / run docs | `README.md` → 构建运行 |
| Default UI / package App | `pipiui-electron-build` skill → `fast-app` → `build/PipiUI.app` |
| Electron release (dual arch + DMG/ZIP) | `pipiui-electron-build` skill → `release`；never `electron-builder` by hand |
| Worker/dev verification | Electron workspace build / test |

macOS 14+ · the only product is Electron (`build/PipiUI.app`). The former Swift App was retired and removed.
