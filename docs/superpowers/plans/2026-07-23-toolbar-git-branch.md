# Toolbar Git Branch Menu Implementation Plan

**Goal:** Chat toolbar shows branch icon + current branch; Menu lists local branches for checkout; hide when not a git repo; optional “在 GitHub 打开” when origin is github.com.

**Architecture:** Pure Foundation `GitRepo` (Process + parsers) → `@MainActor` `GitBranchStore` → SwiftUI `GitBranchMenu` in `ChatDetailView` primaryAction (first). No libgit2.

**Tech Stack:** Swift / Foundation Process, SwiftUI Menu, AppKit NSWorkspace / NSApplication.

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/GitRepo.swift` | probe / checkout / pure parsers / github URL |
| `Sources/PipiUI/GitBranchStore.swift` | Observable store, refresh epoch, app-active |
| `Sources/PipiUI/Views/GitBranchMenu.swift` | Toolbar Menu UI |
| `Sources/PipiUI/Views/ChatDetailView.swift` | Wire store + menu |
| `Tests/PipiUITests/GitRepoTests.swift` | Parser + probe tests |

## Constraints

- No libgit2; no Package.swift change unless required
- checkout errors → `session.lastError` (no new toast)
- `package` visibility for testable GitRepo APIs (match SessionTitleLogic)

## Verify

```bash
swift test --filter GitRepoTests
swift build
git -C . branch --show-current
```
