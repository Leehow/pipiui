---
id: retrieval
name: 代码检索哲学
summary: 点得出 token 就精确搜，只描述得出就交给加权检索；先读 ref 再取正文；陌生仓库先要地图。
order: 21
requires: []
requires-capabilities: [code_search]
scope: [main, explore, plan, general-purpose, reviewer]
---
# Finding code

Locating code is not one question, and the tool that answers one kind returns noise for the
other. Decide which kind you are holding before you search.

**You can name the string.** A symbol, an error message, a config key, an import path —
something that appears literally in the file you want. Match it literally: `grep` and `find`
are exact, complete and instant, and reaching past them for something cleverer is the same
mistake as running a heavy workflow on a one-line fix.

**You can describe it in several words but cannot name the one token.** *Where the login
state gets invalidated. What handles retry on a 429. Which layer owns the merge.* A literal
matcher needs you to guess the exact word the author chose, and one wrong guess returns
nothing while one broad guess returns the whole repository. {{code_search}} weighs your terms
against each other inside symbol boundaries and hands back ranked spans, so the sentence you
can already say does the work the guess was doing.

Be exact about what that is and is not. It ranks the words you gave it; it does not read your
mind, and this build carries no semantic index. If the answer is written in vocabulary you did
not use, it comes back empty — and that emptiness is worth more than a miss, because it tells
you your words are wrong rather than that the code is absent. Change vocabulary, not tool.

The drift runs one way only: taking a describable question to the exact matcher, then
compensating with a dozen greps. Your own second keyword is the tell — if the first pattern
missed and you are reaching for a synonym, you are hand-rolling the weighing that one
{{code_search}} call does properly. Hand it the sentence instead of guessing again.

**Relationships are their own question**: where a symbol is defined, who calls it, what
implements it. Text search flattens the definition, every call, and every mention in a comment
into one undifferentiated list; {{code_nav}} keeps them apart because it walks the symbol
graph rather than the characters.

## Refs before bodies

Retrieval hands back compressed references, not code — a ranked list that costs almost nothing
to read. Judge from the list which spans deserve context, then pull those with {{read_spans}}.
That order is the entire economy of it: one line to reject a candidate, full text only for what
survived.

Opening whole files after a search that already named the lines pays for the same content
twice, and re-fetching a span this session already showed you pays a third time.

## A repository you cannot navigate gets a map, not a guess

When you cannot yet name the files a change touches, {{repo_map}} is the cheapest possible
first move: a token-budgeted view of signatures, imports and call edges across the tree.
Walking directories and opening files to discover what they are is that same map assembled by
hand, at full price — and it is what makes recon expensive enough that it has to be delegated
in the first place.

## A note about the route is not a verdict on the answer

These tools narrate what they did, and the two kinds of narration mean different things.
*"Ranked by term match, not by meaning"* describes how an answer was produced — it is not a
warning that the answer is wrong. A real degradation is stated separately and in its own
words: the index is down, the symbol layer is vacant, nothing matched at all. Reading the
first as the second is how a correct set of spans gets thrown away and re-derived by hand.

They also fall back on their own — to text search when the index is not up, to a plain report
when the symbol layer is vacant. So a degraded answer is still the answer you would have
gotten anyway, and trying costs nothing over the search you were about to run regardless.
"The index might not be ready" is never a reason to skip the call; the call is how you find
out.
