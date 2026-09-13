# PipiUI packaging and host lifecycle

For packaging, installing, launching or real App acceptance only. The canonical command is a local executable usable from Codex or Pi shell tools; the skill name does not imply Codex-only access. Read the installed `~/.codex/skills/pipiui-electron-build/SKILL.md` with the host’s file reader before invoking it. If that exact helper is unavailable, report the missing dependency; do not substitute a different product’s build command.

Paths and commands below are relative to the repository root unless absolute. Read only this route when the task requires it; it does not expand authorization.

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

修改本仓库代码的默认终点是：对应 Electron workspace 编译 / 测试通过；仅在用户授权提交时提交。
不要主动执行 `pipiui-electron-build`，不要重启或替换正在运行的 App。仅当用户明确
要求“打包 / 装包 / 打开 App 验收”时才走打包流程；也只有那时才适用下文“Verify
after package”的 mtime 检查。

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
