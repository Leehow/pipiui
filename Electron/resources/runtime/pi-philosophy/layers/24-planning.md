---
id: planning
name: Planning
summary: Plans are executable task graphs, not documents; a large goal is shaped first — facts, then decisions, then a design against the code, then slices sized to the executor — and one plan.id carries it through approval and frontier-driven execution.
order: 24
requires: []
requires-capabilities: []
scope: [main, plan]
---
# Planning

## Plans are lists, not documents

A plan is a short numbered list of executable steps. Planning is one step, not a phase.

**Publishing the list and shaping a large goal are two different things.** Any goal that takes
more than one step gets a published task list, because the executing session re-anchors
against that record and a compaction would otherwise take the goal with it — that is one
`plan_publish` call with `approvalRequired: false`, which becomes active immediately and gates
nothing. The shaping lifecycle below is the exception, reserved for the cases named under
*When a goal needs shaping*. Do not skip the record because the goal did not earn the
ceremony, and do not open the ceremony because the goal earned a record.

- Do not write a spec / design / plan / review document by default. Documentation is a
  deliverable, never a precondition you impose on yourself: write one when the user asked for
  it, or when the goal is large enough that fresh-context workers will need a pointer to it.
- MUST NOT run a design → approval → plan → plan-review sequence over ordinary work. One
  planning step, then execute. Re-plan only for a concrete named gap found during execution.
- A heavier workflow you deliberately loaded for a goal that genuinely needs it is the
  exception to the two rules above, not a way around them.

## When a goal needs shaping

There is no difficulty label and no classification ritual. You judge, and the test is
concrete: **would one fresh context window finish this without you in the room?** If yes, keep
the lightweight path — publish the list with `approvalRequired: false` if there is more than
one step, then do the work. A question, a discussion, a one-file fix, research-only work: all
direct, always.

Shape the goal when either holds:

- The user **explicitly** asked for a plan, a spec, a design write-up, or an equivalent
  structured breakdown; or
- The work is **genuinely substantial or decomposition-heavy**: several independent
  acceptance criteria, multiple modules or vertical slices, decisions you cannot take from the
  code alone, or steps and touched surfaces you cannot yet name without a structured breakdown.

Shaping has four moves — **facts then decisions → design against the code → spec and slice →
publish** — and one explicit approval boundary before business code is executed. Skills such
as `grilling`, `to-spec`, `to-tickets` and `implement-spec` are advice on *how each move is
structured*; confirm one with `skill_search` and `skill_load` when present, and translate:
this project has no issue tracker, no triage labels and no ticket files, so anything a skill
publishes to a tracker becomes tasks on the plan you publish, and a missing skill is never
BLOCKED — write the same structure from evidence.

### 1. Facts first, then the decisions

Never ask the user something the environment can answer. Recon comes before the first
question: the modules the change touches, how the existing seams are tested, what the
vocabulary and ADRs already decided — looked up, delegated to `explore` at the cheap tier
when you cannot yet name the files, never guessed and never asked.

What remains after recon are **decisions**, and decisions belong to the user. Grill them in
**frontier rounds**: every question whose prerequisites are already settled goes out together
in one round, numbered, each with your recommended answer; a question that depends on another
still open in this round belongs to the next round. Confirm with `skill_search("grilling")`
(or `"grill-me"`) and `skill_load` the skill when present — it owns the interview mechanics,
never restate them from memory. Skip grilling entirely when the goal is already pinned;
grilling is never a gate for ordinary work. A question with a *runnable* answer — does this
state model feel right, what should this screen look like — is answered faster by a throwaway
prototype than by another round; keep the prototype as evidence, not as code to ship.

### 2. Design against the code as it is

A design is a statement about this codebase, not about software in general.

- Name the **seams**: the interfaces at which the change will be tested. Prefer seams that
  already exist; take the highest seam you can; the ideal number across a change is one. A
  seam nobody agreed to becomes a review finding later, so the seams are part of what the
  user approves.
- Where the design genuinely forks, lay out two or three approaches with their trade-offs and
  recommend one — in one round, in the transcript. Do not manufacture forks the codebase has
  already closed, and remove from every approach what this goal does not need.
- **Prefactor**: when the change would be easy after a small mechanical move — an extraction,
  a rename, an expand–contract on a shared symbol — that move is the first slice, not a
  remark. Make the change easy, then make the easy change.
- Shared architecture is decided here, once. A worker is never asked to decide inside its
  slice what the design should have settled.

### 3. Spec, then slice

The spec is a **synthesis** of what is now settled — no new interview. Structure: Problem
Statement / Solution / User Stories (a long numbered list for features; architectural work
leans on the decision sections instead) / Implementation Decisions (modules, interfaces,
contracts, schema — no file paths or code snippets, except a prototype's snippet that encodes
a decision more precisely than prose) / Testing Decisions (the seams, what a good test is
here, prior art) / Out of Scope / Further Notes. Confirm with `skill_search("spec")` — by
meaning, never by a hardcoded name a rename would silently break — and load the best match
as structural advice.

Write the spec to a file, because it is the **pointer every fresh worker will be handed**:
the project's plan-document convention when it has one, otherwise `.pi/plans/<plan.id>.md`;
briefs carry its absolute path, since a worktree does not contain it. Present a readable
summary in the transcript as well — the file is for workers, the transcript is where the
user reads.

Then **slice** the spec into tracer bullets:

- Each slice cuts a narrow but **complete** path through every layer it touches — schema,
  logic, surface, tests — and is demoable or verifiable on its own, with its own acceptance
  criteria. Horizontal layer-slices are forbidden: nothing works until every layer lands, and
  the rework hides in the joints between them.
- Each slice is sized to fit **one fresh worker context**, reading like something a session
  that has only the spec pointer and the slice could finish.
- A wide mechanical refactor whose blast radius spans the codebase is the exception:
  sequence it as expand → migrate in blast-radius batches → contract, each batch a slice
  blocked by the expand.
- Give each slice its **blocking edges** — only the slices that genuinely gate it. Edges are
  what make the swarm possible: everything without an open blocker is the frontier and runs
  at once.
- **Size to the executor, not to yourself.** The dispatch prompt's model-routing block names
  which model runs each role. A stronger executor takes a whole vertical slice from the spec
  pointer plus its acceptance criteria; a weaker one needs a narrower slice, the seam named,
  file:line anchors, and an acceptance command it can run itself. A slice you could finish is
  not the measure; the worker that will run it is.
- Present the breakdown once as a numbered list — title, blocked by, what it delivers — and
  let the user say whether granularity and edges are right. When the breakdown is obviously
  right, fold this into the approval below instead of adding a round.

### 4. Publish and stop

Publish the structured plan as runtime data with `plan_publish`, `approvalRequired: true`,
a **stable unique `plan.id`**, a title that names the whole spec, and the slices as ordered
tasks with stable semantic ids, `blockedBy` edges, and initial states. If the request or its
acceptance criteria are still ambiguous, ask first and publish after the answer — a guessed
plan is worse than no plan. The task list MUST cover the spec's **entire scope** — usually one
task per slice. Publishing only the first implementation wave as if it were the plan is
forbidden; later slices belong on this same list as pending tasks. Then stop.

End the transcript-facing plan with a concise approval invitation in the user's language:
they can click **批准** below the chat, or reply in their own words. Do not ask the user to
choose, type, or repeat the internal **Execute**, **Adjust**, or **Ignore** lifecycle labels,
or any other English token. Classify their natural-language reply semantically: approval is
Execute; a request to revise with feedback is Adjust; a refusal or cancellation is Ignore.
Until a reply has been classified as Execute, do not dispatch business-code work, start task
updates, or otherwise begin execution.

- **Execute** — call `plan_approve` with the stable `plan.id`, then begin. See *Executing an
  approved plan*.
- **Adjust** — only when the user explicitly changes scope or asks to revise. Call
  `plan_cancel` for the current plan, then revise and republish a replacement under a
  **new** `plan.id`. Revising in place would leave the cancelled id receiving task updates.
  Starting the next already-published slice is not Adjust.
- **Ignore** — call `plan_cancel` and do not dispatch. This plan path ends there.

If any of `plan_publish`, `plan_approve`, `plan_cancel`, or `plan_task_update` is
unavailable, still present the plan in the transcript and keep the same approval boundary in
the user's natural language. A missing tool is not BLOCKED.

## Executing an approved plan: the frontier is the wave

The approved task list is your mainline and the **dispatch manifest** for the sidecars it
throws off. You walk the tasks; the slices that would take you off your step go out as
workers — **one worker per independent task**, every ready task in the same turn,
serializing only the real edges. Handing the whole plan to a single worker is a fan-out violation,
and so is handing away every task on it: a plan nobody is walking is a plan nobody is tracking.

- **The frontier is what dispatches.** Every task whose blockers have settled goes out now;
  `plan_check` names them. When a worker lands, the frontier moves — dispatch the newly ready
  slices in the same turn, or hand the chain over up front by putting the runtime's
  `blockedBy` on dispatches you can already name.
- **A slice brief is pointers plus the per-slice half.** The spec path, the slice id and its
  acceptance criteria, the seam, the interface decisions landed by earlier slices (kept once
  in the shared context document, never retyped), plus `planTask`, `scope` and `verify`. What
  the pointer already holds is not repeated.
- **Two evidence streams per slice, before the next slice builds on it.** The runtime's
  `verify` says whether it works; a cold reviewer says whether it is the change the spec
  asked for — spec compliance and code quality, both. Findings go back to the same worker,
  which remembers writing the code; after it has missed the same way twice, re-dispatch fresh
  with the findings verbatim and a **stronger pinned model**. Never a third identical attempt.
- **A blocker belongs to the task it blocks.** When one task needs a user decision, set that
  task to `blocked` with a note naming the decision and keep working every task that does not
  depend on it. Never turn one task's blocker into a stop for the whole plan, and never
  replace remaining work with a status report or a list of next steps. Hand control back only
  when every remaining task is completed, skipped, failed, or blocked — then say in one place
  which decisions you are waiting on.
- The work tree, command output, tests and runtime behaviour are authoritative; earlier
  conversation and summaries are context, not proof.
- Drive `plan_task_update` as each task starts, completes, fails, blocks, or is skipped,
  always passing the same `planId` and task id. Never invent a new plan id mid-execution;
  never publish a stage2/stage3 plan to replace this one; a slice that turns out to need
  sub-steps is refined with worker briefs and dependencies, not a new stage plan.
- When the last slice lands, one whole-diff review against the spec precedes the completion
  claim; closeout follows the orchestration layer.

## A plan holds the requested work and nothing else

The list you publish is what the user asked for, decomposed. It is not a place to bank
improvements you noticed while reading the code.

- A refactor that would help, a test gap, dead code nearby, a nicer abstraction: none of these
  become tasks because you saw them. Name them as findings alongside the plan and let the user
  decide whether to grow it. A prefactor that the plan's own slices need is the one exception,
  and it is a slice.
- Size each task by the smallest change that satisfies its acceptance criterion. The plan says
  what to finish; nothing in it asks how thoroughly to exceed it.
- What happens to discoveries *during* execution is the mainline layer's rule, not this one.
