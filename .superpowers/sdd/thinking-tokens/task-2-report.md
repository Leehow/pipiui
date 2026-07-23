# Task 2 Report: ThinkingBlockView + MessageRow + ChatDetailView wiring

**Status:** DONE  
**Date:** 2026-03-23  
**Commits:** none (no git repo)

## What was implemented

UI-only wiring so thinking blocks show a chars÷4 token estimate suffix and a mini spinner while the streaming row is active.

### API / props

```swift
struct MessageRow: View, Equatable {
    // ...
    var isStreaming: Bool = false  // included in ==
}

struct ThinkingBlockView: View {
    let text: String
    var isStreaming: Bool = false
}
```

### Behavior (verbatim from brief)

- **MessageRow:** `isStreaming` defaults to `false`; compared in `Equatable`; passed into `ThinkingBlockView` for `.thinking` blocks.
- **ThinkingBlockView label:**
  - empty text → `Thinking` (+ mini `ProgressView` if streaming)
  - non-empty → `Thinking · ~{fmt} tokens` via `ThinkingTokenEstimate.labelSuffix` (+ spinner if streaming)
  - finished / non-streaming → no spinner
- **ChatDetailView:** transcript `ForEach` keeps default `isStreaming: false`; streaming row sets `isStreaming: session.isStreaming`.

Consumes Task 1 `ThinkingTokenEstimate` unchanged (no API edits).

## Files changed

| File | Change |
|------|--------|
| `Sources/PipiUI/Views/MessageViews.swift` | `MessageRow.isStreaming` + Equatable; pass through on thinking; replace `ThinkingBlockView` body with estimate + spinner |
| `Sources/PipiUI/Views/ChatDetailView.swift` | Streaming `MessageRow` gets `isStreaming: session.isStreaming` |

No other files touched. No PiProcess / RPC / get_session_stats / session-level token `@Published` changes.

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
[3/8] Compiling PipiUI MessageViews.swift
[4/8] Compiling PipiUI ChatDetailView.swift
[5/8] Emitting module PipiUI
[6/8] Compiling PipiUI SubagentPanel.swift
[7/20] Compiling PipiUI SubagentStore.swift
[8/20] Compiling PipiUI PiProcess.swift
[9/20] Compiling PipiUI MarkdownView.swift
[10/20] Compiling PipiUI BridgeServer.swift
[11/20] Compiling PipiUI ChatSession.swift
[12/20] Compiling PipiUI SidebarView.swift
[13/20] Compiling PipiUI App.swift
[14/20] Compiling PipiUI AppStore.swift
[15/20] Compiling PipiUI WebViewStore.swift
[16/20] Compiling PipiUI ImageAttachment.swift
[17/20] Compiling PipiUI InputBar.swift
[18/20] Compiling PipiUI SelfTest.swift
[18/21] Write Objects.LinkFileList
[19/21] Linking PipiUI
[20/21] Applying PipiUI
Build complete! (2.44s)
```

### SelfTest

```bash
PIPIUI_SELF_TEST=1 swift run 2>&1
```

```
Build of product 'PipiUI' complete! (0.13s)
...
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
...
---
ALL PASSED
```

Exit code 0. All existing SelfTests (including Task 1 ThinkingTokenEstimate suite) green. No new SelfTests required for pure SwiftUI wiring.

### Manual UI check

Skipped (headless / no interactive app launch in this session).

## Self-review checklist

- [x] `MessageRow.isStreaming` default `false` and in `==`
- [x] `assistantView` passes `isStreaming` into `ThinkingBlockView`
- [x] `ThinkingBlockView` shows `labelSuffix` as `· \(suffix)` (no double middle-dot inside suffix)
- [x] Mini `ProgressView` only when `isStreaming`
- [x] ChatDetailView streaming row uses `session.isStreaming`; transcript rows unchanged
- [x] Only listed files modified
- [x] Did not change `ThinkingTokenEstimate`, PiProcess, RPC, session token publishers
- [x] `swift build` success
- [x] `PIPIUI_SELF_TEST=1 swift run` → ALL PASSED
- [x] No git commit / no git init

## Concerns

None. Spinner is driven by whole-row `session.isStreaming`, not per-thinking-block completion — matches brief (pass `isStreaming` through the streaming item). When streaming ends, row leaves the streaming slot / `isStreaming` becomes false so spinner disappears.
