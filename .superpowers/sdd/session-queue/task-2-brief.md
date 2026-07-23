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
