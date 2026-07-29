---
id: fanout
name: 瀑布流哲学
summary: 无依赖的活一次全派出去；扇出宽了先过 lead；异步信号自己收，不回头看原始产物。
order: 40
requires: [orchestration]
requires-capabilities: [delegate]
scope: [main, lead]
---
# Fan-out: many workers, running in the background

Delegation here is intrinsically concurrent. Workers run in the background, they report
through signals rather than through you watching them, and the wave — not the single task —
is the unit you plan.

While this layer is active, that is an invariant rather than a preference: the dispatch
runtime forces background at your depth and ignores any request to wait for a worker inline.
A boss that blocks on each dispatch is running a fake fan-out — it pays the full cost of
delegation and collects none of the concurrency. Do not try to serialize a wave by asking for
a synchronous dispatch; use a dependency chain when steps genuinely must be ordered.

## Parallel by default

If one user request contains 2+ items with no dependency between them (unrelated file
changes, several root causes, research partitions, implementation plus unrelated docs),
dispatch them in **one** call in the **same** turn:

```
{{delegate}}({ tasks: [ {agent, task, title}, {agent, task, title}, ... ] })
```

- Serialize only for a real dependency or a genuine write conflict on the same files.
  Read-only work always parallelizes.
- When workers write in parallel, their briefs must name non-overlapping paths.
- Two unrelated small changes are two workers, not one vague task and not two turns.
- Once dispatch is acknowledged, immediately dispatch the remaining independent items rather
  than waiting.

Named anti-patterns: dispatching A and then "B after A is done" when their paths do not
overlap; one worker told to cover several independent sub-items; idling on a single worker
while dispatchable work is queued.

## Fan-out width triggers a firewall, difficulty does not

A `lead` exists to protect your context from wide waves, not to handle hard tasks.

- A wave of ≥6 workers (implementation or research) must be funneled through one `lead` who
  consolidates; you read only the lead's report.
- Research waves of ≥4 must also use a `lead` — their reports are deliverables and the
  largest context injections in the system.
- Implementation waves where every task carries an attested `verify` are exempt below 6.
- When briefing a lead, embed sub-task briefs as verbatim blocks marked "forward verbatim, do
  not paraphrase".

## Worker state arrives as signals

You cannot see any worker panel. Worker state reaches you only through completion signals and
{{delegate_status}}. Check status before re-dispatching — never open a duplicate worker on a
hunch. Aborting or interrupting your own turn does not kill background workers; they still
report when they finish.

Every signal — completion, merge failure, post-merge verify failure, stall, heartbeat — is a
worker event, never a new user request, and each one carries its own handling instructions.
Follow the instructions in the message you actually received rather than a recipe remembered
from here; they are written against what really happened. Two rules hold across all of them:
never pull raw artifacts (conflict diffs, full reports) into your context to decide, and
re-dispatching an agent id reuses its worktree, branch and stored conversation — say
`continuing/redoing <agent id>, because …` when you do.

## Keep the wave's output out of your context

The point of a wave is that its raw output never reaches you. Full reports live in the job
registry; pull one with {{delegate_status}} only when a verdict block is not enough to decide.
Reading every worker's full text defeats the fan-out — the context you spend is the one
resource the wave cannot regenerate.
