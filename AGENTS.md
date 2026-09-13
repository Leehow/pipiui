# PipiUI — shared project instructions

These rules apply to Codex and Pi coding agents. Use the current host's actual tools and authorization model. Host choice does not change product identity, scope or evidence requirements; `AGENTS.override.md` is not a host selector.

## Common boundaries

- The only product in this repository is Electron (`Electron/packages/ui` → `build/PipiUI.app`). Swift/SwiftUI was retired; do not reintroduce Swift targets or `Package.swift`.
- [CONSTITUTION.md](CONSTITUTION.md) is binding. Read the relevant sections before the work they govern: product/UX §0, package/lifecycle §§1–4, project isolation §6, semantic IDs §7, prompt changes §8. The summary here does not relax them.
- Preserve unrelated dirty work. Only the primary checkout `/Users/haoli/leehow/code/pipiui` may package runnable Apps. Pi-managed `.pi/worktrees/*` on `pipiui/*` branches belong to the in-app SubagentStore; external agents must not adopt or clean them. External Codex worktrees use its canonical lifecycle helper when that host is selected.
- Code-only work ends at relevant workspace validation. Commit only when authorized. Packaging/restart is a separate user-requested operation; source success does not mean the installed App changed.
- Pi sessions, skills, memory, settings and trust belong to the opened project's `.pi/agent`. Preserve the App-profile credential/bookkeeping and immutable-extension-code exceptions in §6; never seed or overwrite project trust or use global `~/.pi`.
- Stable model-facing IDs are semantic slugs; opaque integrity IDs remain runtime-owned. Preserve caller-chosen versus runtime-allocated distinctions in §7.
- `Electron/resources/runtime/pi-core-prompt/SYSTEM_BASE.md` is locked. Put workflow changes in philosophy, capability-specific guidance in its extension layer, and single-tool guidance in `promptGuidelines`. Do not add Astra/Codex-specific instructions to the shared base prompt.
- Prefer a usable end-to-end flow with the minimum necessary safeguards. User-visible errors must be dismissible; optional security ceremonies cannot replace the core task.

## Read the route needed for this task

| Task | Source |
| --- | --- |
| Spawn/process/worker or npm installation changes | [Runtime development](docs/agents/development.md) |
| Packaging, install, restart or real App acceptance | [Packaging and lifecycle](docs/agents/packaging.md) |
| Prompt/layer/tool guidance changes | Constitution §8 and [prompt placement](Electron/resources/runtime/pi-core-prompt/README.md) |
| Build/test commands | `Electron/package.json` and README build section; use checks appropriate to the touched area |
| Extension architecture | Current extension contract and affected manifest; capability presence comes from the live tool surface |

Packaging remains `/Users/haoli/leehow/code/pipiui/build/PipiUI.app` through `pipiui-electron-build`; never use a Paper/Hydra bundle as evidence for this product. Exact signing, PID/path, freshness and LaunchServices verification apply when real App acceptance is requested.
