# Task 2 Report: Wire queue into ChatSession send / abort / idle drain

**Status:** COMPLETE  
**Date:** 2026-03-28  
**Workspace:** `/Users/haoli/leehow/code/pipiui`

---

## Summary

Wired `SessionMessageQueue` into `ChatSession` so busy Enter enqueues follow-ups locally and drains on `agent_settled`, instead of sending pi `streamingBehavior: "steer"`. Idle send is a plain prompt RPC. Abort notes intercept then sends abort; queue head drains on next idle settle. Process death does not drain. `restoreQueueToDraft()` and `@Published messageQueue` are ready for Task 3 (InputBar).

---

## Files Changed

| File | Change |
|------|--------|
| `Sources/PipiUI/ChatSession.swift` | Queue properties, send/abort/drain/restore helpers; remove steer path; drain on `agent_settled` only |

**Not modified (per brief):** `InputBar.swift`, README, `SessionMessageQueue.swift`.

**Git:** skipped (no commit per task instructions).

---

## Implementation Details

### New / updated surface on `ChatSession`

```swift
@Published private(set) var messageQueue: [QueuedMessage] = []
private var queue = SessionMessageQueue()
private var isSendingFromQueue = false  // reserved; unused this task
```

| API | Behavior |
|-----|----------|
| `sendPrompt(_:images:)` | Prepare attachments → if `isStreaming` enqueue + `publishQueue`; else `sendPromptNow` |
| `prepareMessage(text:images:)` | Save images under project attachments; annotate message with real paths |
| `sendPromptNow(..., requeueOnFailure:)` | RPC `prompt` **without** `streamingBehavior`; on failure + requeue payload → `requeueFront` + publish |
| `publishQueue()` | `messageQueue = queue.items` |
| `restoreQueueToDraft()` | `queue.restoreAll()` + publish; returns joined text + flattened images |
| `abort()` | `queue.noteAbort()` + publish + `proc?.send(["type":"abort"])` |
| `drainQueueIfIdle()` | `popForIdleDrain(isStreaming:processAlive:)` then send head with requeue-on-failure |

### `agent_settled`

```swift
case "agent_settled":
    isStreaming = false
    streamingItem = nil
    refreshStats()
    drainQueueIfIdle()
    proc?.request(["type": "get_state"]) { ... applyState ... }
```

### Explicit non-goals / guards

- **Removed** `if isStreaming { cmd["streamingBehavior"] = "steer" }`.
- **Do not** drain from `applyState` (avoids double-drain if get_state still reports streaming).
- **Do not** drain on `onExit` / process death (`processAlive = false` → pop returns nil; queue kept for 撤回).
- Attachment paths prepared **at enqueue** time via `prepareMessage`.

---

## Verification

### Step 2: Build

```bash
cd /Users/haoli/leehow/code/pipiui && swift build
```

**Result:** `Build complete! (2.10s)` — success.

### Step 3: SelfTest

```bash
cd /Users/haoli/leehow/code/pipiui && PIPIUI_SELF_TEST=1 swift run
```

**Result:** `ALL PASSED`

Includes prior image/attachment/token tests plus Task 1 queue pure tests:

- enqueue / pop / requeue / abort intercept / restore / dead process no pop / joinTexts

---

## Behavioral checklist (spec)

| Requirement | Status |
|-------------|--------|
| Busy Enter never sets `streamingBehavior: "steer"` | Done (path removed) |
| Busy → local enqueue after prepareMessage | Done |
| Idle → direct prompt, no streamingBehavior | Done |
| `agent_settled` → isStreaming=false then drain | Done |
| abort → noteAbort then abort RPC | Done (+ publishQueue) |
| restoreQueueToDraft for InputBar (Task 3) | Done |
| Publish messageQueue for SwiftUI | Done |
| No drain from applyState | Done |
| No drain on process death | Done (onExit unchanged; pop guards processAlive) |
| send failure + requeueOnFailure → requeueFront + publish | Done |
| No InputBar / README changes | Done |

---

## Concerns / follow-ups

1. **`isSendingFromQueue` unused** — declared per brief; no callers yet. Harmless; remove or wire if a later task needs “this prompt came from drain” UI/telemetry.
2. **Race with get_state after settle** — drain runs before get_state; `applyState` may briefly set `isStreaming = true` again if state lags. Spec chooses settle-only drain; if pi ever settles without flipping local streaming cleanly, queue could stall until next settle. No test covers live pi RPC.
3. **No ChatSession integration self-tests** — queue unit tests pass; send/abort/drain paths are not exercised against a mock `PiProcess`. Manual / future self-tests recommended when wiring InputBar (Task 3).
4. **Abort + empty queue** — noteAbort is a no-op on empty queue (intercept stays false); only abort RPC fires — correct.
5. **Abort + non-empty queue** — intercept set; on settle, pop clears intercept and sends head; remainder stays queued — correct per global constraints.

---

## Ready for Task 3

Task 3 can bind InputBar to:

- `session.messageQueue` (badge / count / busy UI)
- `session.restoreQueueToDraft()` (bulk 撤回 → composer)
- Existing `session.sendPrompt` / `session.abort` (already queue-aware)

---

## Fix: isSendingFromQueue guard

**Date:** 2026-03-28  
**Problem:** After `drainQueueIfIdle` calls `sendPromptNow`, `isStreaming` stays false until pi emits `agent_start`. In that gap, user Enter took the idle path and could send a parallel prompt — violates “no parallel prompts.” `isSendingFromQueue` existed but was unused.

### What changed (`Sources/PipiUI/ChatSession.swift`)

1. **`drainQueueIfIdle`**: Before `sendPromptNow`, set `isSendingFromQueue = true`. At start, if stale `isSendingFromQueue && !isStreaming`, clear flag first (prior drain never got `agent_start`).
2. **`sendPrompt`**: Busy / enqueue branch is now `isStreaming || isSendingFromQueue` (same as streaming).
3. **Clear `isSendingFromQueue = false` on:**
   - `agent_start` (normal handoff to streaming)
   - `sendPromptNow` failure path when `requeueOnFailure` is provided (drain send failed)
   - `onExit` (process death)

No rename; flag used only as busy guard. No SelfTest added (would need ChatSession/PiProcess mock).

### Commands

```bash
cd /Users/haoli/leehow/code/pipiui && swift build
cd /Users/haoli/leehow/code/pipiui && PIPIUI_SELF_TEST=1 swift run
```

### Output

- `swift build` → `Build complete! (0.15s)`
- `PIPIUI_SELF_TEST=1 swift run` → `ALL PASSED`
