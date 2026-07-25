# Message Actions (Copy / Edit-Resend / Branch) — Design

Date: 2026-07-24  
Status: Approved  
Scope: Hover action bars on user/assistant messages; copy; edit-and-resend; branch to new sidebar session

## Problem

PipiUI transcript rows have almost no message-level actions. Users can only select text or use `/copy` (last assistant text). There is no Cursor-style **edit user message and resend** (truncate subsequent turns) and no **branch from an assistant reply into a new session**.

pi already stores sessions as an append-only tree and exposes RPC `fork` / `clone` / `switch_session` / `get_entries` / `get_fork_messages`. PipiUI does not use these yet; `ChatItem` ids are local `item-N` only.

## Goals

1. **User messages:** hover actions → **Copy** + **Edit** (inline edit → send truncates subsequent turns in the current tab).
2. **Assistant messages:** hover actions → **Copy** (visible markdown body only) + **Branch** (new sidebar session with history through that reply; original session unchanged).
3. Actions appear on **hover** below the message (Cursor-style), not always-visible and not context-menu-primary.
4. Wire edit/branch through **pi session fork/clone**, not hand-truncated JSONL.

## Non-goals (v1)

- In-file `/tree` navigation UI (RPC has no `navigate_tree` command)
- Regenerate assistant reply
- Copy thinking / tool cards / full export-style dump
- Context menu as primary affordance
- Editing image attachments in the edit UI (text only; images remain via forked history)
- Changing `/copy` slash-command semantics (still “last assistant text”)

## Decisions (from product)

| Topic | Choice |
|---|---|
| User “撤回修改” | **Edit and resend** in place (truncate after), not withdraw-only |
| Branch target | **New sidebar session**; original session untouched |
| Assistant copy payload | **Visible markdown text only** (no thinking / tools) |
| Affordance | **Hover action bar** under the message |
| Edit UI | **Inline** on the user bubble (Cancel / Send) |
| Session engine | **pi `fork` / `clone` / `switch_session`**, not local JSONL surgery |

## Approach

**Hover bars + pi fork/clone orchestration** (recommended over truncating `.jsonl` or making every edit a user-visible new tab).

Constraint: pi RPC exposes `fork` (from a **user** `entryId`, position `before`) and `clone` (fork current leaf with position `at`). There is **no** top-level `navigate_tree` RPC. `fork` / `clone` **rebind the current pi process** to the new session file. Branch-without-leaving therefore requires `switch_session` back to the original path after capturing the new file path.

## Architecture

```
MessageRow / AssistantSegmentsView
  └─ MessageActionBar (hover)
       ├─ Copy  → NSPasteboard (local text extract)
       ├─ Edit  → inline editor → ChatSession.editAndResend
       └─ Branch → ChatSession.branchFromAssistant → AppStore.openBranchedSession
```

### Entry ids

- Add optional `entryId: String?` on `ChatItem` (pi session entry id).
- Populate from `get_entries` correlation on initial load and from live events when available.
- Edit / Branch require a non-nil `entryId`. Optimistic / unbound bubbles: show Copy only.

### User — Copy

- Join adjacent `.text` blocks (same merge rules as display).
- Put plain string on `NSPasteboard`.
- Images not included as clipboard files in v1.

### User — Edit and resend (current tab)

1. Hover → Edit → bubble becomes editable; bar hidden; **Cancel** / **Send**.
2. Prefill original plain text. Images: text-only edit; prior images stay in forked history.
3. **Cancel:** restore display; no RPC.
4. **Send:**
   - If text unchanged **and** message is already the leaf (nothing after): no-op, exit edit.
   - Else: `fork(entryId)` → process switches to new session (history ends **before** that user message) → update this tab’s `sessionFile` / AppStore mapping → `prompt(editedText)` (images: none in v1 edit send unless we later re-attach).
5. Previous `.jsonl` remains on disk and in the project session list (recoverable). Current tab continues on the forked file.

### Assistant — Copy

- Visible markdown text for that assistant run only (coalesced text segments).
- Exclude thinking, tool cards, images/videos.

### Assistant — Branch (new sidebar session)

1. Remember `oldPath = sessionFile`.
2. Resolve target:
   - If the assistant entry (or end of that run) is the current leaf → `clone`.
   - Else → find the next **user** message on the active branch after that point → `fork(thatUserEntryId)` so the new leaf is the parent of that user (history includes the chosen assistant turn).
3. Read `newPath` from `get_state` / sessionFile after rebind.
4. `switch_session(oldPath)` so the current tab stays on the original session; reload transcript if needed.
5. `AppStore.openBranchedSession(path: newPath, project:)` → new open session key, select it, set name like `分支 · <original or time>` (truncate if long).

### Busy / streaming

| Action | While streaming / agent busy |
|---|---|
| Copy | Allowed |
| Edit / Branch | Disabled |

Also hide Edit / Branch for system / `[subagent-done]` bubbles.

### Errors

- fork / clone / switch failure → flash/toast; leave transcript unchanged; exit edit mode if open.
- Session not yet persisted → flash “稍后再试” (aligns with pi: fork/clone need a saved session file).

## UI

- Bar below message: user trailing-aligned, assistant leading-aligned.
- Compact icon buttons + tooltips: Copy, Edit (user), Branch (assistant).
- Material/opacity consistent with existing chrome (InputBar strips, menus); no heavy cards.
- Edit mode: multiline field in bubble; Cancel + Send; Escape → Cancel.

## File map

| File | Change |
|---|---|
| `Sources/PipiUI/ChatSession.swift` | `entryId`; entry alignment; `copyMessageText` / `editAndResend` / `branchFromAssistant`; edit-mode published state |
| `Sources/PipiUI/AppStore.swift` | `openBranchedSession`; rebind sessionFile after edit-fork |
| `Sources/PipiUI/Views/MessageViews.swift` | Hover bar + inline editor wiring on `MessageRow` / assistant runs |
| `Sources/PipiUI/Views/ChatDetailView.swift` | Pass callbacks / edit binding into transcript rows |
| `Sources/PipiUI/Views/MessageActionBar.swift` (optional) | Shared hover action bar |
| `Tests/PipiUITests/MessageActionsTests.swift` | Text extract, entryId gating, busy disable helpers; orchestration with fixtures/fakes where practical |

## Testing

**Unit**

- Assistant/user plain-text extract matches copy rules (no thinking/tools).
- Missing `entryId` → edit/branch unavailable.
- Busy flag → edit/branch disabled, copy enabled.

**Manual**

1. Hover user → Copy → clipboard correct.
2. Edit a mid-thread user message → Send → current chat truncates and continues; old session still in sidebar.
3. Hover assistant → Copy → body only.
4. Branch → new sidebar session has history through that reply; original unchanged.
5. During stream, Edit/Branch disabled; Copy works.
6. Forced RPC failure → error flash; transcript intact.

## Out of scope reminders

- Do not invent local tree UI or depend on undocumented `navigate_tree` RPC.
- Do not change queue “撤回编辑” (composer queue) — different feature.
- Git branch menu remains VCS-only, unrelated to chat branch.
