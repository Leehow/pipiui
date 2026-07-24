# Sticky Task Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the latest pinnable user task scrolls above the transcript viewport, show a compact sticky bar at the top of the chat pane so the user always knows the current task; ignore short acks like「好的 / 继续 / a」.

**Architecture:** Pure `TaskPinLogic` decides which user message is pinnable and how to compress its text. `ChatDetailView` tracks that message’s frame vs the scroll viewport with a PreferenceKey; when fully above the viewport, it shows `StickyTaskBar` via `safeAreaInset(edge: .top)`. Tap scrolls back to the original `ChatItem.id` (expanding `transcriptVisibleCount` first if needed).

**Tech Stack:** Swift / SwiftUI / AppKit (existing `NSScrollView` patterns in `ChatDetailView`), XCTest via `@testable import PipiUI`, package with `./make-app.sh`.

**Spec:** `docs/superpowers/specs/2026-07-24-sticky-task-bar-design.md`

## Global Constraints

- Platform: macOS 14+, SwiftPM, product binary `PipiUI`.
- Ship path: successful feature verification intended for the runnable app **must** refresh `build/PipiUI.app` via `./make-app.sh` (see `CONSTITUTION.md` / `AGENTS.md`).
- Tests: `swift test --filter <TestClass>` (or full `swift test`).
- Working tree may contain unrelated WIP. Commit **only** sticky-task-bar files; do not stage unrelated logging / brand / quota edits.
- Do **not** sticky the full blue user bubble inside the scroll content (Claude Code VS Code tall-sticky bug). Always use a fixed-height compact bar outside the message flow.
- Rule C only: blacklist + ≤2-char floor; attachments / newlines always pinnable; **no** length ≥ 20 gate.

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `Sources/PipiUI/TaskPinLogic.swift` | Pinnable rules, latest target, sticky display text | **Create** |
| `Tests/PipiUITests/TaskPinLogicTests.swift` | Unit tests for logic | **Create** |
| `Sources/PipiUI/Views/StickyTaskBar.swift` | Compact top bar UI | **Create** |
| `Sources/PipiUI/Views/ChatDetailView.swift` | Geometry tracking, inset, scrollTo | **Modify** (`transcript` ~228+) |
| `Package.swift` | Auto-includes `Sources/PipiUI/**` | No change |

---

### Task 1: `TaskPinLogic` — pinnable + latest target (TDD)

**Files:**
- Create: `Sources/PipiUI/TaskPinLogic.swift`
- Create: `Tests/PipiUITests/TaskPinLogicTests.swift`

**Interfaces:**
- Produces:
  - `package enum TaskPinLogic`
  - `static func plainText(of item: ChatItem) -> String` — join `.text` blocks with `"\n"`
  - `static func displayText(of item: ChatItem) -> String` — `ImageAttachment.stripAttachmentPathsForDisplay(plainText)`
  - `static func hasImageAttachment(_ item: ChatItem) -> Bool`
  - `static func isPinnable(_ item: ChatItem) -> Bool`
  - `static func latestPinnableUser(in items: [ChatItem]) -> ChatItem?` — scan reverse; only `role == "user"`

- [ ] **Step 1: Write failing tests**

```swift
import XCTest
@testable import PipiUI

final class TaskPinLogicTests: XCTestCase {
    private func user(_ text: String, id: String = "u", images: [ImageBlock] = []) -> ChatItem {
        var blocks: [ChatBlock] = []
        if !text.isEmpty { blocks.append(.text(text)) }
        blocks.append(contentsOf: images.map { .image($0) })
        return ChatItem(id: id, role: "user", blocks: blocks)
    }

    func testBlacklistNotPinnable() {
        for s in ["好的", "好", "继续", "ok", "OK", "okay", "yes", "y", "a", "b", "嗯", "行"] {
            XCTAssertFalse(TaskPinLogic.isPinnable(user(s)), s)
        }
    }

    func testTwoCharOrLessWithoutAttachmentNotPinnable() {
        XCTAssertFalse(TaskPinLogic.isPinnable(user("嗯嗯")))
        XCTAssertFalse(TaskPinLogic.isPinnable(user("  x  ")))
    }

    func testShortRealTaskIsPinnable() {
        XCTAssertTrue(TaskPinLogic.isPinnable(user("修滚动")))
        XCTAssertTrue(TaskPinLogic.isPinnable(user("用方案 A")))
    }

    func testNewlineOrImageIsPinnable() {
        XCTAssertTrue(TaskPinLogic.isPinnable(user("看\n这个")))
        let img = ImageBlock(id: "i1", data: Data([0]), mimeType: "image/png", path: nil)
        XCTAssertTrue(TaskPinLogic.isPinnable(user("", images: [img])))
        XCTAssertTrue(TaskPinLogic.isPinnable(user("a", images: [img]))) // short text + image
    }

    func testInternalAndSubagentDoneNeverPinnable() {
        XCTAssertFalse(TaskPinLogic.isPinnable(user("[subagent-done] done")))
        XCTAssertFalse(TaskPinLogic.isPinnable(user("PipiUI internal — session title")))
    }

    func testLatestPinnableSkipsAcksAndNonUsers() {
        let items: [ChatItem] = [
            user("右下角额度切模型不更新", id: "t1"),
            ChatItem(id: "a1", role: "assistant", blocks: [.text("ok")]),
            user("继续", id: "ack"),
            ChatItem(id: "a2", role: "assistant", blocks: [.text("…")]),
            user("好的", id: "ack2"),
        ]
        XCTAssertEqual(TaskPinLogic.latestPinnableUser(in: items)?.id, "t1")
    }

    func testLatestPinnableUpdatesToNewTask() {
        let items = [
            user("旧任务内容足够长", id: "old"),
            user("新任务：改成蓝色按钮", id: "new"),
        ]
        XCTAssertEqual(TaskPinLogic.latestPinnableUser(in: items)?.id, "new")
    }
}
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `swift test --filter TaskPinLogicTests 2>&1 | tail -30`  
Expected: FAIL (`TaskPinLogic` missing)

- [ ] **Step 3: Minimal implementation**

Create `Sources/PipiUI/TaskPinLogic.swift`:

```swift
import Foundation

package enum TaskPinLogic {
    /// Exact-match ack phrases (trimmed, Latin lowercased). Extend carefully — keep unit-tested.
    package static let ackBlacklist: Set<String> = [
        "好的", "好", "继续", "ok", "okay", "yes", "y", "a", "b", "嗯", "行",
    ]

    package static func plainText(of item: ChatItem) -> String {
        item.blocks.compactMap { block -> String? in
            if case .text(let t) = block { return t }
            return nil
        }.joined(separator: "\n")
    }

    package static func displayText(of item: ChatItem) -> String {
        ImageAttachment.stripAttachmentPathsForDisplay(plainText(of: item))
    }

    package static func hasImageAttachment(_ item: ChatItem) -> Bool {
        item.blocks.contains { if case .image = $0 { return true }; return false }
    }

    package static func isPinnable(_ item: ChatItem) -> Bool {
        guard item.role == "user" else { return false }
        let display = displayText(of: item).trimmingCharacters(in: .whitespacesAndNewlines)
        let hasImage = hasImageAttachment(item)
        if display.hasPrefix("[subagent-done]") { return false }
        if display.contains("PipiUI internal") { return false }
        if display.isEmpty && !hasImage { return false }

        let normalized = display.lowercased()
        if ackBlacklist.contains(normalized) { return false }

        // ≤2 grapheme clusters, no attachment → ack-like
        if display.count <= 2 && !hasImage { return false }

        if hasImage { return true }
        if display.contains(where: \.isNewline) { return true }
        return true
    }

    package static func latestPinnableUser(in items: [ChatItem]) -> ChatItem? {
        for item in items.reversed() where isPinnable(item) {
            return item
        }
        return nil
    }
}
```

Note: `display.count <= 2` uses Swift `String.count` (extended grapheme clusters).「嗯嗯」is 2 → not pinnable;「修滚动」is 3 → pinnable.

- [ ] **Step 4: Run tests — expect PASS**

Run: `swift test --filter TaskPinLogicTests 2>&1 | tail -30`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/TaskPinLogic.swift Tests/PipiUITests/TaskPinLogicTests.swift
git commit -m "$(cat <<'EOF'
feat(chat): add TaskPinLogic for pinnable user tasks

Rule C: blacklist + short-floor; skip acks when choosing sticky target.
EOF
)"
```

---

### Task 2: Sticky display text compression (TDD)

**Files:**
- Modify: `Sources/PipiUI/TaskPinLogic.swift`
- Modify: `Tests/PipiUITests/TaskPinLogicTests.swift`

**Interfaces:**
- Produces: `static func stickyDisplayText(of item: ChatItem, maxChars: Int = 120) -> String`
  - `trimStart` → first paragraph (split on blank line `\n\s*\n`) → collapse whitespace to single spaces → hard-cap `maxChars` → trim

- [ ] **Step 1: Write failing tests**

```swift
func testStickyDisplayTextUsesFirstParagraphAndCollapsesWhitespace() {
    let item = ChatItem(
        id: "u",
        role: "user",
        blocks: [.text("  标题行  还有空格\n\n第二段不要\n第三行")]
    )
    XCTAssertEqual(
        TaskPinLogic.stickyDisplayText(of: item),
        "标题行 还有空格"
    )
}

func testStickyDisplayTextCapsLength() {
    let long = String(repeating: "任务", count: 80) // 160 chars
    let item = ChatItem(id: "u", role: "user", blocks: [.text(long)])
    let out = TaskPinLogic.stickyDisplayText(of: item, maxChars: 40)
    XCTAssertEqual(out.count, 40)
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `swift test --filter TaskPinLogicTests.testSticky 2>&1 | tail -20`  
Expected: FAIL (method missing)

- [ ] **Step 3: Implement**

```swift
package static func stickyDisplayText(of item: ChatItem, maxChars: Int = 120) -> String {
    var s = displayText(of: item).trimmingCharacters(in: .whitespacesAndNewlines)
    // Leading whitespace already trimmed; keep trimStart semantics for mid-content:
    s = String(s.drop(while: { $0.isWhitespace || $0.isNewline }))
    if let r = s.range(of: #"\n\s*\n"#, options: .regularExpression) {
        s = String(s[..<r.lowerBound])
    }
    s = s.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
    if s.count > maxChars {
        s = String(s.prefix(maxChars))
    }
    return s.trimmingCharacters(in: .whitespacesAndNewlines)
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `swift test --filter TaskPinLogicTests 2>&1 | tail -20`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/TaskPinLogic.swift Tests/PipiUITests/TaskPinLogicTests.swift
git commit -m "feat(chat): compress sticky task bar display text"
```

---

### Task 3: `StickyTaskBar` view

**Files:**
- Create: `Sources/PipiUI/Views/StickyTaskBar.swift`

**Interfaces:**
- Produces: `struct StickyTaskBar: View` with `let text: String`, `let onTap: () -> Void`
- Fixed max height (~2–3 lines via `lineLimit(3)`), truncate tail, `↳` prefix, accent-tinted background, bottom divider, whole bar tappable

- [ ] **Step 1: Implement view**

```swift
import SwiftUI

struct StickyTaskBar: View {
    let text: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 6) {
                Text("↳")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                Text(text)
                    .font(.system(size: 12))
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                    .truncationMode(.tail)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.accentColor.opacity(0.12))
            .overlay(alignment: .bottom) {
                Divider()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("跳转到任务原文")
    }
}
```

- [ ] **Step 2: Compile check**

Run: `swift build 2>&1 | tail -20`  
Expected: build succeeds (view unused yet is fine)

- [ ] **Step 3: Commit**

```bash
git add Sources/PipiUI/Views/StickyTaskBar.swift
git commit -m "feat(ui): add StickyTaskBar compact header view"
```

---

### Task 4: Wire into `ChatDetailView` — visibility + scroll back

**Files:**
- Modify: `Sources/PipiUI/Views/ChatDetailView.swift`

**Interfaces:**
- Consumes: `TaskPinLogic.latestPinnableUser`, `stickyDisplayText`, `StickyTaskBar`
- View state on `ChatDetailViewBody`:
  - `@State private var stickyTargetMinY: CGFloat?` — target row’s minY in scroll content / global space as implemented
  - `@State private var stickyViewportMinY: CGFloat = 0`
  - Derived: `showStickyTaskBar` when target exists AND `stickyTargetMaxY <= stickyViewportMinY` (fully above). Use the coordinate space you attach; document in code comment.
- Produces behavior per spec §4.2 / §4.3

**Implementation sketch (place PreferenceKey near existing `StickToBottomTracker` at file bottom):**

```swift
private struct StickyTaskAnchorKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>? = nil
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}
```

In `transcript`’s `ScrollViewReader` / `ScrollView`:

1. Compute `let stickyTarget = TaskPinLogic.latestPinnableUser(in: session.transcript)` once per body.
2. On the matching `MessageRow` (same `item.id`), attach:
   `.anchorPreference(key: StickyTaskAnchorKey.self, value: .bounds) { $0 }`
3. On the `ScrollView`, resolve preference vs named coordinate space `"transcript"` (add `.coordinateSpace(name: "transcript")` on the scroll content or scroll view — pick one and use consistently):
   ```swift
   .backgroundPreferenceValue(StickyTaskAnchorKey.self) { anchor in
       GeometryReader { geo in
           let show: Bool = {
               guard let anchor else { return false }
               let rect = geo[anchor]
               return rect.maxY <= 0 // fully above the scroll viewport top in this space
           }()
           Color.clear.preference(key: StickyTaskVisibleKey.self, value: show)
       }
   }
   ```
   Or simpler: store `showSticky` via `.onPreferenceChange` + viewport `GeometryReader` overlay. **Choose one approach that compiles on macOS 14; prefer the least flicker.**

4. Wrap / decorate the `ScrollView` with:
   ```swift
   .safeAreaInset(edge: .top, spacing: 0) {
       if showSticky, let stickyTarget {
           StickyTaskBar(text: TaskPinLogic.stickyDisplayText(of: stickyTarget)) {
               scrollToStickyTarget(proxy, item: stickyTarget)
           }
           .transition(.move(edge: .top).combined(with: .opacity))
       }
   }
   .animation(.easeInOut(duration: 0.15), value: showSticky)
   ```

5. Implement `scrollToStickyTarget`:
   ```swift
   private func scrollToStickyTarget(_ proxy: ScrollViewProxy, item: ChatItem) {
       // Ensure item is in the visible suffix.
       if let idx = session.transcript.firstIndex(where: { $0.id == item.id }) {
           let needed = session.transcript.count - idx
           if session.transcriptVisibleCount < needed {
               session.transcriptVisibleCount = max(session.transcriptVisibleCount, needed + 20)
           }
       }
       DispatchQueue.main.async {
           withAnimation(.easeInOut(duration: 0.2)) {
               proxy.scrollTo(item.id, anchor: .top)
           }
       }
   }
   ```
   Ensure each `MessageRow` (or its container) has `.id(item.id)` so `scrollTo` works. If missing today, add `.id(item.id)` on the row in the `ForEach`.

6. Reset sticky-related `@State` in existing `.onChange(of: session.id)`.

- [ ] **Step 1: Add `.id(item.id)` on transcript rows if absent; add PreferenceKey + safeAreaInset + scroll helper**

- [ ] **Step 2: Build**

Run: `swift build 2>&1 | tail -30`  
Expected: success

- [ ] **Step 3: Manual smoke (dev)**

Run: `swift run`  
Checklist:
- Send a long task; after long assistant output, scroll up until the blue bubble leaves → bar appears with compressed text.
- Scroll back until bubble visible → bar hides.
- Click bar → jumps to bubble.
- Send「继续」→ bar still shows original task.
- Send a new real task → after it scrolls away, bar shows the new task.

- [ ] **Step 4: Commit**

```bash
git add Sources/PipiUI/Views/ChatDetailView.swift
git commit -m "$(cat <<'EOF'
feat(chat): pin latest task in sticky bar when scrolled away

Show compact StickyTaskBar via safeAreaInset; tap scrolls back,
expanding transcriptVisibleCount when the target is truncated.
EOF
)"
```

---

### Task 5: Package runnable app + verify mtimes

**Files:** none new (verification only)

- [ ] **Step 1: Run unit tests**

Run: `swift test --filter TaskPinLogicTests 2>&1 | tail -40`  
Expected: PASS

- [ ] **Step 2: Package**

Run: `./make-app.sh`  
Expected: `build/PipiUI.app` refreshed

- [ ] **Step 3: Timestamp check**

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  Sources/PipiUI/TaskPinLogic.swift \
  Sources/PipiUI/Views/StickyTaskBar.swift \
  Sources/PipiUI/Views/ChatDetailView.swift
```

Expected: app binary mtime **newer** than the three sources.

- [ ] **Step 4: Commit only if packaging scripts changed** (normally nothing). If the tree is clean for this feature, done.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Latest pinnable user (A) | Task 1 |
| Rule C filter | Task 1 |
| Never pin subagent-done / internal | Task 1 |
| Ack does not replace target | Task 1 |
| New task replaces target | Task 1 |
| Show only when scrolled above viewport | Task 4 |
| Compact 2–3 line bar, first paragraph | Task 2 + 3 |
| Outside scroll sticky (safeAreaInset) | Task 4 |
| Click → scrollTo (+ visibleCount) | Task 4 |
| Don’t break pin-to-bottom FAB | Task 4 (manual) |
| Unit tests | Task 1–2 |
| `make-app.sh` + mtime | Task 5 |

## Self-review notes

- No TBD placeholders.
- `ImageBlock` initializer must match existing `ImageBlock` fields in `ChatSession.swift` — if the test helper fails to compile, align with the real memberwise init (`id`, `data`, `mimeType`, `path`, etc.).
- PreferenceKey geometry is the riskiest step; if `anchorPreference` fights `defaultScrollAnchor(.bottom)`, fall back to an `NSViewRepresentable` reading the target row’s frame in the enclosing `NSScrollView` (same spirit as `StickToBottomTracker`), still driving `safeAreaInset` — do **not** use in-list CSS-like sticky on the full bubble.
