# Paste Session Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure screenshot and large-text ⌘V callbacks always mutate the currently selected chat session after a warm A→B session switch, while preserving attachment-error dismissal after either routed paste changes the draft. The XCTest path must also safely exercise `ComposerPasteInsertion.insertMarker` when no AppKit application exists.

**Architecture:** `ChatDetailView` and its composer deliberately retain warm identity across session changes. `InputBar` owns one stable `ComposerPasteRouter` reference that weakly binds to the current `ChatSession`; app-level `ComposerPasteCatcher` callbacks capture only that router. `ComposerPasteInsertion.insertMarker(_:draftText:)` must optional-chain the two `NSApp` lookups, so its existing `draftText += marker` fallback remains usable in headless XCTest. Existing SwiftUI `onChange` paths for draft text and image count clear `attachError` after the router mutates the draft, so callback closures never capture an old session or view state.

**Tech Stack:** Swift 5.9, SwiftUI + AppKit, macOS 14+, SwiftPM XCTest, `NSEvent.addLocalMonitorForEvents`, existing `ChatSession`, `DraftImage`, and `DraftPasteCollapse`.

## Global Constraints

- Fact basis: commit `2045a75` (July 25, 2026) removed the broad app-level `.id(session.id)` around `ChatDetailView` so the detail chrome and `InputBar` are warm-reused. `ComposerPasteCatcher` is installed once from `InputBar.onAppear`; its old closures capture session A, while the key monitor dispatches later on the main queue. A switch to B can therefore incorrectly mutate A’s `draftImages`, `draftText`, or `draftPastes`.
- `ComposerPasteInsertion.insertMarker(_:draftText:)` currently has two unconditional AppKit application accesses: `NSApp.keyWindow?.firstResponder as? NSTextView` and `NSApp.keyWindow?.firstResponder as? NSTextField`. Under `swift test`, no GUI application is created and `NSApp` is nil, so the large-text routing test terminates before its assertions. This is a test-runability defect in production insertion code, not a reason to bypass, skip, or manually test the route.
- Implement only from an isolated worktree created at commit `2045a75`; the primary working directory currently has 15 unstaged changes and 2 untracked files.
- Never run `git clean`, `git stash`, `git reset`, `git restore`, `git checkout --`, `git add`, or any overwrite operation against the primary working directory or its existing dirty changes. Any staging/commit command in this plan runs only after `cd` into the isolated worktree and names only this task’s files.
- Production implementation changes are limited to `Sources/PipiUI/Views/InputBar.swift`; test coverage is limited to the new `Tests/PipiUITests/ComposerPasteRoutingTests.swift`. Do not modify `Sources/PipiUI/App.swift` or `Sources/PipiUI/Views/ChatDetailView.swift`.
- Do not restore broad `.id(session.id)` identity in `Sources/PipiUI/App.swift`, and do not add `.id(session.id)` in `Sources/PipiUI/Views/ChatDetailView.swift`. Both paths are mandatory static-review targets because the old broad identity belonged in `App.swift`.
- `ComposerPasteRouter` must hold the active `ChatSession` weakly. `InputBar` must retain a stable router in `@State`, bind it in `onAppear`, and rebind it with `.onChange(of: ObjectIdentifier(session))`.
- `ComposerPasteCatcher.onPasteImages` and `.onPasteLargeText` callbacks must capture only the stable router and must not capture `session`, `self`, `attachError`, or another view property. Preserve the existing `attachError = nil` behavior by adding it to the existing `onChange(of: session.draftText)` and `onChange(of: session.draftImages.count)` paths; routed large text changes draft text and routed images change image count.
- Test-only `ChatSession` instances must use `blockedReason: "test-only"` so tests do not launch a pi process.
- Per `CONSTITUTION.md` and `AGENTS.md`, final app verification must run `./scripts/build-app.sh`, which runs tests and packages `build/PipiUI.app`. Then verify the packaged executable is newer than both changed files with the exact `stat` command in Task 5.
- Do not modify README, specifications, `Package.swift`, other plans, or any other documentation as part of the implementation. Commit only from the isolated worktree and only if the user explicitly asks for a commit.
- Do not use `XCTSkip`, conditional test exclusion, a test-local replacement for `ComposerPasteInsertion`, or manual-only validation. The headless test calls the real production symbol specifically to prove XCTest can run the real large-text route.

## File Map

| File | Role | Change |
|---|---|---|
| `Tests/PipiUITests/ComposerPasteRoutingTests.swift` | Focused XCTest coverage for the no-`NSApp` insertion fallback, weak session ownership, and A→B image/large-text routing. | Create |
| `Sources/PipiUI/Views/InputBar.swift` | Defines `ComposerPasteInsertion`, the weak-session router, installs router-only callbacks, rebinds it, and clears attachment errors through draft-change observation. | Modify |
| `Sources/PipiUI/App.swift` | Owns the former broad detail identity boundary. | Verify only; do not modify |
| `Sources/PipiUI/Views/ChatDetailView.swift` | Preserves warm detail reuse without a new session identity boundary. | Verify only; do not modify |

---

### Task 1: First make the real insertion fallback testable under headless XCTest

**Files:**
- Create: `Tests/PipiUITests/ComposerPasteRoutingTests.swift`
- Do not modify: `Sources/PipiUI/Views/InputBar.swift` until the headless baseline failure below is observed.

**Interfaces:**
- Tests the real production symbol `ComposerPasteInsertion.insertMarker(_:draftText:)` from `Sources/PipiUI/Views/InputBar.swift`.
- Establishes this required behavior: with no `NSApplication`, no `NSWindow`, and therefore no usable `NSTextView`/`NSTextField`, insertion appends the marker to `draftText`.

- [ ] **Step 1: Create and enter a clean isolated worktree without touching the primary worktree**

Run these commands from the existing primary checkout only to inspect it and create a separate checkout; do not run a destructive Git command there:

```bash
cd /Users/haoli/leehow/code/pipiui
git status --short
git worktree add -b fix/paste-session-routing \
  /Users/haoli/leehow/code/pipiui-paste-session-routing 2045a75
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
git rev-parse --verify HEAD
git status --short
```

Expected: the first status reports the already-existing primary-worktree changes without altering them; the isolated worktree reports HEAD `2045a75` and an empty status. All remaining commands in this plan run from `/Users/haoli/leehow/code/pipiui-paste-session-routing`.

- [ ] **Step 2: Write the initial, failing headless-AppKit regression test**

Create `Tests/PipiUITests/ComposerPasteRoutingTests.swift` with this initial coverage:

```swift
import XCTest
import AppKit
@testable import PipiUI

final class ComposerPasteRoutingTests: XCTestCase {
    func testInsertMarkerAppendsWhenNoApplicationIsRunning() {
        // swift test does not create a GUI NSApplication. Keep this assertion so a
        // future test-host change cannot silently stop covering the fallback branch.
        XCTAssertNil(NSApp)

        var draftText = "before"
        let marker = "[paste #1 1001 chars]"

        ComposerPasteInsertion.insertMarker(marker, draftText: &draftText)

        XCTAssertEqual(draftText, "before[paste #1 1001 chars]")
    }
}
```

This is deliberately a direct test of the real nil-application case, which is the project’s smallest implementable seam: `insertMarker` already accepts `draftText` by `inout` and has an existing append fallback. Do not introduce an insertion-strategy protocol solely for this test.

This is **test runability, not a test bypass**. The XCTest process must execute the same production `ComposerPasteInsertion.insertMarker` call made by `ComposerPasteRouter.routeLargeText(_:)`; proving its fallback works is what allows the later A→B assertions to run. Do not create `NSApplication.shared`, skip the test, or replace the production function with a test double.

- [ ] **Step 3: Run the focused test and record the pre-fix crash**

Run:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
swift test --filter ComposerPasteRoutingTests/testInsertMarkerAppendsWhenNoApplicationIsRunning
```

Expected before the implementation: the test process terminates when `ComposerPasteInsertion.insertMarker` evaluates its first unconditional `NSApp.keyWindow` access while `NSApp` is nil. It does not reach `XCTAssertEqual`. This crash is the TDD baseline; do not weaken the assertion or exclude the test.

---

### Task 2: Make both production AppKit lookups nil-safe, retaining the append fallback

**Files:**
- Modify: `Sources/PipiUI/Views/InputBar.swift`
- Test: `Tests/PipiUITests/ComposerPasteRoutingTests.swift`

**Interfaces:**
- Changes only `ComposerPasteInsertion.insertMarker(_:draftText:)`.
- Keeps its current priority: editable `NSTextView` selection insertion, then `NSTextField` editor insertion, then `draftText += marker`.

- [ ] **Step 1: Change both `NSApp.keyWindow` accesses to optional chaining**

In `Sources/PipiUI/Views/InputBar.swift`, change the two conditions in the existing `enum ComposerPasteInsertion` implementation exactly as follows:

```swift
static func insertMarker(_ marker: String, draftText: inout String) {
    if let textView = NSApp?.keyWindow?.firstResponder as? NSTextView,
       textView.isEditable {
        let range = textView.selectedRange()
        if textView.shouldChangeText(in: range, replacementString: marker) {
            textView.replaceCharacters(in: range, with: marker)
            textView.didChangeText()
        }
        // Keep SwiftUI binding in sync when the field is the draft composer.
        draftText = textView.string
        return
    }
    if let field = NSApp?.keyWindow?.firstResponder as? NSTextField {
        let editor = field.currentEditor()
        let ns = (editor?.string ?? field.stringValue) as NSString
        let range = editor?.selectedRange ?? NSRange(location: ns.length, length: 0)
        let updated = ns.replacingCharacters(in: range, with: marker)
        field.stringValue = updated
        draftText = updated
        if let editor {
            let cursor = range.location + (marker as NSString).length
            editor.selectedRange = NSRange(location: cursor, length: 0)
        }
        return
    }
    draftText += marker
}
```

The only behavior change is that an unavailable AppKit application/window is treated like no usable text responder and falls through to the existing `draftText += marker`. Do not alter the text-view or text-field selection behavior and do not add a separate XCTest-only implementation path.

- [ ] **Step 2: Prove the real fallback now runs and asserts under XCTest**

Run:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
swift test --filter ComposerPasteRoutingTests/testInsertMarkerAppendsWhenNoApplicationIsRunning
```

Expected: exit status 0. XCTest confirms `NSApp` is nil and confirms the real `ComposerPasteInsertion.insertMarker` call appends the marker. This test is the guard against reintroducing either unconditional `NSApp.keyWindow` access.

- [ ] **Step 3: Statistically verify both lookup sites and the fallback remain present**

Run:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
rg -n -A28 'enum ComposerPasteInsertion|NSApp\?\.keyWindow|draftText \+= marker' \
  Sources/PipiUI/Views/InputBar.swift
git diff --check
```

Expected: exactly the `NSTextView` and `NSTextField` responder branches use `NSApp?.keyWindow`, and the final `draftText += marker` fallback remains intact. `git diff --check` produces no whitespace errors.

---

### Task 3: Add the weak-lifecycle and A→B routing behavior tests after headless insertion is runnable

**Files:**
- Modify: `Tests/PipiUITests/ComposerPasteRoutingTests.swift`
- Do not modify: `Sources/PipiUI/Views/InputBar.swift` until the missing-router baseline below is observed.

**Interfaces:**
- Consumes: `ChatSession(id:projectURL:sessionPath:blockedReason:)`, `DraftImage`, `DraftPasteCollapse.makeMarker(id:lineCount:charCount:)`, `ChatSession.expandedDraftText(from:)`, and the now-runnable real insertion fallback.
- Produces the required implementation contract:
  ```swift
  final class ComposerPasteRouter {
      func bind(to session: ChatSession)
      func route(images: [DraftImage])
      func routeLargeText(_ text: String)
  }
  ```
- Requires that binding does not retain a session and that a router rebound from A to B mutates only B for image and large-text payloads.

- [ ] **Step 1: Expand the focused XCTest file with lifecycle and A→B behavior coverage**

Replace the initial test file with this complete coverage:

```swift
import XCTest
import AppKit
@testable import PipiUI

final class ComposerPasteRoutingTests: XCTestCase {
    private func makeSession(_ id: String) -> ChatSession {
        ChatSession(
            id: id,
            projectURL: URL(fileURLWithPath: "/tmp"),
            sessionPath: nil,
            blockedReason: "test-only"
        )
    }

    private func makeImage() -> DraftImage {
        DraftImage(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            data: Data([0x89, 0x50, 0x4E, 0x47]),
            mimeType: "image/png",
            preview: NSImage(size: NSSize(width: 1, height: 1))
        )
    }

    func testInsertMarkerAppendsWhenNoApplicationIsRunning() {
        XCTAssertNil(NSApp)

        var draftText = "before"
        let marker = "[paste #1 1001 chars]"

        ComposerPasteInsertion.insertMarker(marker, draftText: &draftText)

        XCTAssertEqual(draftText, "before[paste #1 1001 chars]")
    }

    func testBindingDoesNotRetainSession() {
        let router = ComposerPasteRouter()
        weak var releasedSession: ChatSession?
        var session: ChatSession? = makeSession("paste-routing-lifetime")

        releasedSession = session
        router.bind(to: session!)
        session = nil

        XCTAssertNil(releasedSession)
    }

    func testRebindingRoutesImagesOnlyToLatestSession() {
        let sessionA = makeSession("paste-routing-A")
        let sessionB = makeSession("paste-routing-B")
        let image = makeImage()
        let router = ComposerPasteRouter()

        router.bind(to: sessionA)
        router.bind(to: sessionB)
        router.route(images: [image])

        XCTAssertTrue(sessionA.draftImages.isEmpty)
        XCTAssertEqual(sessionB.draftImages.map(\.id), [image.id])
    }

    func testRebindingRoutesLargePasteMarkerAndBodyOnlyToLatestSession() {
        let sessionA = makeSession("paste-routing-A")
        let sessionB = makeSession("paste-routing-B")
        let body = String(repeating: "x", count: 1001)
        let expectedMarker = DraftPasteCollapse.makeMarker(
            id: 1,
            lineCount: 1,
            charCount: body.count
        )
        let router = ComposerPasteRouter()

        router.bind(to: sessionA)
        router.bind(to: sessionB)
        router.routeLargeText(body)

        XCTAssertEqual(sessionA.draftText, "")
        XCTAssertEqual(sessionA.draftPastes, [:])
        XCTAssertEqual(sessionB.draftText, expectedMarker)
        XCTAssertEqual(sessionB.draftPastes, [1: body])
        XCTAssertEqual(sessionB.expandedDraftText(from: sessionB.draftText), body)
    }
}
```

The last test intentionally invokes `ComposerPasteRouter.routeLargeText(_:)`, which in turn calls the real `ComposerPasteInsertion.insertMarker(_:draftText:)`. Since Task 2 has already made that code headless-safe, this A→B test can reach its content assertions instead of crashing at `NSApp`.

- [ ] **Step 2: Run the new routing test target and confirm the intended pre-router failure**

Run:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
swift test --filter ComposerPasteRoutingTests
```

Expected before router implementation: compilation fails because `ComposerPasteRouter` does not exist or is not in scope. The earlier headless insertion test has already passed; this missing-type compile failure is the separate TDD baseline for routing. Do not define a test-local router substitute.

---

### Task 4: Implement stable weak-session paste routing and preserve attachment-error dismissal

**Files:**
- Modify: `Sources/PipiUI/Views/InputBar.swift`
- Test: `Tests/PipiUITests/ComposerPasteRoutingTests.swift`
- Do not modify: `Sources/PipiUI/App.swift` or `Sources/PipiUI/Views/ChatDetailView.swift`

**Interfaces:**
- Consumes:
  ```swift
  final class ComposerPasteCatcher {
      var onPasteImages: ([DraftImage]) -> Void
      var onPasteLargeText: (String) -> Void
  }
  ```
- Produces:
  ```swift
  final class ComposerPasteRouter {
      private weak var session: ChatSession?
      func bind(to session: ChatSession)
      func route(images: [DraftImage])
      func routeLargeText(_ text: String)
  }
  ```
- `InputBar` owns one stable instance:
  ```swift
  @State private var pasteRouter = ComposerPasteRouter()
  ```
  It binds in `onAppear` and whenever `ObjectIdentifier(session)` changes. The catcher callbacks capture `[router = pasteRouter]` only; the existing draft-text and image-count observers clear `attachError` after routed changes.

- [ ] **Step 1: Add `ComposerPasteRouter` immediately after `ComposerPasteCatcher` in `Sources/PipiUI/Views/InputBar.swift`**

Insert this complete type between the closing brace of `ComposerPasteCatcher` and `enum ComposerPasteInsertion`:

```swift
/// Routes asynchronous paste-catcher payloads to the currently displayed composer session.
/// The view can be reused across a warm A→B switch, so it must not retain session A.
final class ComposerPasteRouter {
    private weak var session: ChatSession?

    func bind(to session: ChatSession) {
        self.session = session
    }

    func route(images: [DraftImage]) {
        session?.draftImages.append(contentsOf: images)
    }

    func routeLargeText(_ text: String) {
        guard let session else { return }
        let marker = session.registerLargePaste(text)
        ComposerPasteInsertion.insertMarker(marker, draftText: &session.draftText)
    }
}
```

This must remain a reference type so a callback installed once retains the same router across view-body recalculations. Its `session` property must remain `weak`; Task 3 proves a closed session is not retained by the catcher callback chain.

- [ ] **Step 2: Add stable router state beside the existing paste-catcher state**

In `InputBar`, replace this state declaration block:

```swift
@State private var pasteCatcher = ComposerPasteCatcher()
@State private var slashKeyMonitor = ComposerSlashKeyMonitor()
```

with:

```swift
@State private var pasteCatcher = ComposerPasteCatcher()
@State private var pasteRouter = ComposerPasteRouter()
@State private var slashKeyMonitor = ComposerSlashKeyMonitor()
```

Do not make the router an `@ObservedObject`, do not recreate it from `body`, and do not move it into `ChatDetailView`.

- [ ] **Step 3: Replace session-capturing paste callbacks in `InputBar.onAppear`**

In the existing `.onAppear`, retain focus setup and `pasteCatcher.start()`, but replace this block:

```swift
pasteCatcher.onPasteImages = { images in
    session.draftImages.append(contentsOf: images)
    attachError = nil
}
pasteCatcher.onPasteLargeText = { text in
    let marker = session.registerLargePaste(text)
    ComposerPasteInsertion.insertMarker(marker, draftText: &session.draftText)
    attachError = nil
}
```

with:

```swift
pasteRouter.bind(to: session)
pasteCatcher.onPasteImages = { [router = pasteRouter] images in
    router.route(images: images)
}
pasteCatcher.onPasteLargeText = { [router = pasteRouter] text in
    router.routeLargeText(text)
}
```

The capture lists are intentional: neither callback may reference `session`, `self`, `attachError`, or another view property. Do not restore `attachError = nil` inside either callback.

- [ ] **Step 4: Rebind after a warm switch and move attachment-error dismissal into the existing draft-change paths**

Immediately after the existing focused-state modifier, replace the current draft-text and image-count modifiers with this complete modifier sequence, retaining the unchanged command, skill-visibility, and composer-mode modifiers between the shown text and image observers:

```swift
.onChange(of: focused) { _, isFocused in
    pasteCatcher.focused = isFocused
    refreshSlashKeyMonitorActive()
}
.onChange(of: ObjectIdentifier(session)) { _, _ in
    pasteRouter.bind(to: session)
}
.onChange(of: session.draftText) { _, _ in
    session.pruneOrphanDraftPastes()
    refreshSlashPalette()
    attachError = nil
}
```

Keep these existing modifiers unchanged after that block:

```swift
.onChange(of: session.availableCommands) { _, _ in
    refreshSlashPalette()
}
.onChange(of: store.skillVisibilityRevision) { _, _ in
    refreshSlashPalette()
}
.onChange(of: session.composerMode) { _, _ in
    refreshSlashPalette()
}
```

Then replace the existing image-count modifier with:

```swift
.onChange(of: session.draftImages.count) { _, _ in
    refreshSlashPalette()
    attachError = nil
}
```

A routed large-text paste changes `session.draftText`, and a routed image paste changes `session.draftImages.count`; these two existing observation routes therefore preserve the prior error-dismissal behavior without making the long-lived catcher callbacks capture a session or `attachError`. Do not add `.id(session.id)` anywhere.

- [ ] **Step 5: Execute the complete headless and A→B routing behavior suite**

Run:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
swift test --filter ComposerPasteRoutingTests
```

Expected after implementation: build succeeds and XCTest reports all four behavior tests passing:

- `testInsertMarkerAppendsWhenNoApplicationIsRunning`
- `testBindingDoesNotRetainSession`
- `testRebindingRoutesImagesOnlyToLatestSession`
- `testRebindingRoutesLargePasteMarkerAndBodyOnlyToLatestSession`

The A→B large-text test must not crash in XCTest and must assert that A’s `draftText` and `draftPastes` remain empty while B alone receives the marker and collapsed body. This is the required automated routing verification, not a manual-test substitute.

- [ ] **Step 6: Statistically inspect nil-safe insertion, callback captures, preserved error dismissal, and forbidden identity restoration**

Run:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
rg -n -A12 -B4 'ComposerPasteRouter|NSApp\?\.keyWindow|onPasteImages|onPasteLargeText|ObjectIdentifier\(session\)|onChange\(of: session\.draftText\)|onChange\(of: session\.draftImages\.count\)|attachError = nil|draftText \+= marker' \
  Sources/PipiUI/Views/InputBar.swift
if rg -n '^\s*\.id\(session\.id\)' \
  Sources/PipiUI/App.swift \
  Sources/PipiUI/Views/ChatDetailView.swift; then
  echo 'Unexpected session identity restoration'
  exit 1
fi
git diff --check
git diff -- Sources/PipiUI/Views/InputBar.swift Tests/PipiUITests/ComposerPasteRoutingTests.swift
```

Expected: `InputBar.swift` contains two nil-safe `NSApp?.keyWindow` lookups and the append fallback; one weak `ComposerPasteRouter`; one stable `@State` router; router-only callback capture lists; an `ObjectIdentifier(session)` rebind; and `attachError = nil` in both existing draft-text and image-count observers rather than in either paste callback. The `App.swift` and `ChatDetailView.swift` check prints no executable `.id(session.id)` line and exits 0. `git diff --check` produces no whitespace error.

- [ ] **Step 7: Commit implementation files only if the user has explicitly requested commits**

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
git add Sources/PipiUI/Views/InputBar.swift \
  Tests/PipiUITests/ComposerPasteRoutingTests.swift
git commit -m "fix(chat): route paste callbacks to active session"
```

Run this only on an explicit user request. Expected: the isolated-worktree commit contains only `Sources/PipiUI/Views/InputBar.swift` and `Tests/PipiUITests/ComposerPasteRoutingTests.swift`. Otherwise leave both files unstaged in the isolated worktree.

---

### Task 5: Automate, package, timestamp-check, and manually regress screenshot and large-text paste

**Files:**
- Verify: `Tests/PipiUITests/ComposerPasteRoutingTests.swift`
- Verify: `Sources/PipiUI/Views/InputBar.swift`
- Verify only: `Sources/PipiUI/App.swift`
- Verify only: `Sources/PipiUI/Views/ChatDetailView.swift`
- Verify packaged artifact: `build/PipiUI.app/Contents/MacOS/PipiUI`

**Interfaces:**
- Consumes: the four passing focused tests and the canonical package script.
- Produces: command-level evidence that focused tests pass, full tests/package succeed, `build/PipiUI.app` is newer than both changed files, neither identity regression is restored, and manual warm-switch paste routes to B only.

- [ ] **Step 1: Run the focused automation command**

Run:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
swift test --filter ComposerPasteRoutingTests
```

Expected: exit status 0 and all four `ComposerPasteRoutingTests` tests pass, including the no-`NSApp` fallback and A→B large-text assertions.

- [ ] **Step 2: Run the mandatory full test-and-package ship path**

Run:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
./scripts/build-app.sh
```

Expected: `swift test` passes, `./make-app.sh` builds release `PipiUI`, codesign verification succeeds, and `build/PipiUI.app` is recreated in this isolated worktree.

- [ ] **Step 3: Verify package freshness and prevent identity-boundary regression**

Run exactly:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  Sources/PipiUI/Views/InputBar.swift \
  Tests/PipiUITests/ComposerPasteRoutingTests.swift
if rg -n '^\s*\.id\(session\.id\)' \
  Sources/PipiUI/App.swift \
  Sources/PipiUI/Views/ChatDetailView.swift; then
  echo 'Unexpected session identity restoration'
  exit 1
fi
```

Expected: the first timestamp, for `build/PipiUI.app/Contents/MacOS/PipiUI`, is later than the timestamps printed for both changed files. The identity check exits 0 with no executable `.id(session.id)` line in either file. This explicitly protects against restoring the old broad `.id(session.id)` in `App.swift`; a fresh `.build` directory without the packaged-artifact timestamp result is insufficient.

- [ ] **Step 4: Launch the freshly packaged app without reusing an old app instance**

Run only after Step 2 passes:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
open -n build/PipiUI.app
```

Expected: macOS opens a new instance from the freshly built isolated-worktree bundle. Do not test by activating an already-running PipiUI instance; `open -n` is required here so the manual regression cannot exercise an old bundle.

- [ ] **Step 5: Manually regress screenshot paste after a warm A→B switch**

1. In the new packaged app instance, create two new sessions, mentally named A and B. Do not paste into either session before this regression, so each draft starts empty.
2. Select A, click its composer once so the existing `InputBar`/`ComposerPasteCatcher` lifecycle runs, then select B without quitting or relaunching the app.
3. Create a screenshot directly into the pasteboard:
   ```bash
   screencapture -i -c
   ```
   Drag a non-empty region in the capture crosshair UI; `-c` places the image in the clipboard.
4. Return to the already selected B composer and press ⌘V. Confirm B shows exactly one image thumbnail in its attachment strip.
5. Select A and confirm its attachment strip remains absent/empty. Re-select B and confirm its single thumbnail is still present.

Expected: only B receives the screenshot attachment. This exercises the app-level key monitor callback after `InputBar` has been warm-reused from A to B.

- [ ] **Step 6: Manually regress large-text marker/body routing after a second warm A→B switch**

1. Leave the same freshly launched app instance running. Select A, click the composer once, then select B again without recreating the app window or relaunching.
2. Put an exact over-threshold body on the pasteboard:
   ```bash
   python3 -c 'import sys; sys.stdout.write("L" * 1001)' | pbcopy
   ```
3. Click B’s composer and press ⌘V.
4. Confirm B’s composer displays exactly `[paste #1 1001 chars]` and not the 1001 literal `L` characters.
5. Select A and confirm its composer remains empty with no paste marker. Re-select B, send no message, and confirm the marker is still present there; the unit test verifies that marker expansion resolves the stored body only from B’s `draftPastes`.

Expected: B alone receives both the marker and the stored large-text body. A’s `draftText` and `draftPastes` remain unchanged.

- [ ] **Step 7: Final isolated-worktree scope check**

Run:

```bash
cd /Users/haoli/leehow/code/pipiui-paste-session-routing
git status --short
git diff --name-only
```

Expected: the only implementation-worktree changes are `Sources/PipiUI/Views/InputBar.swift` and `Tests/PipiUITests/ComposerPasteRoutingTests.swift` unless they were committed at explicit user request, in which case `git status --short` is empty. `Sources/PipiUI/App.swift` and `Sources/PipiUI/Views/ChatDetailView.swift` remain unmodified, and the primary checkout at `/Users/haoli/leehow/code/pipiui` remains untouched throughout.
