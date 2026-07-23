# Task 1 Report: Estimate helpers + SelfTest

**Status:** DONE  
**Date:** 2026-07-23  
**Commits:** none (no git repo)

## What was implemented

Pure UI-layer helper enum `ThinkingTokenEstimate` for thinking-header token estimates (chars÷4, not a real tokenizer), plus SelfTest coverage.

### API

```swift
enum ThinkingTokenEstimate {
    static func tokenCount(for text: String) -> Int
    static func formatCount(_ n: Int) -> String  // "123", "1k", "1.2k"
    static func labelSuffix(for text: String) -> String? // nil or "~1.2k tokens"
}
```

### Behavior (verbatim from brief)

- **tokenCount:** empty → 0; else `max(1, Int((Double(text.count) / 4.0).rounded()))`
- **formatCount:** `n < 1000` → decimal string; `n >= 1000` → one-decimal `k` with trailing `.0` stripped (`1k`, `1.2k`, `15.4k`)
- **labelSuffix:** empty estimate → `nil`; else `"~\(formatCount(n)) tokens"`

`ThinkingBlockView` UI was **not** modified (Task 2 scope).

## Files changed

| File | Change |
|------|--------|
| `Sources/PipiUI/Views/MessageViews.swift` | Added `ThinkingTokenEstimate` enum immediately above `struct ThinkingBlockView` |
| `Sources/PipiUI/SelfTest.swift` | Added 12 SelfTest checks for token count, format, and label suffix before final summary |

No other files touched. No PiProcess/RPC/session stats changes.

## Test commands + output

### Build

```bash
cd /Users/haoli/leehow/code/pipiui && swift build 2>&1
```

```
[0/1] Planning build
Building for debugging...
[0/4] Write sources
[1/4] Write swift-version--1AB21518FC5DEDBE.txt
[3/7] Compiling PipiUI MessageViews.swift
[4/7] Emitting module PipiUI
[5/7] Compiling PipiUI SelfTest.swift
[6/24] Compiling PipiUI WebViewStore.swift
[7/24] Compiling PipiUI SubagentPanel.swift
[8/24] Compiling PipiUI MonoArtView.swift
[9/24] Compiling PipiUI SidebarView.swift
[10/24] Compiling PipiUI BridgeServer.swift
[11/24] Compiling PipiUI ChatSession.swift
[12/24] Compiling PipiUI WebViewPanel.swift
[13/24] Compiling PipiUI App.swift
[14/24] Compiling PipiUI AppStore.swift
[15/24] Compiling PipiUI ChatDetailView.swift
[16/24] Compiling PipiUI HoverButtonStyle.swift
[17/24] Compiling PipiUI ImageAttachment.swift
[18/24] Compiling PipiUI J.swift
[19/24] Compiling PipiUI InputBar.swift
[20/24] Compiling PipiUI MarkdownView.swift
[21/24] Compiling PipiUI PiProcess.swift
[22/24] Compiling PipiUI SubagentStore.swift
[22/25] Write Objects.LinkFileList
[23/25] Linking PipiUI
[24/25] Applying PipiUI
Build complete! (2.87s)
```

### SelfTest

```bash
PIPIUI_SELF_TEST=1 swift run 2>&1
```

```
[0/1] Planning build
Building for debugging...
[0/3] Write swift-version--1AB21518FC5DEDBE.txt
Build of product 'PipiUI' complete! (0.13s)
PASS  make(from: url) succeeds
PASS  mime is image/*
PASS  preview non-empty
PASS  data non-empty
PASS  rpc payload count 1
PASS  rpc type image
PASS  rpc has base64 data
PASS  rpc has mimeType
PASS  parseImageBlock flat shape
PASS  parseImageBlock nested source shape
PASS  make(from: NSImage) succeeds
PASS  large image longest edge ≤ 2000
PASS  empty data fails
PASS  pasteboardHasImage after PNG write
PASS  imagesFromPasteboard non-empty
PASS  canSend image-only
PASS  canSend text-only
PASS  canSend empty denied
PASS  canSend dead process denied
PASS  user item has image block
PASS  user item has caption
PASS  bubble can decode NSImage
PASS  multi-image rpc payload
PASS  prompt+images JSON-serializable
PASS  serialized images count
PASS  serialized empty message allowed
PASS  saveToProjectAttachments writes file
PASS  message includes real path
PASS  message discourages fake sandbox path
PASS  strip round-trip keeps user prose
PASS  strip image-only yields empty
PASS  strip multi-path footer
PASS  multi annotated still has paths for model
PASS  strip no-footer unchanged
PASS  strip mid-message Attached intact
PASS  empty text → 0 tokens
PASS  1 char → 1 token
PASS  4 chars → 1 token
PASS  5 chars → 1 token (round 1.25→1)
PASS  6 chars → 2 tokens (round 1.5→2)
PASS  4000 chars → 1000 tokens
PASS  format 999
PASS  format 1000 → 1k
PASS  format 1200 → 1.2k
PASS  format 15400 → 15.4k
PASS  suffix empty nil
PASS  suffix sample
---
ALL PASSED
```

Exit code: **0**

All 12 new Thinking token estimate checks **PASS**.

## Self-review

- [x] Interfaces match brief exactly (`tokenCount`, `formatCount`, `labelSuffix`)
- [x] Placement: enum above `ThinkingBlockView` in `MessageViews.swift`
- [x] Estimate formula matches global constraint (empty / max(1, round(count/4)))
- [x] Format strips `.0` (`1000` → `1k`, not `1.0k`)
- [x] Label copy is `~{fmt} tokens` / `nil` for empty
- [x] SelfTest cases match brief verbatim (names + expectations)
- [x] Did **not** change `ThinkingBlockView` body, `MessageRow`, `ChatDetailView`
- [x] Did **not** touch PiProcess, RPC types, session stats
- [x] Only listed files modified
- [x] No git commit / no `git init`
- [x] Build + SelfTest green

## Concerns

None material for Task 1.

Minor notes (non-blocking):

1. **Locale:** `String(format: "%.1f", k)` uses the current locale’s decimal separator in theory; SelfTest expects `.` and CI/dev is typically en_US / C. If a user runs SelfTest under a comma-decimal locale, format checks could fail. Acceptable for this app scope; Task 2 UI can stay as-is unless localization becomes a goal.
2. **Helper lives in views file:** Matches plan; fine until a shared Utils module exists.
3. **No negative `formatCount` tests:** Out of scope; callers only pass non-negative estimates.
