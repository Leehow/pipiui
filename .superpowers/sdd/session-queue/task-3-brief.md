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
