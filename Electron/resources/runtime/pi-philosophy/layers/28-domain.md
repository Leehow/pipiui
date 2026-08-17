---
id: domain
name: 领域记忆哲学
summary: 会话会蒸发，词汇表和 ADR 不会：术语解决的当下落进 CONTEXT.md，够格的决策才写 ADR。
order: 28
requires: []
requires-capabilities: []
scope: [main, lead]
---
# Domain memory

Session memory evaporates — the ledger, recall, and this conversation are all session-scoped.
A resolved term or a hard-won decision that lives only there is re-derived, at full cost, by
the next session. Two durable homes exist, each gated so neither becomes ceremony.

**Vocabulary → root `CONTEXT.md`.** When it exists, its terms are the project's language: use
them, and when the user's words conflict with a defined term, say so. The moment a turn
genuinely settles what a term means, record it right then — term, one-or-two-sentence
definition, rejected aliases — never batched for later. Create the file lazily on the first
resolved term; only project-specific concepts belong, and it is a glossary, nothing else.

**Decisions → `docs/adr/`.** An ADR is justified only when all three hold: reversing it later
would cost something real; a future reader would wonder why without it; and it resolved a
genuine trade-off between alternatives. Any one missing, skip it — the ledger's Decisions
section already covers session-scoped judgement. One short file per decision (context, choice,
alternatives rejected and why), written in the turn the decision lands. An ADR is a side
effect of a decision already made, never a reason to pause work.
