# Thinking 折叠头实时估算 tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live estimated token count on the Thinking disclosure header that rises while streaming, with a mini spinner while active and a final estimate when done.

**Architecture:** Pure UI-layer estimate from thinking text length (`chars/4`). Extend `ThinkingBlockView` + pass `isStreaming` through `MessageRow` from `ChatDetailView`. No RPC or `ChatSession` stats changes.

**Tech Stack:** SwiftUI (macOS 14+), existing `ChatSession.streamingItem` / `isStreaming`.

**Spec:** `docs/superpowers/specs/2026-07-23-thinking-live-token-estimate-design.md`

## Global Constraints

- Only modify files listed in the file map unless `swift build` forces a trivial fix.
- Do **not** change `PiProcess`, RPC types, `get_session_stats`, or add session-level token `@Published` fields.
- Estimate: `text.isEmpty ? 0 : max(1, Int((Double(text.count) / 4.0).rounded()))`.
- Format: `n < 1000` → `"\(n)"`; `n >= 1000` → one-decimal `k` with trailing `.0` stripped (e.g. `1k`, `1.2k`, `15.4k`).
- Label copy: empty estimate → `Thinking`; non-empty → `Thinking · ~{fmt} tokens`.
- Streaming → mini `ProgressView` on the label trailing edge; finished → no spinner.
- Repo has **no git** — skip all commit steps; do not `git init`.
- Prefer `swift build` for compile verification; extend `SelfTest` for pure helpers.

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/Views/MessageViews.swift` | `ThinkingTokenEstimate` helper, `ThinkingBlockView`, `MessageRow.isStreaming` |
| `Sources/PipiUI/Views/ChatDetailView.swift` | Pass `isStreaming` into streaming `MessageRow` |
| `Sources/PipiUI/SelfTest.swift` | Unit checks for estimate + format helpers |

---

### Task 1: Estimate helpers + SelfTest

**Files:**
- Modify: `Sources/PipiUI/Views/MessageViews.swift` (add helper enum near `ThinkingBlockView`)
- Modify: `Sources/PipiUI/SelfTest.swift`

**Interfaces:**
- Produces:
  ```swift
  enum ThinkingTokenEstimate {
      static func tokenCount(for text: String) -> Int
      static func formatCount(_ n: Int) -> String  // "123", "1k", "1.2k"
      static func labelSuffix(for text: String) -> String? // nil or "~1.2k tokens"
  }
  ```

- [ ] **Step 1: Add `ThinkingTokenEstimate` to `MessageViews.swift`**

Place **above** `struct ThinkingBlockView` (after the subagent row helpers is fine):

```swift
/// chars÷4 estimate for Thinking header (not a real tokenizer).
enum ThinkingTokenEstimate {
    static func tokenCount(for text: String) -> Int {
        guard !text.isEmpty else { return 0 }
        return max(1, Int((Double(text.count) / 4.0).rounded()))
    }

    /// Compact count: 999 → "999"; 1000 → "1k"; 1200 → "1.2k"; 15400 → "15.4k"
    static func formatCount(_ n: Int) -> String {
        guard n >= 1000 else { return String(n) }
        let k = Double(n) / 1000.0
        let raw = String(format: "%.1f", k)
        if raw.hasSuffix(".0") {
            return String(raw.dropLast(2)) + "k"
        }
        return raw + "k"
    }

    /// nil when no tokens to show; otherwise "~1.2k tokens"
    static func labelSuffix(for text: String) -> String? {
        let n = tokenCount(for: text)
        guard n > 0 else { return nil }
        return "~\(formatCount(n)) tokens"
    }
}
```

- [ ] **Step 2: Add SelfTest cases**

In `SelfTest.runIfRequested()`, after existing checks (or a clear new section), add:

```swift
// Thinking token estimate
check("empty text → 0 tokens", ThinkingTokenEstimate.tokenCount(for: "") == 0)
check("1 char → 1 token", ThinkingTokenEstimate.tokenCount(for: "a") == 1)
check("4 chars → 1 token", ThinkingTokenEstimate.tokenCount(for: "abcd") == 1)
check("5 chars → 1 token (round 1.25→1)", ThinkingTokenEstimate.tokenCount(for: "abcde") == 1)
check("6 chars → 2 tokens (round 1.5→2)", ThinkingTokenEstimate.tokenCount(for: "abcdef") == 2)
check("4000 chars → 1000 tokens", ThinkingTokenEstimate.tokenCount(for: String(repeating: "x", count: 4000)) == 1000)
check("format 999", ThinkingTokenEstimate.formatCount(999) == "999")
check("format 1000 → 1k", ThinkingTokenEstimate.formatCount(1000) == "1k")
check("format 1200 → 1.2k", ThinkingTokenEstimate.formatCount(1200) == "1.2k")
check("format 15400 → 15.4k", ThinkingTokenEstimate.formatCount(15400) == "15.4k")
check("suffix empty nil", ThinkingTokenEstimate.labelSuffix(for: "") == nil)
check("suffix sample", ThinkingTokenEstimate.labelSuffix(for: String(repeating: "x", count: 4800)) == "~1.2k tokens")
```

- [ ] **Step 3: Build + run SelfTest**

```bash
cd /Users/haoli/leehow/code/pipiui && swift build 2>&1
PIPIUI_SELF_TEST=1 swift run 2>&1
```

Expected: build success; all new `PASS` lines; process exits 0.

---

### Task 2: ThinkingBlockView + MessageRow + ChatDetailView wiring

**Files:**
- Modify: `Sources/PipiUI/Views/MessageViews.swift` (`MessageRow`, `ThinkingBlockView`)
- Modify: `Sources/PipiUI/Views/ChatDetailView.swift`

**Interfaces:**
- Consumes: `ThinkingTokenEstimate` from Task 1
- Produces:
  ```swift
  struct MessageRow {
      var isStreaming: Bool = false  // in Equatable
  }
  struct ThinkingBlockView {
      let text: String
      var isStreaming: Bool = false
  }
  ```

- [ ] **Step 1: Update `MessageRow`**

Change the struct header and equality:

```swift
struct MessageRow: View, Equatable {
    let item: ChatItem
    let toolRuns: [String: ToolRun]
    var subagents: [SubagentInfo] = []
    var isStreaming: Bool = false
    var onSelectAgent: ((String) -> Void)?

    static func == (lhs: MessageRow, rhs: MessageRow) -> Bool {
        lhs.item == rhs.item
            && lhs.toolRuns == rhs.toolRuns
            && lhs.subagents == rhs.subagents
            && lhs.isStreaming == rhs.isStreaming
    }
```

In `assistantView`, replace:

```swift
case .thinking(let text):
    ThinkingBlockView(text: text)
```

with:

```swift
case .thinking(let text):
    ThinkingBlockView(text: text, isStreaming: isStreaming)
```

- [ ] **Step 2: Replace `ThinkingBlockView` body**

Replace the entire `ThinkingBlockView` with:

```swift
struct ThinkingBlockView: View {
    let text: String
    var isStreaming: Bool = false
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            Text(text)
                .font(.callout)
                .italic()
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
        } label: {
            HStack(spacing: 6) {
                Label("Thinking", systemImage: "brain")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                if let suffix = ThinkingTokenEstimate.labelSuffix(for: text) {
                    Text("· \(suffix)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if isStreaming {
                    ProgressView()
                        .controlSize(.mini)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(0.035))
        )
    }
}
```

Note: label renders as `Thinking` + `· ~1.2k tokens` (suffix already includes `~… tokens`). Do **not** double the middle dot inside `labelSuffix`.

- [ ] **Step 3: Wire `ChatDetailView`**

Transcript rows stay default `isStreaming: false`. Streaming row:

```swift
if let streaming = session.streamingItem {
    MessageRow(
        item: streaming,
        toolRuns: runs(for: streaming),
        subagents: subagents(for: streaming),
        isStreaming: session.isStreaming,
        onSelectAgent: selectAgent
    )
}
```

(Keep transcript `ForEach` as-is without `isStreaming`, relying on default `false`.)

- [ ] **Step 4: Build**

```bash
cd /Users/haoli/leehow/code/pipiui && swift build 2>&1
PIPIUI_SELF_TEST=1 swift run 2>&1
```

Expected: success, SelfTest exit 0.

- [ ] **Step 5: Manual UI check (if app can run)**

```bash
swift run
```

1. Set thinking level ≠ off; send a prompt that triggers thinking.
2. Header shows spinner; once text flows, `· ~N tokens` rises.
3. On settle: spinner gone, final estimate remains.
4. Reload history: past thinking blocks show estimate, no spinner.

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| chars÷4 estimate | Task 1 |
| `~1.2k` / `tokens` format | Task 1 + 2 |
| spinner while streaming | Task 2 |
| final estimate kept | Task 2 (`isStreaming: false` on transcript) |
| empty text no `~0` | Task 1 `labelSuffix` nil |
| MessageRow Equatable includes isStreaming | Task 2 |
| No RPC / ChatSession stats changes | Global + file map |
| ChatDetailView wiring | Task 2 |

## Execution handoff

Plan complete. Choose:

1. **Subagent-Driven (recommended)** — fresh subagent per task + review between tasks  
2. **Inline Execution** — this session with executing-plans checkpoints  
