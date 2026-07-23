# Session Message Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the agent is busy, user submits enter a per-session local follow-up queue, drain on idle in order, support bulk restore-to-editor, and abort-then-send-first intercept.

**Architecture:** Keep a pure `SessionMessageQueue` state machine (testable without spawning pi). `ChatSession` owns one instance, enqueues when `isStreaming`, drains on `agent_settled`/idle via direct RPC `prompt` (no `streamingBehavior`). `InputBar` shows a compact strip and wires 撤回编辑; Stop calls `abort()` which sets intercept-when-queue-nonempty.

**Tech Stack:** Swift / SwiftUI macOS 14+, existing `PiProcess` JSONL RPC, `SelfTest` via `PIPIUI_SELF_TEST=1 swift run`.

**Spec:** `docs/superpowers/specs/2026-07-23-session-message-queue-design.md`

## Global Constraints

- Busy Enter must **never** set `streamingBehavior: "steer"` (remove that path).
- Default busy delivery is **follow-up semantics** via local queue + idle drain (not pi `follow_up` RPC — no clear_queue in RPC).
- Withdraw is **bulk only** (all items → composer); no per-item edit UI this iteration.
- Stop with non-empty queue: `abort` → on idle **send queue head**; remainder stays queued.
- Stop with empty queue: `abort` only.
- Queue items may carry images; prepare attachment paths **at enqueue** time.
- No git repo in this workspace historically — **skip commit steps** if `git status` fails; still finish verification.
- Do not add steer dual-mode, disk persistence, or upstream pi RPC changes.

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/SessionMessageQueue.swift` | **Create** — `QueuedMessage` + pure queue state machine |
| `Sources/PipiUI/ChatSession.swift` | Wire queue into send/abort/agent_settled; expose published queue + restore API |
| `Sources/PipiUI/Views/InputBar.swift` | Placeholder, queue strip, restore, stop help text |
| `Sources/PipiUI/SelfTest.swift` | Pure tests for queue machine + restore join rules |
| `README.md` | Replace steer wording with queue / 撤回 / 阻截 |

---

### Task 1: Pure `SessionMessageQueue` + SelfTest

**Files:**
- Create: `Sources/PipiUI/SessionMessageQueue.swift`
- Modify: `Sources/PipiUI/SelfTest.swift` (append checks before final `print("---")`)
- Test: `PIPIUI_SELF_TEST=1 swift run`

**Interfaces:**
- Produces:
  - `struct QueuedMessage: Identifiable` with `id: UUID`, `text: String`, `images: [DraftImage]`
  - `struct SessionMessageQueue` with:
    - `private(set) var items: [QueuedMessage]`
    - `private(set) var interceptSendFirst: Bool`
    - `mutating func enqueue(text: String, images: [DraftImage] = []) -> Bool` — returns false if both empty after trim
    - `mutating func restoreAll() -> (text: String, images: [DraftImage])` — clears items + intercept; joins texts with `"\n\n"`; concatenates images in order
    - `mutating func noteAbort()` — if `!items.isEmpty { interceptSendFirst = true }`
    - `mutating func clearIntercept()` 
    - `mutating func popForIdleDrain(isStreaming: Bool, processAlive: Bool) -> QueuedMessage?` — returns head only when `processAlive && !isStreaming && !items.isEmpty && (interceptSendFirst || !items.isEmpty)`; always clears `interceptSendFirst` when popping; if not idle or empty or dead → nil (and if empty, clear intercept)
    - `mutating func requeueFront(_ msg: QueuedMessage)` — on send failure
  - Static helper optional: `SessionMessageQueue.joinTexts(_ texts: [String]) -> String` using `"\n\n"`

**Notes:**
- `DraftImage` is not `Equatable`; do **not** make `QueuedMessage`/`SessionMessageQueue` require full Equatable on images. Compare by `id` in tests.
- Keep types in the main target (no new test target) so SelfTest can call them.

- [ ] **Step 1: Add `SessionMessageQueue.swift`**

```swift
import Foundation

struct QueuedMessage: Identifiable {
    let id: UUID
    var text: String
    var images: [DraftImage]

    init(id: UUID = UUID(), text: String, images: [DraftImage] = []) {
        self.id = id
        self.text = text
        self.images = images
    }
}

/// Pure session follow-up queue (no RPC). ChatSession owns one instance.
struct SessionMessageQueue {
    private(set) var items: [QueuedMessage] = []
    private(set) var interceptSendFirst = false

    var isEmpty: Bool { items.isEmpty }
    var count: Int { items.count }

    /// Enqueue a follow-up. `text` should already include attachment path footnotes if any.
    @discardableResult
    mutating func enqueue(text: String, images: [DraftImage] = []) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !images.isEmpty else { return false }
        // Keep caller-provided text (may include path footnotes); only reject fully empty.
        let storedText = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !images.isEmpty
            ? text // allow image-only; may be path-annotated multiline
            : (trimmed.isEmpty ? text : text) 
        // Prefer: store `text` as provided by ChatSession after prep; if only whitespace and no images, already guarded.
        items.append(QueuedMessage(text: text, images: images))
        return true
    }

    mutating func restoreAll() -> (text: String, images: [DraftImage]) {
        let texts = items.map(\.text)
        let images = items.flatMap(\.images)
        items.removeAll()
        interceptSendFirst = false
        return (Self.joinTexts(texts), images)
    }

    static func joinTexts(_ texts: [String]) -> String {
        texts.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    mutating func noteAbort() {
        if !items.isEmpty { interceptSendFirst = true }
    }

    mutating func clearIntercept() {
        interceptSendFirst = false
    }

    /// Pop head when idle and alive. Clears intercept when popping or when queue empty.
    mutating func popForIdleDrain(isStreaming: Bool, processAlive: Bool) -> QueuedMessage? {
        if items.isEmpty {
            interceptSendFirst = false
            return nil
        }
        guard processAlive, !isStreaming else { return nil }
        interceptSendFirst = false
        return items.removeFirst()
    }

    mutating func requeueFront(_ msg: QueuedMessage) {
        items.insert(msg, at: 0)
    }
}
```

**Simplify enqueue body** when implementing — do not keep the confusing ternary above. Final enqueue:

```swift
@discardableResult
mutating func enqueue(text: String, images: [DraftImage] = []) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty || !images.isEmpty else { return false }
    items.append(QueuedMessage(text: text, images: images))
    return true
}
```

`joinTexts`: join all strings with `"\n\n"` in order (including empty strings if image-only items used `""` or path-only bodies — prefer joining `items.map(\.text)` as-is with `"\n\n"`).

```swift
static func joinTexts(_ texts: [String]) -> String {
    texts.joined(separator: "\n\n")
}
```

- [ ] **Step 2: Add SelfTest checks**

Insert before `print("---")` in `SelfTest.runIfRequested()`:

```swift
// 8. Session message queue (follow-up / restore / intercept drain)
var q = SessionMessageQueue()
check("enqueue rejects empty", q.enqueue(text: "  ", images: []) == false)
check("enqueue text", q.enqueue(text: "first"))
check("enqueue second", q.enqueue(text: "second"))
check("queue count 2", q.count == 2)

// No drain while streaming
check("no pop while streaming",
      q.popForIdleDrain(isStreaming: true, processAlive: true) == nil)
check("still 2 after blocked pop", q.count == 2)

// Idle drain FIFO
let head = q.popForIdleDrain(isStreaming: false, processAlive: true)
check("pop head first", head?.text == "first")
check("one left", q.count == 1 && q.items.first?.text == "second")

// Requeue front on failure
if let head {
    q.requeueFront(head)
    check("requeue front", q.items.first?.text == "first" && q.count == 2)
    // pop again to restore single "second" scenario for later tests
    _ = q.popForIdleDrain(isStreaming: false, processAlive: true)
}

// Abort intercept flag
q.noteAbort()
check("abort sets intercept when non-empty", q.interceptSendFirst)
let afterAbort = q.popForIdleDrain(isStreaming: false, processAlive: true)
check("intercept pop sends remaining head", afterAbort?.text == "second")
check("intercept cleared after pop", q.interceptSendFirst == false)
check("queue empty", q.isEmpty)

// noteAbort on empty is no-op
q.noteAbort()
check("abort empty no intercept", q.interceptSendFirst == false)

// restoreAll join + clear
_ = q.enqueue(text: "a")
_ = q.enqueue(text: "b")
q.noteAbort()
let restored = q.restoreAll()
check("restore join blank line", restored.text == "a\n\nb", "got: \(restored.text)")
check("restore clears queue", q.isEmpty && q.interceptSendFirst == false)

// dead process no pop
_ = q.enqueue(text: "x")
check("dead process no pop",
      q.popForIdleDrain(isStreaming: false, processAlive: false) == nil)
_ = q.restoreAll()

// joinTexts helper
check("joinTexts single", SessionMessageQueue.joinTexts(["only"]) == "only")
check("joinTexts multi", SessionMessageQueue.joinTexts(["a", "b"]) == "a\n\nb")
```

- [ ] **Step 3: Run SelfTest**

```bash
cd /Users/haoli/leehow/code/pipiui && PIPIUI_SELF_TEST=1 swift run
```

Expected: `ALL PASSED` and exit 0. Fix compile/logic until green.

- [ ] **Step 4: Commit if git exists**

```bash
git status -sb || true
# if repo: git add Sources/PipiUI/SessionMessageQueue.swift Sources/PipiUI/SelfTest.swift && git commit -m "feat: pure session message queue + selftests"
```

---

### Task 2: Wire queue into `ChatSession` send / abort / idle drain

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift`
- Test: `PIPIUI_SELF_TEST=1 swift run` (must still pass); `swift build`

**Interfaces:**
- Consumes: `SessionMessageQueue`, `QueuedMessage`
- Produces on `ChatSession`:
  - `@Published private(set) var messageQueue: [QueuedMessage] = []` (mirror of `queue.items` for SwiftUI)
  - `private var queue = SessionMessageQueue()`
  - `func sendPrompt(_ text: String, images: [DraftImage] = [])` — if streaming → prepare + enqueue; else → `sendPromptNow`
  - `private func prepareMessage(text:String, images:[DraftImage]) -> (message:String, images:[DraftImage])` — existing attachment save + path annotate
  - `private func sendPromptNow(message:String, images:[DraftImage], requeueOnFailure: QueuedMessage? = nil)`
  - `func abort()` — `queue.noteAbort()` then publish; `proc?.send(["type":"abort"])`
  - `func restoreQueueToDraft() -> (text: String, images: [DraftImage])` — `queue.restoreAll()`, publish, return
  - `private func publishQueue()` — `messageQueue = queue.items`
  - `private func drainQueueIfIdle()` — call from `agent_settled` (after `isStreaming = false`) and from `onExit` path only if you choose not to drain on death (spec: no send if dead)
  - **Remove** `if isStreaming { cmd["streamingBehavior"] = "steer" }`

**Implementation details:**

1. After defining properties, add:

```swift
@Published private(set) var messageQueue: [QueuedMessage] = []
private var queue = SessionMessageQueue()
private var isSendingFromQueue = false
```

2. Replace `sendPrompt` + add helpers:

```swift
func sendPrompt(_ text: String, images: [DraftImage] = []) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty || !images.isEmpty else { return }
    let prepared = prepareMessage(text: trimmed, images: images)

    if isStreaming {
        let ok = queue.enqueue(text: prepared.message, images: prepared.images)
        if ok { publishQueue() }
        return
    }
    sendPromptNow(message: prepared.message, images: prepared.images)
}

private func prepareMessage(text: String, images: [DraftImage]) -> (message: String, images: [DraftImage]) {
    var message = text
    if !images.isEmpty {
        let paths = ImageAttachment.saveToProjectAttachments(images, projectURL: projectURL)
        message = ImageAttachment.messageWithAttachmentPaths(text: text, paths: paths)
    }
    return (message, images)
}

private func sendPromptNow(message: String, images: [DraftImage], requeueOnFailure: QueuedMessage? = nil) {
    var cmd: [String: Any] = ["type": "prompt", "message": message]
    if !images.isEmpty {
        cmd["images"] = ImageAttachment.rpcPayload(from: images)
    }
    proc?.request(cmd) { [weak self] resp in
        guard let self else { return }
        if resp["success"].bool != true {
            self.lastError = resp["error"].string ?? "发送失败"
            if let requeueOnFailure {
                self.queue.requeueFront(requeueOnFailure)
                self.publishQueue()
            }
        }
    }
}

private func publishQueue() {
    messageQueue = queue.items
}

func restoreQueueToDraft() -> (text: String, images: [DraftImage]) {
    let restored = queue.restoreAll()
    publishQueue()
    return restored
}

func abort() {
    queue.noteAbort()
    // intercept flag only; items stay until idle drain
    proc?.send(["type": "abort"])
}

private func drainQueueIfIdle() {
    guard let msg = queue.popForIdleDrain(isStreaming: isStreaming, processAlive: processAlive) else {
        publishQueue()
        return
    }
    publishQueue()
    sendPromptNow(message: msg.text, images: msg.images, requeueOnFailure: msg)
}
```

3. In `handleEvent` `agent_settled` case, after `isStreaming = false` (and clearing streamingItem), call `drainQueueIfIdle()`:

```swift
case "agent_settled":
    isStreaming = false
    streamingItem = nil
    refreshStats()
    drainQueueIfIdle()
    proc?.request(["type": "get_state"]) { [weak self] resp in
        self?.applyState(resp["data"])
        self?.onSessionMetaChanged?()
    }
```

4. **Race guard:** `applyState` may set `isStreaming` from get_state. If get_state still reports streaming true after settled, avoid double-drain. Prefer draining **only** on `agent_settled` event (not on every applyState). Do **not** call drain from applyState.

5. If user aborts and pi emits `agent_settled`, drain runs with intercept (flag cleared on pop) and sends head — correct.

6. If queue drains into a new prompt, pi will `agent_start` then later `agent_settled` again → next item — correct FIFO.

7. Process exit (`onExit`): set `isStreaming = false` but **do not** drain (processAlive false → pop returns nil). Queue remains for UI 撤回.

- [ ] **Step 1: Implement ChatSession changes as above**

- [ ] **Step 2: Build**

```bash
cd /Users/haoli/leehow/code/pipiui && swift build
```

Expected: build succeeded.

- [ ] **Step 3: SelfTest still green**

```bash
PIPIUI_SELF_TEST=1 swift run
```

Expected: `ALL PASSED`

- [ ] **Step 4: Commit if git exists**

```bash
# git add Sources/PipiUI/ChatSession.swift && git commit -m "feat: drain local follow-up queue on agent_settled"
```

---

### Task 3: InputBar queue strip + placeholder + restore + stop help

**Files:**
- Modify: `Sources/PipiUI/Views/InputBar.swift`
- Modify: `README.md` (功能 bullet for 输入栏)
- Test: `swift build`; manual checklist below

**Interfaces:**
- Consumes: `session.messageQueue`, `session.restoreQueueToDraft()`, `session.abort()`, `session.isStreaming`, existing `send`

**UI copy (exact):**
- Placeholder streaming: `输入将排队，完成后发送…`
- Placeholder idle: `输入消息…` (unchanged)
- Strip: `排队 \(n) 条` + optional `· 「\(preview)」` where preview is first line of first item, max ~40 chars
- Button: `撤回编辑`
- Stop help empty queue: `中止当前回复`
- Stop help with queue: `中止并发送队首`
- Status caption when streaming && queue non-empty: `生成中 · \(n) 条排队` else if streaming: `生成中…`

**Restore merge rules (spec):**
- If `draft` non-empty, set `draft = draft + "\n\n" + restored.text` (if restored.text non-empty); if draft empty, `draft = restored.text`
- `draftImages.append(contentsOf: restored.images)`

**Strip placement:** Above attachment strip (or above HStack if no attachments) inside the outer `VStack`.

Example strip view:

```swift
private var queueStrip: some View {
    HStack(spacing: 10) {
        Image(systemName: "tray")
            .foregroundStyle(.secondary)
        VStack(alignment: .leading, spacing: 2) {
            Text("排队 \(session.messageQueue.count) 条")
                .font(.caption.weight(.semibold))
            if let preview = queuePreview {
                Text(preview)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        Spacer()
        Button("撤回编辑") {
            let restored = session.restoreQueueToDraft()
            if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                draft = restored.text
            } else if !restored.text.isEmpty {
                draft = draft + "\n\n" + restored.text
            }
            draftImages.append(contentsOf: restored.images)
        }
        .font(.caption.weight(.medium))
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Color.accentColor.opacity(0.08))
    )
}

private var queuePreview: String? {
    guard let text = session.messageQueue.first?.text else { return nil }
    let firstLine = text.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? text
    let trimmed = firstLine.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return session.messageQueue.first?.images.isEmpty == false ? "(图片)" : nil
    }
    if trimmed.count <= 40 { return "「\(trimmed)」" }
    return "「\(trimmed.prefix(40))…」"
}
```

In `body` VStack top:

```swift
if !session.messageQueue.isEmpty {
    queueStrip
}
```

Update TextField placeholder, stop button help, status text as specified.

`send()` stays calling `session.sendPrompt` — session handles enqueue vs now.

- [ ] **Step 1: Implement InputBar UI**

- [ ] **Step 2: Update README 输入栏 bullet**

Replace steer wording with something like:

```markdown
- **输入栏**：Enter 发送；生成中消息进入会话 follow-up 队列（完成后按序发送），可「撤回编辑」；停止按钮在有队列时为「中止并发送队首」；模型/thinking 菜单；多图附件…
```

- [ ] **Step 3: Build**

```bash
swift build
```

Expected: success.

- [ ] **Step 4: Manual verification checklist** (run app with `swift run` or `./make-app.sh`)

1. Idle send still works (text + image).
2. During a long run, Enter twice → strip shows `排队 2 条`; agent continues; after settle both send in order as user bubbles.
3. Queue 2 → 撤回编辑 → both texts in field separated by blank line; strip gone; agent continues.
4. Queue 2 → Stop → after abort settles, first message sends; strip shows 1 remaining until that run finishes then second sends.
5. Stop with empty queue → abort only.
6. No `steer` behavior (message should not inject mid-tool-batch before full settle).

- [ ] **Step 5: Commit if git exists**

```bash
# git add Sources/PipiUI/Views/InputBar.swift README.md && git commit -m "feat: queue strip UI and README"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Busy Enter → local follow-up queue | T2 |
| Never steer | T2 |
| Drain on agent settle FIFO | T2 |
| Bulk 撤回编辑 + join `\n\n` | T1 + T3 |
| Draft merge append on restore | T3 |
| Abort empty = abort only | T2 |
| Abort nonempty = send head on idle | T1 + T2 |
| Remainder stays queued | T2 |
| Images at enqueue | T2 prepareMessage |
| Send failure requeue front | T2 |
| Process dead no drain | T1 + T2 |
| Placeholder / strip / stop help | T3 |
| README | T3 |
| SelfTest | T1 |
| No per-item UI / no persistence / no steer mode | honored by omission |

## Out of scope reminders for implementers

- Do not call pi `follow_up` / `steer` for this feature.
- Do not drain on `applyState`.
- Do not clear queue on session backgrounding.
- Do not add fake transcript bubbles for queued items.
