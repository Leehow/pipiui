# PipiUI

Ubiquitous language for the PipiUI project — an Electron-first macOS agent host with an
orchestration runtime. Glossary only: no implementation details, no plans, no status.

## Product

**Canonical App**:
One of the two user-authorized packaged apps: `build/PipiUI Electron.app` (default) or
`build/PipiUI.app` (Swift, frozen). Only the primary checkout may create them.
_Avoid_: the app, the build, the bundle

**Electron edition**:
The default product (`Electron/packages/ui` → `build/PipiUI Electron.app`). All UI, product,
and acceptance work targets it unless the user explicitly names Swift.

**Swift edition**:
The frozen SwiftUI app (`build/PipiUI.app`). No features, fixes, or packaging unless the user
explicitly asks for it in the current turn.

**fast-app**:
The `pipiui-electron-build` skill's quick packaging mode: host arch, signed, no DMG/ZIP.
_Avoid_: quick build, dev package

**Runtime mirror**:
`Sources/PipiUI/PiExt` and `Sources/PipiUI/PiPhilosophy`, Swift-app copies of
`Electron/resources/runtime/`. Never synced from Electron without an explicit request.

## Orchestration

**Boss**:
The orchestrating main session. Decomposes, dispatches, verifies, integrates, reports; never
writes code or runs large investigations itself.
_Avoid_: main agent, coordinator, leader (reserved for Computer Use Leader)

**Worker**:
A dispatched agent running in the background with its own context, worktree, and branch,
addressed by a stable `agentId`.
_Avoid_: sub-agent (except when translating external skills), task

**Brief**:
The standalone task description a worker receives: goal, current state and evidence,
touchable surface, acceptance criteria, and (for implementation) a `verify` command.
_Avoid_: prompt, spec (a spec is a plan artifact, not a dispatch)

**Wave**:
One round of workers dispatched together in a single turn. The unit of fan-out planning; a
wave of parallel explores counts as one round of ceremony however wide it is.
_Avoid_: batch, group

**Vertical slice**:
One contained change covered by a single acceptance criterion, owned end-to-end
(implement → verify → diagnose → fix) by one named worker.

**Attestation**:
The runtime-run `verify` result in a worker's done header (`verified=pass|fail|none`).
Machine testimony; the only acceptance evidence, outranking worker-claimed success.

**Ledger**:
The per-session orchestration record under `.pi/boss/`. Runtime writes `## Tasks`; the Boss
writes judgement (`## Decisions`, `## Done`, `## Risks & open questions`) via `ledger_note`.
Session-scoped — durable vocabulary goes to `CONTEXT.md`, durable decisions to `docs/adr/`.

## Runtime

**Philosophy layer**:
One markdown file under `pi-philosophy/layers/`, with frontmatter (`id`, `order`, `scope`,
requirements) selecting who receives it. Composed into the system prompt per role/agent/model.

**Skill root**:
A directory the skill loader walks for `SKILL.md` files. Bundled root first (so user skills
cannot shadow bundled workflows), then `PIPIUI_SKILL_ROOTS`, `~/.pi/agent/skills`, and
settings entries.

**Worktree ownership**:
`.pi/worktrees/*` on `pipiui/*` branches belong to the in-app `SubagentStore`; external
Codex worktrees go through `codex-worktree-lifecycle`. Linked worktrees are build/test-only.
