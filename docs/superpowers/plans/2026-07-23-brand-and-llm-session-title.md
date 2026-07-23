# Brand + LLM Session Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put cyan-accent **Pipi UI** brand on the sidebar/empty-state header, show the session title in the detail nav bar, and auto-name sessions via same-session pi “ghost” prompts (first 5 user rounds) with typewriter UI — never polluting the chat transcript.

**Architecture:** Extract pure `SessionTitleLogic` (parse + schedule rules) for SelfTest. `ChatSession` owns title-job state and, when idle, sends a hidden `prompt` RPC; while `titleJobActive`, `handleEvent` skips transcript ingestion and captures assistant text, then calls existing `setSessionName`. SwiftUI gets `BrandMark` + `TypewriterText`; sidebar top inset and `ChatDetailView` principal/title bind to animated display name.

**Tech Stack:** Swift / SwiftUI macOS 14+, existing `PiProcess` JSONL RPC (`prompt`, `set_session_name`), `SelfTest` via `PIPIUI_SELF_TEST=1 swift run`, XCTest harness in `Tests/PipiUITests`.

**Spec:** `docs/superpowers/specs/2026-07-23-brand-and-llm-session-title-design.md`

## Global Constraints

- Brand second **i** (last letter of “Pipi”) uses SwiftUI `Color.cyan`; rest `.primary`.
- Detail nav title fallback is **`新会话`**, never **`Pipi UI`**.
- Title jobs use **current session** pi RPC only; **no** second long-lived process / external API key.
- Ghost prompt traffic **must not** append to `transcript` / `streamingItem` visible chat.
- Auto-title only for live sessions that are still “untitled” policy per logic; **stop** after 5 **user** rounds or on **manual rename**.
- Ghost prompts only when **session idle** (`!isWorking && messageQueue.isEmpty && !titleJobActive` before start).
- Title copy: ~8–16 chars (or equivalent English), follow user language; strip quotes / “标题：” prefixes in parser.
- Typewriter only when **auto** title text changes; not on manual rename, session switch, or load-from-disk.
- No git in this workspace historically — **skip commit steps** if `git status` fails; still finish verification.
- Do not change pi protocol, queue/steer semantics for **user** messages, or Dock/WindowGroup plain name beyond leaving them as plain “Pipi UI”.

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/SessionTitleLogic.swift` | **Create** — pure parse + `shouldRunTitleJob` rules |
| `Sources/PipiUI/Views/BrandMark.swift` | **Create** — Pip + cyan i + UI |
| `Sources/PipiUI/Views/TypewriterText.swift` | **Create** — shared typewriter label |
| `Sources/PipiUI/ChatSession.swift` | Title job state machine, ghost send, event filter, hooks |
| `Sources/PipiUI/AppStore.swift` | `renameSession` sets `userRenamedTitle` |
| `Sources/PipiUI/Views/SidebarView.swift` | Top BrandMark; session rows use TypewriterText |
| `Sources/PipiUI/Views/ChatDetailView.swift` | Nav title / principal typewriter; fallback 新会话 |
| `Sources/PipiUI/App.swift` | EmptyState BrandMark |
| `Sources/PipiUI/SelfTest.swift` | Pure logic checks for title parse/schedule |
| `Tests/PipiUITests/SessionTitleLogicTests.swift` | **Create** — package tests mirroring SelfTest |

---

### Task 1: Pure `SessionTitleLogic` + tests

**Files:**
- Create: `Sources/PipiUI/SessionTitleLogic.swift`
- Create: `Tests/PipiUITests/SessionTitleLogicTests.swift`
- Modify: `Sources/PipiUI/SelfTest.swift` (append checks before final summary print)
- Test: `swift test` and/or `PIPIUI_SELF_TEST=1 swift run`

**Interfaces:**
- Produces:
  - `enum SessionTitleJobKind: Equatable { case generate, review }`
  - `struct SessionTitleLogic` with static methods:
    - `static func parseModelTitle(_ raw: String, maxChars: Int = 40) -> String?`
    - `static func shouldRunTitleJob(userRenamed: Bool, titleRoundCount: Int, maxRounds: Int = 5, hasNonPlaceholderName: Bool, isIdle: Bool, titleJobActive: Bool) -> SessionTitleJobKind?`
    - `static func isPlaceholderName(_ name: String?) -> Bool` — true for nil, empty, `新会话`
    - `static let maxAutoRounds = 5`
  - `parseModelTitle` rules:
    1. Trim whitespace/newlines
    2. Take first line only
    3. Strip wrapping `"` / `'` / `「」` / `『』`
    4. Strip leading labels: `标题：`, `标题:`, `Title:`, `title:` (case-insensitive for English)
    5. Trim again; reject if empty or `count > maxChars`
    6. Return cleaned string
  - `shouldRunTitleJob`:
    - nil if `userRenamed || titleJobActive || !isIdle`
    - nil if `titleRoundCount < 1` (no completed user round yet) OR `titleRoundCount > maxRounds`
    - if `titleRoundCount` in `1...maxRounds`:
      - if `!hasNonPlaceholderName` → `.generate`
      - else → `.review`
  - Note: round is incremented on **user** `agent_settled` **before** calling shouldRun; ghost settles do not increment.

- [ ] **Step 1: Add `SessionTitleLogic.swift`**

```swift
import Foundation

enum SessionTitleJobKind: Equatable {
    case generate
    case review
}

enum SessionTitleLogic {
    static let maxAutoRounds = 5
    static let placeholderName = "新会话"

    static func isPlaceholderName(_ name: String?) -> Bool {
        guard let name else { return true }
        let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty || t == placeholderName
    }

    /// Returns `.generate` / `.review` when a ghost title job should start; nil to skip.
    static func shouldRunTitleJob(
        userRenamed: Bool,
        titleRoundCount: Int,
        maxRounds: Int = maxAutoRounds,
        hasNonPlaceholderName: Bool,
        isIdle: Bool,
        titleJobActive: Bool
    ) -> SessionTitleJobKind? {
        guard !userRenamed, !titleJobActive, isIdle else { return nil }
        guard titleRoundCount >= 1, titleRoundCount <= maxRounds else { return nil }
        return hasNonPlaceholderName ? .review : .generate
    }

    static func parseModelTitle(_ raw: String, maxChars: Int = 40) -> String? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let nl = s.firstIndex(of: "\n") {
            s = String(s[..<nl]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        // Strip one layer of wrapping quotes
        let wrappers: [(Character, Character)] = [
            ("\"", "\""), ("'", "'"), ("「", "」"), ("『", "』")
        ]
        if let f = s.first, let l = s.last, s.count >= 2 {
            for (a, b) in wrappers where f == a && l == b {
                s = String(s.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
                break
            }
        }
        let prefixes = ["标题：", "标题:", "Title:", "title:", "TITLE:"]
        for p in prefixes {
            if s.lowercased().hasPrefix(p.lowercased()) {
                // Use original-case prefix length via range
                if let r = s.range(of: p, options: [.caseInsensitive, .anchored]) {
                    s = String(s[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                }
                break
            }
        }
        guard !s.isEmpty, s.count <= maxChars else { return nil }
        return s
    }
}
```

- [ ] **Step 2: Add package tests `SessionTitleLogicTests.swift`**

```swift
import Foundation
import PipiUI

final class SessionTitleLogicTests: XCTestCase {
    func testParseStripsQuotesAndLabel() throws {
        try XCTAssertEqual(SessionTitleLogic.parseModelTitle("「侧栏品牌与会话标题」"), "侧栏品牌与会话标题")
        try XCTAssertEqual(SessionTitleLogic.parseModelTitle("标题：Foo bar"), "Foo bar")
        try XCTAssertEqual(SessionTitleLogic.parseModelTitle("Title: Hello\nmore"), "Hello")
    }

    func testParseRejectsEmptyAndTooLong() throws {
        try XCTAssertNil(SessionTitleLogic.parseModelTitle("   "))
        try XCTAssertNil(SessionTitleLogic.parseModelTitle(String(repeating: "字", count: 41)))
    }

    func testShouldRunGenerateVsReview() throws {
        let gen = SessionTitleLogic.shouldRunTitleJob(
            userRenamed: false, titleRoundCount: 1, hasNonPlaceholderName: false,
            isIdle: true, titleJobActive: false)
        try XCTAssertEqual(gen, .generate)
        let rev = SessionTitleLogic.shouldRunTitleJob(
            userRenamed: false, titleRoundCount: 3, hasNonPlaceholderName: true,
            isIdle: true, titleJobActive: false)
        try XCTAssertEqual(rev, .review)
    }

    func testShouldRunStops() throws {
        try XCTAssertNil(SessionTitleLogic.shouldRunTitleJob(
            userRenamed: true, titleRoundCount: 1, hasNonPlaceholderName: false,
            isIdle: true, titleJobActive: false))
        try XCTAssertNil(SessionTitleLogic.shouldRunTitleJob(
            userRenamed: false, titleRoundCount: 0, hasNonPlaceholderName: false,
            isIdle: true, titleJobActive: false))
        try XCTAssertNil(SessionTitleLogic.shouldRunTitleJob(
            userRenamed: false, titleRoundCount: 6, hasNonPlaceholderName: true,
            isIdle: true, titleJobActive: false))
        try XCTAssertNil(SessionTitleLogic.shouldRunTitleJob(
            userRenamed: false, titleRoundCount: 2, hasNonPlaceholderName: true,
            isIdle: false, titleJobActive: false))
        try XCTAssertNil(SessionTitleLogic.shouldRunTitleJob(
            userRenamed: false, titleRoundCount: 2, hasNonPlaceholderName: true,
            isIdle: true, titleJobActive: true))
    }

    func testPlaceholder() throws {
        try XCTAssertTrue(SessionTitleLogic.isPlaceholderName(nil))
        try XCTAssertTrue(SessionTitleLogic.isPlaceholderName("新会话"))
        try XCTAssertTrue(SessionTitleLogic.isPlaceholderName("  "))
        try XCTAssertFalse(SessionTitleLogic.isPlaceholderName("侧栏标题"))
    }
}
```

(Use same MiniXCTest style as `SlashCommandTests.swift` — `thrown` asserts.)

- [ ] **Step 3: Mirror 4–6 checks in `SelfTest.swift`**

Follow existing `check("name", condition)` pattern near other pure tests.

- [ ] **Step 4: Run tests**

```bash
cd /Users/haoli/leehow/code/pipiui
swift test 2>&1
# and/or
PIPIUI_SELF_TEST=1 swift run 2>&1
```

Expected: parse/schedule tests PASS; build succeeds.

- [ ] **Step 5: Commit (skip if no git)**

```bash
git add Sources/PipiUI/SessionTitleLogic.swift Tests/PipiUITests/SessionTitleLogicTests.swift Sources/PipiUI/SelfTest.swift
git commit -m "feat: pure session title parse and schedule logic" || true
```

---

### Task 2: `BrandMark` + wire sidebar top + empty state

**Files:**
- Create: `Sources/PipiUI/Views/BrandMark.swift`
- Modify: `Sources/PipiUI/Views/SidebarView.swift` (body — top brand)
- Modify: `Sources/PipiUI/App.swift` (`EmptyStateView` title)
- Test: `swift build`; manual visual when app runs

**Interfaces:**
- Produces: `struct BrandMark: View` with `var size: BrandMark.Size = .sidebar` where `.sidebar` / `.hero` pick font
- Consumes: none from Task 1

- [ ] **Step 1: Add `BrandMark.swift`**

```swift
import SwiftUI

struct BrandMark: View {
    enum Size {
        case sidebar
        case hero
        var font: Font {
            switch self {
            case .sidebar: return .title3.weight(.semibold)
            case .hero: return .title2.weight(.semibold)
            }
        }
    }

    var size: Size = .sidebar

    var body: some View {
        HStack(spacing: 0) {
            Text("Pip")
            Text("i")
                .foregroundStyle(Color.cyan)
            Text(" UI")
        }
        .font(size.font)
        .foregroundStyle(.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Pipi UI")
    }
}
```

- [ ] **Step 2: Sidebar top brand**

In `SidebarView.body`, wrap list so brand sits above:

```swift
var body: some View {
    VStack(spacing: 0) {
        BrandMark(size: .sidebar)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 8)
        List(selection: selectionBinding) {
            // existing sections unchanged
            projectsSection
            if let project = store.selectedProject {
                sessionsSection(project: project)
                archivedSessionsSection(project: project)
            }
        }
        .listStyle(.sidebar)
    }
    .safeAreaInset(edge: .bottom) {
        // existing Boss bar unchanged
        ...
    }
}
```

If `VStack` + `List` breaks sidebar styling, use `.safeAreaInset(edge: .top) { BrandMark... }` on the List instead — prefer whichever keeps `.listStyle(.sidebar)` look.

- [ ] **Step 3: Empty state**

In `App.swift` `EmptyStateView`, replace:

```swift
Text("Pipi UI")
    .font(.title2.weight(.semibold))
```

with:

```swift
BrandMark(size: .hero)
```

- [ ] **Step 4: Build**

```bash
swift build 2>&1
```

Expected: success.

- [ ] **Step 5: Commit (skip if no git)**

```bash
git add Sources/PipiUI/Views/BrandMark.swift Sources/PipiUI/Views/SidebarView.swift Sources/PipiUI/App.swift
git commit -m "feat: BrandMark with cyan second i on sidebar and empty state" || true
```

---

### Task 3: `TypewriterText` component

**Files:**
- Create: `Sources/PipiUI/Views/TypewriterText.swift`
- Test: `swift build` (optional tiny SelfTest for prefix length helper if extracted)

**Interfaces:**
- Produces:
  - `struct TypewriterText: View`
  - Init: `text: String`, `animationToken: UUID?`, `cps: Double = 28` (chars per second ≈ 35ms/char), `font: Font = .body`
  - Behavior:
    - When `animationToken` is non-nil **and** changes (or text changes while token changes), animate from empty (or from 0) to full `text` by increasing visible prefix on a Timer/Task.
    - When `animationToken == nil`, show full `text` immediately (manual rename / disk load / selection).
    - Cancel in-flight animation on token/text change or `onDisappear`.

- [ ] **Step 1: Implement `TypewriterText.swift`**

```swift
import SwiftUI

struct TypewriterText: View {
    let text: String
    /// Non-nil token means "play typewriter for this text".
    let animationToken: UUID?
    var charsPerSecond: Double = 28
    var font: Font = .body

    @State private var visibleCount = 0
    @State private var runningToken: UUID?
    @State private var task: Task<Void, Never>?

    private var displayed: String {
        if animationToken == nil { return text }
        let n = min(visibleCount, text.count)
        guard n > 0 else { return "" }
        let idx = text.index(text.startIndex, offsetBy: n)
        return String(text[..<idx])
    }

    var body: some View {
        Text(displayed)
            .font(font)
            .lineLimit(1)
            .truncationMode(.tail)
            .onAppear { sync(force: true) }
            .onChange(of: text) { _ in sync(force: false) }
            .onChange(of: animationToken) { _ in sync(force: true) }
            .onDisappear { task?.cancel(); task = nil }
    }

    private func sync(force: Bool) {
        task?.cancel()
        guard let token = animationToken else {
            runningToken = nil
            visibleCount = text.count
            return
        }
        if !force, runningToken == token, visibleCount == text.count { return }
        runningToken = token
        visibleCount = 0
        let target = text
        let delayNs = UInt64(1_000_000_000 / max(charsPerSecond, 1))
        task = Task { @MainActor in
            for i in 1...max(target.count, 1) {
                if Task.isCancelled { return }
                visibleCount = min(i, target.count)
                if target.isEmpty { break }
                try? await Task.sleep(nanoseconds: delayNs)
            }
        }
    }
}
```

Adjust `onChange` to macOS 14 signature used elsewhere in the project (`onChange(of:) { old, new in` vs single-parameter) — **match existing files**.

- [ ] **Step 2: `swift build`**

Expected: success.

- [ ] **Step 3: Commit (skip if no git)**

```bash
git add Sources/PipiUI/Views/TypewriterText.swift
git commit -m "feat: TypewriterText for session title animation" || true
```

---

### Task 4: `ChatSession` title job state machine + ghost prompt

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift`
- Consumes: `SessionTitleLogic` from Task 1
- Produces published fields for UI (Task 5–6)

**Interfaces:**
- Add on `ChatSession`:
  - `@Published private(set) var userRenamedTitle = false`
  - `@Published private(set) var titleRoundCount = 0`
  - `@Published private(set) var titleAnimationToken: UUID? = nil` — set when auto title applies
  - `@Published private(set) var displayTitle: String = SessionTitleLogic.placeholderName` — convenience: non-placeholder `sessionName` else `新会话`
  - `private var titleJobActive = false`
  - `private var titleJobKind: SessionTitleJobKind?`
  - `private var titleJobBuffer = ""` — accumulate assistant text during ghost job
  - `private var userTurnsCompleted = 0` — same as titleRoundCount source
  - `func markUserRenamedTitle()` — sets `userRenamedTitle = true`, clears `titleAnimationToken`
  - `private func noteUserAgentSettled()` — increment round, `scheduleTitleJobIfNeeded()`
  - `private func scheduleTitleJobIfNeeded()`
  - `private func startTitleJob(_ kind: SessionTitleJobKind)`
  - `private func finishTitleJob(rawAssistantText: String)`
  - `private func cancelTitleJob()`
  - `private func refreshDisplayTitle()`

**Behavioral wiring (critical):**

1. **Distinguish user vs ghost settles**
   - Only increment `titleRoundCount` when `!titleJobActive` at the start of handling a normal user turn settle.
   - Pattern:
     - User `sendPromptNow` (non-title) sets nothing special beyond today.
     - On `agent_settled`:
       ```
       if titleJobActive {
         // end of ghost job
         let raw = titleJobBuffer
         finishTitleJob(rawAssistantText: raw)
         // do NOT markUnseenCompletion; do NOT increment rounds
         // still allow drainQueueIfIdle after clearing titleJobActive
       } else {
         // normal user settle path (existing drain / green / get_state)
         titleRoundCount += 1  // only if this settle ends a user prompt turn
         scheduleTitleJobIfNeeded()
         ... existing logic ...
       }
       ```
   - **Careful with queue:** if `drainQueueIfIdle` immediately sends another user prompt, do **not** start title job until truly idle. `scheduleTitleJobIfNeeded` must re-check `!isWorking && messageQueue.isEmpty` after drain. Prefer order:
     1. If `titleJobActive` → finish title job first (clear flag)
     2. Else existing drain
     3. Then if still idle → `scheduleTitleJobIfNeeded()`
     4. Green badge only when idle and **not** title job

2. **Ghost send**
   ```swift
   private func startTitleJob(_ kind: SessionTitleJobKind) {
       guard !titleJobActive, processAlive, proc != nil else { return }
       titleJobActive = true
       titleJobKind = kind
       titleJobBuffer = ""
       let current = sessionName ?? SessionTitleLogic.placeholderName
       let message: String
       switch kind {
       case .generate:
           message = """
           [PipiUI internal — session title. Do not use tools. Reply with ONLY one short title line.]
           Rules: 8–16 characters if Chinese (or short English phrase); follow the user's language; no quotes; no prefix like 标题:.
           Summarize this conversation's topic as the session title.
           """
       case .review:
           message = """
           [PipiUI internal — session title review. Do not use tools. Reply with ONLY one short title line.]
           Current title: \(current)
           If the conversation topic is still the same, reply with the current title EXACTLY.
           If the topic changed, reply with a new title only (8–16 Chinese chars or short English; no quotes; no prefix).
           """
       }
       isSendingFromQueue = true // keep isWorking true so UI shows busy consistently OR use a separate flag — prefer NOT flipping sidebar green mid-title; using isSendingFromQueue is OK if green suppressed
       var cmd: [String: Any] = ["type": "prompt", "message": message]
       proc?.request(cmd) { [weak self] resp in
           guard let self else { return }
           if resp["success"].bool != true {
               self.cancelTitleJob()
           }
       }
   }
   ```

3. **Event filter when `titleJobActive`**
   - In `handleEvent`, early branch after reading type (or inside each message case):
     - `message_start` / `message_update` / `message_end` for assistant: append text into `titleJobBuffer` via `contentText`, **do not** set `streamingItem` / `ingest`
     - `tool_execution_*`: ignore (do not mutate toolRuns UI) or no-op
     - `agent_start`: set streaming flags as needed but no transcript
     - `agent_settled`: finish path above
   - User role messages during title job (if any): do not ingest

4. **finishTitleJob**
   ```swift
   private func finishTitleJob(rawAssistantText: String) {
       titleJobActive = false
       titleJobKind = nil
       isSendingFromQueue = false
       isStreaming = false
       streamingItem = nil
       let parsed = SessionTitleLogic.parseModelTitle(rawAssistantText)
       titleJobBuffer = ""
       if let parsed {
           let prev = sessionName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
           if parsed != prev {
               // Optimistic UI + RPC
               sessionName = parsed
               titleAnimationToken = UUID()
               refreshDisplayTitle()
               // Persist without going through markUserRenamed
               proc?.request(["type": "set_session_name", "name": parsed]) { [weak self] resp in
                   guard let self else { return }
                   if resp["success"].bool == true {
                       self.onSessionMetaChanged?()
                   }
                   // if fail, keep optimistic name or revert — keep optimistic silently
               }
           }
       }
       refreshDisplayTitle()
       // After title job, if queue has items, drain
       drainQueueIfIdle()
   }
   ```

5. **`setSessionName` vs auto**
   - Keep public `setSessionName` for RPC.
   - `markUserRenamedTitle()` called only from AppStore rename path.
   - Auto path must **not** set `userRenamedTitle`.

6. **`abort()`**
   - Also `cancelTitleJob()` if active (clear flags; optional `proc?.send abort` already happens).

7. **Opened disk session with existing name**
   - On `applyState` when `sessionName` becomes non-placeholder, do not reset rounds; auto logic still only runs after new user settles in this process. Spec v1: OK to review in first 5 **new** turns even if old name exists (review keeps title if same topic). No special block.

8. **`refreshDisplayTitle`**
   ```swift
   private func refreshDisplayTitle() {
       if let n = sessionName, !SessionTitleLogic.isPlaceholderName(n) {
           displayTitle = n
       } else {
           displayTitle = SessionTitleLogic.placeholderName
       }
   }
   ```
   Call from `applyState` when sessionName updates, init, finishTitleJob, markUserRenamed.

9. **First-round timing**
   - Spec: first user message sent → schedule generate when idle. Implementing solely on `agent_settled` + `titleRoundCount >= 1` satisfies “after first message” with idle gate (recommended, simpler, matches “if busy wait settled”).

- [ ] **Step 1: Add properties + helpers to `ChatSession`**

Implement fields and `markUserRenamedTitle`, `refreshDisplayTitle`, `cancelTitleJob`, `scheduleTitleJobIfNeeded`, `startTitleJob`, `finishTitleJob`.

- [ ] **Step 2: Rewire `handleEvent` agent_settled / message_* / abort**

Apply filter + settle ordering as above. Suppress `markUnseenCompletionAfterSuccessfulSettle` when finishing a title job.

- [ ] **Step 3: Build**

```bash
swift build 2>&1
```

Expected: success.

- [ ] **Step 4: Commit (skip if no git)**

```bash
git add Sources/PipiUI/ChatSession.swift
git commit -m "feat: ghost LLM session title job with transcript filter" || true
```

---

### Task 5: AppStore rename marks user renamed

**Files:**
- Modify: `Sources/PipiUI/AppStore.swift` `renameSession` (~432–455)

**Interfaces:**
- Consumes: `ChatSession.markUserRenamedTitle()`
- Produces: rename stops future auto titles

- [ ] **Step 1: In `renameSession`, after resolving live `session`:**

```swift
session.markUserRenamedTitle()
session.sessionName = trimmed
session.titleAnimationToken = nil // if token is internal, markUserRenamedTitle clears it
// Prefer only calling markUserRenamedTitle which sets name path:
session.setSessionName(trimmed)
```

Ensure optimistic `sessionName` update still happens. If `setSessionName` is async RPC, keep existing optimistic assign **and** `markUserRenamedTitle()`.

Also set `displayTitle` via session helper if needed.

- [ ] **Step 2: `swift build`**

- [ ] **Step 3: Commit (skip if no git)**

```bash
git add Sources/PipiUI/AppStore.swift
git commit -m "feat: manual rename disables auto session titles" || true
```

---

### Task 6: ChatDetailView session title (not Pipi UI) + typewriter

**Files:**
- Modify: `Sources/PipiUI/Views/ChatDetailView.swift`

**Interfaces:**
- Consumes: `session.displayTitle`, `session.titleAnimationToken`, `TypewriterText`

- [ ] **Step 1: Replace navigation title**

macOS `navigationTitle` is String-only. Use toolbar principal for typewriter:

```swift
// Remove or neutralize:
// .navigationTitle(session.sessionName ?? "Pipi UI")

.navigationTitle("") // or session.displayTitle if principal not used
.toolbar {
    ToolbarItem(placement: .principal) {
        TypewriterText(
            text: session.displayTitle,
            animationToken: session.titleAnimationToken,
            font: .headline
        )
        .frame(maxWidth: 360)
    }
    // existing subagent / web toggles unchanged
}
```

If empty `navigationTitle` causes layout issues, set `.navigationTitle(session.displayTitle)` **and** hide default title area only if principal works — verify in app. Minimum acceptance: visible title is session title / 新会话, never Pipi UI.

- [ ] **Step 2: Build**

```bash
swift build 2>&1
```

- [ ] **Step 3: Commit (skip if no git)**

```bash
git add Sources/PipiUI/Views/ChatDetailView.swift
git commit -m "feat: detail header shows session title with typewriter" || true
```

---

### Task 7: Sidebar session rows use typewriter + displayTitle

**Files:**
- Modify: `Sources/PipiUI/Views/SidebarView.swift` (`LiveSessionRow`, disk session row title views)

**Interfaces:**
- Consumes: `session.displayTitle`, `session.titleAnimationToken`, `TypewriterText`
- For disk-only rows (no open session): plain `Text(meta.name)` — **no** typewriter
- For live rows: `TypewriterText(text: title, animationToken: session.titleAnimationToken, font: .body)`

- [ ] **Step 1: Update `LiveSessionRow` title**

Replace plain title `Text` with:

```swift
TypewriterText(
    text: {
        if let name = session.sessionName, !name.isEmpty { return name }
        return fallbackTitle
    }(),
    animationToken: session.titleAnimationToken,
    font: .body
)
```

Or use `session.displayTitle` if fallbackTitle is always 新会话/meta — prefer wiring `displayTitle` and keep meta fallback only when `sessionName` nil: e.g. `let text = session.sessionName.flatMap { $0.isEmpty ? nil : $0 } ?? fallbackTitle`.

- [ ] **Step 2: Build**

```bash
swift build 2>&1
```

- [ ] **Step 3: Commit (skip if no git)**

```bash
git add Sources/PipiUI/Views/SidebarView.swift
git commit -m "feat: sidebar live session titles typewriter on auto-name" || true
```

---

### Task 8: Integration verification + acceptance pass

**Files:** none required unless bugs found

- [ ] **Step 1: Full test/build**

```bash
cd /Users/haoli/leehow/code/pipiui
swift test 2>&1
PIPIUI_SELF_TEST=1 swift run 2>&1
swift build -c release 2>&1
```

Expected: all existing + new title logic tests pass; release build OK.

- [ ] **Step 2: Manual checklist (when running app)**

1. Sidebar top shows Pipi UI with cyan second i; empty state too.
2. Open new session → header shows 新会话 not Pipi UI.
3. Send first chat message → after settle, title updates without new bubbles in transcript; typewriter on header + sidebar.
4. Send turns 2–5 with topic shift → title may change; still no ghost bubbles.
5. Turn 6+ → title stable.
6. Manual rename → no further auto changes; no typewriter required.
7. User queue / abort still work; stop during title job does not crash.
8. Dark mode cyan readable.

- [ ] **Step 3: Fix any regressions found; re-run `swift test` / `swift build`**

- [ ] **Step 4: Final commit if git exists**

```bash
git add -A
git commit -m "feat: brand header and LLM session titles" || true
```

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| Brand left header, second i cyan | T2 |
| Empty state brand | T2 |
| Main header = session title, fallback 新会话 | T6 |
| LLM via same-session RPC ghost prompt | T4 |
| Hidden from transcript | T4 event filter |
| First message → generate (idle after settle) | T4 |
| Rounds 1–5 review on settle | T1 + T4 |
| Stop after 5 / manual rename | T1 + T4 + T5 |
| Typewriter top + sidebar | T3 + T6 + T7 |
| 8–16 / parse / language via prompt | T1 parse + T4 prompts |
| set_session_name persist | T4 finishTitleJob |
| Idle gate / queue coexistence | T4 settle ordering |
| Window/Dock plain name unchanged | no task (explicit non-goal) |

## Placeholder scan

No TBD steps; concrete Swift snippets included. `onChange` API must match project (implementer checks one existing file).

## Type consistency

- `SessionTitleJobKind`: `.generate` / `.review`
- `SessionTitleLogic.maxAutoRounds == 5`
- `placeholderName == "新会话"`
- `ChatSession.displayTitle`, `titleAnimationToken`, `markUserRenamedTitle()`, `userRenamedTitle`, `titleRoundCount`
- `TypewriterText(text:animationToken:font:)`
- `BrandMark(size:)`
