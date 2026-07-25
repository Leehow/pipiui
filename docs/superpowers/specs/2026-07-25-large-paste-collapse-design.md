# Large Paste Collapse — Design

Date: 2026-07-25  
Status: Approved  
Scope: Composer ⌘V large-text paste → in-memory markers → expand on send

## Problem

Pasting a large document into PipiUI’s composer puts the full string into a SwiftUI `TextField` bound to `@Published draftText`. Layout/measurement on the main thread freezes the app. pi TUI avoids this by collapsing large pastes into short markers.

## Goals

1. On ⌘V of large plain text, store the body in memory and insert a short marker into the composer.
2. Expand markers to full text when sending (before `prepareMessage` / RPC).
3. Keep image ⌘V behavior unchanged (images still win when the pasteboard has an image).
4. Match pi TUI thresholds and marker shape for familiarity.

## Non-goals (v1)

- Paste-as-file / writing paste bodies to disk
- Replacing `TextField` with a custom `NSTextView`
- Persisting `draftPastes` across app restarts
- Catching Edit-menu / right-click Paste (known limitation; may add `onPasteCommand` later)
- Changing message bubble rendering of large user text

## Approach

**In-memory map + marker string in `draftText`** (same idea as `@earendil-works/pi-tui` `Editor.handlePaste`).

- Threshold: `lineCount > 10` **or** `characterCount > 1000`
- Marker formats:
  - multi-line over threshold: `[paste #N +L lines]`
  - single-line / char threshold: `[paste #N C chars]`
- Image paste still handled first by `ComposerPasteCatcher`
- Small text pastes pass through to the system `TextField`

## Data model

```swift
// ChatSession (composer-only, not persisted)
var draftPastes: [Int: String]  // pasteId → full text
var pasteCounter: Int
```

Pure helpers in `DraftPasteCollapse`:

- `isLargePaste(_:)`
- `makeMarker(id:lineCount:charCount:)`
- `expandPasteMarkers(text:pastes:)`
- `pruneOrphanPastes(text:pastes:)`

## Flow

```
⌘V → image on pasteboard? → draftImages (existing)
     → else large text? → register in draftPastes, insert marker, swallow event
     → else → system TextField

Send → expandPasteMarkers(draftText) → prepareMessage / RPC
     → clear draftText, draftImages, draftPastes
```

Insertion point: prefer `firstResponder` `NSTextView` / `NSTextField` selected range; fall back to appending to `draftText`.

Orphan cleanup: on `draftText` change, drop paste IDs whose markers are no longer present.

## Testing

Unit tests for thresholds, marker format, multi-paste expand, orphan prune, and identity when no markers.

## Known limitations

Menu “Paste” / context-menu paste may bypass the key monitor and still dump large text into the `TextField`.
