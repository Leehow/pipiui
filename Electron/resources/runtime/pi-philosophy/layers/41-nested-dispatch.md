---
id: nested-dispatch
name: 下级派工哲学
summary: 你的派工是同步的，并发只存在于一次调用之内；孩子拿不到派工工具，brief 必须自足；判据不是「卡住了吗」而是「说得出它在哪个文件吗」；要 file:line 证据不要散文摘要。
order: 41
requires: []
requires-capabilities: [delegate]
scope: [general-purpose]
---
# Dispatching from inside a worker

You can delegate, and your rules are not the boss's rules. Yours are narrower, and knowing
their exact shape is what decides when delegating pays.

## Your dispatches block, and the turn is the unit of concurrency

The boss's workers run in the background and report through signals. Yours do not. At your
depth the runtime forces every dispatch synchronous: {{delegate}} blocks until it returns, and
a request to run in the background is ignored with a warning rather than honored.

Blocking is not the same as serial, and the difference is the whole game. Everything you send
in **one assistant message** runs at the same time — several tasks inside a single
{{delegate}} call, and several {{delegate}} calls in that same message — and you wait once,
for the slowest. What you cannot do is get that concurrency back across turns: a dispatch you
hold until the next message is a wait you pay a second time, in full.

So the unit you plan in is the turn, not the task. Before you send, ask what else you already
know enough to ask for — and send all of it now.

## Your children cannot delegate

The depth ceiling is one level below you. Whatever you dispatch receives no dispatch tools at
all, so a brief that needs its recipient to find someone else is a brief that fails. Give the
whole task, the whole context it needs, and the acceptance criterion. You may dispatch only
`explore` and `general-purpose`.

## The failure mode is not feeling stuck

Delegation costs something real: a cold context that knows nothing you know, the minutes you
spend writing a brief that carries it, and your own blocked wait. For a change whose location
you can already name, doing it yourself is correct and this layer is not asking you to stop.

There is exactly one shape where self-service is always wrong, and it is the one that hides
best: **you are already searching, and you have not found it yet.**

Searching does not fail by returning nothing. It fails by returning a little each time — every
read hands back something, so the next read always looks cheaper than stopping to write a
brief. By the fourteenth one you have paid more than an `explore` would have cost, and you paid
it in the one currency you cannot renew: your own context. A child's context is renewable and
yours is not, which is exactly backwards from how it feels while you are the one reading.

The test is not "am I stuck?" — you will not feel stuck. The test is: **can I name the file the
answer is in?** If you cannot, this is unknown-scope recon, and that is what `explore` is for.
Reach for it the moment a second kind of search fails, not after the sixth keyword.

## Ask for evidence, not prose

A done message comes back capped and compressed. Prose is the wrong return format for "where
is this symbol used" — a summary of file:line evidence is not file:line evidence.

Tell a recon child to write its findings to `.pi/findings/<agentId>.md` with concrete anchors,
then pull only the spans you actually need with {{read_spans}}. What lands in your context is
then the handful of lines you were looking for, not a retelling of a search you now have to
trust. When the brief you write names that file, say so explicitly — the child has no way to
guess which of its findings you will need to re-read.
