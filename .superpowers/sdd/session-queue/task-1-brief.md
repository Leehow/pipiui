# Task Brief

## Global Constraints

- Busy Enter must **never** set `streamingBehavior: "steer"` (remove that path).
- Default busy delivery is **follow-up semantics** via local queue + idle drain (not pi `follow_up` RPC — no clear_queue in RPC).
- Withdraw is **bulk only** (all items → composer); no per-item edit UI this iteration.
- Stop with non-empty queue: `abort` → on idle **send queue head**; remainder stays queued.
- Stop with empty queue: `abort` only.
- Queue items may carry images; prepare attachment paths **at enqueue** time.
- No git repo in this workspace historically — **skip commit steps** if `git status` fails; still finish verification.
- Do not add steer dual-mode, disk persistence, or upstream pi RPC changes.

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
