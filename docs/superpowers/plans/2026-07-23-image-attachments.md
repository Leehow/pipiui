# Image Attachments Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Paste/drag/pick images → composer thumbnails → RPC `images` → user bubble + session restore.

**Architecture:** Independent attachment strip + TextField; pure helpers in `ImageAttachment.swift`; `ChatBlock.image` for transcript.

**Tech Stack:** SwiftUI, AppKit (NSImage, NSPasteboard, NSOpenPanel), pi RPC JSONL.

## Global Constraints

- macOS 14+, SPM executable `PipiUI`
- Multi-image; image-only send allowed
- Max 20MB/image; longest edge ≤ 2000 on ingest
- HEIC → JPEG
- No lightbox / tool-result images in v1

---

### Task 1: ImageAttachment helpers + ChatBlock.image + send/convert

**Files:**
- Create: `Sources/PipiUI/ImageAttachment.swift`
- Modify: `Sources/PipiUI/ChatSession.swift`

- [x] Add `DraftImage`, load/resize/MIME/pasteboard helpers
- [x] Add `ImageBlock` + `ChatBlock.image`
- [x] Parse image content in `convert`
- [x] `sendPrompt(_:images:)` with RPC payload
- [x] `swift build` succeeds

### Task 2: User bubble image render

**Files:**
- Modify: `Sources/PipiUI/Views/MessageViews.swift`

- [x] User bubble: images above text; image-only OK
- [x] Exhaustive switches on `ChatBlock`
- [x] `swift build` succeeds

### Task 3: InputBar attachment UI + paste/drop/picker

**Files:**
- Modify: `Sources/PipiUI/Views/InputBar.swift`

- [x] Thumbnail strip with remove
- [x] + open panel
- [x] ⌘V image intercept, onDrop
- [x] canSend / send with images
- [x] `swift build` succeeds

### Task 4: Verify build + smoke checklist

- [x] `swift build -c debug` clean
- [ ] Manual checklist from spec acceptance criteria（需在 App 内点验）
