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

## Global Constraints (binding)

- Only modify files listed unless `swift build` forces a trivial fix.
- Do **not** change `PiProcess`, RPC types, `get_session_stats`, or add session-level token `@Published` fields.
- Estimate: `text.isEmpty ? 0 : max(1, Int((Double(text.count) / 4.0).rounded()))`.
- Format: `n < 1000` → `"\(n)"`; `n >= 1000` → one-decimal `k` with trailing `.0` stripped (e.g. `1k`, `1.2k`, `15.4k`).
- Label copy: empty estimate → no suffix; non-empty → `~{fmt} tokens` via `labelSuffix`.
- Repo has **no git** — skip all commit steps; do not `git init`.
- Prefer `swift build` for compile verification; extend `SelfTest` for pure helpers.
- Task 1 scope only: helpers + SelfTest. Do **not** change `ThinkingBlockView` UI or `MessageRow`/`ChatDetailView` yet (Task 2).
