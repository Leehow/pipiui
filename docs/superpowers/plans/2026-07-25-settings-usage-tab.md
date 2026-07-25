# Settings Usage Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Settings → 用量 Tab that aggregates PipiUI `TokenLedger` by model / role / tool (full-turn tool attribution), with expandable In/Out/Cache detail.

**Architecture:** Keep writing per-turn usage into `TokenLedger` JSONL (extend with optional `tools[]`). Add pure read-side `TokenUsageStats` to load active+`.1` files and build two-level reports. Wire a new segmented tab in `SettingsSheet` that flushes the ledger, aggregates off-main, and renders compact expandable rows.

**Tech Stack:** Swift 5.9 / SwiftUI macOS 14+, SwiftPM XCTest, existing `TokenLedger` + `TokenFormat`, PiExt TypeScript subagent bridge.

**Spec:** `docs/superpowers/specs/2026-07-25-settings-usage-tab-design.md`

## Global Constraints

- Data source v1: **only** `TokenLedger` (active + `.1`). Do **not** scan `~/.pi/agent/sessions`.
- Do **not** install community pi usage npm extensions.
- `Tokens = input + output + cacheWrite` (exclude `cacheRead`).
- By-tool view: **full-turn attribution** (multi-tool turn credits whole turn to each tool); **totals always count each turn once**.
- Empty / missing `tools` → primary key `(无工具)`.
- Role key: `main` if `channel == "main"`; else non-empty `agentName`; else `subagent`.
- Sort rows by cost desc, then tokens desc, then key ascending.
- No CSV export, no provider quota API, no session/project drill-down in v1.
- After successful compile meant for the runnable app ⇒ `./make-app.sh` and verify `build/PipiUI.app` mtime newer than touched sources.
- Commit only when the user explicitly asks.

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/Logging/TokenLedger.swift` | Optional `tools` on append/Record; `rolledFileURL`; `toolNames(from:)` |
| `Sources/PipiUI/Logging/TokenUsageStats.swift` | Period / GroupBy / load / aggregate (pure) |
| `Sources/PipiUI/ChatSession.swift` | Main `recordTurnUsage` passes `tools:` |
| `Sources/PipiUI/SubagentStore.swift` | `kind:"usage"` reads `tools` array into ledger |
| `Sources/PipiUI/PiExt/subagent/index.ts` | `pipiuiReport` usage payload includes `tools` |
| `Sources/PipiUI/Views/SettingsSheet.swift` | `SettingsTab.usage` + usage UI |
| `Tests/PipiUITests/TokenLedgerTests.swift` | tools write + `toolNames` |
| `Tests/PipiUITests/TokenUsageStatsTests.swift` | aggregation TDD |

## Prerequisites / clean slate

A premature implementation landed out of process order. **Task 0 discards it** so Tasks 1–N re-implement via TDD against the approved spec. Do not "keep and tweak" the voided code unless a step explicitly says to reuse a file after rewrite.

---

### Task 0: Void premature implementation

**Files:**
- Delete (if present): `Sources/PipiUI/Logging/TokenUsageStats.swift`
- Delete (if present): `Tests/PipiUITests/TokenUsageStatsTests.swift`
- Revert usage-related edits in:
  - `Sources/PipiUI/Logging/TokenLedger.swift`
  - `Sources/PipiUI/ChatSession.swift` (`recordTurnUsage` `tools:` only)
  - `Sources/PipiUI/SubagentStore.swift` (usage `tools` only)
  - `Sources/PipiUI/PiExt/subagent/index.ts` (usage `tools` only)
  - `Tests/PipiUITests/TokenLedgerTests.swift` (tools / toolNames tests only)
  - `Sources/PipiUI/Views/SettingsSheet.swift` (用量 Tab / usage state / usageSection only)

**Note:** `SettingsSheet` may also contain unrelated WebSearch `.env` UI fixes needed to compile against current `WebSearchSettings`. **Keep compile-fixing WebSearch changes**; only remove 用量-specific code (`SettingsTab.usage`, usage `@State`, `usageSection`, related helpers, sheet size bump if it was only for 用量 — restore width/height only if no other reason to keep 640×620).

- [ ] **Step 1: Remove new usage files**

```bash
rm -f Sources/PipiUI/Logging/TokenUsageStats.swift \
      Tests/PipiUITests/TokenUsageStatsTests.swift
```

- [ ] **Step 2: Revert ledger / writers / tests to pre-usage baseline**

Prefer surgical revert of usage hunks. If the working tree is too mixed:

```bash
# Only if these files have no other intentional WIP you must keep:
git checkout -- Sources/PipiUI/Logging/TokenLedger.swift \
  Sources/PipiUI/SubagentStore.swift \
  Sources/PipiUI/PiExt/subagent/index.ts \
  Tests/PipiUITests/TokenLedgerTests.swift
```

Then manually remove from `ChatSession.recordTurnUsage` any `tools:` argument. Manually strip 用量 UI from `SettingsSheet` while leaving WebSearch `.env` compile fixes.

- [ ] **Step 3: Confirm baseline builds (no 用量 symbols)**

```bash
swift build 2>&1 | tail -20
rg -n "TokenUsageStats|SettingsTab\.usage|case usage" Sources/PipiUI || true
```

Expected: build succeeds (or only pre-existing unrelated errors); no `TokenUsageStats` / usage tab references.

- [ ] **Step 4: Commit** (only if user asks) — message: `chore: void premature settings usage tab work`

---

### Task 1: Ledger `tools` + `toolNames` (TDD)

**Files:**
- Modify: `Sources/PipiUI/Logging/TokenLedger.swift`
- Modify: `Tests/PipiUITests/TokenLedgerTests.swift`

**Interfaces:**
- Consumes: existing `TokenLedger.append`, `J`
- Produces:
  ```swift
  // append gains:
  tools: [String] = []
  // Record gains: let tools: [String]
  // toJSONLine: omit tools key when empty
  var rolledFileURL: URL { /* fileURL.path + ".1" */ }
  static func toolNames(from message: J) -> [String]
  ```

- [ ] **Step 1: Write failing tests** (add to `TokenLedgerTests`)

```swift
func testAppendWritesToolsWhenNonEmpty() throws {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("pipiui-ledger-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let ledger = TokenLedger(
        baseDirectory: dir,
        queue: DispatchQueue(label: "test.token-ledger.\(UUID().uuidString)")
    )
    ledger.append(
        session: "s", channel: "main", agentId: nil, agentName: nil,
        depth: 0, model: "xai/a", turn: 1,
        usage: .init(input: 1, output: 2),
        tools: ["bash", "read"]
    )
    ledger.flushSync()
    let data = try Data(contentsOf: ledger.fileURL)
    let line = String(data: data, encoding: .utf8)!
        .split(separator: "\n").first!
    let obj = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
    XCTAssertEqual(obj["tools"] as? [String], ["bash", "read"])
}

func testAppendOmitsToolsWhenEmpty() throws {
    // same temp ledger setup…
    ledger.append(
        session: "s", channel: "main", agentId: nil, agentName: nil,
        depth: 0, model: "xai/a", turn: 1,
        usage: .init(input: 1, output: 2),
        tools: []
    )
    ledger.flushSync()
    let obj = /* parse first JSONL line */
    XCTAssertNil(obj["tools"])
}

func testToolNamesFromMessageDedupsAndSorts() {
    let message: [String: Any] = [
        "role": "assistant",
        "content": [
            ["type": "text", "text": "hi"],
            ["type": "toolCall", "name": "read", "id": "1"],
            ["type": "toolCall", "name": "bash", "id": "2"],
            ["type": "toolCall", "name": "read", "id": "3"],
        ],
    ]
    XCTAssertEqual(TokenLedger.toolNames(from: J(message)), ["bash", "read"])
}

func testRolledFileURLSuffix() {
    let ledger = TokenLedger(baseDirectory: FileManager.default.temporaryDirectory)
    XCTAssertTrue(ledger.rolledFileURL.path.hasSuffix("pipiui-token-ledger.jsonl.1"))
}
```

- [ ] **Step 2: Run — expect fail**

```bash
swift test --filter TokenLedgerTests
```

Expected: FAIL on missing `tools` / `toolNames` / `rolledFileURL`.

- [ ] **Step 3: Minimal implementation**

In `TokenLedger.swift`:
- Add `rolledFileURL`.
- Extend `append` + `Record` with `tools: [String]`.
- `toJSONLine`: build `[String: Any]`, add `tools` only if non-empty; keep stripping nil agent fields.
- Add `static func toolNames(from message: J) -> [String]` — unique names from `content` blocks with `type == "toolCall"`, trimmed, sorted.

- [ ] **Step 4: Tests pass**

```bash
swift test --filter TokenLedgerTests
```

- [ ] **Step 5: Commit** (only if user asks)

---

### Task 2: `TokenUsageStats` aggregation (TDD)

**Files:**
- Create: `Sources/PipiUI/Logging/TokenUsageStats.swift`
- Create: `Tests/PipiUITests/TokenUsageStatsTests.swift`

**Interfaces:**
- Consumes: `TokenLedger.fileURL`, `rolledFileURL`, `flushSync`, JSONL shape from Task 1
- Produces:
  ```swift
  enum TokenUsageStats {
      enum Period: String, CaseIterable, Identifiable { case today, last7Days, last30Days, all }
      // rawValues: "今日", "7 天", "30 天", "全部"
      enum GroupBy: String, CaseIterable, Identifiable { case model, role, tool }
      // rawValues: "按模型", "按角色", "按工具"
      static let noToolKey = "(无工具)"
      struct Metrics { var calls, input, output, cacheRead, cacheWrite: Int; var cost: Double
                       var tokens: Int { input + output + cacheWrite } }
      struct Row: Identifiable { let key: String; var metrics: Metrics; var children: [Row] }
      struct Report { var total: Metrics; var rows: [Row] }
      struct Record { var date: Date; var channel: String; var agentName: String?
                      var model: String; var input, output, cacheRead, cacheWrite: Int
                      var cost: Double; var tools: [String] }
      static func roleKey(channel: String, agentName: String?) -> String
      static func loadRecords(from urls: [URL], fileManager: FileManager = .default) -> [Record]
      static func loadSharedRecords() -> [Record] // flushSync + active + rolled
      static func parseLine(_ line: String) -> Record?
      static func aggregate(records: [Record], period: Period, groupBy: GroupBy,
                            now: Date = Date(), calendar: Calendar = .current) -> Report
  }
  ```

- [ ] **Step 1: Write failing tests**

```swift
final class TokenUsageStatsTests: XCTestCase {
    // Use fixed UTC calendar + ISO8601 dates as in other logging tests.

    func testRoleKeyMainAndSubagentTypes() { /* main / explore / blank → subagent */ }

    func testTokensExcludeCacheRead() {
        var m = TokenUsageStats.Metrics()
        m.add(input: 100, output: 50, cacheRead: 9999, cacheWrite: 20, cost: 1)
        XCTAssertEqual(m.tokens, 170)
    }

    func testAggregateByModelSplitsRoles() throws { /* primary model, children roles, cost sort */ }

    func testAggregateByRoleSplitsModels() throws { /* inverse */ }

    func testAggregateByToolFullTurnAttribution() throws {
        // tools [bash,read] cost 1.0 + tools [bash] cost 0.5
        // total.cost == 1.5, total.calls == 2
        // bash.cost == 1.5, read.cost == 1.0
    }

    func testAggregateByToolLegacyNoToolsBucket() {
        // tools [] → key == TokenUsageStats.noToolKey
    }

    func testPeriodTodayFiltersOtherDays() { /* … */ }

    func testLoadRecordsFromJSONLFiles() throws {
        // write active + .1 lines including tools; loadRecords merges both
    }
}
```

Full assertions: copy semantics from the approved spec (by-model children = roles; by-tool children = roles; totals turn-deduped).

- [ ] **Step 2: Run — expect fail**

```bash
swift test --filter TokenUsageStatsTests
```

- [ ] **Step 3: Implement `TokenUsageStats.swift`**

- Parse `ts` with fractional + plain ISO8601.
- `aggregate`: filter by period; always `total.add` once per record; for `.tool`, attribute to each tool key (or `noToolKey`); build primary→secondary tree; sort with cost/tokens/key.
- `loadSharedRecords`: `TokenLedger.shared.flushSync()` then load `[fileURL, rolledFileURL]`.

- [ ] **Step 4: Tests pass**

```bash
swift test --filter TokenUsageStatsTests
```

- [ ] **Step 5: Commit** (only if user asks)

---

### Task 3: Wire writers (main + subagent)

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift` — `recordTurnUsage`
- Modify: `Sources/PipiUI/SubagentStore.swift` — `case "usage"`
- Modify: `Sources/PipiUI/PiExt/subagent/index.ts` — `message_end` usage report

**Interfaces:**
- Consumes: `TokenLedger.toolNames`, `append(..., tools:)`
- Produces: ledger lines with `tools` for new turns; subagent bridge field `tools: string[]`

- [ ] **Step 1: Main session**

In `recordTurnUsage(for message:)`:

```swift
TokenLedger.shared.append(
    session: id,
    channel: "main",
    agentId: nil,
    agentName: nil,
    depth: 0,
    model: model,
    turn: turn,
    usage: usage,
    tools: TokenLedger.toolNames(from: message)
)
```

- [ ] **Step 2: Subagent TS**

Inside `message_end` assistant+usage block, before `pipiuiReport`:

```typescript
const toolSet = new Set<string>();
for (const part of (msg as any).content ?? []) {
  if (part?.type === "toolCall" && typeof part.name === "string" && part.name) {
    toolSet.add(part.name);
  }
}
const tools = [...toolSet].sort();
pipiuiReport({
  kind: "usage",
  agentId: pipiuiAgentId,
  turn: currentResult.usage.turns,
  model: msg.model || currentResult.model || null,
  tools,
  usage: { /* existing fields */ },
});
```

- [ ] **Step 3: SubagentStore**

```swift
let tools = e["tools"].array.compactMap(\.string)
TokenLedger.shared.append(
    /* existing session/channel/agent… */,
    usage: usage,
    tools: tools
)
```

- [ ] **Step 4: Sanity**

```bash
swift test --filter 'TokenLedgerTests|TokenUsageStatsTests'
```

Expected: PASS. (No new UI yet.)

- [ ] **Step 5: Commit** (only if user asks)

---

### Task 4: Settings → 用量 Tab UI

**Files:**
- Modify: `Sources/PipiUI/Views/SettingsSheet.swift`

**Interfaces:**
- Consumes: `TokenUsageStats.*`, `TokenFormat.compact`

- [ ] **Step 1: Tab + state**

```swift
private enum SettingsTab: String, CaseIterable, Identifiable {
    case models = "模型"
    case usage = "用量"
    case toolsSkills = "工具与 Skills"
    case subagentModels = "Subagent 模型"
    case webSearch = "网络搜索"
    var id: String { rawValue }
}

@State private var usagePeriod: TokenUsageStats.Period = .today
@State private var usageGroupBy: TokenUsageStats.GroupBy = .model
@State private var usageReport = TokenUsageStats.Report(total: .init(), rows: [])
@State private var usageExpanded: Set<String> = []
@State private var usageLoading = false
```

Sheet frame: `width: 640, height: 620`.

`switch tab` include `case .usage: usageSection`.

`onChange` of `tab` / `usagePeriod` / `usageGroupBy` → `reloadUsage()` (clear expanded on groupBy change).

- [ ] **Step 2: `usageSection` UI**

Must include:
- Title + caption (Tokens formula)
- Extra caption when `groupBy == .tool` (full-turn attribution warning + `(无工具)`)
- Period + groupBy segmented pickers + refresh
- Totals bar: Calls / Tokens / Cost (from `usageReport.total`)
- Empty / loading states (exact empty copy from spec)
- Column header by groupBy (模型 / 角色 / 工具)
- Rows: disclosure; collapsed Calls/Tokens/Cost; expanded In/Out/CacheR/CacheW/命中 + children by role or model

Cost formatting: `$0` if ≤0; `$%.4f` if &lt;0.01; else `$%.2f`.

- [ ] **Step 3: `reloadUsage`**

```swift
private func reloadUsage() {
    usageLoading = true
    let period = usagePeriod
    let groupBy = usageGroupBy
    Task.detached(priority: .utility) {
        let records = TokenUsageStats.loadSharedRecords()
        let report = TokenUsageStats.aggregate(records: records, period: period, groupBy: groupBy)
        await MainActor.run {
            usageReport = report
            usageLoading = false
        }
    }
}
```

- [ ] **Step 4: Build**

```bash
swift build
```

Expected: success.

- [ ] **Step 5: Commit** (only if user asks)

---

### Task 5: Package app + verify timestamps

**Files:** none (build artifacts)

- [ ] **Step 1: Package**

```bash
./make-app.sh
```

- [ ] **Step 2: Verify binary newer than sources**

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  Sources/PipiUI/Logging/TokenUsageStats.swift \
  Sources/PipiUI/Views/SettingsSheet.swift \
  Sources/PipiUI/Logging/TokenLedger.swift \
  Sources/PipiUI/PiExt/subagent/index.ts
```

Expected: `PipiUI` mtime ≥ each listed source.

- [ ] **Step 3: Manual smoke (human)**

1. Open `build/PipiUI.app` → 设置 → 用量  
2. Confirm three views + time filters  
3. Send a turn that calls tools → refresh → 按工具 shows those tools  
4. Expand a row → see role/model children + In/Out/Cache  

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| 用量 Tab entry + sheet size | 4 |
| Period filters | 2, 4 |
| GroupBy model / role / tool | 2, 4 |
| Tokens exclude cacheRead | 2 |
| Role key rules | 2 |
| Full-turn tool attribution + turn-deduped totals | 2 |
| `(无工具)` legacy bucket | 2 |
| Expandable In/Out/Cache + secondary rows | 4 |
| Ledger `tools` write main + subagent | 1, 3 |
| No sessions scan / no npm extension | Global + all tasks |
| `./make-app.sh` delivery | 5 |
| Void premature work | 0 |

## Placeholder scan

No TBD / "implement later" / "similar to Task N" left unresolved.

## Type consistency

- `GroupBy`: `model` / `role` / `tool` throughout Tasks 2–4  
- `noToolKey == "(无工具)"`  
- `append(..., tools:)` default `[]`  
- Bridge field name `tools` (string array) in TS + Swift
