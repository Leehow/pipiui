# PipiUI

Ubiquitous language for the PipiUI project — an Electron macOS/Linux agent host with an
orchestration runtime. Glossary only: no implementation details, no plans, no status.

## Product

**Canonical App**:
The user-authorized packaged app: `build/PipiUI Electron.app`. Only the primary checkout may
create it. The former Swift/SwiftUI edition was retired in 2026-08 and removed from the repo.
_Avoid_: the app, the build, the bundle

**Electron edition**:
The only product (`Electron/packages/ui` → `build/PipiUI Electron.app`). All UI, product,
and acceptance work targets it.

**fast-app**:
The `pipiui-electron-build` skill's quick packaging mode: host arch, signed, no DMG/ZIP.
_Avoid_: quick build, dev package

**Bundled runtime**:
`Electron/resources/runtime/` (pi-ext + pi-philosophy): the single source of truth for the
pi runtime shipped inside the App.

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
Addressed to the Boss after a compaction; what workers must read is **Shared context**.

**Findings**:
A finished worker's FULL report, written by the runtime to `.pi/findings/<agentId>.md` and
named by the `Findings:` line of its `[subagent-done]`. Exists so evidence can cross the
fan-out boundary without entering the Boss's context: the Boss forwards the path into the
next brief and does not read the file. Replaced, not accumulated, when an agentId is
re-dispatched.

**Shared context**:
The Boss-written document under `.pi/context/`, read by every worker on a goal — shared
architecture, conventions, decisions all workers must respect — so that half of a brief is
written once instead of retyped per worker. Boss-only writer via `context_doc` (`set`
replaces a section, `append` extends it); workers read and never edit it.

## Runtime

**Philosophy layer**:
One markdown file under `pi-philosophy/layers/`, with frontmatter (`id`, `order`, `scope`,
requirements) selecting who receives it. Composed into the system prompt per role/agent/model.

**Skill root**:
A directory the skill loader walks for `SKILL.md` files. Bundled root first (so user skills
cannot shadow bundled workflows), then `PIPIUI_SKILL_ROOTS`, the opened project's
`.pi/agent/skills`, and that project's settings entries. Never `~/.pi`.

**Worktree ownership**:
`.pi/worktrees/*` on `pipiui/*` branches belong to the in-app `SubagentStore`; external
Codex worktrees go through `codex-worktree-lifecycle`. Linked worktrees are build/test-only.
