# Message Actions (Copy / Edit / Branch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hover actions on chat messages — user Copy/Edit-resend, assistant Copy/Branch to a new sidebar session — wired through pi `fork` / `clone` / `switch_session`.

**Architecture:** Pure helpers extract copy text and decide clone-vs-fork. `ChatItem.entryId` is filled by aligning `get_entries` active-branch message entries with the transcript. `ChatSession` owns RPC orchestration; `AppStore` opens/rebinds session files; SwiftUI hover bar + inline editor sit on `MessageRow` / `AssistantSegmentsView`.

**Tech Stack:** SwiftUI macOS 14+, SwiftPM XCTest, pi RPC (`fork`, `clone`, `switch_session`, `get_entries`, `get_state`, `prompt`), AppKit `NSPasteboard`.

**Spec:** `docs/superpowers/specs/2026-07-24-message-actions-design.md`

## Global Constraints

- Copy assistant = visible markdown `.text` only (no thinking / tools / media).
- Edit = inline on user bubble → `fork(userEntryId)` then `prompt(edited)` on **current tab**; prior `.jsonl` remains on disk.
- Branch = new sidebar session; original tab restored via `switch_session(oldPath)` after fork/clone.
- No `navigate_tree` RPC; do not hand-truncate JSONL.
- Edit/Branch disabled while `session.isWorking`; Copy always allowed when text non-empty.
- Hide Edit/Branch for system / `[subagent-done]` and when `entryId == nil`.
- After successful compile meant for the runnable app ⇒ `./make-app.sh` and verify `build/PipiUI.app` mtime vs sources.
- Do not change `/copy` slash semantics or composer queue「撤回编辑」.

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/MessageActions.swift` | Pure copy text, action availability, branch strategy, entry-id alignment |
| `Tests/PipiUITests/MessageActionsTests.swift` | Unit tests for pure helpers |
| `Sources/PipiUI/ChatSession.swift` | `ChatItem.entryId`; sync from `get_entries`; `copyMessage` / `editAndResend` / `branchFromAssistant` |
| `Sources/PipiUI/AppStore.swift` | `openBranchedSession`; rebind open-session key after edit-fork |
| `Sources/PipiUI/AssistantBlockLayout.swift` | `assistantRun` carries `entryId` of last item in run |
| `Sources/PipiUI/Views/MessageActionBar.swift` | Hover icon bar |
| `Sources/PipiUI/Views/MessageViews.swift` | User hover/edit; assistant hover on `AssistantSegmentsView` |
| `Sources/PipiUI/Views/ChatDetailView.swift` | Wire callbacks + busy/edit state into rows |

---

### Task 1: Pure helpers — copy text, availability, branch strategy

**Files:**
- Create: `Sources/PipiUI/MessageActions.swift`
- Create: `Tests/PipiUITests/MessageActionsTests.swift`

**Interfaces:**
- Produces:
  ```swift
  enum MessageActions {
      static func copyableText(from item: ChatItem) -> String
      static func copyableText(from segments: [AssistantBlockLayout.Segment]) -> String
      static func showsMutatingActions(
          role: String,
          entryId: String?,
          displayText: String,
          isWorking: Bool
      ) -> Bool
      enum BranchOp: Equatable {
          case clone
          case fork(nextUserEntryId: String)
      }
      /// `runLastEntryId` = entry id of last assistant item in the coalesced run.
      /// `leafId` = current session leaf from `get_entries`.
      /// `nextUserEntryId` = first user entry after that run on the active branch (if any).
      static func branchOp(
          runLastEntryId: String,
          leafId: String?,
          nextUserEntryId: String?
      ) -> BranchOp?
  }
  ```

- [ ] **Step 1: Write failing tests**

```swift
import XCTest
@testable import PipiUI

final class MessageActionsTests: XCTestCase {
    func testCopyableTextUserJoinsTextOnly() {
        let item = ChatItem(
            id: "item-1",
            role: "user",
            blocks: [
                .text("hello"),
                .image(ImageBlock(id: "i", data: Data([1]), mimeType: "image/png")),
                .text("world"),
            ],
            entryId: "e1"
        )
        XCTAssertEqual(MessageActions.copyableText(from: item), "hello\nworld")
    }

    func testCopyableTextAssistantSkipsThinkingAndTools() {
        let item = ChatItem(
            id: "a",
            role: "assistant",
            blocks: [
                .thinking("secret"),
                .toolCall(ToolCallBlock(id: "t", name: "bash", argsSummary: "ls")),
                .text("visible"),
            ],
            entryId: "e2"
        )
        XCTAssertEqual(MessageActions.copyableText(from: item), "visible")
    }

    func testCopyableTextFromSegments() {
        let segments: [AssistantBlockLayout.Segment] = [
            .singleton(.thinking("x")),
            .text("A"),
            .finishedGroup([.toolCall(ToolCallBlock(id: "1", name: "read", argsSummary: "f"))]),
            .text("B"),
        ]
        XCTAssertEqual(MessageActions.copyableText(from: segments), "A\nB")
    }

    func testMutatingActionsRequireEntryIdAndIdle() {
        XCTAssertFalse(MessageActions.showsMutatingActions(
            role: "user", entryId: nil, displayText: "hi", isWorking: false))
        XCTAssertFalse(MessageActions.showsMutatingActions(
            role: "user", entryId: "e", displayText: "hi", isWorking: true))
        XCTAssertFalse(MessageActions.showsMutatingActions(
            role: "system", entryId: "e", displayText: "hi", isWorking: false))
        XCTAssertFalse(MessageActions.showsMutatingActions(
            role: "user", entryId: "e", displayText: "[subagent-done] x", isWorking: false))
        XCTAssertTrue(MessageActions.showsMutatingActions(
            role: "user", entryId: "e", displayText: "hi", isWorking: false))
    }

    func testBranchOpCloneWhenRunIsLeaf() {
        XCTAssertEqual(
            MessageActions.branchOp(runLastEntryId: "a3", leafId: "a3", nextUserEntryId: nil),
            .clone
        )
    }

    func testBranchOpForkNextUserWhenNotLeaf() {
        XCTAssertEqual(
            MessageActions.branchOp(runLastEntryId: "a1", leafId: "u2", nextUserEntryId: "u2"),
            .fork(nextUserEntryId: "u2")
        )
    }

    func testBranchOpNilWithoutNextUserWhenNotLeaf() {
        XCTAssertNil(
            MessageActions.branchOp(runLastEntryId: "a1", leafId: "a9", nextUserEntryId: nil)
        )
    }
}
```

- [ ] **Step 2: Run tests — expect fail**

Run: `swift test --filter MessageActionsTests`  
Expected: FAIL (type/module missing)

- [ ] **Step 3: Implement `MessageActions.swift`**

```swift
import Foundation

enum MessageActions {
    static func copyableText(from item: ChatItem) -> String {
        item.blocks.compactMap { block -> String? in
            if case .text(let t) = block { return t }
            return nil
        }
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func copyableText(from segments: [AssistantBlockLayout.Segment]) -> String {
        segments.compactMap { seg -> String? in
            if case .text(let t) = seg { return t }
            return nil
        }
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func showsMutatingActions(
        role: String,
        entryId: String?,
        displayText: String,
        isWorking: Bool
    ) -> Bool {
        guard !isWorking, entryId != nil else { return false }
        guard role == "user" || role == "assistant" else { return false }
        if displayText.hasPrefix("[subagent-done]") { return false }
        return true
    }

    enum BranchOp: Equatable {
        case clone
        case fork(nextUserEntryId: String)
    }

    static func branchOp(
        runLastEntryId: String,
        leafId: String?,
        nextUserEntryId: String?
    ) -> BranchOp? {
        if leafId == runLastEntryId { return .clone }
        if let nextUserEntryId { return .fork(nextUserEntryId: nextUserEntryId) }
        return nil
    }
}
```

Note: Task 2 adds `entryId` to `ChatItem`. Until then, tests that construct `ChatItem(..., entryId:)` will not compile — **implement Task 2 Step 3's `ChatItem` change before or as part of making Task 1 compile**. Prefer: add `entryId` default `nil` on `ChatItem` first (tiny additive change), then land helpers.

Minimal `ChatItem` additive (do with Step 3 if needed):

```swift
struct ChatItem: Identifiable, Equatable {
    let id: String
    let role: String
    var blocks: [ChatBlock]
    var entryId: String? = nil
}
```

All existing `ChatItem(...)` call sites keep compiling via default.

- [ ] **Step 4: Run tests — expect pass**

Run: `swift test --filter MessageActionsTests`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/MessageActions.swift Tests/PipiUITests/MessageActionsTests.swift Sources/PipiUI/ChatSession.swift
git commit -m "feat(chat): add message action pure helpers"
```

---

### Task 2: Align `entryId` from `get_entries`

**Files:**
- Modify: `Sources/PipiUI/MessageActions.swift`
- Modify: `Sources/PipiUI/ChatSession.swift` (`buildTranscript` optional pass-through, `beginInitialMessagesLoad`, `ingest`, sync helper)
- Modify: `Tests/PipiUITests/MessageActionsTests.swift`
- Modify: `Sources/PipiUI/AssistantBlockLayout.swift` (`assistantRun` carries `entryId`)

**Interfaces:**
- Consumes: `ChatItem.entryId`
- Produces:
  ```swift
  extension MessageActions {
      /// `entries` = `get_entries` data.entries; `leafId` = data.leafId.
      /// Returns user/assistant message entries on the active branch, oldest → newest.
      static func activeBranchMessages(entries: [J], leafId: String?) -> [J]

      /// Zip active-branch user/assistant messages onto transcript items (same order/filters).
      static func applyingEntryIds(items: [ChatItem], branchMessages: [J]) -> [ChatItem]

      /// First user entry id after `afterEntryId` on the branch list; nil if none.
      static func nextUserEntryId(after afterEntryId: String, branchMessages: [J]) -> String?
  }
  ```

- [ ] **Step 1: Write failing alignment tests**

```swift
func testActiveBranchWalksParentChain() {
    // entries append-order with an abandoned sibling; leaf = e4
    let entries: [J] = [
        J.parse(#"{"type":"message","id":"e1","parentId":null,"message":{"role":"user","content":"u1"}}"#)!,
        J.parse(#"{"type":"message","id":"e2","parentId":"e1","message":{"role":"assistant","content":"a1"}}"#)!,
        J.parse(#"{"type":"message","id":"eX","parentId":"e1","message":{"role":"assistant","content":"abandoned"}}"#)!,
        J.parse(#"{"type":"message","id":"e3","parentId":"e2","message":{"role":"user","content":"u2"}}"#)!,
        J.parse(#"{"type":"message","id":"e4","parentId":"e3","message":{"role":"assistant","content":"a2"}}"#)!,
    ]
    let branch = MessageActions.activeBranchMessages(entries: entries, leafId: "e4")
    XCTAssertEqual(branch.compactMap { $0["id"].string }, ["e1", "e2", "e3", "e4"])
}

func testApplyingEntryIdsZipsUserAssistantOnly() {
    var items = [
        ChatItem(id: "item-1", role: "user", blocks: [.text("u1")]),
        ChatItem(id: "item-2", role: "assistant", blocks: [.text("a1")]),
        ChatItem(id: "item-3", role: "system", blocks: [.text("$ ls")]),
        ChatItem(id: "item-4", role: "user", blocks: [.text("u2")]),
    ]
    let branch: [J] = [
        J.parse(#"{"type":"message","id":"e1","message":{"role":"user"}}"#)!,
        J.parse(#"{"type":"message","id":"e2","message":{"role":"assistant"}}"#)!,
        J.parse(#"{"type":"message","id":"e3","message":{"role":"user"}}"#)!,
    ]
    items = MessageActions.applyingEntryIds(items: items, branchMessages: branch)
    XCTAssertEqual(items[0].entryId, "e1")
    XCTAssertEqual(items[1].entryId, "e2")
    XCTAssertNil(items[2].entryId) // system skipped in zip
    XCTAssertEqual(items[3].entryId, "e3")
}

func testNextUserEntryId() {
    let branch: [J] = [
        J.parse(#"{"id":"e1","message":{"role":"user"}}"#)!,
        J.parse(#"{"id":"e2","message":{"role":"assistant"}}"#)!,
        J.parse(#"{"id":"e3","message":{"role":"user"}}"#)!,
    ]
    XCTAssertEqual(MessageActions.nextUserEntryId(after: "e2", branchMessages: branch), "e3")
    XCTAssertNil(MessageActions.nextUserEntryId(after: "e3", branchMessages: branch))
}

func testPlanTranscriptCarriesLastEntryId() {
    let items = [
        ChatItem(id: "item-1", role: "assistant", blocks: [.text("a")], entryId: "e1"),
        ChatItem(id: "item-2", role: "assistant", blocks: [.toolCall(ToolCallBlock(id: "t", name: "bash", argsSummary: "x"))], entryId: "e2"),
    ]
    let rows = AssistantBlockLayout.planTranscript(items: items)
    guard case .assistantRun(_, let entryId, _) = rows[0] else {
        return XCTFail("expected assistantRun")
    }
    XCTAssertEqual(entryId, "e2")
}
```

Adapt `J.parse` to the repo’s real JSON helper (see existing tests).

- [ ] **Step 2: Run — expect fail**

Run: `swift test --filter MessageActionsTests`  
Expected: FAIL on new symbols / `assistantRun` shape

- [ ] **Step 3: Implement alignment + `assistantRun.entryId`**

In `MessageActions.swift`:

```swift
static func activeBranchMessages(entries: [J], leafId: String?) -> [J] {
    guard let leafId else { return [] }
    var byId: [String: J] = [:]
    for e in entries {
        if let id = e["id"].string { byId[id] = e }
    }
    var chain: [J] = []
    var current: String? = leafId
    var guardCount = 0
    while let id = current, let entry = byId[id], guardCount < 100_000 {
        guardCount += 1
        if entry["type"].string == "message",
           let role = entry["message"]["role"].string,
           role == "user" || role == "assistant" {
            chain.append(entry)
        }
        current = entry["parentId"].string
    }
    return chain.reversed()
}

static func applyingEntryIds(items: [ChatItem], branchMessages: [J]) -> [ChatItem] {
    var ids = branchMessages.compactMap { $0["id"].string }
    var i = 0
    return items.map { item in
        guard item.role == "user" || item.role == "assistant", i < ids.count else {
            return item
        }
        var copy = item
        copy.entryId = ids[i]
        i += 1
        return copy
    }
}

static func nextUserEntryId(after afterEntryId: String, branchMessages: [J]) -> String? {
    guard let idx = branchMessages.firstIndex(where: { $0["id"].string == afterEntryId }) else {
        return nil
    }
    for e in branchMessages.suffix(from: branchMessages.index(after: idx)) {
        if e["message"]["role"].string == "user", let id = e["id"].string {
            return id
        }
    }
    return nil
}
```

`AssistantBlockLayout.TranscriptRow`:

```swift
case assistantRun(id: String, entryId: String?, segments: [Segment])
```

In `flushAssistant()`:

```swift
result.append(.assistantRun(id: last.id, entryId: last.entryId, segments: segments))
```

Update all `assistantRun` switch sites / tests accordingly.

`ChatSession` sync:

```swift
/// After transcript assign (initial or post-fork), fetch entries and stamp entryIds.
private func syncEntryIds(completion: (() -> Void)? = nil) {
    proc?.request(["type": "get_entries"]) { [weak self] resp in
        guard let self else { return }
        guard resp["success"].bool == true else {
            completion?()
            return
        }
        let entries = resp["data"]["entries"].array
        let leafId = resp["data"]["leafId"].string
        let branch = MessageActions.activeBranchMessages(entries: entries, leafId: leafId)
        self.transcript = MessageActions.applyingEntryIds(items: self.transcript, branchMessages: branch)
        self.cachedBranchMessages = branch
        self.cachedLeafId = leafId
        completion?()
    }
}
```

Add:

```swift
private var cachedBranchMessages: [J] = []
private var cachedLeafId: String?
```

Call `syncEntryIds()` at end of `applyInitialTranscript`, after `agent_settled` (idle), and after successful edit-fork / branch switch-back reloads.

Also call `syncEntryIds` once after `ingest` of user/assistant when not streaming (or always on `agent_settled` — prefer single settle sync to avoid races).

- [ ] **Step 4: Fix compile fallout**

Update `AssistantBlockLayoutTests` / `ChatDetailView` switches for new `assistantRun` associated value.

Run: `swift test --filter MessageActionsTests`  
Run: `swift test --filter AssistantBlockLayoutTests`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/MessageActions.swift Sources/PipiUI/ChatSession.swift \
  Sources/PipiUI/AssistantBlockLayout.swift Sources/PipiUI/Views/ChatDetailView.swift \
  Tests/PipiUITests/MessageActionsTests.swift Tests/PipiUITests/AssistantBlockLayoutTests.swift
git commit -m "feat(chat): stamp ChatItem.entryId from get_entries"
```

---

### Task 3: Copy + Edit-and-resend on `ChatSession`

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift`
- Modify: `Sources/PipiUI/AppStore.swift` (rebind helper used after fork)
- Test: extend `MessageActionsTests` for edit no-op predicate if extracted

**Interfaces:**
- Consumes: `MessageActions.copyableText`, `entryId`, `syncEntryIds`
- Produces:
  ```swift
  // ChatSession
  @Published var editingItemId: String?   // local ChatItem.id
  func copyItemText(_ item: ChatItem)
  func copySegmentsText(_ segments: [AssistantBlockLayout.Segment])
  func beginEditingUserMessage(itemId: String)
  func cancelEditingUserMessage()
  func commitEditingUserMessage(newText: String)
  // AppStore
  func rebindOpenSessionFile(key: String, newPath: String)
  ```

- [ ] **Step 1: Add no-op predicate test**

```swift
func testEditNoOpWhenUnchangedAndIsLastUser() {
    // Pure helper:
    XCTAssertTrue(MessageActions.shouldNoOpEdit(
        originalText: "hi",
        newText: "hi",
        itemEntryId: "e3",
        leafId: "e3"
    ))
    XCTAssertFalse(MessageActions.shouldNoOpEdit(
        originalText: "hi",
        newText: "hi",
        itemEntryId: "e1",
        leafId: "e3"
    ))
    XCTAssertFalse(MessageActions.shouldNoOpEdit(
        originalText: "hi",
        newText: "hey",
        itemEntryId: "e3",
        leafId: "e3"
    ))
}
```

Implement:

```swift
static func shouldNoOpEdit(
    originalText: String,
    newText: String,
    itemEntryId: String,
    leafId: String?
) -> Bool {
    originalText == newText && leafId == itemEntryId
}
```

(Spec: unchanged **and** nothing after — if the user message is the leaf, there is no later content. If leaf is an assistant child of that user, treat as “has content after” → not no-op when text unchanged? Spec says: “文案未变且其后无内容”. So leaf must be the user entry itself OR we check no branch messages after the user entry.)

Prefer:

```swift
static func shouldNoOpEdit(
    originalText: String,
    newText: String,
    itemEntryId: String,
    branchMessages: [J]
) -> Bool {
    guard originalText == newText else { return false }
    guard let idx = branchMessages.firstIndex(where: { $0["id"].string == itemEntryId }) else {
        return false
    }
    return branchMessages.index(after: idx) == branchMessages.endIndex
}
```

- [ ] **Step 2: Run filter — expect fail then implement helper — pass**

- [ ] **Step 3: Implement session methods**

```swift
func copyItemText(_ item: ChatItem) {
    let text = MessageActions.copyableText(from: item)
    guard !text.isEmpty else {
        flash("没有可复制的内容")
        return
    }
    let pb = NSPasteboard.general
    pb.clearContents()
    pb.setString(text, forType: .string)
    flash("已复制（\(text.count) 字符）")
}

func copySegmentsText(_ segments: [AssistantBlockLayout.Segment]) {
    let text = MessageActions.copyableText(from: segments)
    guard !text.isEmpty else {
        flash("没有可复制的内容")
        return
    }
    let pb = NSPasteboard.general
    pb.clearContents()
    pb.setString(text, forType: .string)
    flash("已复制（\(text.count) 字符）")
}

func beginEditingUserMessage(itemId: String) {
    guard !isWorking else { return }
    editingItemId = itemId
}

func cancelEditingUserMessage() {
    editingItemId = nil
}

func commitEditingUserMessage(newText: String) {
    let trimmed = newText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let itemId = editingItemId,
          let item = transcript.first(where: { $0.id == itemId }),
          let entryId = item.entryId else {
        editingItemId = nil
        return
    }
    let original = MessageActions.copyableText(from: item)
    if MessageActions.shouldNoOpEdit(
        originalText: original,
        newText: trimmed,
        itemEntryId: entryId,
        branchMessages: cachedBranchMessages
    ) {
        editingItemId = nil
        return
    }
    guard let oldPath = sessionFile, !oldPath.isEmpty else {
        flash("会话尚未保存，稍后再试")
        editingItemId = nil
        return
    }
    guard !isWorking else {
        flash("请等待当前任务结束")
        return
    }
    editingItemId = nil
    let previousPath = oldPath
    proc?.request(["type": "fork", "entryId": entryId]) { [weak self] resp in
        guard let self else { return }
        guard resp["success"].bool == true,
              resp["data"]["cancelled"].bool != true else {
            self.flash(resp["error"].string ?? "编辑失败")
            return
        }
        // Process rebound to forked file — refresh sessionFile via get_state, then prompt.
        self.proc?.request(["type": "get_state"]) { [weak self] stateResp in
            guard let self else { return }
            self.applyState(stateResp["data"])
            let newPath = self.sessionFile
            if let newPath, newPath != previousPath {
                self.onSessionFileRebound?(previousPath, newPath)
            }
            self.reloadTranscriptAfterSessionReplace {
                self.sendPromptNow(message: trimmed, images: [])
            }
        }
    }
}
```

Add:

```swift
/// AppStore rekeys `resume:` open session when edit-fork changes the file.
var onSessionFileRebound: ((String, String) -> Void)?
```

Implement `reloadTranscriptAfterSessionReplace` as: clear streaming state → `get_messages` + `buildTranscript` + `syncEntryIds` → then `completion`.

`AppStore.makeSession` wire:

```swift
session.onSessionFileRebound = { [weak self] oldPath, newPath in
    self?.rebindOpenSessionFile(from: oldPath, to: newPath)
}

func rebindOpenSessionFile(from oldPath: String, to newPath: String) {
    // If open key is resume:oldPath, move to resume:newPath keeping same ChatSession instance.
    let oldKey = "resume:\(oldPath)"
    let newKey = "resume:\(newPath)"
    if let session = openSessions[oldKey] {
        openSessions.removeValue(forKey: oldKey)
        openSessions[newKey] = session
        if selectedSessionKey == oldKey { selectedSessionKey = newKey }
    }
    // Also scan values for matching sessionFile (new: UUID keys).
    for (key, session) in openSessions where session.sessionFile == newPath || key.contains(oldPath) {
        _ = key // session.sessionFile already updated by applyState
    }
    upsertLiveSessionMeta(project: /* from session */, file: newPath, name: session.sessionName ?? "新会话")
    if let project = openSessions[newKey]?.projectURL ?? openSessions.values.first(where: { $0.sessionFile == newPath })?.projectURL {
        refreshSessions(for: project)
    }
}
```

Keep rebind logic tight: prefer finding the `ChatSession` instance by identity / oldPath and updating dictionary keys only when they embed the path.

- [ ] **Step 4: Compile + unit tests**

Run: `swift test --filter MessageActionsTests`  
Run: `swift build`  
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/ChatSession.swift Sources/PipiUI/AppStore.swift Sources/PipiUI/MessageActions.swift Tests/PipiUITests/MessageActionsTests.swift
git commit -m "feat(chat): copy and edit-resend via pi fork"
```

---

### Task 4: Branch from assistant → new sidebar session

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift`
- Modify: `Sources/PipiUI/AppStore.swift`

**Interfaces:**
- Consumes: `MessageActions.branchOp`, `nextUserEntryId`, cached branch/leaf
- Produces:
  ```swift
  // ChatSession
  func branchFromAssistant(runLastEntryId: String)
  var onBranchedSessionReady: ((String) -> Void)?  // new session file path

  // AppStore
  func openBranchedSession(path: String, project: URL, suggestedName: String)
  ```

- [ ] **Step 1: Implement `branchFromAssistant`**

```swift
func branchFromAssistant(runLastEntryId: String) {
    guard !isWorking else {
        flash("请等待当前任务结束")
        return
    }
    guard let oldPath = sessionFile, !oldPath.isEmpty else {
        flash("会话尚未保存，稍后再试")
        return
    }
    // Refresh leaf/branch once before deciding.
    proc?.request(["type": "get_entries"]) { [weak self] resp in
        guard let self else { return }
        guard resp["success"].bool == true else {
            self.flash(resp["error"].string ?? "无法读取会话树")
            return
        }
        let entries = resp["data"]["entries"].array
        let leafId = resp["data"]["leafId"].string
        let branch = MessageActions.activeBranchMessages(entries: entries, leafId: leafId)
        self.cachedBranchMessages = branch
        self.cachedLeafId = leafId
        let nextUser = MessageActions.nextUserEntryId(after: runLastEntryId, branchMessages: branch)
        guard let op = MessageActions.branchOp(
            runLastEntryId: runLastEntryId,
            leafId: leafId,
            nextUserEntryId: nextUser
        ) else {
            self.flash("无法从此消息创建分支")
            return
        }
        let request: [String: Any]
        switch op {
        case .clone:
            request = ["type": "clone"]
        case .fork(let userId):
            request = ["type": "fork", "entryId": userId]
        }
        self.proc?.request(request) { [weak self] forkResp in
            guard let self else { return }
            guard forkResp["success"].bool == true,
                  forkResp["data"]["cancelled"].bool != true else {
                self.flash(forkResp["error"].string ?? "创建分支失败")
                return
            }
            self.proc?.request(["type": "get_state"]) { [weak self] stateResp in
                guard let self else { return }
                let newPath = stateResp["data"]["sessionFile"].string
                guard let newPath, !newPath.isEmpty, newPath != oldPath else {
                    self.flash("创建分支失败：未得到新会话文件")
                    // Best-effort return home
                    self.proc?.request(["type": "switch_session", "sessionPath": oldPath]) { _ in }
                    return
                }
                self.proc?.request(["type": "switch_session", "sessionPath": oldPath]) { [weak self] switchResp in
                    guard let self else { return }
                    guard switchResp["success"].bool == true,
                          switchResp["data"]["cancelled"].bool != true else {
                        self.flash(switchResp["error"].string ?? "恢复原会话失败")
                        return
                    }
                    self.applyState(switchResp["data"].exists ? switchResp["data"] : J.parse("{}")!)
                    // switch_session response may not include full state — get_state + reload
                    self.proc?.request(["type": "get_state"]) { [weak self] st in
                        guard let self else { return }
                        self.applyState(st["data"])
                        self.reloadTranscriptAfterSessionReplace {
                            self.onBranchedSessionReady?(newPath)
                            self.flash("已创建分支会话")
                        }
                    }
                }
            }
        }
    }
}
```

Note: `switch_session` success payload is `{cancelled:false}` only — always follow with `get_state` + transcript reload. If `applyState` on empty is awkward, skip that line and only `get_state`.

- [ ] **Step 2: `AppStore.openBranchedSession`**

```swift
func openBranchedSession(path: String, project: URL, suggestedName: String) {
    let key = "resume:\(path)"
    if openSessions[key] == nil {
        openSessions[key] = makeSession(key: key, project: project, sessionPath: path)
    }
    selectedSessionKey = key
    // Name after process is up — use existing rename path when ready:
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        self?.openSessions[key]?.renameSession(suggestedName) // or setSessionName API already used by /name
    }
    upsertLiveSessionMeta(project: project, file: path, name: suggestedName)
    refreshSessions(for: project)
}
```

Wire in `makeSession`:

```swift
session.onBranchedSessionReady = { [weak self, weak session] newPath in
    guard let self, let session else { return }
    let base = session.sessionName?.trimmingCharacters(in: .whitespacesAndNewlines)
    let label: String
    if let base, !base.isEmpty, !SessionTitleLogic.isPlaceholderName(base) {
        label = "分支 · \(base)"
    } else {
        let formatter = DateFormatter()
        formatter.dateFormat = "HHmmss"
        label = "分支 · \(formatter.string(from: Date()))"
    }
    let clipped = label.count > 40 ? String(label.prefix(39)) + "…" : label
    self.openBranchedSession(path: newPath, project: session.projectURL, suggestedName: clipped)
}
```

Use the real rename/set_session_name method name already on `ChatSession` (see `/name` / `setSessionName`).

- [ ] **Step 3: Build**

Run: `swift build`  
Expected: success

- [ ] **Step 4: Commit**

```bash
git add Sources/PipiUI/ChatSession.swift Sources/PipiUI/AppStore.swift
git commit -m "feat(chat): branch assistant reply into new session"
```

---

### Task 5: Hover action bar + user inline edit UI

**Files:**
- Create: `Sources/PipiUI/Views/MessageActionBar.swift`
- Modify: `Sources/PipiUI/Views/MessageViews.swift` (`MessageRow`)
- Modify: `Sources/PipiUI/Views/ChatDetailView.swift`

**Interfaces:**
- Consumes: session copy/edit/branch APIs; `showsMutatingActions`
- Produces: interactive UI only

- [ ] **Step 1: `MessageActionBar`**

```swift
import SwiftUI

struct MessageActionBar: View {
    enum Alignment { case trailing, leading }
    var alignment: Alignment
    var showEdit: Bool = false
    var showBranch: Bool = false
    var onCopy: () -> Void
    var onEdit: (() -> Void)? = nil
    var onBranch: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 6) {
            iconButton("doc.on.doc", help: "复制", action: onCopy)
            if showEdit, let onEdit {
                iconButton("pencil", help: "编辑", action: onEdit)
            }
            if showBranch, let onBranch {
                iconButton("arrow.branch", help: "创建分支会话", action: onBranch)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.regularMaterial, in: Capsule())
        .frame(maxWidth: .infinity, alignment: alignment == .trailing ? .trailing : .leading)
    }

    private func iconButton(_ systemName: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .medium))
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
    }
}
```

If `arrow.branch` unavailable on the deployment macOS, use `arrow.triangle.branch`.

- [ ] **Step 2: Extend `MessageRow` for user hover + edit**

Add parameters (defaults keep Equatable tests working):

```swift
var isWorking: Bool = false
var isEditing: Bool = false
var onCopy: (() -> Void)? = nil
var onBeginEdit: (() -> Void)? = nil
var onCancelEdit: (() -> Void)? = nil
var onCommitEdit: ((String) -> Void)? = nil
```

Exclude callbacks from `==` (same as `onFlash`).

User column:

```swift
@State private var hovered = false
@State private var draft = ""

// in userView VStack after bubble:
if isEditing {
    VStack(alignment: .trailing, spacing: 8) {
        TextEditor(text: $draft)
            .font(.body)
            .frame(minHeight: 60, maxHeight: 180)
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.accentColor.opacity(0.85)))
        HStack {
            Button("取消") { onCancelEdit?() }
            Button("发送") { onCommitEdit?(draft) }
                .keyboardShortcut(.defaultAction)
        }
    }
    .onAppear { draft = MessageActions.copyableText(from: item) }
    .onExitCommand { onCancelEdit?() }
} else {
    // existing bubble…
    if hovered {
        MessageActionBar(
            alignment: .trailing,
            showEdit: MessageActions.showsMutatingActions(
                role: item.role,
                entryId: item.entryId,
                displayText: userDisplayText,
                isWorking: isWorking
            ),
            onCopy: { onCopy?() },
            onEdit: { onBeginEdit?() }
        )
    }
}
.onHover { hovered = $0 }
```

- [ ] **Step 3: Wire `ChatDetailView` leaf user rows**

```swift
MessageRow(
    item: item,
    ...
    isWorking: session.isWorking,
    isEditing: session.editingItemId == item.id,
    onCopy: { session.copyItemText(item) },
    onBeginEdit: { session.beginEditingUserMessage(itemId: item.id) },
    onCancelEdit: { session.cancelEditingUserMessage() },
    onCommitEdit: { session.commitEditingUserMessage(newText: $0) }
)
```

- [ ] **Step 4: Build**

Run: `swift build`  
Expected: success

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/Views/MessageActionBar.swift Sources/PipiUI/Views/MessageViews.swift Sources/PipiUI/Views/ChatDetailView.swift
git commit -m "feat(chat): hover action bar and inline user edit"
```

---

### Task 6: Assistant hover Copy + Branch

**Files:**
- Modify: `Sources/PipiUI/Views/MessageViews.swift` (`AssistantSegmentsView`)
- Modify: `Sources/PipiUI/Views/ChatDetailView.swift`

- [ ] **Step 1: Extend `AssistantSegmentsView`**

```swift
var entryId: String? = nil
var isWorking: Bool = false
var onCopy: (() -> Void)? = nil
var onBranch: (() -> Void)? = nil
@State private var hovered = false
```

Wrap content:

```swift
VStack(alignment: .leading, spacing: 6) {
    // existing segments UI
    if hovered {
        MessageActionBar(
            alignment: .leading,
            showBranch: MessageActions.showsMutatingActions(
                role: "assistant",
                entryId: entryId,
                displayText: MessageActions.copyableText(from: segments),
                isWorking: isWorking
            ),
            onCopy: { onCopy?() },
            onBranch: { onBranch?() }
        )
    }
}
.onHover { hovered = $0 }
```

- [ ] **Step 2: Wire in `ChatDetailView`**

```swift
case .assistantRun(let id, let entryId, let segments):
    AssistantSegmentsView(
        segments: segments,
        ...
        entryId: entryId,
        isWorking: session.isWorking,
        onCopy: { session.copySegmentsText(segments) },
        onBranch: {
            guard let entryId else { return }
            session.branchFromAssistant(runLastEntryId: entryId)
        }
    )
```

Also pass the same for the live streaming assistant path if it uses `MessageRow` / segments — Copy only while streaming (`showBranch` false via `isWorking`).

- [ ] **Step 3: Build + focused tests**

Run: `swift test --filter MessageActionsTests`  
Run: `swift test --filter AssistantBlockLayoutTests`  
Run: `swift build`  
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add Sources/PipiUI/Views/MessageViews.swift Sources/PipiUI/Views/ChatDetailView.swift
git commit -m "feat(chat): assistant copy and branch actions"
```

---

### Task 7: Package app + manual verification

**Files:** none (ship path only)

- [ ] **Step 1: Test suite**

Run: `swift test`  
Expected: PASS (or only pre-existing failures unrelated to this work — do not ignore new failures)

- [ ] **Step 2: Package**

Run: `./make-app.sh`  
Then:

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  Sources/PipiUI/MessageActions.swift \
  Sources/PipiUI/Views/MessageActionBar.swift \
  Sources/PipiUI/ChatSession.swift
```

Expected: app binary mtime ≥ source mtimes.

- [ ] **Step 3: Manual checklist**

1. Hover user → Copy → clipboard has text.
2. Edit mid-thread user → Send → tab truncates + new reply; old session still in sidebar.
3. Hover assistant → Copy → body only (no tool JSON).
4. Branch → new sidebar session named `分支 · …` with history through that reply; original unchanged.
5. While streaming: Edit/Branch disabled; Copy works.
6. Kill pi mid-fork (or invalid entryId) → flash error; transcript intact.

- [ ] **Step 4: Final commit if packaging scripts/docs touched; else stop**

```bash
git status
# commit only if Step 2/3 forced doc tweaks
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| User Copy | 1, 3, 5 |
| User Edit-resend (fork + prompt, current tab) | 3, 5 |
| Assistant Copy (text only) | 1, 6 |
| Assistant Branch (new session, original restored) | 1, 4, 6 |
| Hover bar | 5, 6 |
| Inline edit Cancel/Send | 5 |
| `entryId` gating | 1, 2, 5, 6 |
| Busy disables mutate | 1, 5, 6 |
| No thinking/tools in copy | 1 |
| Errors / unsaved session | 3, 4 |
| `make-app.sh` | 7 |
| Non-goals (tree UI, regenerate, `/copy` unchanged) | honored (no tasks) |

## Type consistency

- `ChatItem.entryId: String?`
- `AssistantBlockLayout.TranscriptRow.assistantRun(id:entryId:segments:)`
- `MessageActions.BranchOp` = `.clone` / `.fork(nextUserEntryId:)`
- `ChatSession.editingItemId`, `onSessionFileRebound`, `onBranchedSessionReady`
- `AppStore.rebindOpenSessionFile`, `openBranchedSession`
