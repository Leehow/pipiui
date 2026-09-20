# PipiUI

Ubiquitous language for the PipiUI project — an Electron macOS/Linux agent host with an
orchestration runtime. Glossary only: no implementation details, no plans, no status.

## Product

**Canonical App**:
The user-authorized packaged app: `build/PipiUI.app`. Only the primary checkout may
create it. The former Swift/SwiftUI edition was retired in 2026-08 and removed from the repo.
_Avoid_: the app, the build, the bundle

**Electron edition**:
The only product (`Electron/packages/ui` → `build/PipiUI.app`). All UI, product,
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

## 实验

**实验台（Experiment Lab）**：
PipiUI 中按需制作候选方案、隔离运行、展示证据并交由用户决定是否采用的能力；不指所有开发任务必经的原型流程。
_避免混称_：原型生成器、自动优化器、沙盒本身。

**实验（Experiment）**：
围绕一个明确问题组织的、带固定基线、方案、测例、指标和预算的比较单元；可包含多次运行，不等于一次测试命令。

**方案（Variant）**：
实验中解释一个候选假设的代码或配置版本，现状也可作为基线方案；冻结后改变内容应进入新的实验修订。
_避免混称_：Worker、分支（它们只是承载方式）。

**单次运行（Trial）**：
某一实验修订中，一个方案对一个测例的一次实际执行；重复运行仍是同一测例的重复，不是新增独立样本。

**采纳（Adoption）**：
用户选择以某个冻结方案和证据作为正式实现依据；不等于测试通过，也不等于原型自动合并或已经上线。

**试验隔离／执行安全沙盒**：
试验隔离分开代码、数据和运行状态；执行安全沙盒用技术边界限制进程文件与网络权限。Git worktree 本身仅提供前者，不证明后者。
