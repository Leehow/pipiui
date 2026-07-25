# User Message Bubble Collapse — Design

Date: 2026-07-25  
Status: Approved  
Scope: Chat user bubbles — collapse long text by default; lazy-load full `PathLinkedText` on expand

## Problem

Ordinary user bubbles render the full string through `PathLinkedText` immediately. That runs `FileReveal.pathLinkedContent` on the entire body and lays out a large attributed string on the main thread. Large pastes (evaluation reports, logs, etc.) freeze scrolling and first paint. `.lineLimit(5)` alone does not help, because construction still touches the full text.

## Goals

1. When a user message is too long, show at most ~5 lines of preview by default.
2. Do not path-link or layout the full body until the user expands.
3. On expand: show a brief waiting spinner, then mount full `PathLinkedText` with a short fade-in.
4. Keep copy / edit on the complete original text.

## Non-goals (v1)

- Assistant / system message collapse
- Changing `[subagent-done]` / worktree-merge-failed cards
- Composer paste markers (`DraftPasteCollapse`)
- Persisting expand state across relaunch
- Virtualized / AppKit text views

## Thresholds

| Rule | Value |
|------|-------|
| Collapse when | `lineCount > 5` **or** `characterCount > 1000` |
| Preview lines | First 5 lines (`\n`-split, keep empty lines) |
| Preview char hard cap | 400 characters (after line trim) |

## UI states

```
short message     → full PathLinkedText (unchanged)
long + collapsed  → preview Text (white) + top「展开」; no full body render
long + loading    → preview kept + mini ProgressView
long + expanded   → plain Text (no path linking), opacity 0→1 (~0.2s);
                    「收起」at top and bottom
```

Expand flow:

1. User taps「展开」→ `expanded = true`, `fullReady = false`.
2. First frame shows spinner (and preview).
3. `Task { @MainActor in await Task.yield(); fullReady = true }` mounts full text next turn.
4. Fade in.「收起」(top/bottom) clears state with animations disabled and unloads full view.

Why not `PathLinkedText` when expanded: user-bubble white styling bypasses the plain render cache; path scan + `AttributedString` + `Text` layout on large pastes freezes the main thread. Plain `Text` is enough for long pastes.

Images / attachment thumbnails stay outside the collapsible text (existing `userBubble` layout).

## Pure helpers

`UserMessageCollapse`:

- `shouldCollapse(_:)`
- `preview(_:maxLines:maxChars:)` (defaults 5 / 400)

Unit-tested; no SwiftUI.

## Touch points

| File | Change |
|------|--------|
| `Sources/PipiUI/UserMessageCollapse.swift` | Thresholds + preview |
| `Sources/PipiUI/Views/MessageViews.swift` | `CollapsibleUserBubbleView`; wire into `userBubble` |
| `Tests/PipiUITests/UserMessageCollapseTests.swift` | Helper coverage |

## Acceptance

1. Short user messages: no expand control; same look as before.
2. Long messages: default ≤ ~5 lines; scrolling list stays responsive.
3. Expand: spinner then fade-in of full text; collapse returns to preview.
4. Copy / edit still operate on full message text.
5. Helper unit tests pass.
