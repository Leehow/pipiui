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
PipiUI 中由用户在主聊天发起、Boss 自动组织原型与测试对比、交由用户决定是否正式采用的可选能力，由实验扩展与实验 Skill 共同提供；面板只是可选查看器，不是必经入口。
_避免混称_：独立表单工作台、自动优化器、所有开发任务必经的原型流程。

**实验 Skill**：
指导 Boss 识别实验意图、调用实验能力、组织共同测例与最小原型、观察运行并解释证据的方法；不代替运行时状态、实际测试结果或用户采用决定。

**实验（Experiment）**：
围绕一个明确问题组织的、带固定基线、方案、测例、指标和预算的比较单元；可包含多次运行，不等于一次测试命令。

**方案（Variant）**：
实验中解释一个候选假设的代码或配置版本，现状也可作为基线方案；冻结后改变内容应进入新的实验修订。
_避免混称_：Worker、分支（它们只是承载方式）。

**测试批次（Test Batch）**：
某一实验修订中，按方案、测例和重复轮次组织并受同一执行策略与预算约束的运行集合；不是 Worker 派工的 Wave。

**单次运行（Trial）**：
某一实验修订和测试批次中，一个方案对一个测例的一次实际执行；重复运行仍是同一测例的重复，不是新增独立样本。

**并发运行（Concurrent Trials）**：
多个真实执行进程的工作时间重叠，且各自具有独立可写状态；多个终端窗口或一个 Pi 串行处理不等于多进程并发。

**采纳（Adoption）**：
用户选择以某个冻结方案和证据作为正式实现依据；不等于测试通过，也不等于原型自动合并或已经上线。

**实验沙盒（Experiment Workspace）**：
本功能语境中，由受管理 worktree／独立工作目录承载的实验区，分开原型、可变测试状态和正式开发；不是 Docker 或操作系统安全沙盒。
_避免混称_：执行安全沙盒、容器、安全证明。

**执行安全沙盒**：
用操作系统等技术边界限制进程的文件或网络权限；与实验沙盒含义不同，Git worktree 本身不提供这类权限隔离。

**运行承载（Run Carrier）**：
承载真实 Pi 运行和交互的机制，例如 RPC、PTY／终端或可选 tmux；不等于实验、测试批次或结果记录，也不天然代表跨应用退出保活。
