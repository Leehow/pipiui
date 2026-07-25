# write / edit 路径 + 流式 tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On write/edit tool cards, show path + live `~N tokens` while args stream; never show JSON dumps.

**Architecture:** Pure convert helpers extract `argsSummary` (path or `…`) and `payloadChars` from tool arguments. `ToolCardView` reuses `ThinkingTokenEstimate` and shows a spinner when `isStreaming || run.isRunning`.

**Tech Stack:** SwiftUI macOS 14+, SwiftPM XCTest, existing `ThinkingTokenEstimate`.

**Spec:** `docs/superpowers/specs/2026-07-24-write-edit-live-tokens-design.md`

## Global Constraints

- Only write / edit change summary strategy; bash/read/etc. keep current `argsSummary`.
- Never fall back to `compactJSON` for write/edit.
- Estimate: reuse `ThinkingTokenEstimate` (`chars÷4`, `~1.2k tokens`).
- Do not store full `content` on `ToolCallBlock` — only `payloadChars`.
- After successful compile meant for the runnable app ⇒ `./make-app.sh` and verify `build/PipiUI.app` mtime.

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/ChatSession.swift` | `ToolCallBlock.payloadChars`; write/edit summary + payload extractors; `convert` wiring |
| `Sources/PipiUI/Views/MessageViews.swift` | `ToolCardView` / `AssistantSegmentsView` pass `isStreaming`; show tokens |
| `Tests/PipiUITests/ToolCallSummaryTests.swift` | Pure tests for summary + payloadChars |

---

### Task 1: Extractors + `ToolCallBlock.payloadChars` (TDD)

**Files:**
- Create: `Tests/PipiUITests/ToolCallSummaryTests.swift`
- Modify: `Sources/PipiUI/ChatSession.swift` (`ToolCallBlock`, `argsSummary` / new helpers, `convert`)

**Interfaces:**
- Produces:
  ```swift
  struct ToolCallBlock {
      let id: String
      let name: String
      let argsSummary: String
      var payloadChars: Int = 0
  }
  enum ToolCallSummary {
      static func summarize(name: String, args: J) -> (summary: String, payloadChars: Int)
  }
  ```

- [ ] **Step 1: Write failing tests**

```swift
final class ToolCallSummaryTests: XCTestCase {
    func testWritePathAndContent() {
        let args = J.parse(#"{"path":"a.swift","content":"hello!"}"#)! // 6 chars
        let r = ToolCallSummary.summarize(name: "write", args: args)
        XCTAssertEqual(r.summary, "a.swift")
        XCTAssertEqual(r.payloadChars, 6)
    }

    func testWriteMissingPathNoJSON() {
        let args = J.parse(#"{"content":" partial"}"#)!
        let r = ToolCallSummary.summarize(name: "write", args: args)
        XCTAssertEqual(r.summary, "…")
        XCTAssertFalse(r.summary.contains("{"))
        XCTAssertEqual(r.payloadChars, 8)
    }

    func testEditSumsNewText() {
        let args = J.parse(#"{"path":"f.swift","edits":[{"oldText":"a","newText":"ab"},{"oldText":"x","newText":"xyz"}]}"#)!
        let r = ToolCallSummary.summarize(name: "edit", args: args)
        XCTAssertEqual(r.summary, "f.swift")
        XCTAssertEqual(r.payloadChars, 5) // "ab" + "xyz"
    }

    func testBashUnchangedJSONFallbackAllowed() {
        let args = J.parse(#"{"command":"ls"}"#)!
        let r = ToolCallSummary.summarize(name: "bash", args: args)
        XCTAssertEqual(r.summary, "ls")
        XCTAssertEqual(r.payloadChars, 0)
    }
}
```

(Adapt `J.parse` to whatever constructor the repo already uses — see other tests.)

- [ ] **Step 2: Run tests — expect fail**

Run: `swift test --filter ToolCallSummaryTests`

- [ ] **Step 3: Implement**

Add `payloadChars` to `ToolCallBlock`. Add `ToolCallSummary.summarize`. Wire `convert` toolCall case:

```swift
let s = ToolCallSummary.summarize(name: name, args: block["arguments"])
blocks.append(.toolCall(ToolCallBlock(
    id: ..., name: name, argsSummary: s.summary, payloadChars: s.payloadChars
)))
```

Keep `argsSummary(name:args:)` as a thin wrapper calling `summarize(...).summary` if other call sites exist, or replace them.

write/edit summary rules:
- path = `path` ?? `file_path` string; else `"…"`
- write payload = `content` string `.count` (0 if missing/non-string)
- edit payload = sum of `edits[].newText` counts; else top-level `newText` count
- other tools: existing logic (`command`, path, else compactJSON truncate); `payloadChars = 0`

- [ ] **Step 4: Tests pass**

Run: `swift test --filter ToolCallSummaryTests`

- [ ] **Step 5: Commit** (only if user asks)

---

### Task 2: ToolCardView live tokens + streaming spinner

**Files:**
- Modify: `Sources/PipiUI/Views/MessageViews.swift` (`ToolCardView`, call sites in `AssistantSegmentsView` / `FinishedNonTextGroupView`)

**Interfaces:**
- Consumes: `ToolCallBlock.payloadChars`, `ThinkingTokenEstimate.labelSuffix(for:)` — build a string of `String(repeating: "x", count: payloadChars)` **or** add `labelSuffix(charCount:)` overload to avoid allocating giant strings.
- Prefer: `ThinkingTokenEstimate.labelSuffix(charCount: Int) -> String?` thin overload used by both paths.

- [ ] **Step 1: Add `labelSuffix(charCount:)` + SelfTest/XCTest one-liner**

```swift
static func labelSuffix(charCount: Int) -> String? {
    guard charCount > 0 else { return nil }
    let n = tokenCount(for: String(repeating: "x", count: charCount))
    // better: extract tokenCount(fromCharCount:) to avoid huge alloc
}
```

Better implementation:

```swift
static func tokenCount(charCount: Int) -> Int {
    guard charCount > 0 else { return 0 }
    return max(1, Int((Double(charCount) / 4.0).rounded()))
}
static func tokenCount(for text: String) -> Int { tokenCount(charCount: text.count) }
static func labelSuffix(charCount: Int) -> String? {
    let n = tokenCount(charCount: charCount)
    guard n > 0 else { return nil }
    return "~\(formatCount(n)) tokens"
}
```

- [ ] **Step 2: Update `ToolCardView`**

```swift
var isStreaming: Bool = false
// header after PathLinkedText:
if call.name == "write" || call.name == "edit",
   let suffix = ThinkingTokenEstimate.labelSuffix(charCount: call.payloadChars) {
    Text("· \(suffix)")
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
}
// spinner:
if isStreaming || run?.isRunning == true {
    ProgressView().controlSize(.mini)
} else if run != nil { ... checkmark ... }
```

Pass `isStreaming` from `AssistantSegmentsView.assistantBlockView` and `FinishedNonTextGroupView` (finished → false).

- [ ] **Step 3: Build + package**

Run: `swift test --filter ToolCallSummaryTests`  
Run: `./make-app.sh`  
Verify app binary newer than touched sources.

- [ ] **Step 4: Manual check**

Trigger a large write while streaming: card shows path + rising `~N tokens` + spinner; no `{` JSON in header.

- [ ] **Step 5: Commit** (only if user asks)

---

## Done when

- [x] All Task 1–2 tests green
- [x] `build/PipiUI.app` refreshed via `./make-app.sh`
- [x] Spec status → Approved
