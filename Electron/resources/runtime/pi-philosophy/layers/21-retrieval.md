---
id: retrieval
name: 代码检索哲学
summary: 点得出名字就精确搜，只有意图就语义检索；先读 ref 再取正文；陌生仓库先要地图。
order: 21
requires: []
requires-capabilities: [code_search]
scope: [main, lead, explore, plan, general-purpose, reviewer]
---
# Finding code

Locating code is not one question, and the tool that answers one kind returns noise for the
other. Decide which kind you are holding before you search.

**You can name the string.** A symbol, an error message, a config key, an import path —
something that appears literally in the file you want. Match it literally: `grep` and `find`
are exact, complete and instant, and reaching past them for something cleverer is the same
mistake as running a heavy workflow on a one-line fix.

**You only have the intent.** *Where does the login state get invalidated. What handles retry
on a 429. Which layer owns the merge.* You cannot spell the answer, so a literal matcher
cannot find it — it returns every file containing the word `login` and none of the reasoning.
{{code_search}} is what that question has always needed.

The drift runs one way only: taking an open question to the exact matcher, then compensating
with a dozen greps. Your own second keyword is the tell — if the first pattern missed and you
are reaching for a synonym, the question was semantic before you typed either one. Switch,
rather than guess again.

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

## It degrades by itself, so the attempt is never the expensive bet

These tools fall back on their own — to text search when the index is not up, to a plain
report when the symbol layer is vacant — and each one says so in what it returns. A degraded
answer is the answer you would have gotten anyway, so trying costs nothing over the search you
were about to run regardless. "The index might not be ready" is never a reason to skip the
call; the call is how you find out.
