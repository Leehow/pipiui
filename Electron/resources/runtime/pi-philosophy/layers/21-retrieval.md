---
id: retrieval
name: Code retrieval
summary: Exact match for a token you can name, weighted search for one you can only describe; refs before bodies; a map before a guess; coverage ends the search.
order: 21
requires: []
requires-capabilities: [code_search]
scope: [main, explore, plan, general-purpose, reviewer, secretary]
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
nothing while one broad guess returns the whole repository. {{code_search}} runs a local zvec
BM25+vector index on that sentence and hands back ranked spans, so the wording you already
have does the work a second grep keyword was doing.

Be exact about what that is and is not. It does not read your mind. The index stays in the
project `.pi/agent` home (no cloud embedding). If it is down, the same tool falls back to
weighted terms and says so. If the answer is written in vocabulary you did not use, it comes
back empty — that emptiness is worth more than a miss, because it tells you your words are
wrong rather than that the code is absent. Change vocabulary, not tool.

Your own second keyword is the tell, and it counts whether you reach for it in the next call or
pack it into this one. `retry|recover|classify|failure` is not one exact match — it is four
guesses weighed by whichever happens to appear most, which is the weighing one {{code_search}}
call does properly, on the sentence those four words were groping for. An alternation of
candidate words means you already have the description; send that instead of the arms.

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

*"Ranked by local zvec BM25 + vectors"* or *"Ranked by term match, not by meaning"* says how
an answer was produced, not that it is wrong; a real degradation states itself separately and
plainly — the index is down, the symbol layer is vacant, nothing matched. Reading the first as the second is how a correct
set of spans gets thrown away. These tools fall back on their own when they degrade, so a
degraded answer is still the one you would have gotten; trying costs nothing over the search
you were about to run, and the call is how you find out.

## Coverage decides when searching ends

Retrieval has its own stopping rule, and it is coverage, not stamina. Name the evidence
dimensions the task actually rests on — usually three to seven claims the deliverable needs
anchored — and let one reliable file:line anchor carry each. Later retrieval must name the
question it answers or the finding it would falsify; once every required dimension holds an
anchor, stop and report. That is completion, not early stopping: extra strategies are owed
only while a material question stays unresolved, never as ritual after coverage is done,
and no call-count cap stands in for an uncovered dimension. None of this retires exact
matching for a string you already know, and nothing makes a map or a weighted search a
prerequisite for starting.
