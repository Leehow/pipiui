# Image Attachments in Input & Chat — Design

Date: 2026-07-23  
Status: Approved  
Scope: Full pipeline (paste/drag/picker → input preview → RPC send → user bubble render)

## Problem

Pasting an image into PipiUI’s input currently degrades to a path/link (or does nothing useful). README v1 also lists “no image attachments” as a limitation. pi RPC already supports images on `prompt` / `steer` / `follow_up`.

## Goals

1. Paste, drag-and-drop, or pick image files into the composer.
2. Show multi-image thumbnail previews (removable) above the text field — not as text links.
3. Send images via RPC `images` with optional empty text.
4. Render user-message images in chat bubbles and when restoring sessions.

## Non-goals (v1)

- Click-to-zoom / save image from bubbles
- Rendering images inside assistant or tool-result content
- Restoring draft on send failure
- Extension UI dialogs for images

## Approach

**Independent attachment strip + existing `TextField`** (not a custom NSTextView, not path-only hacks).

- Text stays in `TextField`.
- Images live in a separate `draftImages` array with a horizontal thumbnail bar.
- On send, call `prompt` with `message` + optional `images` base64 payloads.

## Data model

### Draft (composer only)

```swift
struct DraftImage: Identifiable {
    let id: UUID
    let data: Data
    let mimeType: String  // image/png | image/jpeg | image/gif | image/webp
    let preview: NSImage
}
```

Held as `@State` in `InputBar` (not `ChatSession`). Cleared after a successful handoff to `sendPrompt`.

### Transcript blocks

```swift
enum ChatBlock {
    case text(String)
    case thinking(String)
    case toolCall(ToolCallBlock)
    case image(ImageBlock)  // new
}

struct ImageBlock: Identifiable {
    let id: String
    let data: Data
    let mimeType: String
}
```

`convert(message:)` maps user content blocks with `type == "image"` to `.image`, decoding base64 `data`.

## UI

```
┌─────────────────────────────────────────────┐
│ [thumb ×] [thumb ×] …   // only if non-empty │
├─────────────────────────────────────────────┤
│ [+]  [ TextField …                    ] [↑] │
│      model · thinking · status              │
└─────────────────────────────────────────────┘
```

- Thumbnail bar: horizontal `ScrollView`, ~64×64, corner radius ~8, top-trailing × to remove.
- **+** button (leading of field): `NSOpenPanel`, multiple selection, `public.image`.
- HEIC → convert to JPEG before creating `DraftImage`.
- **Paste (⌘V)** while composer focused:
  - Clipboard has image or image file URL → append to `draftImages`, do not insert path text.
  - Otherwise allow normal text paste.
  - If clipboard has both image and text: prefer attaching the image; user can paste text separately.
- **Drop**: `.onDrop` on the composer container for `.image` and `.fileURL`.
- **canSend**: `processAlive && (non-empty trimmed text || !draftImages.isEmpty)`.

### Limits / normalization

- Reject single image > 20MB with a short error.
- On ingest into draft, optionally downscale so longest edge ≤ 2000px (aligned with pi `images.autoResize`).
- Unsupported/corrupt files: skip; optional brief error.

## Send path

```swift
func sendPrompt(_ text: String, images: [DraftImage] = [])
```

- Trim text; allow empty string when `images` non-empty.
- Build RPC body:

```json
{
  "type": "prompt",
  "message": "<text or empty>",
  "images": [
    {"type": "image", "data": "<base64>", "mimeType": "image/png"}
  ]
}
```

- When `isStreaming`, add `"streamingBehavior": "steer"` (same as today).
- Clear draft text + images immediately when calling send (simple; no failure restore in v1).
- On `success != true`, set `lastError`.

## History rendering

- `MessageRow` user bubble: images above text (or images only).
- Display via `Image(nsImage:)`, max height ~200, rounded, constrained to bubble width.
- Session restore: existing `get_messages` → `ingest` → `convert` picks up image blocks; no new RPC.

## Files to touch

| File | Change |
|---|---|
| `Sources/PipiUI/Views/InputBar.swift` | Attachment bar, +, paste/drop, canSend, send with images |
| `Sources/PipiUI/ChatSession.swift` | `ChatBlock.image`, `sendPrompt(_:images:)`, `convert` image parsing |
| `Sources/PipiUI/Views/MessageViews.swift` | User bubble image layout |
| `Sources/PipiUI/ImageAttachment.swift` (new) | DraftImage helpers: MIME, resize, pasteboard, drop, HEIC→JPEG |

## Acceptance criteria

1. ⌘V screenshot → thumbnails appear; field does not show a file path.
2. Multiple images via paste, drop, and + multi-select; each removable.
3. Image-only send → user bubble shows image(s); multimodal model receives image via RPC.
4. Image + text send → bubble shows images above text.
5. Resume session that contains user images → images still visible.
6. Steer-while-streaming with images does not crash; uses existing steer behavior.

## Implementation notes

- Prefer SwiftUI `onPasteCommand` first; if image types are unreliable, use a small AppKit key-equivalent / pasteboard check on ⌘V.
- Keep base64 encoding off the main thread if payloads are large; hop back to main before `PiProcess.request`.
- Do not expand scope to tool-result images or lightbox in this change.
