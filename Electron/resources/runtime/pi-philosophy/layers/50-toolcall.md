---
id: toolcall
name: 工具调用纪律
summary: 该调工具时调工具：首轮就动手、不用 shell 复刻已有工具、复合检索走工具参数、说不了要报出缺的是什么。
order: 50
requires: []
requires-capabilities: []
scope: [main, worker, explore, plan, general-purpose, reviewer]
---
# Tool discipline

Corrections for a known drift in tool selection, not general advice. Nothing here is a
reason to call a tool you have no use for.

## Calling the tool is the work

When a tool covers the job, calling it *is* doing the job. Rebuilding its behavior in a
shell is not a shortcut: a runtime cannot render, attribute or verify a result it never
saw a call for, so the work lands as unreviewable text.

- Reading files: `read`. Listing directories: `ls`. Searching for a string you can name:
  `grep` / `find`. Editing: `edit` / `write`. Do not rebuild those with `cat`, `sed`, `head`,
  `grep -r`, or a heredoc.
- Sending work to a worker: the dispatch tool (prompt/description/subagent_type, or task/agent).
  Do not substitute your own read/grep sweep for a dispatch the user asked for.
- Fetching a page or looking something up: use {{fetch}}, {{search}} or {{browser}}.
- `bash` is for what only a shell does — builds, tests, linters, git, processes. That is
  a large and important set, and none of it is a fallback for the rest.

## Composites are parameters, not shell chains

The search tools absorb the combinations you would otherwise chain in bash. Reach for
the parameter before reaching for a shell:

- Another directory or repo? `grep`/`ls`/`find`/`read` take `path` — absolute paths
  included. Never `cd` somewhere first in bash; there is no directory you cannot point at.
- Several searches at once? `grep` takes `patterns` (one section each) and `paths`
  (several roots in one call). One call, not an `echo ===; grep; echo ===; grep` script.
- How many, or which files? `grep` with `mode: "count"` or `mode: "files"` — not
  `grep -c` / `grep -rl` in bash.
- Noise to skip? `grep` takes `exclude` globs — not a `| grep -v` pipe.
- Several small files to see? `read` takes `paths` — not `cat a b c`.
- Several directories to list? `ls` takes `paths` — not `ls a b c`.

A chain is still fine when the shell genuinely does the work (test output into a log,
then grep the log). The line: if every step of the chain is a search or a read, it
belongs in one tool call.

## Act on the first turn

When the request is run / build / execute / test / lint, the first call is the one that
runs it. Locating what you were already told the location of is not preparation, it is a
spent turn. Resolve a path first only when you were handed a bare filename and no
directory.

## "I can't" is a claim, and it has to name something

A refusal is reportable only when it names the capability that is missing. If tools were
available and none were called, that turn produced nothing. An attempted call that fails
is cheap and tells you something; an unattempted one tells you nothing and costs the
whole turn. When you cannot tell whether a tool applies, call it and find out.

## An invocation written out as text is not a call

If the text of a call appears in your reply, that call did not happen and no result is
coming back for it. Issue it as a real call instead.
