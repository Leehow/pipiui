---
name: pipiui-research
description: External or mixed web+repo research with claim-level sources. Use when the user asks to research / 调研 / 深挖 / 查证 / 文献综述 / deep research / fact-check a non-local topic, verify third-party API or docs behavior, compare prior art, or produce a cited findings note. Skip for pure in-repo fixes you already know, and skip one named fact when the model has native hosted search (answer in place). Dispatches explore; writes project .pi/findings. Not packaging, desktop use, or code implementation.
---

# PipiUI research

## Agent, Skill, and Prompt

Use this **only in the main session**. This Skill is guidance; it grants no
tools. Dispatched workers run skill-free (`--no-skills`) and must not load this
Skill. A Prompt is only task text.

Skill load is advice, not a gate: follow the procedure when it fits. Do not
invent accounts, tickets, tmux, issue trackers, or a global `~/.pi` skill home.

Bundled name is retained and bundled-first: `pipiui-research` cannot be replaced
by a same-named user Skill.

## When to use

Load / run when **at least one** is true:

- The user explicitly wants 调研, 调查, 深挖, 查证, 交叉验证, 文献综述, research,
  deep research, fact-check, or a cited comparison of prior art.
- The conclusion depends on **out-of-repo** third-party API / OS / library
  version / product behavior.
- A design decision needs prior art and this repo has no authoritative answer.

## When not to use

- Pure in-repo fix you already know; single-file bug; existing findings still
  current enough to continue from.
- One already-named fact **and** the model has native hosted search → search
  yourself in the main session (philosophy `22-research`). Do not dispatch.
- Desktop / packaging / implementing the fix → other skills or agents.
- Do not treat this Skill as permission to edit product code.

## Think first

Form 3–7 falsifiable hypotheses **before** searching. Searching first anchors
you to someone else's framing. Write what would refute each hypothesis. Evidence
beats authority; keep **facts** and **inferences** in separate sentences.

This is proportional, never mandatory ceremony. One optional clarifying sentence
only if a constraint is actually missing. No questionnaire, no plan-edit UI.

## Procedure (main session)

Aligns with philosophy `22-research` and the bundled `explore` agent.

### A. Scope (≤5 lines, non-blocking)

- Question, success criteria, your own hypotheses (not search mashups).
- Classify it: a one-hop named fact is small; a broad, deep, comparative, or
  open question needs a research fan-out. Optional: one clarifying question.
- For a fan-out, split the question into **non-overlapping research axes**
  before dispatching. Each axis names its query angle and source range, so
  explorers do not repeat the same search.

### B. Research (delegate first)

Who searches follows tooling, then question size (`22-research`):

- **Native search + named small fact** → answer directly in the main session;
  skip `explore`. Do not over-orchestrate a one-hop fact query.
- **Broad/deep/open question** → default to multiple `explore` workers, not one.
  Use a first-wave baseline of **3–6 independent partitions**, expanding for a
  wider question only while information gain justifies it. In the same wave,
  dispatch **all known independent partitions at once**; do not serially wait
  for one explorer before starting another. Runtime concurrency limits apply.
  Include, as the question permits, distinct axes for:
  - primary sources / authoritative specifications or original research;
  - counterevidence, conflicts, limitations, or refutations; and
  - adjacent approaches, alternatives, or historical / regional / temporal
    context.
  Give every explorer its own hypothesis, falsifier, query angle, and source
  range. Ask for a **verdict** plus the evidence that changed it, not a link
  dump. `explore` is the locator/evidence worker; the main session synthesizes.
  Full worker material remains in `.pi/findings/<agentId>.md`.
- **Other non-small external question** → dispatch at least one read-only
  `explore` with the same verdict-and-evidence brief.
- Tool routing in each explore brief:
  - `web_search` — discovery
  - `fetch_content` — pages, PDFs, GitHub repo/blob/tree
  - `arxiv_fetch` — arxiv.org / export.arxiv.org / ar5iv **only**
  - `source_check` — machine-readable check of a decisive claim
  - `get_search_content` — slice already-fetched content
- A follow-up wave targets only evidence gaps exposed by the first wave; do not
  repeat axes already covered. Bound further expansion by information gain,
  duplication rate, budget, and the stop conditions below.
- Third-party git clone **only** into `/tmp` or `/private/tmp`. Never into the
  project tree. Never write `~/.pi`.
- Main-session `web_search` / `fetch_content` is last resort when explore is
  unavailable or returned unable to answer.

### C. Verify (lightweight citation step)

For every **decision-changing** claim: URL (or `file:line`) + checkable quote or
locator. Prefer `source_check`. Spot-check ≥1 high-risk claim with
`fetch_content` / `arxiv_fetch` of the primary page. No support → status
`unverified` or drop the claim. Do not invent a CitationAgent role.

### D. Write

Synthesize to the **open project's** findings dir (never `~/.pi`):

`{projectRoot}/.pi/findings/research-<slug>-<UTC>.md`

Chat shows a short Verdict + that path. Explore already writes
`.pi/findings/<agentId>.md`; do not duplicate that file — cite it under Explore
runs. Do not auto-edit application code or expand scope into implementation.

## Source ladder

1. **Primary** — official docs, specs, source, RFC, first-author papers (arXiv),
   vendor API reference.
2. **High-trust secondary** — official blog/changelog, maintainer statement.
3. **Tertiary** — tutorials / SEO / aggregators — **clues only**; trace back to
   primary before treating as fact.
4. **Conflicts** — report side by side with timestamps/versions; do not silently
   pick a side.
5. Prefer the domain that **owns** the fact (official docs for that product).
   Do not hard-lock a vendor allowlist.
6. Forbidden: answering from search snippets you never opened; authoritative
   tone with no URL.

## Claims table (required in the findings file)

Each material claim:

| field | requirement |
|---|---|
| claim | one falsifiable sentence |
| status | `supported` / `contested` / `unverified` / `refuted` |
| sources | `{url or file:line, owner, retrieved, quote_or_locator}` |
| confidence | high / med / low (primary + direct quote → high) |
| notes | version / date sensitivity |

Repo facts use `file:line`. Web facts use URL + section. Missing source → delete
or mark `unverified`.

## Stop / degrade

**Stop when:** success criteria met and decision claims are `supported` or
explicitly `unverified`; explore budget exhausted with no new primary; two
independent primaries agree (one official source is enough for a small named
fact); user interrupts or narrows the question.

**Do not stop when:** only tertiary sources; one empty search (explore must try
≥3 strategies); “one more round might help” with no new hypothesis.

| failure | degrade |
|---|---|
| no web / tool errors | `blocked`; repo evidence only; do not fabricate |
| explore empty/shallow | one retry on a new query axis; still empty → undetermined + strategies tried |
| only secondary | conclusion `provisional`; list missing primaries |
| native search available and question shrank | cancel further explore; finish in main |
| user wants a fast answer | one explore or native; skip full Claims table but mark `depth=shallow` |
| arXiv URL | must `arxiv_fetch`; on failure say so — do not fake it with ordinary fetch |

## Findings file shape

```markdown
# Research: <title>
- date, question, budget used, depth=full|shallow
## Verdict
(≤15 lines)
## Claims
| claim | status | sources | confidence |
## Adopt / Reject
(for design tasks; otherwise omit)
## Evidence index
(merge explore rows + URLs)
## What was not checked
## Explore runs
agentId + `.pi/findings/<agentId>.md`
## Start here for implementer
```

## Out of scope

Do not implement the researched change in the same turn unless the user
explicitly asked to implement after research. Do not open Magentic-One-style
browser/coder teams. Do not depend on LangGraph, Codex background Skill tools,
or wayfinder tickets.
