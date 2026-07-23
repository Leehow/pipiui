# Session Message Queue (Follow-up While Agent Busy) — Design

Date: 2026-07-23  
Status: Approved  
Scope: Composer submit while streaming → local session queue → drain on idle; bulk restore; abort-and-send-first intercept

## Problem

When the agent is working, PipiUI either steers mid-run (`streamingBehavior: "steer"`) or gives no visible queue. Users want messages typed during a run to **wait until the current task finishes**, then continue in order — with the ability to **pull queued text back to edit**, and to **intercept** by aborting the current run and immediately sending the first queued item.

pi RPC supports `follow_up` / `steer` and emits `queue_update`, but **does not expose `clear_queue`**. Edit / withdraw / abort-then-resend therefore cannot be implemented solely on pi’s internal queues.

## Goals

1. While streaming, Enter **enqueues** a follow-up message on a **per-session local queue** (does not steer).
2. When the agent becomes fully idle, automatically **drain the next queued message** as a normal `prompt`.
3. Show a compact queue strip (count + summary) with **撤回编辑** (restore all queued text to the composer), matching pi TUI’s Alt+Up bulk restore semantics.
4. **阻截**: Stop button aborts the current run, then when idle **immediately sends the first queued message**; remaining items stay queued.
5. Queue items support the same image attachments path as a normal send.

## Non-goals (this iteration)

- Per-item edit, delete, or reorder UI
- Dual-mode steer vs follow-up shortcuts (Enter stays follow-up only)
- Persisting the queue across app restart / process crash
- Adding `clear_queue` to upstream pi RPC
- Changing Bash/tool abort cards or subagent interrupt UX

## Decisions (from product)

| Topic | Choice |
|---|---|
| Default delivery while busy | **followUp** (after full agent settle), not steer |
| Edit / withdraw granularity | **Bulk only** (align pi TUI), not per-item |
| Stop / 阻截 | **Abort → wait idle → send queue head**; rest remain queued |
| Queue ownership | **Client-side** in `ChatSession` (not pi `follow_up`) |

## Approach

**Pure client-side session queue + idle drain** (recommended over native `follow_up` mirror).

```
User Enter while isStreaming
        │
        ▼
  append QueuedMessage  ──UI strip──► 撤回 → restore all to draft, clear queue
        │
        │  agent_settled / idle
        ▼
  sendPrompt(head) as normal prompt
        │
        ▼
  if more queued and still/again streaming → wait again
  if idle and more queued → continue drain one-by-one
```

**Intercept path:**

```
Stop (queue non-empty)
  → abort()
  → flag interceptPending = true
  → on idle: pop first QueuedMessage → sendPrompt(...)
  → leave remainder queued
```

Stop with empty queue: `abort()` only (current behavior).

## Why not pi `follow_up`?

- Display-only via `queue_update` is easy, but **withdraw / intercept require clearing or rewriting** pi’s queue.
- RPC has `follow_up` / `steer` / `abort` and **no** `clear_queue` / dequeue command (SDK has `clearQueue()` for TUI only).
- Client queue gives identical user-visible follow-up timing if we drain on **session settle**, without upstream changes.

## Data model

```swift
struct QueuedMessage: Identifiable, Equatable {
    let id: UUID
    var text: String          // already path-annotated if images were saved at enqueue time
    var images: [DraftImage]  // may be empty; kept for RPC images payload
}
```

Held on `ChatSession` as `@Published var messageQueue: [QueuedMessage] = []`.

Enqueue-time responsibilities (same as today’s `sendPrompt` prep):

- Trim text; allow images-only
- Save images under `.pi/attachments` and rewrite message with attachment paths **at enqueue** (stable paths even if user later clears composer)
- Store both rewritten `text` and original `DraftImage`s for RPC `images`

Internal flags (not necessarily published):

- `drainAfterIdle: Bool` — set whenever queue non-empty; cleared when queue empty and nothing in flight from drain
- `interceptSendFirst: Bool` — set by stop-with-queue; on next idle, send head instead of only waiting

## Idle / drain rules

**Idle signal (prefer strongest available):**

1. Handle pi event `agent_settled` when present (session-level: no retry/compaction/queued continuation inside pi).
2. Also react to `isStreaming` flipping to `false` via existing state/events, with a short coalescing delay (e.g. existing 0.05s pattern or ~50–100ms) to avoid draining between tool rounds that briefly clear streaming.

**Drain algorithm (main thread):**

```
onIdle():
  guard processAlive
  guard !isStreaming
  guard !messageQueue.isEmpty
  if interceptSendFirst || drainAfterIdle:
    interceptSendFirst = false
    let next = messageQueue.removeFirst()
    sendPromptNow(next)  // never re-enter local queue; always direct prompt
  // If send starts streaming again, remaining items wait for next idle
```

**Invariants:**

- While `isStreaming`, user submit **only** enqueues (never `steer`).
- `sendPromptNow` is the sole path that emits RPC `prompt` without `streamingBehavior`.
- Only one drain send per idle edge; no parallel prompts.
- If `sendPromptNow` fails (`success != true`), surface `lastError` and **do not** silently drop the message — re-insert at front of queue (or keep a `failedHead` retry); user can 撤回 or retry by stop/idle again.

**Session lifecycle:**

- Switching away from a session does **not** clear its queue (queue lives on that `ChatSession` instance).
- `shutdown` / process death: leave queue in memory; if process dead, disable send and show existing “进程已退出”; queue remains visible for 撤回 into draft if UI still up.
- New session: empty queue.

## UI

### InputBar

Placeholder while streaming:

- Before: `输入将作为 steer 消息插入…`
- After: `输入将排队，完成后发送…`

Queue strip (above attachment strip / field, only if `messageQueue` non-empty):

```
┌──────────────────────────────────────────────────────────┐
│ 排队 N 条 · 「first line preview…」     [撤回编辑]         │
└──────────────────────────────────────────────────────────┘
```

- Preview: first item’s text, single line, truncated.
- **撤回编辑**: concatenate all queued texts with blank line separators (pi TUI bulk restore); merge all images into `draftImages` (append); clear `messageQueue`; clear intercept flag.
- If composer already has draft text, **prepend or append?** → **Append after existing draft** with a blank line if draft non-empty (do not wipe unsents). Images: append.

Stop button:

- Always available while streaming (unchanged).
- Help / tooltip:
  - queue empty: `中止当前回复`
  - queue non-empty: `中止并发送队首`

Optional subtle status caption when queue non-empty and streaming: `生成中 · N 条排队` (can replace bare `生成中…`).

### Chat transcript

- Do **not** add fake user bubbles for queued items until actually sent (pi will emit the real user message on prompt).
- Avoid double-echo: keep current behavior of relying on RPC events for transcript append.

## RPC / ChatSession API surface

| Method | Behavior |
|---|---|
| `sendPrompt(_:images:)` | If `isStreaming` → enqueue; else → `sendPromptNow` |
| `sendPromptNow` (private) | Build RPC `prompt` **without** `streamingBehavior` |
| `abort()` | Existing abort send; if queue non-empty set `interceptSendFirst = true` |
| `restoreQueueToDraft() -> (text:String, images:[DraftImage])` | Clear queue + flags; return bulk restore payload for InputBar |
| `handleAgentSettled` / idle hook | Run drain algorithm |

Remove automatic `streamingBehavior: "steer"` from the busy path.

Optionally still listen to `queue_update` for debugging only — **not** required for v1 UI.

## Edge cases

| Case | Behavior |
|---|---|
| Empty text + no images | Ignore (no enqueue) |
| Enqueue during intercept wait (after abort, before idle) | Allowed; append to queue; idle still sends **old** head first unless user 撤回 |
| Abort with empty queue | Abort only; no send |
| Abort with queue, then 撤回 before idle | Clear queue + clear `interceptSendFirst`; idle no-ops |
| Multiple rapid Enter while busy | FIFO multiple items |
| Model still streaming after drain send | Remaining wait for next settle |
| Compaction / retry mid-run | Wait for true idle (`agent_settled` preferred); do not drain on transient gaps if still not settled |
| Extension slash commands while busy | Out of scope; treat as normal text enqueue (same as typing). Future: execute immediately like pi |

## Testing

1. **Unit-ish / SelfTest**: enqueue while `isStreaming==true` does not emit steer; queue count increments; restore concatenates with blank lines; intercept flag + idle pops head only.
2. **Manual**: start long agent run → type two follow-ups → see strip N=2 → wait for finish → both send in order.
3. **Manual intercept**: queue two messages → stop → first sends after abort settles → second remains until that run finishes.
4. **Manual withdraw**: queue two → 撤回 → both texts in field, queue empty, agent continues.
5. **Images**: queue image-only follow-up → after idle, bubble + RPC images present.

## Files likely touched

- `Sources/PipiUI/ChatSession.swift` — queue state, send branching, idle drain, abort intercept
- `Sources/PipiUI/Views/InputBar.swift` — placeholder, queue strip, restore wiring, stop help
- `Sources/PipiUI/SelfTest.swift` — queue helpers if testable without live pi
- `README.md` — replace steer wording with queue / withdraw / intercept

## Success criteria

- Busy Enter never steers; messages appear in session queue and send after settle in order.
- 撤回编辑 restores all queued content to composer and clears queue.
- Stop with non-empty queue aborts and sends queue head on idle; remainder stays queued.
- Stop with empty queue only aborts.
- No regression to idle send, images, model/thinking menus.
