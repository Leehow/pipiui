# Phase B Report — Slash Commands Integration (Task 5–6)

**Status:** PASS  
**Date:** 2025-07-23  
**Scope:** ChatSession host + send routing; AppStore lifecycle injection. No InputBar / SlashPalette (Phase C).

---

## Summary

Integrated Phase A slash-command logic into the live session layer:

1. `ChatSession` conforms to `BuiltinCommandHost`, loads `get_commands` into `availableCommands`, routes builtins in `sendPrompt` before queue/prompt, and flashes via `lastError`.
2. `AppStore.makeSession` injects `onRequestNewSession` / `onRequestClose` with `[weak self]` so `/new` and `/quit` reach store APIs.

---

## Files Changed

| File | Change |
|------|--------|
| `Sources/PipiUI/ChatSession.swift` | Task 5: properties, flash, get_commands, sendPrompt gate, BuiltinCommandHost extension, `import AppKit` |
| `Sources/PipiUI/AppStore.swift` | Task 6: wire `onRequestNewSession` / `onRequestClose` in `makeSession` |
| `.superpowers/sdd/slash-commands/phase-B-diff.txt` | Change inventory + symbol index |
| `.superpowers/sdd/slash-commands/task-5-diff.txt` | Task 5 snapshot |
| `.superpowers/sdd/slash-commands/task-6-diff.txt` | Task 6 snapshot |
| `.superpowers/sdd/slash-commands/ChatSession.after-t5.swift` | Full ChatSession copy after Task 5 |
| `.superpowers/sdd/slash-commands/phase-B-report.md` | This report |

**Not touched:** InputBar, SlashPalette, App.swift, J.swift, SlashCommand.swift, tests (no new ChatSession routing unit test — see below).

---

## New / Conformed API on `ChatSession`

### Properties

```swift
@Published var availableCommands: [SlashCommand] = []
var onRequestNewSession: (() -> Void)?
var onRequestClose: (() -> Void)?
```

### Host surface

```swift
func flash(_ message: String)                    // lastError = message
func runCompact()
func runSetSessionName(_ name: String)           // → setSessionName
func runShowSessionStats()                       // get_session_stats + get_state → flash multi-line snapshot
func runExportHTML()                             // export_html RPC; Finder reveal on success
func runCopyLastAssistant()                      // last assistant .text blocks → NSPasteboard
func runSetModel(providerSlashId: String)        // parse provider/model → setModel(known|synthetic)
```

Conformance: `extension ChatSession: BuiltinCommandHost` (same file; uses private `proc` / `applyState`).

### loadInitialState

After `refreshStats()`:

```swift
proc?.request(["type": "get_commands"]) { [weak self] resp in
    guard let self else { return }
    self.availableCommands = SlashCommandParser.parseGetCommandsResponse(resp)
}
```

- Callbacks already main-thread (`PiProcess` contract).
- Failure / empty → `[]`; **no** flash.

---

## sendPrompt Builtin Gate

Placement: **after** media-mode early return, **before** `prepareMessage` / queue / `sendPromptNow`.

```swift
if images.isEmpty,
   let inv = BuiltinCommands.parseInvocation(trimmed),
   BuiltinCommands.execute(name: inv.name, args: inv.args, host: self) {
    draftText = ""
    draftImages = []
    return
}
```

Behavior:

| Input | Result |
|-------|--------|
| Builtin `/compact` etc., no images | execute immediately; clear draft; **no** enqueue / prompt |
| Unknown `/xxx` | `execute` → false → normal prompt path (queue if busy) |
| Builtin + attached images | gate skipped (`images.isEmpty` false) → normal path |
| Media composer modes | unchanged; gate never reached |

Busy-time: builtins never hit queue; existing steer/queue path untouched for non-builtins.

---

## AppStore Injection (Task 6)

In `makeSession`, after `isSelectedCheck`:

```swift
session.onRequestNewSession = { [weak self] in
    guard let self else { return }
    self.newSession(project: project)
}
session.onRequestClose = { [weak self] in
    self?.closeSession(key: key)
}
```

- `project` / `key` captured by value from `makeSession` args.
- `[weak self]` avoids AppStore ↔ session retain cycles via closures.

---

## Deviations from Plan Code

| Item | Plan | Done | Why |
|------|------|------|-----|
| Clear draft on builtin hit | Plan snippet only `return` | Also `draftText = ""` / `draftImages = []` | Task brief required clear; InputBar already clears before send, but gate is defensive if `sendPrompt` is called directly |
| New sendPrompt routing unit test | Optional if hard | **Not added** | Requires live `ChatSession` + `PiProcess`; no harness in MiniXCTest for session/proc. Phase A 27 tests cover BuiltinCommands.execute path. Manual/Phase C acceptance for full UI path. |
| `swift test` | Plan Step 5 | Used `swift run PipiUITestRunner` | Project uses custom test runner (same as Phase A), not XCTest via `swift test` |

No other API renames or protocol changes.

---

## Verification Evidence

### `swift build` (full targets)

```text
$ swift build 2>&1
Building for debugging...
[3/9] Compiling PipiUI AppStore.swift
[4/9] Compiling PipiUI ChatSession.swift
… (pre-existing Sendable warning at mediaStatus line 515 only)
[20/24] Linking PipiUI
[21/24] Linking PipiUITestRunner
Build complete! (3.94s)
```

**Result:** green (no errors).

### `swift run PipiUITestRunner`

```text
$ swift run PipiUITestRunner 2>&1
Build of product 'PipiUITestRunner' complete! (0.14s)
Test Suite 'SlashCommandTests' started
… (all 27 cases ✔)
Test Suite 'SlashCommandTests' finished
Executed 27 tests, with 0 failures (27 passed)
```

**Result:** 27/27 pass. Phase A tests intact; no MiniXCTest registry change needed (no new tests).

---

## Self-check

- [x] `availableCommands` published; filled only from `get_commands`
- [x] get_commands failure silent
- [x] `flash` → `lastError`
- [x] All BuiltinCommandHost methods implemented per plan
- [x] Builtin gate before queue; unknown `/` still prompts
- [x] Closures injected with `[weak self]`
- [x] No InputBar / SlashPalette / App / J edits
- [x] No git commit
- [x] Build + 27 tests green with fresh command output

---

## Handoff for Phase C (InputBar / SlashPalette)

Phase C can rely on:

| Need | Source |
|------|--------|
| Server command list | `session.availableCommands` (`[SlashCommand]`) |
| Builtin list | `BuiltinCommands.all` (do not re-fetch) |
| Draft binding | `session.draftText` (existing) |
| Execute on Return / click | Prefer `session.sendPrompt(draft)` — gate already routes builtins; OR call `BuiltinCommands.execute` then clear draft if you bypass send for palette-only complete |
| Flash / errors | `session.lastError` banner (existing ChatDetailView) |
| Fuzzy filter | `SlashFuzzy` + `SlashPaletteQuery.paletteQuery(from:)` |
| New session / close | Already wired; no InputBar work needed for `/new` `/quit` if they go through `sendPrompt` |

**Suggested palette merge for display:** builtins (`BuiltinCommands.all`) ∪ `session.availableCommands`, then `SlashFuzzy.filter`.

**Do not:** re-implement host methods in the view layer; do not enqueue builtins.

---

## Manual acceptance notes (optional before Phase C)

With app running and a live pi session:

1. After load, `availableCommands` non-empty if server has extensions/skills (inspect via debugger) or stays `[]` without flash.
2. `/session` → red banner with name/model/cost/context/file.
3. `/copy` with prior assistant text → pasteboard + flash char count.
4. `/new` / `/quit` → new tab / close tab via AppStore.
5. While streaming, `/compact` still fires immediately (no queue growth).
6. `/not-a-real-cmd` goes out as normal user prompt.
