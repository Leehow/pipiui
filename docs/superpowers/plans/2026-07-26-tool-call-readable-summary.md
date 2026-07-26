# 工具调用摘要可读化（find / grep / subagent）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ToolCallSummary` emit human-readable headers for `find`, `grep`, and `subagent` tool calls (and their malformed/activity variants) so no card header ever shows raw JSON for these three tools.

**Architecture:** Single-point fix in the centralized `enum ToolCallSummary` (`Sources/PipiUI/ChatSession.swift`). Add three branches to `summarize(name:args:)` backed by three private helpers (`findSummary` / `grepSummary` / `subagentSummary`), and matching branches to the truncated-JSON fallback `scrapeSummary(name:from:)`. No other surface changes: `summarizeActivity(_:)`, `summarize(name:argsJSON:)`, `legacySummary`, and all views route through this one entry point and inherit the fix automatically.

**Tech Stack:** Swift 6.3 · SwiftUI macOS 14+ · SwiftPM XCTest · existing `J` dynamic-JSON accessor and existing `ToolCallSummaryTests` target.

**Spec:** `docs/superpowers/specs/2026-07-26-tool-call-readable-summary-design.md` (approved)

## Global Constraints

Copied verbatim in force from the spec; every task implicitly includes all of these:

- **Only two files may change:** `Sources/PipiUI/ChatSession.swift` and `Tests/PipiUITests/ToolCallSummaryTests.swift`. Nothing else.
- **No views, no TS, no tool behavior, no config, no scripts.** Do not touch `SubagentToolCardView`, `ToolCardView`, `SubagentPanel`, `MessageViews`, `PiExt/subagent/index.ts`, any tool `execute`, any schema, `make-app.sh`, or `scripts/`.
- **Never output `{`** for `find` / `grep` / `subagent`. Every new test asserts `XCTAssertFalse(summary.contains("{"))`.
- **Default values are exact:** `find` missing/empty `pattern` → `*`; `grep` missing/empty `pattern` → `…`; `subagent` empty → `…`.
- **Truncation rules are exact:** `subagent` task text collapses runs of whitespace to a single space, then truncates to 80 chars + `…` when longer. Separator between agent and task is exactly ` — ` (space + U+2014 + space). Matches the existing `generate_image` 80-char ceiling.
- **`subagent` priority is fixed:** `abort <agentId>` → `<agent>`(+`task`) → `<N> tasks` → `<N>-step chain` → `…`.
- **Fallback reachability:** the new `scrapeSummary` branches for these three tools never return `nil`, so the existing `>120`-char brace-truncation fallback in `summarize(name:argsJSON:)` is never reached for them.
- **Verification is `swift test` only.** No git commits, no `swift build`-only gates, no `make-app.sh`, no `build/PipiUI.app` packaging. (Spec explicitly forbids commits/builds/packaging in this scope.) Steps deliberately omit the usual commit step.
- **Do not disturb unrelated working-tree state.** Only edit the two named files. Do not stage, stash, clean, restore, or commit anything. Confirm scope with a path-limited diff (see Task 4), never a broad `git status` enumeration.

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/ChatSession.swift` | `ToolCallSummary.summarize(name:args:)` — add `find` / `grep` / `subagent` cases + 3 private helpers. `ToolCallSummary.scrapeSummary(name:from:)` — add `find` / `grep` / `subagent` scrape branches. Nothing else in this file changes. |
| `Tests/PipiUITests/ToolCallSummaryTests.swift` | New XCTest methods for direct summary, truncated-JSON, and activity paths; existing cases untouched. |

## Shared interfaces (read before any task)

`J` (`Sources/PipiUI/J.swift`) — already exists, do not modify:

- `args["key"]` → `J` (never optional; missing key → `J(nil)`).
- `.string` → `String?` (nil if absent/non-string).
- `.array` → `[J]` **non-optional** (empty `[]` if absent/non-array — so guard with `!arr.isEmpty`, **not** `if let`).
- `.bool` → `Bool?`.

Existing private helper reused by the scrape branches (do not modify):

```swift
private static func scrapeJSONString(key: String, from text: String) -> String?
// Extracts "key":"value"; tolerates truncated trailing content / missing close quote.
// Returns nil for an empty/absent value.
```

New helpers this plan introduces (private, inside `enum ToolCallSummary`):

```swift
private static func findSummary(_ args: J) -> String
private static func grepSummary(_ args: J) -> String
private static func subagentSummary(_ args: J) -> String
```

---

### Task 1: `find` readable summary (direct + scrape + activity)

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift` — `summarize(name:args:)` switch (insert before `default:`, ~line 67), add `findSummary` helper, and `scrapeSummary(name:from:)` switch (insert before `default:`, ~line 120).
- Test: `Tests/PipiUITests/ToolCallSummaryTests.swift` — append new methods.

**Interfaces:**
- Consumes: `J`, existing `scrapeJSONString(key:from:)`.
- Produces: `private static func findSummary(_ args: J) -> String`; a new `case "find"` in both `summarize(name:args:)` and `scrapeSummary(name:from:)`.

- [ ] **Step 1: Write the failing tests**

Append to `Tests/PipiUITests/ToolCallSummaryTests.swift` (inside the existing `final class ToolCallSummaryTests: XCTestCase { … }`):

```swift
// MARK: - find

func testFindPatternAndPath() {
    let args = J(["pattern": "*.swift", "path": "Sources"])
    let r = ToolCallSummary.summarize(name: "find", args: args)
    XCTAssertEqual(r.summary, "*.swift in Sources")
    XCTAssertFalse(r.summary.contains("{"))
    XCTAssertEqual(r.payloadChars, 0)
}

func testFindPatternOnly() {
    let args = J(["pattern": "*.md"])
    let r = ToolCallSummary.summarize(name: "find", args: args)
    XCTAssertEqual(r.summary, "*.md")
    XCTAssertFalse(r.summary.contains("{"))
}

func testFindDefaultPatternEmpty() {
    let args = J([:])
    let r = ToolCallSummary.summarize(name: "find", args: args)
    XCTAssertEqual(r.summary, "*")
    XCTAssertFalse(r.summary.contains("{"))
}

func testFindDefaultPatternWithPath() {
    let args = J(["path": "Sources"])
    let r = ToolCallSummary.summarize(name: "find", args: args)
    XCTAssertEqual(r.summary, "* in Sources")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSummarizeTruncatedFindJSONShowsPattern() {
    // Invalid JSON (no closing brace) — must still scrape pattern + path.
    let truncated = #"{"pattern":"*.swift","path":"Sources"#
    let r = ToolCallSummary.summarize(name: "find", argsJSON: truncated)
    XCTAssertEqual(r.summary, "*.swift in Sources")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSummarizeActivityFind() {
    let s = ToolCallSummary.summarizeActivity(
        #"find {"pattern":"*.swift","path":"Sources"}"#
    )
    XCTAssertEqual(s, "*.swift in Sources")
    XCTAssertFalse(s.contains("{"))
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --filter ToolCallSummaryTests 2>&1 | tail -30`
Expected: the six new `testFind*` / `testSummarize*Find*` methods FAIL. Reason: before this task, `summarize(name:"find", args:)` falls through to `legacySummary`, which returns the `path` value only (e.g. `"Sources"`) or the raw `compactJSON` (e.g. `{"pattern":"*.md"}`), so the `…contains("{")` / equality assertions fail.

- [ ] **Step 3: Write minimal implementation**

3a. Add the `find` case to `summarize(name:args:)`. In `Sources/PipiUI/ChatSession.swift`, locate this block and insert the `find` case immediately before `default:`:

```swift
        case "browser":
            return (browserSummary(args), 0)
        case "find":
            return (findSummary(args), 0)
        default:
            return (legacySummary(name: name, args: args), 0)
        }
```

3b. Add the `findSummary` helper. Place it next to the other private helpers (e.g. just above `legacySummary`):

```swift
    /// `find` — `pattern in path`; missing/empty pattern defaults to `*`.
    private static func findSummary(_ args: J) -> String {
        let pattern = args["pattern"].string.flatMap { $0.isEmpty ? nil : $0 } ?? "*"
        if let path = args["path"].string, !path.isEmpty {
            return "\(pattern) in \(path)"
        }
        return pattern
    }
```

3c. Add the `find` scrape branch to `scrapeSummary(name:from:)`. Locate this block and insert the `find` case immediately before `default:`:

```swift
        case "generate_image":
            guard let prompt = scrapeJSONString(key: "prompt", from: text) else { return nil }
            return prompt.count > 80 ? String(prompt.prefix(80)) + "…" : prompt
        case "find":
            let pattern = scrapeJSONString(key: "pattern", from: text) ?? "*"
            if let path = scrapeJSONString(key: "path", from: text), !path.isEmpty {
                return "\(pattern) in \(path)"
            }
            return pattern
        default:
            return scrapeJSONString(key: "path", from: text)
                ?? scrapeJSONString(key: "file_path", from: text)
                ?? scrapeJSONString(key: "command", from: text)
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --filter ToolCallSummaryTests 2>&1 | tail -30`
Expected: the six new `find` methods PASS, and all previously-existing methods still PASS. No commit (out of scope).

---

### Task 2: `grep` readable summary (direct + scrape + activity)

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift` — `summarize(name:args:)` switch (add `case "grep"` after the new `case "find"`), add `grepSummary` helper, and `scrapeSummary(name:from:)` switch (add `case "grep"` after the new `case "find"`).
- Test: `Tests/PipiUITests/ToolCallSummaryTests.swift` — append new methods.

**Interfaces:**
- Consumes: `J`, existing `scrapeJSONString(key:from:)`.
- Produces: `private static func grepSummary(_ args: J) -> String`; a new `case "grep"` in both switches.

- [ ] **Step 1: Write the failing tests**

Append to `Tests/PipiUITests/ToolCallSummaryTests.swift`:

```swift
// MARK: - grep

func testGrepPatternAndPath() {
    let args = J(["pattern": "foo", "path": "Sources"])
    let r = ToolCallSummary.summarize(name: "grep", args: args)
    XCTAssertEqual(r.summary, "/foo/ in Sources")
    XCTAssertFalse(r.summary.contains("{"))
}

func testGrepPatternOnly() {
    let args = J(["pattern": "foo"])
    let r = ToolCallSummary.summarize(name: "grep", args: args)
    XCTAssertEqual(r.summary, "/foo/")
    XCTAssertFalse(r.summary.contains("{"))
}

func testGrepDefaultPattern() {
    let args = J([:])
    let r = ToolCallSummary.summarize(name: "grep", args: args)
    XCTAssertEqual(r.summary, "/…/")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSummarizeTruncatedGrepJSONShowsPattern() {
    // Invalid JSON (no closing brace) — must still scrape pattern + path.
    let truncated = #"{"pattern":"ToolCallSummary","path":"Sources"#
    let r = ToolCallSummary.summarize(name: "grep", argsJSON: truncated)
    XCTAssertEqual(r.summary, "/ToolCallSummary/ in Sources")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSummarizeActivityGrep() {
    let s = ToolCallSummary.summarizeActivity(
        #"grep {"pattern":"foo","path":"Sources"}"#
    )
    XCTAssertEqual(s, "/foo/ in Sources")
    XCTAssertFalse(s.contains("{"))
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --filter ToolCallSummaryTests 2>&1 | tail -30`
Expected: the five new `testGrep*` / `testSummarize*Grep*` methods FAIL. Reason: `summarize(name:"grep", args:)` currently falls to `legacySummary`, which returns the `path` only (e.g. `"Sources"`) or raw `compactJSON`; the `/pattern/` formatting and `contains("{")` assertions fail.

- [ ] **Step 3: Write minimal implementation**

3a. Add the `grep` case to `summarize(name:args:)`, right after the `find` case added in Task 1:

```swift
        case "find":
            return (findSummary(args), 0)
        case "grep":
            return (grepSummary(args), 0)
        default:
            return (legacySummary(name: name, args: args), 0)
        }
```

3b. Add the `grepSummary` helper (next to `findSummary`):

```swift
    /// `grep` — `/pattern/ in path`; missing/empty pattern defaults to `…`.
    private static func grepSummary(_ args: J) -> String {
        let pattern = args["pattern"].string.flatMap { $0.isEmpty ? nil : $0 } ?? "…"
        if let path = args["path"].string, !path.isEmpty {
            return "/\(pattern)/ in \(path)"
        }
        return "/\(pattern)/"
    }
```

3c. Add the `grep` scrape branch to `scrapeSummary(name:from:)`, right after the `find` case added in Task 1:

```swift
        case "find":
            let pattern = scrapeJSONString(key: "pattern", from: text) ?? "*"
            if let path = scrapeJSONString(key: "path", from: text), !path.isEmpty {
                return "\(pattern) in \(path)"
            }
            return pattern
        case "grep":
            let pattern = scrapeJSONString(key: "pattern", from: text) ?? "…"
            if let path = scrapeJSONString(key: "path", from: text), !path.isEmpty {
                return "/\(pattern)/ in \(path)"
            }
            return "/\(pattern)/"
        default:
            return scrapeJSONString(key: "path", from: text)
                ?? scrapeJSONString(key: "file_path", from: text)
                ?? scrapeJSONString(key: "command", from: text)
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --filter ToolCallSummaryTests 2>&1 | tail -30`
Expected: the five new `grep` methods PASS; all `find` methods and all pre-existing methods still PASS. No commit (out of scope).

---

### Task 3: `subagent` readable summary (full priority matrix + truncation + scrape + activity)

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift` — `summarize(name:args:)` switch (add `case "subagent"` after `case "grep"`), add `subagentSummary` helper, and `scrapeSummary(name:from:)` switch (add `case "subagent"` after `case "grep"`).
- Test: `Tests/PipiUITests/ToolCallSummaryTests.swift` — append new methods.

**Interfaces:**
- Consumes: `J` (`.string`, non-optional `.array`), existing `scrapeJSONString(key:from:)`.
- Produces: `private static func subagentSummary(_ args: J) -> String`; a new `case "subagent"` in both switches.

- [ ] **Step 1: Write the failing tests**

Append to `Tests/PipiUITests/ToolCallSummaryTests.swift`:

```swift
// MARK: - subagent

func testSubagentSingleAgentAndTask() {
    let args = J(["agent": "researcher", "task": "查找 X 的实现"])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    XCTAssertEqual(r.summary, "researcher — 查找 X 的实现")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSubagentAgentOnly() {
    let args = J(["agent": "researcher"])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    XCTAssertEqual(r.summary, "researcher")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSubagentAbort() {
    let args = J(["action": "abort", "agentId": "agent-abc-123"])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    XCTAssertEqual(r.summary, "abort agent-abc-123")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSubagentAbortNoId() {
    let args = J(["action": "abort"])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    XCTAssertEqual(r.summary, "abort …")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSubagentTasks() {
    let args = J([
        "tasks": [["x": 1], ["y": 2]] as [[String: Int]],
    ])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    XCTAssertEqual(r.summary, "2 tasks")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSubagentChain() {
    let args = J([
        "chain": [["s": 1], ["s": 2], ["s": 3]] as [[String: Int]],
    ])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    XCTAssertEqual(r.summary, "3-step chain")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSubagentEmpty() {
    let args = J([:])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    XCTAssertEqual(r.summary, "…")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSubagentLongTaskTruncated() {
    let long = String(repeating: "a", count: 120)
    let args = J(["agent": "researcher", "task": long])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    let expected = "researcher — " + String(repeating: "a", count: 80) + "…"
    XCTAssertEqual(r.summary, expected)
    XCTAssertFalse(r.summary.contains("{"))
}

func testSubagentTaskWhitespaceCollapsed() {
    let args = J(["agent": "r", "task": "foo   bar\tbaz"])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    XCTAssertEqual(r.summary, "r — foo bar baz")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSubagentPriorityAbortBeatsAgent() {
    // action==abort wins over a present agent field.
    let args = J(["action": "abort", "agentId": "id-1", "agent": "researcher"])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    XCTAssertEqual(r.summary, "abort id-1")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSubagentPriorityAgentBeatsTasks() {
    let args = J(["agent": "researcher", "tasks": [["x": 1], ["y": 2]] as [[String: Int]]])
    let r = ToolCallSummary.summarize(name: "subagent", args: args)
    XCTAssertEqual(r.summary, "researcher")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSummarizeTruncatedSubagentJSONShowsAgent() {
    // Invalid JSON (no closing brace) — must still scrape agent + task.
    let truncated = #"{"agent":"researcher","task":"do X"#
    let r = ToolCallSummary.summarize(name: "subagent", argsJSON: truncated)
    XCTAssertEqual(r.summary, "researcher — do X")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSummarizeTruncatedSubagentAbortJSON() {
    let truncated = #"{"action":"abort","agentId":"agent-abc-123"#
    let r = ToolCallSummary.summarize(name: "subagent", argsJSON: truncated)
    XCTAssertEqual(r.summary, "abort agent-abc-123")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSummarizeTruncatedSubagentNoFieldsFallsBackEllipsis() {
    // Truncated text with no scannable agent/task/action — must NOT echo raw JSON.
    let truncated = #"{"tasks":[{"x"#
    let r = ToolCallSummary.summarize(name: "subagent", argsJSON: truncated)
    XCTAssertEqual(r.summary, "…")
    XCTAssertFalse(r.summary.contains("{"))
}

func testSummarizeActivitySubagent() {
    let s = ToolCallSummary.summarizeActivity(
        #"subagent {"agent":"researcher","task":"do X"}"#
    )
    XCTAssertEqual(s, "researcher — do X")
    XCTAssertFalse(s.contains("{"))
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --filter ToolCallSummaryTests 2>&1 | tail -40`
Expected: the fifteen new `testSubagent*` / `testSummarize*Subagent*` methods FAIL. Reason: `summarize(name:"subagent", args:)` currently falls to `legacySummary`, whose `command`/`path`/`file_path` lookups all miss, so it returns raw `compactJSON` containing `{` — failing both the equality and the `contains("{")` assertions.

- [ ] **Step 3: Write minimal implementation**

3a. Add the `subagent` case to `summarize(name:args:)`, right after the `grep` case added in Task 2:

```swift
        case "grep":
            return (grepSummary(args), 0)
        case "subagent":
            return (subagentSummary(args), 0)
        default:
            return (legacySummary(name: name, args: args), 0)
        }
```

3b. Add the `subagentSummary` helper (next to `grepSummary`). Priority order is fixed: abort → agent(+task) → tasks → chain → `…`. Task text collapses whitespace runs to a single space, then truncates to 80 chars + `…`. Separator is exactly ` — ` (space + U+2014 + space):

```swift
    /// `subagent` — priority: `abort <agentId>` → `<agent> — <task>` → `<N> tasks`
    /// → `<N>-step chain` → `…`. Task text collapses whitespace and truncates at 80 chars.
    private static func subagentSummary(_ args: J) -> String {
        if args["action"].string == "abort" {
            let id = args["agentId"].string.flatMap { $0.isEmpty ? nil : $0 } ?? "…"
            return "abort \(id)"
        }
        if let agent = args["agent"].string, !agent.isEmpty {
            if let task = args["task"].string, !task.isEmpty {
                let collapsed = task.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
                let truncated = collapsed.count > 80 ? String(collapsed.prefix(80)) + "…" : collapsed
                return "\(agent) — \(truncated)"
            }
            return agent
        }
        let tasks = args["tasks"].array
        if !tasks.isEmpty { return "\(tasks.count) tasks" }
        let chain = args["chain"].array
        if !chain.isEmpty { return "\(chain.count)-step chain" }
        return "…"
    }
```

3c. Add the `subagent` scrape branch to `scrapeSummary(name:from:)`, right after the `grep` case added in Task 2. It reuses the same priority/format but reads fields via `scrapeJSONString`; `tasks`/`chain` counts are unreliable when truncated, so it falls back to `…` and never emits raw JSON:

```swift
        case "grep":
            let pattern = scrapeJSONString(key: "pattern", from: text) ?? "…"
            if let path = scrapeJSONString(key: "path", from: text), !path.isEmpty {
                return "/\(pattern)/ in \(path)"
            }
            return "/\(pattern)/"
        case "subagent":
            if scrapeJSONString(key: "action", from: text) == "abort" {
                let id = scrapeJSONString(key: "agentId", from: text) ?? "…"
                return "abort \(id)"
            }
            if let agent = scrapeJSONString(key: "agent", from: text), !agent.isEmpty {
                if let task = scrapeJSONString(key: "task", from: text), !task.isEmpty {
                    let collapsed = task.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
                    let truncated = collapsed.count > 80 ? String(collapsed.prefix(80)) + "…" : collapsed
                    return "\(agent) — \(truncated)"
                }
                return agent
            }
            return "…"
        default:
            return scrapeJSONString(key: "path", from: text)
                ?? scrapeJSONString(key: "file_path", from: text)
                ?? scrapeJSONString(key: "command", from: text)
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --filter ToolCallSummaryTests 2>&1 | tail -40`
Expected: all fifteen new `subagent` methods PASS; all `find` / `grep` methods and all pre-existing methods still PASS. No commit (out of scope).

---

### Task 4: Focused + full Swift verification, regression check, and scope guard

**Files:**
- No edits. Verification only on `Sources/PipiUI/ChatSession.swift` and `Tests/PipiUITests/ToolCallSummaryTests.swift`.

- [ ] **Step 1: Focused test run (all ToolCallSummaryTests)**

Run: `swift test --filter ToolCallSummaryTests 2>&1 | tail -40`
Expected: every method in `ToolCallSummaryTests` — original (`testWrite*`, `testEdit*`, `testBash*`, `testGenerateImage*`, `testSummarizeArgs*`, `testSummarizeTruncatedEdit*`, `testSummarizeTruncatedBash*`, `testSummarizePlainPathPassthrough`, `testSummarizeActivity*`, `testLabelSuffixFromCharCount`, `testConvertWritePopulatesPayloadChars`) plus the new find/grep/subagent methods — reports PASS, with **zero** `XCTAssertFalse(...contains("{"))` failures. Exit code 0.

- [ ] **Step 2: Full SwiftPM test run (regression)**

Run: `swift test 2>&1 | tail -50`
Expected: entire `PipiUITests` suite passes (exit code 0). No pre-existing case regressed; nothing outside the two named files was required to change. This is the only build/test gate — **do not** run `make-app.sh`, `scripts/build-app.sh`, or any packaging step (spec forbids it).

- [ ] **Step 3: Scope guard — confirm only the two intended files changed**

Run (path-limited; does **not** enumerate unrelated working-tree state):

```bash
git diff --name-only -- Sources/PipiUI/ChatSession.swift Tests/PipiUITests/ToolCallSummaryTests.swift
```

Expected output, exactly these two lines and nothing else from this command:

```
Sources/PipiUI/ChatSession.swift
Tests/PipiUITests/ToolCallSummaryTests.swift
```

If any other path appears in this limited diff, stop and undo that stray edit — it is out of scope. Do **not** run a broad `git status`, do **not** stage/stash/restore/clean, and do **not** commit: the spec forbids disturbing unrelated state and forbids commits in this scope.

- [ ] **Step 4: Static scope confirmation**

Confirm by reading the diff that the only edits in `Sources/PipiUI/ChatSession.swift` are: three new `case`s in `summarize(name:args:)`, three new private helpers (`findSummary` / `grepSummary` / `subagentSummary`), and three new `case`s in `scrapeSummary(name:from:)`. `legacySummary`, `summarizeActivity(_:)`, `summarize(name:argsJSON:)`, `browserSummary`, `promptSummary`, `pathSummary`, `editPayloadChars`, and `scrapeJSONString` are unchanged. No views, no TS, no tool schemas, no scripts touched.

---

## Self-Review

Run by the plan author after writing the full plan (checklist completed — issues fixed inline, no second pass needed).

**1. Spec coverage** — each spec requirement maps to a task/step:

| Spec section | Covered by |
|---|---|
| §2/§5.1 `find` format + `*` default | Task 1 helper + `testFindPatternAndPath` / `testFindPatternOnly` / `testFindDefaultPatternEmpty` / `testFindDefaultPatternWithPath` |
| §2/§5.2 `grep` format + `…` default | Task 2 helper + `testGrepPatternAndPath` / `testGrepPatternOnly` / `testGrepDefaultPattern` |
| §2/§5.3 `subagent` priority (abort/agent+task/tasks/chain/`…`) | Task 3 helper + `testSubagentSingleAgentAndTask` / `AgentOnly` / `Abort` / `AbortNoId` / `Tasks` / `Chain` / `Empty` / `PriorityAbortBeatsAgent` / `PriorityAgentBeatsTasks` |
| §5.3 task truncation (whitespace collapse, 80-char + `…`, ` — ` separator) | Task 3 helper + `testSubagentLongTaskTruncated` / `testSubagentTaskWhitespaceCollapsed` |
| §5.4 `scrapeSummary` fallback for find/grep/subagent | Tasks 1/2/3 step 3c + `testSummarizeTruncated{Find,Grep,Subagent}JSON*` / `testSummarizeTruncatedSubagentNoFieldsFallsBackEllipsis` |
| §6.1 direct-summary assertions (incl. `contains("{")==false`) | every new test method asserts `XCTAssertFalse(...contains("{"))` |
| §6.2 truncated-JSON assertions | Task 1/2/3 truncated tests |
| §6.3 activity assertions (find + subagent; grep added for symmetry) | `testSummarizeActivity{Find,Grep,Subagent}` |
| §6.4 regression of write/edit/bash/generate_image/read/activity | Task 4 Step 1 + Step 2 re-run unchanged originals |
| §7 file scope (only `ChatSession.swift` + `ToolCallSummaryTests.swift`) | File map + Task 4 Step 3/Step 4 scope guard |
| §3 non-goals (no views/TS/tool behavior/scripts/packaging/commits) | Global Constraints + Task 4 forbids `make-app.sh`/commits |

No spec section is left without a task.

**2. Placeholder scan** — searched the plan for `TODO`, `TBD`, `implement later`, `fill in`, `Add appropriate`, `handle edge cases`, `Similar to Task`, and bare descriptive steps. None present. Every code-bearing step contains the full, compilable code. Every verification step contains the exact command and expected result.

**3. Type consistency** — verified against `Sources/PipiUI/J.swift`:
- `.string` is `String?` → used with `flatMap { $0.isEmpty ? nil : $0 } ?? default` and `if let x = args[k].string, !x.isEmpty`. ✓
- `.array` is **non-optional** `[J]` → used as `let tasks = args["tasks"].array; if !tasks.isEmpty`, **not** `if let`. ✓
- `args["key"]` returns `J` (never optional) → `args["action"].string == "abort"` is a valid `String? == String` comparison (nil ≠ "abort"). ✓
- Test constructor `J([...])` matches existing tests (`J(["path": "a.swift", "content": "hello!"])`); array literals cast `as [[String: Int]]` like the existing `as [[String: String]]` in `testEditSumsNewText`. ✓
- Helper names `findSummary` / `grepSummary` / `subagentSummary` are spelled identically in their definition, their `case` call sites in `summarize(name:args:)`, and (conceptually, via duplicated logic) in `scrapeSummary`. No `clearLayers`/`clearFullLayers` drift. ✓
- Truncation ceiling is 80 chars + `…`, matching the existing `promptSummary`/`generate_image` 80-char ceiling cited in the spec; the `testSubagentLongTaskTruncated` expected string is computed from the same rule. ✓

**4. Scope guard confirmation** — the plan edits exactly `Sources/PipiUI/ChatSession.swift` and `Tests/PipiUITests/ToolCallSummaryTests.swift`. It does not modify views, TS, tool `execute`, schemas, `make-app.sh`, `scripts/`, or any config. It performs no git commits and no app packaging. Task 4 Step 3 enforces this with a path-limited diff and explicitly forbids broad `git status` / staging / committing, preserving the pre-existing unrelated working-tree state.
