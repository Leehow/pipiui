# Phase C Report — Slash Commands UI (Task 7–8)

**Status:** DONE  
**Date:** 2025-07-23 (session)  
**Scope:** Slash palette overlay + InputBar mount + keyboard monitor  
**Commit:** none (non-git per brief)

---

## Summary

Implemented slash-command UI only:

1. **Task 7** — `SlashPalette` view; preferred **VStack-above-HStack** mount in `InputBar`; draft-driven filter/refresh; click/Tab complete; Return execute helpers.
2. **Task 8** — `ComposerSlashKeyMonitor` (local keyDown); ↑↓ / Tab / Esc / Return handling with consume-on-handle; belt-and-suspenders in `send()` against double-fire.

Ignored the plan’s fragile ZStack+offset layout entirely.

---

## Files

| Path | Action |
|---|---|
| `Sources/PipiUI/Views/SlashPalette.swift` | **Created** |
| `Sources/PipiUI/Views/InputBar.swift` | **Modified** |

**Not touched:** `ChatSession.swift`, `AppStore.swift`, `SlashCommand.swift`, tests, Package.swift (auto-discover).

Diff dump: `.superpowers/sdd/slash-commands/phase-C-diff.txt`

---

## Task 7 — SlashPalette + InputBar mount

### `SlashPalette`

- Props: `commands`, `selectedIndex`, `onSelect` (click → complete, not execute).
- `ScrollView` + `LazyVStack`; maxHeight 220; scroll-to-selected via `ScrollViewReader`.
- Row: monospaced `/name`, optional `argumentHint` (tertiary), `description` (secondary), trailing source badge (`builtin` / `ext` / `skill` / `prompt`).
- Selected row: accent fill opacity 0.14.
- Chrome: `.regularMaterial`, corner radius 10, light stroke + shadow.

### InputBar state

```swift
@State private var slashMatches: [SlashCommand] = []
@State private var slashSelectedIndex: Int = 0
@State private var slashPaletteVisible: Bool = false
@State private var slashKeyMonitor = ComposerSlashKeyMonitor()
```

### Layout (preferred only)

Outer `VStack` order:

1. queue / attachments / media strips / errors / media status (unchanged)
2. **`if slashPaletteVisible && !slashMatches.isEmpty { SlashPalette(...) }`** — immediately above composer row
3. `HStack` plus / TextField / stop / send (unchanged structure)
4. `responsiveStatus`

No ZStack offset / estimated field height.

### Helpers

| Helper | Behavior |
|---|---|
| `allSlashCommands()` | `BuiltinCommands.all + session.availableCommands` |
| `refreshSlashPalette()` | `SlashPaletteQuery.paletteQuery` → nil hides; else `SlashFuzzy.filter`; clamps `slashSelectedIndex`; updates key-monitor active |
| `completeSlash(_:)` | `draftText = "/\(name) "`; hide palette; keep focus |
| `executeSlash(_:)` | Parse args if draft name matches selected; clear draft/images; builtin → `BuiltinCommands.execute`; else → `session.sendPrompt("/name …")` |

### Wiring

- `.onChange(of: session.draftText)` → `refreshSlashPalette()`
- `.onAppear` also calls `refreshSlashPalette()` after monitors start
- Palette `onSelect` → `completeSlash` (spec: click = Tab complete)

---

## Task 8 — Keyboard monitor

### `ComposerSlashKeyMonitor`

Same lifecycle pattern as `ComposerPasteCatcher`:

- `start()` / `stop()` / `deinit { stop() }`
- `NSEvent.addLocalMonitorForEvents(matching: .keyDown)`
- Active only when `isActive == true`

| Condition | Behavior |
|---|---|
| `!isActive` | return `event` unchanged |
| ⌘ / ⌥ / ⌃ held | return `event` (don’t steal) |
| ↑ 126 | `onMove(-1)` → **nil** (consume) |
| ↓ 125 | `onMove(+1)` → **nil** |
| Esc 53 | `onEscape()` → **nil** |
| Tab 48 | `onTab()` → **nil** |
| Return 36 / keypad 76 | if `onReturn()` true → **nil**; else event |
| other keys | return `event` |

### Active flag

```swift
slashKeyMonitor.isActive = focused && slashPaletteVisible && !slashMatches.isEmpty
```

Updated from: `refreshSlashPalette`, `completeSlash`, `executeSlash`, Esc handler, `onChange(focused)`, appear.

### Double-send prevention

1. **Primary:** monitor returns `nil` on Return while palette active → TextField never gets key → `.onSubmit(send)` does not fire from that Return.
2. **Belt-and-suspenders:** top of `send()`:

```swift
if slashPaletteVisible, !slashMatches.isEmpty,
   slashMatches.indices.contains(slashSelectedIndex) {
    executeSlash(slashMatches[slashSelectedIndex])
    return
}
```

Normal typing, bare Return (no palette), ⌘↩ send shortcut, and ⌘V paste catcher remain unaffected (monitor inactive or mods non-empty / non-matching keyCodes).

---

## Verification (fresh this session)

### `swift build`

```text
Building for debugging...
[3/11] Emitting module PipiUI
[4/11] Compiling PipiUI InputBar.swift
[5/11] Compiling PipiUI SlashPalette.swift
...
[15/19] Linking PipiUI
[17/19] Linking PipiUITestRunner
Build complete! (4.55s)
```

**Result: green**

### `swift run PipiUITestRunner`

```text
Test Suite 'SlashCommandTests' started
… (27 tests) …
Test Suite 'SlashCommandTests' finished
Executed 27 tests, with 0 failures (27 passed)
```

**Result: 27/27**

---

## Manual acceptance checklist (Boss 实机)

| # | Action | Expected |
|---|---|---|
| 1 | Type `/` | Palette above field; builtins (+ server cmds if any); first row selected |
| 2 | Type `mo` | Filters toward `model` |
| 3 | ↓ / ↑ | Selection moves; clamps at ends; list scrolls to selection |
| 4 | Tab on selected | Draft → `/name `; palette closes; focus stays for args |
| 5 | Click a row | Same as Tab (complete only, **not** execute) |
| 6 | `/com` then Return | Executes selected (e.g. compact); draft clears; **no** double user bubble / double RPC |
| 7 | `/name` Return with empty args | Builtin flash 用法；**no** user prompt bubble |
| 8 | Esc with palette open | Palette closes; draft unchanged |
| 9 | Type `hello` Return | Normal send; no palette intercept |
| 10 | Unknown `/zzznotreal` (no matches) | Palette hidden; Return sends via normal `sendPrompt` path |
| 11 | While streaming, `/compact` Return | Builtin runs immediately (not queued) |
| 12 | While streaming, server/skill cmd if listed | Goes through sendPrompt queue like normal |
| 13 | ⌘V image paste with composer focused | Still works (paste catcher) |
| 14 | Normal multi-line / typing while palette closed | Keys not swallowed |

---

## Self-check

- [x] Preferred VStack-above layout only (no ZStack offset)
- [x] Click = complete; Return = execute
- [x] Return consumed when palette open (monitor nil + send() guard)
- [x] Inactive monitor passes all events
- [x] No Command/Option/Control chord stealing
- [x] Monitors started on appear, stopped on disappear
- [x] Build green; 27/27 tests
- [x] No edits outside InputBar + new SlashPalette
- [x] No commit

---

## Deviations

None material vs plan Task 7–8 preferred code.

Minor:

- Esc / complete / execute explicitly call `refreshSlashKeyMonitorActive()` so `isActive` drops immediately (plan already required this).
- `send()` palette branch runs before `canSend` (as plan Step 3 belt-and-suspenders).
