# Session activity ownership

## Problem

Automatic subagent signals (`[subagent-stalled]`, heartbeat, done, interrupted reminder) are implemented as Pi follow-up user messages. Pi's `abort` does not clear that queue. Stop only armed the quiet gate when the panel still had a running worker. Digest / continuing waits hid the Stop control.

Result: a user abort is followed by a stale signal starting another Boss turn, and the Stop button is gone.

## Contract

The host owns session activity. The extension and UI project it.

| State | Who opened it | Composer |
|---|---|---|
| `idle` | nobody | can send |
| `user-turn` | a real user message | busy + Stop |
| `digesting` | one admitted runtime signal | busy + Stop |
| `quiet` | user pressed Stop | can send; auto signals held/dropped |

Admission (re-checked at the moment of send, never earlier):

- Heartbeat / stall / vanished: send only if that worker is still running.
- Done: send only if this completion is not yet observed.
- Reminder: send only if the episode is still unresolved.
- While `user-turn`, `digesting`, or `quiet`: hold in the extension. Do not call `sendUserMessage` / `triggerTurn`.
- On return to `idle`: drop stale held signals, then send at most one.
- On `quiet`: drop watchdog signals; hold done receipts until the next real user message.

Stop always sends `/subagent_abort_all` (even if no worker is running) so quiet is armed. The waiting placeholder always shows Stop for any main-turn wait, including `followup` and `continuing`.

## Non-goals

Signals do not become a side channel that never starts a turn. A valid done receipt may open one `digesting` turn while idle and not quiet — that is orchestration, not a leak.
