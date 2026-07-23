### Task 2: ThinkingBlockView + MessageRow + ChatDetailView wiring

**Files:**
- Modify: `Sources/PipiUI/Views/MessageViews.swift` (`MessageRow`, `ThinkingBlockView`)
- Modify: `Sources/PipiUI/Views/ChatDetailView.swift`

**Interfaces:**
- Consumes: `ThinkingTokenEstimate` from Task 1 (already in MessageViews.swift)
  ```swift
  enum ThinkingTokenEstimate {
      static func tokenCount(for text: String) -> Int
      static func formatCount(_ n: Int) -> String
      static func labelSuffix(for text: String) -> String? // nil or "~1.2k tokens"
  }
  ```
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

- [ ] **Step 5: Manual UI check (if app can run)** — optional if headless; note if skipped.

## Global Constraints (binding)

- Only modify files listed unless build forces trivial fix.
- Do **not** change PiProcess, RPC, get_session_stats, or add session-level token @Published.
- Estimate via existing `ThinkingTokenEstimate` only.
- Label: empty → `Thinking` (+ spinner if streaming); non-empty → `Thinking · ~{fmt} tokens` (+ spinner if streaming).
- Streaming spinner: mini ProgressView; finished: no spinner.
- Repo has **no git** — skip commits; do not git init.
- Do not change `ThinkingTokenEstimate` API unless build requires a fix.
