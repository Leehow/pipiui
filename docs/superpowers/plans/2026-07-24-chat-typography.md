# Chat Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Independent chat body font size (persisted) with derived line/message/block spacing so transcript text is larger and less cramped without using whole-window `scaleEffect`.

**Architecture:** Pure `ChatTypography.make(fontSize:)` derives spacing tokens. `AppStore.chatFontSize` persists and feeds `.environment(\.chatTypography)`. Transcript / Markdown / `PathLinkedText` / user bubbles read the environment. Menu uses ⌘⇧=/-/0; ⌘=/−/0 stay for UI scale.

**Tech Stack:** Swift / SwiftUI / AppKit, XCTest, SwiftPM, `./make-app.sh`.

**Spec:** `docs/superpowers/specs/2026-07-24-chat-typography-design.md`

## Global Constraints

- macOS 14+, SwiftPM, product `PipiUI`.
- Ship path: refresh `build/PipiUI.app` via `./make-app.sh` when verifying the runnable app.
- Do **not** change whole-window `uiScale` / `.scaleEffect`.
- Do **not** restyle sidebar, toolbar, InputBar, StickyTaskBar.
- Work in a git worktree branch; keep primary checkout on `main`.
- Commit only chat-typography files; leave unrelated WIP alone.

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `Sources/PipiUI/ChatTypography.swift` | Tokens + EnvironmentKey + make/clamp | **Create** |
| `Tests/PipiUITests/ChatTypographyTests.swift` | Formula + clamp tests | **Create** |
| `Sources/PipiUI/AppStore.swift` | `chatFontSize` + setter | **Modify** |
| `Sources/PipiUI/App.swift` | Menu commands + environment inject | **Modify** |
| `Sources/PipiUI/Views/ChatDetailView.swift` | messageSpacing | **Modify** |
| `Sources/PipiUI/Views/MarkdownView.swift` | blockSpacing, heading/code sizes | **Modify** |
| `Sources/PipiUI/Views/PathLinkedText.swift` | default font + lineSpacing from env | **Modify** |
| `Sources/PipiUI/Views/MessageViews.swift` | user bubble padding | **Modify** |

---

### Task 1: `ChatTypography` (TDD)

**Files:** create `ChatTypography.swift`, `ChatTypographyTests.swift`

- [ ] **Step 1: Failing tests** for default 15, clamp 12…22, lineSpacing=`fontSize*0.3`, messageSpacing=`clamp(16…28, 18+(fontSize-13)*2)`, blockSpacing=`max(8, round(fontSize*0.65))`, `sanitizedFontSize`.

- [ ] **Step 2:** `swift test --filter ChatTypographyTests` → FAIL

- [ ] **Step 3:** Implement `ChatTypography` + `EnvironmentValues.chatTypography`

- [ ] **Step 4:** Tests PASS → commit

---

### Task 2: AppStore + menu + environment

**Files:** `AppStore.swift`, `App.swift`

- [ ] Persist `pipiui.chatFontSize`; `setChatFontSize`; menu 聊天字号放大/缩小/默认 with ⌘⇧=/-/0
- [ ] Inject `.environment(\.chatTypography, …)` on window root content
- [ ] Build → commit

---

### Task 3: Wire transcript / markdown / PathLinkedText / bubble

**Files:** `ChatDetailView`, `MarkdownView`, `PathLinkedText`, `MessageViews`

- [ ] LazyVStack `messageSpacing`; Markdown VStack `blockSpacing`
- [ ] PathLinkedText: `@Environment(\.chatTypography)`; default NSFont + lineSpacing; sync hitFont
- [ ] Headings/code relative to typography.fontSize; user bubble vertical padding 11
- [ ] Build + `ChatTypographyTests` → commit

---

### Task 4: Package

- [ ] `swift test --filter ChatTypographyTests`
- [ ] `./make-app.sh` + mtime check vs sources
- [ ] Merge branch into main without checking out other branch in primary folder
