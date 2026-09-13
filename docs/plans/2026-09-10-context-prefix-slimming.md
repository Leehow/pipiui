# Context prefix slimming — the boss's first request

Status: draft (awaiting approval) · Author: main session · Created: 2026-09-10

## Problem

Every PipiUI main session pays a fixed prefix before it reads anything the user wrote. Measured
on this checkout (2026-09-10, session `630be438`):

| Block | tokens | share | owner | movable? |
|---|---:|---:|---|---|
| Tool JSON schemas (73 registered / 67 active) | ~26,900 | 48% | PipiUI extensions | yes |
| System prompt — philosophy layers | 23,094 | 41% | `pi-philosophy` + `pi-ext/subagent/layers` | yes |
| System prompt — `pi-frame` | 3,307 | 6% | pi (npm dep) | no |
| System prompt — `project-context` (AGENTS.md) | 2,273 | 4% | the opened project | out of scope here |
| System prompt — `pipiui-base` + skill catalog | 999 | 2% | locked / already lazy | no |
| messages | ~150 | — | — | — |
| **first request prompt** | **56,610** | | | |

Where the number comes from: `pipiui_runtime_info.contextUsage` is pi's
`getContextUsage()` (`agent-session.js`), which returns the last assistant message's
provider-reported usage total plus a trailing estimate. In this session that is
`input 53,154 + cacheRead 3,456 + output 145 = 56,755` from the session JSONL. It is a
bill, not a recount.

Why it still matters, and why it mostly does not:

- From the second request on the prefix is cache-read (56,704 of 59,400 tokens in this
  session, ~50× cheaper). Per-turn cost is not the problem.
- What the prefix does cost: time-to-first-token on every new session, viability on
  smaller-window models (the same 56.6k is 28% of a 200k window and triggers proactive
  compaction earlier), and — with a multiplier — **the 136 recorded worker dispatches**, whose
  system prompts average 35,932 chars (≈9k tokens, of which philosophy is 11,892 chars).

## Solution

Shrink the two pools PipiUI owns: the philosophy layers and the tool surface. Everything else
is either locked (CONSTITUTION §8), owned by the project, or owned by pi.

### Decisions

**D1 — Only the two owned pools.** `SYSTEM_BASE.md` is locked; `pi-frame` is a dependency's
prompt; `AGENTS.md` is the project's own file. No task here touches them.

**D2 — Philosophy is compressed, never de-featured.** The 13.2k tokens in
`30-orchestration.md` (6.8k) + `24-planning.md` (3.6k) + `40-fanout.md` (2.8k) are 57% of the
philosophy. The target is meta-prose: narration about why a rule exists, worked examples,
restatements of rules that live elsewhere, and prose that repeats what the dispatch runtime
already says inline in its own receipts (`[subagent-stalled]`, `[subagent-recovery]`,
`[worker-continuity]`, `[findings-available]`). Every rule stays; `philosophy-runtime.test.ts`
pins the load-bearing sentences and will fail if one is dropped. One owner for the three layer
files plus the budget-ledger comment in the test — they are coupled, so they are not split
across workers.

**D3 — Tool surface, three levers ordered by risk.** (a) Trim the heaviest descriptions
(40,543 chars of description text is ~10.1k of the 26.9k; the top ten tools are ~40% of it)
without changing parameter semantics. (b) Make the long tail opt-in per project, using the
evidence that it is used in <5% of sessions. (c) Deferred registration of whole families —
biggest win, real risk, gated behind a spike.

**D4 — Deferred registration only after `lazy-tool-spike` returns go.** pi activates tools
registered after session start (a newly registered extension tool is appended to the active
set), which makes a stub-plus-activate design technically possible without patching pi. But it
changes the tool array mid-session, which invalidates the cached prefix. The spike measures
that trade; if it is not clearly positive, the tail goes default-off instead (CONSTITUTION §0:
usability first).

**D5 — Savings are attested, not estimated.** `scripts/check-boss-tool-policy.mjs` already
launches the real pi binary with the real assembled argv and captures the prompt the model
receives; `scripts/collect-extension-tools.mjs` already loads every extension with the real
env. Both get extended to report *sizes* instead of only names, so each slice is accepted
against a number, not a feeling.

### The tail (usage evidence, 224 sessions / 19,841 tool calls)

| used in ≥40% of sessions | ≤5% (tail candidates) |
|---|---|
| `subagent_status` 182, `subagent` 186, `read` 181, `git` 168, `ledger_note` 153, `memory_search` 117 | `computer` 1, `computer_task` 11, `open_application` 3, `browser_flow` 1, `image_gen`/`image_edit` 0, `pipiui_officecli` 0, `pipiui_firecrawl_*` 0–2, `secret_vault_*` ≤6, `source_check` 0, `arxiv_fetch` 0, `unfold` 0, `subagent_reply`/`subagent_done_ack` 0, `list_open_documents` 2 |

### Slices

| id | delivers | acceptance |
|---|---|---|
| `baseline-harness` | size reporting in the two existing scripts + a written baseline | running the harness prints per-block and per-tool sizes matching this table within 5% |
| `trim-philosophy` | orchestration/planning/fanout compressed ≥25%, budget-ledger comment updated | `philosophy-runtime.test.ts` green (pinned sentences intact), composed prefix reported lower |
| `trim-tool-descriptions` | top-10 descriptions shortened | harness shows description bytes down; no tool's parameter schema changed |
| `tail-default-off` | long-tail families not mounted in the coding profile | harness shows the tools gone from the active set; a project can still enable a family |
| `lazy-tool-spike` | read-only verdict on deferred registration | report: activation semantics with file:line, measured cache effect, go/no-go |
| `lazy-tool-impl` | deferred families (only on go) | harness shows the families absent from the base tool array; activation path exercised end to end |
| `philosophy-review` | cold review of the compressed layers | every removed sentence classified as narration/example/duplicate, no rule or gate lost |
| `verify-closeout` | full verification + commit | workspace `npm test` green, before/after table written here, commit via closeout |

### Expected outcome (estimates, to be replaced by harness numbers)

- `trim-philosophy` −3.3～4.6k · `trim-tool-descriptions` −2～3k · `tail-default-off` −3～5k
- `lazy-tool-impl` −8～15k (conditional)
- Boss first request: 56.6k → ~45k after the safe three, ~32–37k with deferred families.
  The same edits also shrink every worker's system prompt, where philosophy is ~3k of ~9k.

### Out of scope

`SYSTEM_BASE.md`, pi's own frame prompt, the project's `AGENTS.md`, worker agent definitions,
and any change to the 25,000-token prefix budget itself (the test keeps its job of noticing
growth; it is not the target).

### Risks

- **R1 behaviour drift** from prose compression → pinned-sentence tests + `philosophy-review`.
- **R2 discovery regression** when a family is off → `check-boss-tool-policy.mjs` still fails
  on a tool that is callable but introduced nowhere.
- **R3 cache invalidation** from mid-session activation → measured in `lazy-tool-spike` before
  any implementation.
- **R4 over-trimming the philosophy into a checklist** → the review axis is "is this still a
  rule the model can act on", not "is it shorter".
