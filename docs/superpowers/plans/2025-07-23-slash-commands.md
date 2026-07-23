# Slash Commands (`/`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give pipiui a `/` slash-command palette that lists builtin GUI actions plus pi `get_commands` (extension/prompt/skill), with fuzzy filter, keyboard navigation, and correct busy-time behavior (builtin immediate; server commands use existing queue).

**Architecture:** Pure logic lives in `SlashCommand.swift` (model, `get_commands` JSON parse, fuzzy rank, builtin table + host-protocol execute). `ChatSession` loads commands once, routes `sendPrompt` through builtin execute, and exposes `flash` + lifecycle closures. `SlashPalette` is a material overlay above the composer; `InputBar` owns query state + a `ComposerSlashKeyMonitor` (same `NSEvent.addLocalMonitorForEvents` pattern as `ComposerPasteCatcher`) for ↑↓/Tab/Return/Esc.

**Tech Stack:** Swift 6.3.3 / swift-tools-version 5.9 / SwiftUI + AppKit / macOS 14+ / single executable target `PipiUI` / new XCTest target `PipiUITests` / pi RPC JSONL via existing `PiProcess.request`.

**Spec:** `docs/superpowers/specs/2025-07-23-slash-commands-design.md`

## Global Constraints

- Swift 6.3.3 / swift-tools-version 5.9 / macOS 14+ / single executable target `PipiUI` (contains `@main` App) plus new `.testTarget(name: "PipiUITests", dependencies: ["PipiUI"])`.
- Workspace is **not** a git repo. Every task “commit” step is: save a unified diff snapshot to `.superpowers/sdd/slash-commands/task-N-diff.txt` (create dir if needed). Do **not** run `git commit`.
- Build/verify: `swift build` (compile), `swift test` (unit tests), `swift run` (manual UI). Packaging `./make-app.sh` only at final manual pass if desired.
- Draft text is **`session.draftText`** (`ChatSession` `@Published`), not a local `@State draft` (spec wording is outdated; match source).
- No toast system today: `ChatSession.flash(_:)` sets `@Published lastError` (existing red banner in `ChatDetailView`). Informational builtins (e.g. `/session`) also use `flash`.
- Builtin commands execute **immediately** even when `isWorking`; never enqueue them. Extension/prompt/skill and unknown `/xxx` keep existing `sendPrompt` → queue/`sendPromptNow` path.
- Unknown `/xxx` (not in builtin table) is sent as a normal prompt (pi expands skills/ext or treats as user text).
- `get_commands` failure/empty → keep `availableCommands = []`; palette still shows builtins; **no** error flash.
- Do **not** add RPC for builtins missing from the table (`/settings`, `/login`, etc.). Do **not** implement `/model` model-id completion. Do **not** change extension_ui auto-cancel behavior.
- Cross-task names must match exactly: `SlashSource`, `SlashCommand`, `BuiltinCommands`, `BuiltinCommandHost`, `SlashFuzzy`, `SlashCommandParser`, `paletteQuery(from:)`, `availableCommands`, `flash(_:)`, `onRequestNewSession`, `onRequestClose`.
- Prefer TDD for pure logic: failing test → implement → pass → snapshot diff.

---

## File Structure

| File | Responsibility |
|---|---|
| `Sources/PipiUI/SlashCommand.swift` | **Create** — `SlashSource`, `SlashCommand`, `SlashCommandParser` (`get_commands` JSON→models), `SlashFuzzy` (subsequence filter/score/sort), `BuiltinCommands` (static table + parse invocation + `execute` against `BuiltinCommandHost`), `SlashPaletteQuery.paletteQuery(from:)` |
| `Sources/PipiUI/ChatSession.swift` | **Modify** — `availableCommands`, `flash`, lifecycle closures, `loadInitialState` `get_commands`, `sendPrompt` builtin gate, host methods (`runCompact`, …), expose/adapt `refreshStats` usage |
| `Sources/PipiUI/AppStore.swift` | **Modify** — in `makeSession`, inject `onRequestNewSession` / `onRequestClose` |
| `Sources/PipiUI/Views/SlashPalette.swift` | **Create** — floating candidate list UI (material, badges, selection highlight) |
| `Sources/PipiUI/Views/InputBar.swift` | **Modify** — palette state, `onChange(of: session.draftText)`, overlay mount, key monitor, complete/execute helpers |
| `Package.swift` | **Modify** — add `PipiUITests` test target |
| `Tests/PipiUITests/SlashCommandTests.swift` | **Create** — XCTest for parser, fuzzy, builtin route/args/closures |
| `Tests/PipiUITests/BuiltinHostMock.swift` | **Create** — mock `BuiltinCommandHost` for execute tests |
| `README.md` | **Modify** — slash-commands feature section + code-structure rows |
| `.superpowers/sdd/slash-commands/` | **Create as needed** — per-task `task-N-diff.txt` snapshots |

**Unchanged:** `PiProcess.swift` (generic `request`/`send` suffice), `J.swift` (parser uses existing `J`).

---

### Task 1: XCTest target scaffolding

**Files:**
- Modify: `Package.swift`
- Create: `Tests/PipiUITests/SlashCommandTests.swift` (minimal compile check)
- Create: `.superpowers/sdd/slash-commands/` (directory)

**Interfaces:**
- Produces: test target `PipiUITests` depending on `PipiUI`; `swift test` runs.

- [ ] **Step 1: Ensure snapshot directory exists**

```bash
mkdir -p .superpowers/sdd/slash-commands
```

- [ ] **Step 2: Replace `Package.swift` with test target added**

Full file contents:

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PipiUI",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "PipiUI",
            path: "Sources/PipiUI",
            resources: [
                // App 自有的 pi 插件（补丁版 subagent + 我们的 agents），
                // 运行时拷到 Application Support 并 -e 加载，独立于 ~/.pi
                .copy("PiExt")
            ]
        ),
        .testTarget(
            name: "PipiUITests",
            dependencies: ["PipiUI"],
            path: "Tests/PipiUITests"
        ),
    ]
)
```

- [ ] **Step 3: Add a minimal test file so the target compiles**

Create `Tests/PipiUITests/SlashCommandTests.swift`:

```swift
import XCTest
@testable import PipiUI

final class SlashCommandTests: XCTestCase {
    func testScaffoldCompiles() {
        XCTAssertTrue(true)
    }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
swift test --filter SlashCommandTests/testScaffoldCompiles 2>&1
```

Expected: `Test Suite 'SlashCommandTests' passed` / `testScaffoldCompiles` passed, exit 0.

**If** link fails because `PipiUI` is an executable with `@main` (SPM error about executable dependency or duplicate main), apply this fallback **before** continuing — split library + thin entry (only if needed):

1. Move all current `Sources/PipiUI/*` to stay put but change Package to:

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PipiUI",
    platforms: [.macOS(.v14)],
    targets: [
        .target(
            name: "PipiUI",
            path: "Sources/PipiUI",
            exclude: ["AppEntry.swift"],
            resources: [.copy("PiExt")]
        ),
        .executableTarget(
            name: "PipiUIApp",
            dependencies: ["PipiUI"],
            path: "Sources/PipiUIApp"
        ),
        .testTarget(
            name: "PipiUITests",
            dependencies: ["PipiUI"],
            path: "Tests/PipiUITests"
        ),
    ]
)
```

2. Create `Sources/PipiUIApp/main.swift` that is empty and move `@main struct PipiUIApp` into `Sources/PipiUIApp/AppEntry.swift` importing PipiUI — **only if Step 4 failed**. Prefer the simple executable+testTarget layout first; modern SPM usually allows test→executable dependency for module import.

Document which path you took in the task snapshot header.

- [ ] **Step 5: Snapshot diff**

```bash
mkdir -p .superpowers/sdd/slash-commands
{
  echo "=== FILES ==="
  echo "Package.swift"
  echo "Tests/PipiUITests/SlashCommandTests.swift"
  echo ""
  echo "=== Package.swift ==="
  cat Package.swift
  echo ""
  echo "=== Tests/PipiUITests/SlashCommandTests.swift ==="
  cat Tests/PipiUITests/SlashCommandTests.swift
} > .superpowers/sdd/slash-commands/task-1-diff.txt
```

---

### Task 2: `SlashCommand` model + `get_commands` parser (TDD)

**Files:**
- Create: `Sources/PipiUI/SlashCommand.swift` (model + parser section; grow in later tasks)
- Modify: `Tests/PipiUITests/SlashCommandTests.swift`
- Test: `swift test --filter SlashCommandTests`

**Interfaces:**
- Produces:
  - `enum SlashSource: String, Hashable, Codable` cases: `builtin`, `extension_ = "extension"`, `prompt`, `skill`
  - `struct SlashCommand: Identifiable, Hashable` with `name`, `description`, `source`, `argumentHint`, `id`
  - `enum SlashCommandParser` with `static func parseGetCommandsResponse(_ resp: J) -> [SlashCommand]`
  - Mapping: RPC `source` string `"extension"|"prompt"|"skill"` → `SlashSource`; unknown/missing name skipped; `description` optional; `argumentHint` always `nil` for server commands; **ignore** top-level `path`/`location` (legacy); may read `sourceInfo` but need not store it in v1

- [ ] **Step 1: Write failing tests for model id + parser**

Replace `Tests/PipiUITests/SlashCommandTests.swift` with:

```swift
import XCTest
@testable import PipiUI

final class SlashCommandTests: XCTestCase {

    // MARK: - Model

    func testSlashCommandIdIncludesSourceAndName() {
        let c = SlashCommand(
            name: "fix-tests",
            description: "Fix tests",
            source: .prompt,
            argumentHint: nil
        )
        XCTAssertEqual(c.id, "prompt:fix-tests")
    }

    func testBuiltinSourceRawValue() {
        XCTAssertEqual(SlashSource.builtin.rawValue, "builtin")
        XCTAssertEqual(SlashSource.extension_.rawValue, "extension")
        XCTAssertEqual(SlashSource.prompt.rawValue, "prompt")
        XCTAssertEqual(SlashSource.skill.rawValue, "skill")
    }

    // MARK: - get_commands parser

    func testParseGetCommandsModernSourceInfoShape() {
        let json: [String: Any] = [
            "type": "response",
            "command": "get_commands",
            "success": true,
            "data": [
                "commands": [
                    [
                        "name": "session-name",
                        "description": "Set session name",
                        "source": "extension",
                        "sourceInfo": [
                            "path": "/home/user/.pi/agent/extensions/session.ts",
                            "source": "extension",
                            "scope": "user",
                            "origin": "top-level",
                        ] as [String: Any],
                    ] as [String: Any],
                    [
                        "name": "fix-tests",
                        "description": "Fix failing tests",
                        "source": "prompt",
                        "sourceInfo": [
                            "path": "/proj/.pi/agent/prompts/fix-tests.md",
                            "source": "prompt",
                            "scope": "project",
                            "origin": "top-level",
                        ] as [String: Any],
                    ] as [String: Any],
                    [
                        "name": "skill:brave-search",
                        "description": "Web search",
                        "source": "skill",
                        "sourceInfo": [
                            "path": "/home/user/.pi/agent/skills/brave-search/SKILL.md",
                            "source": "skill",
                            "scope": "user",
                            "origin": "top-level",
                        ] as [String: Any],
                    ] as [String: Any],
                ] as [[String: Any]],
            ] as [String: Any],
        ]
        let cmds = SlashCommandParser.parseGetCommandsResponse(J(json))
        XCTAssertEqual(cmds.count, 3)
        XCTAssertEqual(cmds[0].name, "session-name")
        XCTAssertEqual(cmds[0].source, .extension_)
        XCTAssertEqual(cmds[0].description, "Set session name")
        XCTAssertNil(cmds[0].argumentHint)
        XCTAssertEqual(cmds[1].source, .prompt)
        XCTAssertEqual(cmds[2].name, "skill:brave-search")
        XCTAssertEqual(cmds[2].source, .skill)
        XCTAssertEqual(cmds[2].id, "skill:skill:brave-search")
    }

    func testParseGetCommandsLegacyPathLocationStillWorks() {
        // rpc.md examples still show path/location; parser must not crash and still map name/source.
        let json: [String: Any] = [
            "success": true,
            "data": [
                "commands": [
                    [
                        "name": "old",
                        "description": "legacy",
                        "source": "prompt",
                        "location": "project",
                        "path": "/x/y.md",
                    ] as [String: Any],
                ],
            ] as [String: Any],
        ]
        let cmds = SlashCommandParser.parseGetCommandsResponse(J(json))
        XCTAssertEqual(cmds.map(\.name), ["old"])
        XCTAssertEqual(cmds.first?.source, .prompt)
    }

    func testParseGetCommandsFailureOrMissingReturnsEmpty() {
        XCTAssertEqual(SlashCommandParser.parseGetCommandsResponse(J(["success": false, "error": "nope"])).count, 0)
        XCTAssertEqual(SlashCommandParser.parseGetCommandsResponse(J(["success": true, "data": [String: Any]()])).count, 0)
        XCTAssertEqual(SlashCommandParser.parseGetCommandsResponse(J(nil)).count, 0)
    }

    func testParseGetCommandsSkipsUnknownSourceAndMissingName() {
        let json: [String: Any] = [
            "success": true,
            "data": [
                "commands": [
                    ["name": "x", "source": "mystery"] as [String: Any],
                    ["description": "no name", "source": "prompt"] as [String: Any],
                    ["name": "ok", "source": "extension"] as [String: Any],
                ],
            ] as [String: Any],
        ]
        let cmds = SlashCommandParser.parseGetCommandsResponse(J(json))
        XCTAssertEqual(cmds.map(\.name), ["ok"])
    }
}
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
swift test --filter SlashCommandTests 2>&1
```

Expected: compile errors (`SlashCommand` / `SlashCommandParser` not found) or test failures.

- [ ] **Step 3: Implement model + parser in `Sources/PipiUI/SlashCommand.swift`**

Create the file with:

```swift
import Foundation

// MARK: - Model

enum SlashSource: String, Hashable, Codable {
    case builtin
    /// RPC wire value is `"extension"`; Swift case cannot be `extension`.
    case extension_ = "extension"
    case prompt
    case skill
}

struct SlashCommand: Identifiable, Hashable {
    let name: String          // without leading '/'
    let description: String?
    let source: SlashSource
    let argumentHint: String? // e.g. "<provider/model>"; nil for server cmds
    var id: String { "\(source.rawValue):\(name)" }
}

// MARK: - get_commands parser

enum SlashCommandParser {
    /// Parse a full RPC response `J` (or just the response object) into server commands.
    /// On failure / empty / success!=true → `[]` (caller keeps builtins only; no error).
    static func parseGetCommandsResponse(_ resp: J) -> [SlashCommand] {
        // Accept either full response or a bare `{commands:[...]}` data object.
        let data: J
        if resp["data"].exists {
            if resp["success"].exists && resp["success"].bool != true {
                return []
            }
            data = resp["data"]
        } else {
            data = resp
        }
        return data["commands"].array.compactMap { parseOne($0) }
    }

    private static func parseOne(_ c: J) -> SlashCommand? {
        guard let name = c["name"].string, !name.isEmpty else { return nil }
        guard let source = mapSource(c["source"].string) else { return nil }
        return SlashCommand(
            name: name,
            description: c["description"].string,
            source: source,
            argumentHint: nil
        )
    }

    private static func mapSource(_ raw: String?) -> SlashSource? {
        guard let raw else { return nil }
        switch raw {
        case "extension": return .extension_
        case "prompt": return .prompt
        case "skill": return .skill
        case "builtin": return .builtin
        default: return nil
        }
    }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
swift test --filter SlashCommandTests 2>&1
```

Expected: all Task 2 tests pass.

- [ ] **Step 5: Snapshot diff**

```bash
{
  echo "=== Task 2: model + parser ==="
  echo "=== Sources/PipiUI/SlashCommand.swift ==="
  cat Sources/PipiUI/SlashCommand.swift
  echo ""
  echo "=== Tests/PipiUITests/SlashCommandTests.swift ==="
  cat Tests/PipiUITests/SlashCommandTests.swift
} > .superpowers/sdd/slash-commands/task-2-diff.txt
```

---

### Task 3: Fuzzy filter/sort + palette query helper (TDD)

**Files:**
- Modify: `Sources/PipiUI/SlashCommand.swift` (append `SlashFuzzy` + `SlashPaletteQuery`)
- Modify: `Tests/PipiUITests/SlashCommandTests.swift` (append tests)
- Test: `swift test --filter SlashCommandTests`

**Interfaces:**
- Produces:
  - `enum SlashFuzzy` with:
    - `static func score(query: String, name: String) -> Int?` — `nil` if not subsequence match; higher is better
    - `static func filter(commands: [SlashCommand], query: String) -> [SlashCommand]` — empty query returns input order unchanged; else filter + sort by score desc, then `name` asc
  - `enum SlashPaletteQuery` with:
    - `static func paletteQuery(from draft: String) -> String?` — strip leading whitespace/newlines; require leading `/`; if remainder contains whitespace → `nil` (args mode / hide); else return text after `/` (may be `""`)

**Scoring rules (implement exactly):**
- Case-insensitive subsequence match of `query` against `name`.
- Base: start at 0; each matched character +1.
- Bonus +3 if match is contiguous run (previous matched index was `i-1`).
- Bonus +5 if first matched character is at name index 0 (prefix).
- Bonus +2 if match starts at a segment boundary (`-`, `_`, `:` just before, or camel hump: lower→upper).
- Empty query: `filter` returns `commands` as-is (no re-sort).

- [ ] **Step 1: Append failing fuzzy + query tests**

Append to `SlashCommandTests`:

```swift
    // MARK: - Palette query

    func testPaletteQueryShowsForSlashPrefix() {
        XCTAssertEqual(SlashPaletteQuery.paletteQuery(from: "/"), "")
        XCTAssertEqual(SlashPaletteQuery.paletteQuery(from: "  /mo"), "mo")
        XCTAssertEqual(SlashPaletteQuery.paletteQuery(from: "\n/model"), "model")
    }

    func testPaletteQueryHidesWhenArgsStarted() {
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: "/model "))
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: "/model gpt"))
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: "/name my session"))
    }

    func testPaletteQueryHidesWithoutSlash() {
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: "hello"))
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: "  hello"))
        XCTAssertNil(SlashPaletteQuery.paletteQuery(from: ""))
    }

    // MARK: - Fuzzy

    private func sampleCommands() -> [SlashCommand] {
        [
            SlashCommand(name: "compact", description: nil, source: .builtin, argumentHint: nil),
            SlashCommand(name: "model", description: nil, source: .builtin, argumentHint: "<provider/model>"),
            SlashCommand(name: "session-name", description: nil, source: .extension_, argumentHint: nil),
            SlashCommand(name: "skill:brave-search", description: nil, source: .skill, argumentHint: nil),
            SlashCommand(name: "fix-tests", description: nil, source: .prompt, argumentHint: nil),
        ]
    }

    func testFuzzyEmptyQueryPreservesOrder() {
        let all = sampleCommands()
        XCTAssertEqual(SlashFuzzy.filter(commands: all, query: "").map(\.name), all.map(\.name))
    }

    func testFuzzySubsequenceMatch() {
        let names = SlashFuzzy.filter(commands: sampleCommands(), query: "mdl").map(\.name)
        XCTAssertTrue(names.contains("model"))
        XCTAssertFalse(names.contains("compact"))
    }

    func testFuzzyPrefixRanksHigher() {
        let cmds = [
            SlashCommand(name: "remodel", description: nil, source: .prompt, argumentHint: nil),
            SlashCommand(name: "model", description: nil, source: .builtin, argumentHint: nil),
        ]
        let ranked = SlashFuzzy.filter(commands: cmds, query: "model").map(\.name)
        XCTAssertEqual(ranked.first, "model")
    }

    func testFuzzyCaseInsensitive() {
        let names = SlashFuzzy.filter(commands: sampleCommands(), query: "COMP").map(\.name)
        XCTAssertEqual(names, ["compact"])
    }

    func testFuzzyNoMatchReturnsEmpty() {
        XCTAssertTrue(SlashFuzzy.filter(commands: sampleCommands(), query: "zzz").isEmpty)
    }
```

- [ ] **Step 2: Run — expect FAIL**

```bash
swift test --filter SlashCommandTests 2>&1
```

Expected: missing `SlashFuzzy` / `SlashPaletteQuery`.

- [ ] **Step 3: Append implementation to `SlashCommand.swift`**

```swift
// MARK: - Palette trigger query

enum SlashPaletteQuery {
    /// Returns the fuzzy query (text after `/`) when the palette should show; otherwise nil.
    static func paletteQuery(from draft: String) -> String? {
        var s = draft[...]
        while let c = s.first, c.isWhitespace {
            s.removeFirst()
        }
        guard s.first == "/" else { return nil }
        s.removeFirst()
        // Any whitespace means user started typing arguments → hide palette.
        if s.contains(where: { $0.isWhitespace }) {
            return nil
        }
        return String(s)
    }
}

// MARK: - Fuzzy filter

enum SlashFuzzy {
    /// Higher is better. nil = no match.
    static func score(query: String, name: String) -> Int? {
        let q = Array(query.lowercased())
        let n = Array(name.lowercased())
        if q.isEmpty { return 0 }
        var qi = 0
        var score = 0
        var prevMatched = -2
        var firstMatchIndex: Int?
        for (ni, ch) in n.enumerated() {
            guard qi < q.count else { break }
            if ch == q[qi] {
                score += 1
                if ni == prevMatched + 1 { score += 3 }
                if firstMatchIndex == nil {
                    firstMatchIndex = ni
                    if ni == 0 { score += 5 }
                    else if isBoundary(nameChars: Array(name), index: ni) { score += 2 }
                }
                prevMatched = ni
                qi += 1
            }
        }
        guard qi == q.count else { return nil }
        return score
    }

    private static func isBoundary(nameChars: [Character], index: Int) -> Bool {
        guard index > 0 else { return true }
        let prev = nameChars[index - 1]
        if prev == "-" || prev == "_" || prev == ":" || prev == "/" { return true }
        let cur = nameChars[index]
        if prev.isLowercase && cur.isUppercase { return true }
        return false
    }

    static func filter(commands: [SlashCommand], query: String) -> [SlashCommand] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return commands }
        let scored: [(SlashCommand, Int)] = commands.compactMap { cmd in
            guard let s = score(query: q, name: cmd.name) else { return nil }
            return (cmd, s)
        }
        return scored
            .sorted { lhs, rhs in
                if lhs.1 != rhs.1 { return lhs.1 > rhs.1 }
                return lhs.0.name.localizedCaseInsensitiveCompare(rhs.0.name) == .orderedAscending
            }
            .map(\.0)
    }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
swift test --filter SlashCommandTests 2>&1
```

Expected: all tests green. If `testFuzzyPrefixRanksHigher` fails on score ties, adjust only enough to keep prefix bonus (+5) so `"model"` wins over `"remodel"` for query `"model"`.

- [ ] **Step 5: Snapshot**

```bash
{
  echo "=== Task 3: fuzzy + palette query ==="
  cat Sources/PipiUI/SlashCommand.swift
  echo "-----"
  cat Tests/PipiUITests/SlashCommandTests.swift
} > .superpowers/sdd/slash-commands/task-3-diff.txt
```

---

### Task 4: Builtin table + host protocol + execute router (TDD)

**Files:**
- Modify: `Sources/PipiUI/SlashCommand.swift` (append builtin section)
- Create: `Tests/PipiUITests/BuiltinHostMock.swift`
- Modify: `Tests/PipiUITests/SlashCommandTests.swift`
- Test: `swift test --filter SlashCommandTests`

**Interfaces:**
- Produces:
  - `protocol BuiltinCommandHost: AnyObject` with:
    - `func flash(_ message: String)`
    - `func runCompact()`
    - `func runSetSessionName(_ name: String)`
    - `func runShowSessionStats()`
    - `func runExportHTML()`
    - `func runCopyLastAssistant()`
    - `func runSetModel(providerSlashId: String)` // `"provider/modelId"`
    - `var onRequestNewSession: (() -> Void)? { get }`
    - `var onRequestClose: (() -> Void)? { get }`
  - `enum BuiltinCommands` with:
    - `static let all: [SlashCommand]` — exactly 8 entries from spec §5
    - `static func command(named name: String) -> SlashCommand?`
    - `static func parseInvocation(_ text: String) -> (name: String, args: String)?` — trim; must start with `/`; name = first token without `/`; args = remainder trimmed (may be empty). Returns nil if not a slash invocation.
    - `static func execute(name: String, args: String, host: BuiltinCommandHost) -> Bool` — returns `false` if `name` not in builtin table; otherwise runs action (or flashes validation/closure errors) and returns `true`

**Builtin table (exact):**

| name | description (Chinese OK) | argumentHint |
|---|---|---|
| `compact` | 压缩上下文 | nil |
| `new` | 新建会话 | nil |
| `name` | 重命名会话 | `<name>` |
| `session` | 显示会话统计 | nil |
| `export` | 导出 HTML | nil |
| `copy` | 复制最后一条助手回复 | nil |
| `quit` | 关闭当前会话 | nil |
| `model` | 切换模型 | `<provider/model>` |

**Execute rules:**
- `compact` → `host.runCompact()`
- `new` → if let `onRequestNewSession` call it; else `flash("无法新建会话（未接入 AppStore）")`
- `name` → if args empty: `flash("用法：/name <name>")`; else `runSetSessionName(args)`
- `session` → `runShowSessionStats()`
- `export` → `runExportHTML()`
- `copy` → `runCopyLastAssistant()`
- `quit` → if let `onRequestClose` call it; else `flash("无法关闭会话（未接入 AppStore）")`
- `model` → if args empty: `flash("用法：/model <provider/model>，或用底栏模型菜单")`; else `runSetModel(providerSlashId: args)`
- Unknown name → return `false` (do not flash)

- [ ] **Step 1: Create mock host**

`Tests/PipiUITests/BuiltinHostMock.swift`:

```swift
import Foundation
@testable import PipiUI

final class BuiltinHostMock: BuiltinCommandHost {
    var flashMessages: [String] = []
    var compactCount = 0
    var setNames: [String] = []
    var showStatsCount = 0
    var exportCount = 0
    var copyCount = 0
    var setModels: [String] = []
    var newCount = 0
    var quitCount = 0

    var onRequestNewSession: (() -> Void)?
    var onRequestClose: (() -> Void)?

    func flash(_ message: String) { flashMessages.append(message) }
    func runCompact() { compactCount += 1 }
    func runSetSessionName(_ name: String) { setNames.append(name) }
    func runShowSessionStats() { showStatsCount += 1 }
    func runExportHTML() { exportCount += 1 }
    func runCopyLastAssistant() { copyCount += 1 }
    func runSetModel(providerSlashId: String) { setModels.append(providerSlashId) }

    func enableNew() {
        onRequestNewSession = { [weak self] in self?.newCount += 1 }
    }
    func enableQuit() {
        onRequestClose = { [weak self] in self?.quitCount += 1 }
    }
}
```

- [ ] **Step 2: Append failing builtin tests to `SlashCommandTests`**

```swift
    // MARK: - Builtin table + parse

    func testBuiltinAllHasEightCommands() {
        XCTAssertEqual(BuiltinCommands.all.count, 8)
        let names = Set(BuiltinCommands.all.map(\.name))
        XCTAssertEqual(names, ["compact", "new", "name", "session", "export", "copy", "quit", "model"])
        XCTAssertTrue(BuiltinCommands.all.allSatisfy { $0.source == .builtin })
        XCTAssertEqual(BuiltinCommands.command(named: "model")?.argumentHint, "<provider/model>")
        XCTAssertEqual(BuiltinCommands.command(named: "name")?.argumentHint, "<name>")
        XCTAssertNil(BuiltinCommands.command(named: "compact")?.argumentHint)
    }

    func testParseInvocation() {
        let a = BuiltinCommands.parseInvocation("  /name  hello world  ")
        XCTAssertEqual(a?.name, "name")
        XCTAssertEqual(a?.args, "hello world")
        let b = BuiltinCommands.parseInvocation("/compact")
        XCTAssertEqual(b?.name, "compact")
        XCTAssertEqual(b?.args, "")
        XCTAssertNil(BuiltinCommands.parseInvocation("nope"))
        XCTAssertNil(BuiltinCommands.parseInvocation(""))
        // bare slash is not a named invocation
        XCTAssertNil(BuiltinCommands.parseInvocation("/"))
        XCTAssertNil(BuiltinCommands.parseInvocation("/ "))
    }

    // MARK: - Builtin execute

    func testExecuteUnknownReturnsFalse() {
        let host = BuiltinHostMock()
        XCTAssertFalse(BuiltinCommands.execute(name: "not-a-real-cmd", args: "", host: host))
        XCTAssertEqual(host.flashMessages.count, 0)
        XCTAssertEqual(host.compactCount, 0)
    }

    func testExecuteCompact() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "compact", args: "", host: host))
        XCTAssertEqual(host.compactCount, 1)
    }

    func testExecuteNameRequiresArgs() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "name", args: "", host: host))
        XCTAssertEqual(host.setNames.count, 0)
        XCTAssertEqual(host.flashMessages.count, 1)
        XCTAssertTrue(host.flashMessages[0].contains("/name"))
    }

    func testExecuteNameWithArgs() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "name", args: "My Session", host: host))
        XCTAssertEqual(host.setNames, ["My Session"])
    }

    func testExecuteModelRequiresArgs() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "model", args: "  ", host: host))
        XCTAssertEqual(host.setModels.count, 0)
        XCTAssertTrue(host.flashMessages.last?.contains("/model") == true)
    }

    func testExecuteModelWithArgs() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "model", args: "openai/gpt-4o", host: host))
        XCTAssertEqual(host.setModels, ["openai/gpt-4o"])
    }

    func testExecuteNewWithoutClosureFlashes() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "new", args: "", host: host))
        XCTAssertEqual(host.newCount, 0)
        XCTAssertTrue(host.flashMessages.last?.contains("新建") == true || host.flashMessages.last?.contains("AppStore") == true)
    }

    func testExecuteNewWithClosure() {
        let host = BuiltinHostMock()
        host.enableNew()
        XCTAssertTrue(BuiltinCommands.execute(name: "new", args: "", host: host))
        XCTAssertEqual(host.newCount, 1)
        XCTAssertTrue(host.flashMessages.isEmpty)
    }

    func testExecuteQuitWithoutClosureFlashes() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "quit", args: "", host: host))
        XCTAssertEqual(host.quitCount, 0)
        XCTAssertFalse(host.flashMessages.isEmpty)
    }

    func testExecuteQuitWithClosure() {
        let host = BuiltinHostMock()
        host.enableQuit()
        XCTAssertTrue(BuiltinCommands.execute(name: "quit", args: "", host: host))
        XCTAssertEqual(host.quitCount, 1)
    }

    func testExecuteSessionExportCopy() {
        let host = BuiltinHostMock()
        XCTAssertTrue(BuiltinCommands.execute(name: "session", args: "", host: host))
        XCTAssertTrue(BuiltinCommands.execute(name: "export", args: "", host: host))
        XCTAssertTrue(BuiltinCommands.execute(name: "copy", args: "", host: host))
        XCTAssertEqual(host.showStatsCount, 1)
        XCTAssertEqual(host.exportCount, 1)
        XCTAssertEqual(host.copyCount, 1)
    }
```

- [ ] **Step 3: Run — expect FAIL**

```bash
swift test --filter SlashCommandTests 2>&1
```

- [ ] **Step 4: Append builtin implementation to `SlashCommand.swift`**

```swift
// MARK: - Builtin commands

protocol BuiltinCommandHost: AnyObject {
    func flash(_ message: String)
    func runCompact()
    func runSetSessionName(_ name: String)
    func runShowSessionStats()
    func runExportHTML()
    func runCopyLastAssistant()
    func runSetModel(providerSlashId: String)
    var onRequestNewSession: (() -> Void)? { get }
    var onRequestClose: (() -> Void)? { get }
}

enum BuiltinCommands {
    static let all: [SlashCommand] = [
        SlashCommand(name: "compact", description: "压缩上下文", source: .builtin, argumentHint: nil),
        SlashCommand(name: "new", description: "新建会话", source: .builtin, argumentHint: nil),
        SlashCommand(name: "name", description: "重命名会话", source: .builtin, argumentHint: "<name>"),
        SlashCommand(name: "session", description: "显示会话统计", source: .builtin, argumentHint: nil),
        SlashCommand(name: "export", description: "导出 HTML", source: .builtin, argumentHint: nil),
        SlashCommand(name: "copy", description: "复制最后一条助手回复", source: .builtin, argumentHint: nil),
        SlashCommand(name: "quit", description: "关闭当前会话", source: .builtin, argumentHint: nil),
        SlashCommand(name: "model", description: "切换模型", source: .builtin, argumentHint: "<provider/model>"),
    ]

    private static let byName: [String: SlashCommand] = {
        Dictionary(uniqueKeysWithValues: all.map { ($0.name, $0) })
    }()

    static func command(named name: String) -> SlashCommand? {
        byName[name]
    }

    /// Parse a trimmed user send string into `/name args` if it is a slash invocation.
    static func parseInvocation(_ text: String) -> (name: String, args: String)? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/") else { return nil }
        let rest = trimmed.dropFirst()
        guard !rest.isEmpty else { return nil }
        let tokenEnd = rest.firstIndex(where: { $0.isWhitespace }) ?? rest.endIndex
        let name = String(rest[..<tokenEnd])
        guard !name.isEmpty else { return nil }
        let args = rest[tokenEnd...].trimmingCharacters(in: .whitespacesAndNewlines)
        return (name, args)
    }

    /// Returns false when `name` is not a builtin (caller should send as normal prompt).
    @discardableResult
    static func execute(name: String, args: String, host: BuiltinCommandHost) -> Bool {
        guard byName[name] != nil else { return false }
        let trimmedArgs = args.trimmingCharacters(in: .whitespacesAndNewlines)
        switch name {
        case "compact":
            host.runCompact()
        case "new":
            if let action = host.onRequestNewSession {
                action()
            } else {
                host.flash("无法新建会话（未接入 AppStore）")
            }
        case "name":
            if trimmedArgs.isEmpty {
                host.flash("用法：/name <name>")
            } else {
                host.runSetSessionName(trimmedArgs)
            }
        case "session":
            host.runShowSessionStats()
        case "export":
            host.runExportHTML()
        case "copy":
            host.runCopyLastAssistant()
        case "quit":
            if let action = host.onRequestClose {
                action()
            } else {
                host.flash("无法关闭会话（未接入 AppStore）")
            }
        case "model":
            if trimmedArgs.isEmpty {
                host.flash("用法：/model <provider/model>，或用底栏模型菜单")
            } else {
                host.runSetModel(providerSlashId: trimmedArgs)
            }
        default:
            return false
        }
        return true
    }
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
swift test --filter SlashCommandTests 2>&1
```

Expected: full suite green.

- [ ] **Step 6: Snapshot**

```bash
{
  echo "=== Task 4: builtin ==="
  cat Sources/PipiUI/SlashCommand.swift
  echo "----- mock -----"
  cat Tests/PipiUITests/BuiltinHostMock.swift
  echo "----- tests -----"
  cat Tests/PipiUITests/SlashCommandTests.swift
} > .superpowers/sdd/slash-commands/task-4-diff.txt
```

---

### Task 5: `ChatSession` integration (commands load, flash, route, host methods)

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift`
- Verify: `swift build` && `swift test`

**Interfaces:**
- Consumes: `SlashCommandParser`, `BuiltinCommands`, `BuiltinCommandHost`
- Produces on `ChatSession`:
  - `@Published var availableCommands: [SlashCommand] = []`
  - `var onRequestNewSession: (() -> Void)?`
  - `var onRequestClose: (() -> Void)?`
  - `func flash(_ message: String)` — sets `lastError = message`
  - Conformance to `BuiltinCommandHost` (methods below)
  - `sendPrompt` routes builtins **before** media? No — media mode check stays first; then builtin route when `images.isEmpty` and parseInvocation matches builtin execute → return without queue/prompt
  - `loadInitialState()` ends with `get_commands` request

**Exact insertion points (current file as of plan writing):**
- Properties near other `@Published` / closure hooks (~lines 64–98): add `availableCommands`, `onRequestNewSession`, `onRequestClose`
- `loadInitialState()` (~174–191): after `refreshStats()`, add `get_commands`
- `sendPrompt` (~442–463): after media-mode early return, before `prepareMessage`, add builtin gate
- New methods section near other user actions (~600+)

- [ ] **Step 1: Add published + closures + flash**

In `ChatSession` property block, after `var isSelectedCheck: (() -> Bool)?` (approx line 87), add:

```swift
    /// Server-side slash commands from `get_commands` (extension / prompt / skill).
    @Published var availableCommands: [SlashCommand] = []

    /// Injected by AppStore for `/new`.
    var onRequestNewSession: (() -> Void)?
    /// Injected by AppStore for `/quit`.
    var onRequestClose: (() -> Void)?
```

Add method (near `appendSystem` or user actions):

```swift
    func flash(_ message: String) {
        lastError = message
    }
```

- [ ] **Step 2: Pull `get_commands` in `loadInitialState`**

At end of `loadInitialState()` after `refreshStats()`:

```swift
        proc?.request(["type": "get_commands"]) { [weak self] resp in
            guard let self else { return }
            // Failure/empty → leave availableCommands empty; builtins still work. No flash.
            self.availableCommands = SlashCommandParser.parseGetCommandsResponse(resp)
        }
```

- [ ] **Step 3: Route builtins at start of normal chat send path**

Inside `sendPrompt(_ text:images:)`, **after** the `composerMode == .generateImage || .generateVideo` block returns, and **before** `prepareMessage`, insert:

```swift
        // Builtin slash commands: local/GUI or dedicated RPC — never go through prompt queue.
        // Only when there are no images (slash is text-only UX).
        if images.isEmpty,
           let inv = BuiltinCommands.parseInvocation(trimmed),
           BuiltinCommands.execute(name: inv.name, args: inv.args, host: self) {
            return
        }
```

Full `sendPrompt` after edit should look like:

```swift
    func sendPrompt(_ text: String, images: [DraftImage] = []) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !images.isEmpty else { return }

        // Media generation modes bypass pi RPC and hit local relays (Grok Build Imagine path).
        if composerMode == .generateImage || composerMode == .generateVideo {
            guard !trimmed.isEmpty else {
                lastError = composerMode == .generateImage ? "请描述要生成的图像" : "请描述要生成的视频"
                return
            }
            generateMedia(prompt: trimmed, images: images)
            return
        }

        // Builtin slash commands: local/GUI or dedicated RPC — never go through prompt queue.
        if images.isEmpty,
           let inv = BuiltinCommands.parseInvocation(trimmed),
           BuiltinCommands.execute(name: inv.name, args: inv.args, host: self) {
            return
        }

        let prepared = prepareMessage(text: trimmed, images: images)

        // Busy while streaming OR in the gap after drain popped until agent_start.
        if isStreaming || isSendingFromQueue {
            let ok = queue.enqueue(text: prepared.message, images: prepared.images)
            if ok { publishQueue() }
            return
        }
        sendPromptNow(message: prepared.message, images: prepared.images)
    }
```

- [ ] **Step 4: Conform `ChatSession` to `BuiltinCommandHost`**

Append extension at end of `ChatSession.swift` (file end):

```swift
// MARK: - BuiltinCommandHost

extension ChatSession: BuiltinCommandHost {
    func runCompact() {
        proc?.request(["type": "compact"]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool != true {
                self.flash(resp["error"].string ?? "压缩失败")
            }
            // Success: existing compaction_start/end events append system lines.
        }
    }

    func runSetSessionName(_ name: String) {
        setSessionName(name)
    }

    func runShowSessionStats() {
        // Refresh then flash current snapshot (callbacks update published fields).
        proc?.request(["type": "get_session_stats"]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool == true {
                self.cost = resp["data"]["cost"].double ?? self.cost
                self.contextPercent = resp["data"]["contextUsage"]["percent"].double
            }
            self.proc?.request(["type": "get_state"]) { [weak self] stateResp in
                guard let self else { return }
                self.applyState(stateResp["data"])
                let modelName = self.model?.id ?? "(无模型)"
                let name = self.sessionName ?? "(未命名)"
                let pct: String = {
                    if let p = self.contextPercent { return "\(Int(p))%" }
                    return "—"
                }()
                let file = self.sessionFile ?? "—"
                self.flash(
                    "会话：\(name)\n模型：\(modelName)\n费用：$\(String(format: "%.4f", self.cost)) · 上下文：\(pct)\n文件：\(file)"
                )
            }
        }
    }

    func runExportHTML() {
        proc?.request(["type": "export_html"]) { [weak self] resp in
            guard let self else { return }
            if resp["success"].bool == true, let path = resp["data"]["path"].string {
                self.flash("已导出 HTML：\(path)")
                let url = URL(fileURLWithPath: path)
                NSWorkspace.shared.activateFileViewerSelecting([url])
            } else {
                self.flash(resp["error"].string ?? "导出失败")
            }
        }
    }

    func runCopyLastAssistant() {
        // Walk transcript from end for last assistant text blocks.
        for item in transcript.reversed() where item.role == "assistant" {
            let text = item.blocks.compactMap { block -> String? in
                if case .text(let t) = block { return t }
                return nil
            }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                let pb = NSPasteboard.general
                pb.clearContents()
                pb.setString(text, forType: .string)
                flash("已复制最后一条助手回复（\(text.count) 字符）")
                return
            }
        }
        flash("没有可复制的助手回复")
    }

    func runSetModel(providerSlashId: String) {
        let parts = providerSlashId.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else {
            flash("模型格式应为 provider/modelId，例如 openai/gpt-4o")
            return
        }
        let provider = String(parts[0])
        let modelId = String(parts[1])
        guard !provider.isEmpty, !modelId.isEmpty else {
            flash("模型格式应为 provider/modelId，例如 openai/gpt-4o")
            return
        }
        if let known = availableModels.first(where: { $0.provider == provider && $0.modelId == modelId }) {
            setModel(known)
        } else {
            setModel(ModelInfo(provider: provider, modelId: modelId, name: modelId))
        }
    }
}
```

**Import:** `ChatSession.swift` currently imports `Foundation` + `Combine` only. `NSPasteboard` / `NSWorkspace` need AppKit:

At top of `ChatSession.swift`:

```swift
import Foundation
import Combine
import AppKit
```

**Note:** `applyState` is `private` and called from `runShowSessionStats` inside the type — OK. Do **not** move `applyState` access outside the type body without adjusting access.

- [ ] **Step 5: Build + test**

```bash
swift build 2>&1
swift test 2>&1
```

Expected: build OK; all `SlashCommandTests` pass.

- [ ] **Step 6: Snapshot**

```bash
{
  echo "=== Task 5: ChatSession ==="
  # Prefer full file if manageable
  wc -l Sources/PipiUI/ChatSession.swift
  rg -n "availableCommands|onRequestNewSession|onRequestClose|func flash|get_commands|BuiltinCommands|BuiltinCommandHost|runCompact|runSetModel|sendPrompt" Sources/PipiUI/ChatSession.swift
  echo "----- tail extension -----"
  tail -n 120 Sources/PipiUI/ChatSession.swift
} > .superpowers/sdd/slash-commands/task-5-diff.txt
# Also keep a full copy for review
cp Sources/PipiUI/ChatSession.swift .superpowers/sdd/slash-commands/ChatSession.after-t5.swift
```

---

### Task 6: AppStore inject `/new` + `/quit` closures

**Files:**
- Modify: `Sources/PipiUI/AppStore.swift` — `makeSession(key:project:sessionPath:)` (~107–141)
- Verify: `swift build`

**Interfaces:**
- Consumes: `ChatSession.onRequestNewSession`, `onRequestClose`
- Produces: every new `ChatSession` from `makeSession` gets:
  - `onRequestNewSession = { self.newSession(project: project) }`
  - `onRequestClose = { self.closeSession(key: key) }`

- [ ] **Step 1: Wire closures in `makeSession`**

After `session.isSelectedCheck = { ... }` and before `return session`, add:

```swift
        session.onRequestNewSession = { [weak self] in
            guard let self else { return }
            self.newSession(project: project)
        }
        session.onRequestClose = { [weak self] in
            self?.closeSession(key: key)
        }
```

Full ending of `makeSession` should read:

```swift
        session.onSessionMetaChanged = { [weak self, weak session] in
            guard let self, let session else { return }
            if let file = session.sessionFile {
                self.upsertLiveSessionMeta(
                    project: project,
                    file: file,
                    name: session.sessionName ?? "新会话"
                )
            }
            self.refreshSessions(for: project)
        }
        session.isSelectedCheck = { [weak self] in self?.selectedSessionKey == key }
        session.onRequestNewSession = { [weak self] in
            guard let self else { return }
            self.newSession(project: project)
        }
        session.onRequestClose = { [weak self] in
            self?.closeSession(key: key)
        }
        return session
```

- [ ] **Step 2: Build**

```bash
swift build 2>&1
```

Expected: success.

- [ ] **Step 3: Snapshot**

```bash
{
  echo "=== Task 6: AppStore makeSession hooks ==="
  rg -n -A8 "onRequestNewSession|onRequestClose|isSelectedCheck" Sources/PipiUI/AppStore.swift
} > .superpowers/sdd/slash-commands/task-6-diff.txt
```

---

### Task 7: `SlashPalette` view + `InputBar` mount (show/filter/click)

**Files:**
- Create: `Sources/PipiUI/Views/SlashPalette.swift`
- Modify: `Sources/PipiUI/Views/InputBar.swift`
- Verify: `swift build`；manual via `swift run`

**Interfaces:**
- Consumes: `SlashCommand`, `SlashFuzzy`, `SlashPaletteQuery`, `BuiltinCommands.all`, `session.availableCommands`
- Produces:
  - `struct SlashPalette: View` with:
    - `commands: [SlashCommand]`
    - `selectedIndex: Int`
    - `onSelect: (SlashCommand) -> Void` // click → complete name (same as Tab)
  - `InputBar` state:
    - `@State private var slashMatches: [SlashCommand] = []`
    - `@State private var slashSelectedIndex: Int = 0`
    - `@State private var slashPaletteVisible: Bool = false`
  - Helpers on `InputBar`:
    - `refreshSlashPalette()`
    - `allSlashCommands() -> [SlashCommand]` = `BuiltinCommands.all + session.availableCommands`
    - `completeSlash(_ cmd: SlashCommand)` — sets `session.draftText = "/\(cmd.name) "` and hides palette
    - `executeSlash(_ cmd: SlashCommand)` — used in Task 8; stub-call from click? **Click = complete only (spec §6)**

**UI rules (spec §6):**
- Overlay **above** TextField (ZStack alignment bottom or VStack with palette above HStack)
- `.regularMaterial` background, corner radius ~10, shadow light
- Row: `/name` + secondary description + trailing source badge (`builtin` / `ext` / `skill` / `prompt`)
- Selected row: accent fill opacity ~0.12
- Max height ~220, scroll if needed

- [ ] **Step 1: Create `SlashPalette.swift`**

```swift
import SwiftUI

struct SlashPalette: View {
    let commands: [SlashCommand]
    let selectedIndex: Int
    let onSelect: (SlashCommand) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(commands.enumerated()), id: \.element.id) { index, cmd in
                        row(cmd, selected: index == selectedIndex)
                            .id(cmd.id)
                            .contentShape(Rectangle())
                            .onTapGesture { onSelect(cmd) }
                    }
                }
                .padding(6)
            }
            .frame(maxHeight: 220)
            .onChange(of: selectedIndex) { _, idx in
                guard commands.indices.contains(idx) else { return }
                withAnimation(.easeOut(duration: 0.1)) {
                    proxy.scrollTo(commands[idx].id, anchor: .center)
                }
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08))
        )
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    }

    private func row(_ cmd: SlashCommand, selected: Bool) -> some View {
        HStack(spacing: 8) {
            Text("/\(cmd.name)")
                .font(.system(.body, design: .monospaced).weight(.medium))
                .lineLimit(1)
            if let hint = cmd.argumentHint, !hint.isEmpty {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
            if let desc = cmd.description, !desc.isEmpty {
                Text(desc)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(badgeText(cmd.source))
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(Color.primary.opacity(0.08)))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(selected ? Color.accentColor.opacity(0.14) : Color.clear)
        )
    }

    private func badgeText(_ source: SlashSource) -> String {
        switch source {
        case .builtin: return "builtin"
        case .extension_: return "ext"
        case .prompt: return "prompt"
        case .skill: return "skill"
        }
    }
}
```

- [ ] **Step 2: Mount palette + onChange in `InputBar`**

Add state properties next to other `@State`s:

```swift
    @State private var slashMatches: [SlashCommand] = []
    @State private var slashSelectedIndex: Int = 0
    @State private var slashPaletteVisible: Bool = false
```

Change the composer `HStack` region so the text field is wrapped to allow an overlay above it. Replace the block that is currently:

```swift
            HStack(alignment: .bottom, spacing: 10) {
                plusMenu

                TextField(fieldPlaceholder,
                          text: $session.draftText, axis: .vertical)
                ...
```

with:

```swift
            HStack(alignment: .bottom, spacing: 10) {
                plusMenu

                ZStack(alignment: .bottomLeading) {
                    if slashPaletteVisible && !slashMatches.isEmpty {
                        SlashPalette(
                            commands: slashMatches,
                            selectedIndex: slashSelectedIndex,
                            onSelect: { completeSlash($0) }
                        )
                        .frame(maxWidth: .infinity)
                        .offset(y: -8)
                        .alignmentGuide(.bottom) { d in d[.bottom] + 0 } // sits above field via padding trick
                        .padding(.bottom, 44) // approximate field height so palette clears the field
                        .zIndex(1)
                    }

                    TextField(fieldPlaceholder,
                              text: $session.draftText, axis: .vertical)
                        .textFieldStyle(.plain)
                        .lineLimit(1...10)
                        .focused($focused)
                        .onSubmit(send)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(Color.primary.opacity(0.05))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(Color.primary.opacity(0.1))
                        )
                }
                .frame(maxWidth: .infinity)
```

**Better layout (preferred — implement this instead of fragile offset):** put palette in the outer `VStack` **immediately above** the `HStack` of plus/field/send:

```swift
            if slashPaletteVisible && !slashMatches.isEmpty {
                SlashPalette(
                    commands: slashMatches,
                    selectedIndex: slashSelectedIndex,
                    onSelect: { completeSlash($0) }
                )
                .frame(maxWidth: .infinity, alignment: .leading)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            HStack(alignment: .bottom, spacing: 10) {
                plusMenu

                TextField(fieldPlaceholder,
                          text: $session.draftText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...10)
                    .focused($focused)
                    .onSubmit(send)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(Color.primary.opacity(0.05))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.1))
                    )

                // ... stop + send buttons unchanged ...
```

Add modifiers on the root `VStack` (chain after existing `.onDisappear`):

```swift
        .onChange(of: session.draftText) { _, _ in
            refreshSlashPalette()
        }
```

Also call `refreshSlashPalette()` once in `.onAppear` after paste catcher start.

- [ ] **Step 3: Add helpers on `InputBar`**

```swift
    private func allSlashCommands() -> [SlashCommand] {
        BuiltinCommands.all + session.availableCommands
    }

    private func refreshSlashPalette() {
        guard let query = SlashPaletteQuery.paletteQuery(from: session.draftText) else {
            slashPaletteVisible = false
            slashMatches = []
            slashSelectedIndex = 0
            return
        }
        let matches = SlashFuzzy.filter(commands: allSlashCommands(), query: query)
        slashMatches = matches
        slashPaletteVisible = !matches.isEmpty
        if slashSelectedIndex >= matches.count {
            slashSelectedIndex = max(0, matches.count - 1)
        }
    }

    /// Tab / click: fill `/name ` and keep focus for args.
    private func completeSlash(_ cmd: SlashCommand) {
        session.draftText = "/\(cmd.name) "
        slashPaletteVisible = false
        slashMatches = []
        slashSelectedIndex = 0
        focused = true
    }

    /// Return while palette open: run command now (Task 8 wires keyboard).
    private func executeSlash(_ cmd: SlashCommand) {
        let args: String = {
            // If draft is `/name rest`, pass rest; if user selected different cmd, args empty.
            if let inv = BuiltinCommands.parseInvocation(session.draftText), inv.name == cmd.name {
                return inv.args
            }
            return ""
        }()
        session.draftText = ""
        session.draftImages = []
        slashPaletteVisible = false
        slashMatches = []
        slashSelectedIndex = 0
        // Builtin path or server prompt:
        if cmd.source == .builtin {
            _ = BuiltinCommands.execute(name: cmd.name, args: args, host: session)
        } else {
            let message: String
            if args.isEmpty {
                message = "/\(cmd.name)"
            } else {
                message = "/\(cmd.name) \(args)"
            }
            session.sendPrompt(message, images: [])
        }
    }
```

**Important execute edge (spec):** If selected builtin requires args and args empty → `BuiltinCommands.execute` already flashes. Clear draft only when executing (yes).

**Return when draft is `/name foo` without palette:** normal `send()` → `sendPrompt` → builtin route. Good.

**Return when palette open:** Task 8 intercepts and calls `executeSlash(slashMatches[slashSelectedIndex])` instead of `send()`.

- [ ] **Step 4: Build**

```bash
swift build 2>&1
```

Expected: success.

- [ ] **Step 5: Manual smoke (partial)**

```bash
swift run
```

1. Open/create a session.  
2. Type `/` → palette lists builtins (+ any server cmds).  
3. Type `mo` → filters toward `model`.  
4. Click `model` → draft becomes `/model ` and palette closes.  
5. Type `/zzznotreal` then space? actually no space: still may show empty filter → palette hides when no matches.  
6. Type `hello` → no palette.

- [ ] **Step 6: Snapshot**

```bash
{
  echo "=== Task 7: palette + InputBar mount ==="
  cat Sources/PipiUI/Views/SlashPalette.swift
  echo "----- InputBar -----"
  cat Sources/PipiUI/Views/InputBar.swift
} > .superpowers/sdd/slash-commands/task-7-diff.txt
```

---

### Task 8: InputBar keyboard monitor (↑↓ / Tab / Return / Esc)

**Files:**
- Modify: `Sources/PipiUI/Views/InputBar.swift`
- Verify: `swift build` + manual keyboard checklist

**Interfaces:**
- Produces: `final class ComposerSlashKeyMonitor` (same file as paste catcher or just below it) with:
  - `var isActive: Bool` — palette visible && composer focused
  - `var onMove: (Int) -> Void` // delta +1/-1
  - `var onEscape: () -> Void`
  - `var onTab: () -> Void`
  - `var onReturn: () -> Bool` // return true if handled (consume event)
  - `start()` / `stop()` using `NSEvent.addLocalMonitorForEvents(matching: .keyDown)`
- When palette inactive: monitor returns `event` unchanged (Return reaches TextField `onSubmit`).
- When palette active:
  - ↑ keyCode 126 → move -1 clamp → consume (`nil`)
  - ↓ keyCode 125 → move +1 clamp → consume
  - Esc keyCode 53 → hide palette → consume
  - Tab keyCode 48 → complete selected → consume
  - Return keyCode 36 (and keypad 76 if desired) → `executeSlash` selected → consume (**blocks** `onSubmit(send)`)
- Do not steal keys when Command/Option/Control held (except none of these use those mods).

- [ ] **Step 1: Add `ComposerSlashKeyMonitor` above `struct InputBar`**

```swift
/// Arrow/Tab/Return/Esc while slash palette is open. Mirrors ComposerPasteCatcher lifecycle.
final class ComposerSlashKeyMonitor {
    var isActive = false
    var onMove: (Int) -> Void = { _ in }
    var onEscape: () -> Void = {}
    var onTab: () -> Void = {}
    /// Return true if the key was handled and should not propagate.
    var onReturn: () -> Bool = { false }
    private var monitor: Any?

    func start() {
        stop()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.isActive else { return event }
            let mods = event.modifierFlags.intersection([.command, .option, .control])
            guard mods.isEmpty else { return event }

            switch event.keyCode {
            case 126: // up
                self.onMove(-1)
                return nil
            case 125: // down
                self.onMove(1)
                return nil
            case 53: // escape
                self.onEscape()
                return nil
            case 48: // tab
                self.onTab()
                return nil
            case 36, 76: // return / keypad enter
                if self.onReturn() { return nil }
                return event
            default:
                return event
            }
        }
    }

    func stop() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }

    deinit { stop() }
}
```

- [ ] **Step 2: Wire monitor in `InputBar`**

Add:

```swift
    @State private var slashKeyMonitor = ComposerSlashKeyMonitor()
```

In `.onAppear` (with paste catcher):

```swift
            slashKeyMonitor.onMove = { delta in
                guard !slashMatches.isEmpty else { return }
                let next = slashSelectedIndex + delta
                slashSelectedIndex = min(max(0, next), slashMatches.count - 1)
            }
            slashKeyMonitor.onEscape = {
                slashPaletteVisible = false
                // keep draft as-is
            }
            slashKeyMonitor.onTab = {
                guard slashPaletteVisible,
                      slashMatches.indices.contains(slashSelectedIndex) else { return }
                completeSlash(slashMatches[slashSelectedIndex])
            }
            slashKeyMonitor.onReturn = {
                guard slashPaletteVisible,
                      slashMatches.indices.contains(slashSelectedIndex) else { return false }
                executeSlash(slashMatches[slashSelectedIndex])
                return true
            }
            slashKeyMonitor.start()
            refreshSlashKeyMonitorActive()
```

In `.onDisappear`:

```swift
            slashKeyMonitor.stop()
```

Update active flag whenever focus or palette visibility changes:

```swift
    private func refreshSlashKeyMonitorActive() {
        slashKeyMonitor.isActive = focused && slashPaletteVisible && !slashMatches.isEmpty
    }
```

Call `refreshSlashKeyMonitorActive()` at end of `refreshSlashPalette()`, in `onChange(of: focused)`, and after complete/execute/escape.

Replace/extend existing:

```swift
        .onChange(of: focused) { _, isFocused in
            pasteCatcher.focused = isFocused
            refreshSlashKeyMonitorActive()
        }
```

Also: when `slashPaletteVisible` becomes false via Esc, call `refreshSlashKeyMonitorActive()`.

- [ ] **Step 3: Guard `send()` / `onSubmit` double-fire**

`onSubmit(send)` must not run when palette handled Return — monitor returning `nil` is the primary guard. As a belt-and-suspenders, at top of `send()`:

```swift
    private func send() {
        if slashPaletteVisible, !slashMatches.isEmpty,
           slashMatches.indices.contains(slashSelectedIndex) {
            executeSlash(slashMatches[slashSelectedIndex])
            return
        }
        guard canSend else { return }
        // ... existing body ...
    }
```

Note: when palette is open, `canSend` might still be true (`/compact` is non-empty text). The palette branch must run **first**.

- [ ] **Step 4: Build**

```bash
swift build 2>&1
```

Expected: success.

- [ ] **Step 5: Manual keyboard acceptance**

```bash
swift run
```

| Step | Action | Expected |
|---|---|---|
| 1 | Type `/` | Palette open, first item selected |
| 2 | ↓ then ↑ | Selection moves; clamps at ends |
| 3 | Tab on `name` | Draft `/name `, palette closed, focus remains |
| 4 | Type `/com` then Return | Executes compact (or selects compact); draft clears; compaction system lines or RPC |
| 5 | Type `/name` Return with empty args | flash 用法：/name；**no** user bubble prompt |
| 6 | Esc with palette open | Palette closes; draft unchanged |
| 7 | Type `hello` Return | Normal send; no palette intercept |
| 8 | While streaming, `/compact` Return | Runs immediately (not queued) |
| 9 | While streaming, `/some-skill` if listed | Goes through queue like normal prompt |
| 10 | Click candidate | Same as Tab (complete, not execute) |

- [ ] **Step 6: Snapshot**

```bash
{
  echo "=== Task 8: keyboard ==="
  cat Sources/PipiUI/Views/InputBar.swift
} > .superpowers/sdd/slash-commands/task-8-diff.txt
```

---

### Task 9: README + full manual acceptance + final snapshot

**Files:**
- Modify: `README.md`
- Create: `.superpowers/sdd/slash-commands/final-diff.txt` (aggregate)
- Verify: `swift test` + manual checklist below

- [ ] **Step 1: Update README feature bullet**

In `## 功能`, after the 输入栏 bullet, add:

```markdown
- **斜杠命令**：输入 `/` 弹出补全面板（↑↓ 选择，Tab 补全，Enter 执行，Esc 关闭）；内置 `/compact` `/new` `/name` `/session` `/export` `/copy` `/quit` `/model` 走本地/GUI 或专用 RPC；扩展/prompt/skill 来自启动时 `get_commands`，经 `prompt` 发送（忙时入队）
```

In `## 代码结构` table add rows:

```markdown
| `Sources/PipiUI/SlashCommand.swift` | 斜杠命令模型、`get_commands` 解析、fuzzy、内置命令路由 |
| `Sources/PipiUI/Views/SlashPalette.swift` | `/` 补全浮层 |
```

In `## 已知限制（v1）` add:

```markdown
- 斜杠命令 v1：无 `/model` 模型列表补全；TUI 专有命令（`/settings` `/login` 等）不出现在面板；扩展交互对话框仍自动取消
```

- [ ] **Step 2: Full automated verify**

```bash
swift build 2>&1
swift test 2>&1
```

Expected:

- `swift build` exit 0  
- `swift test` exit 0, `SlashCommandTests` all passed  

Optional regression:

```bash
PIPIUI_SELF_TEST=1 swift run 2>&1 | tail -20
```

Expected: `ALL PASSED`

- [ ] **Step 3: Full manual acceptance checklist**

```bash
swift run
```

Work through **all** of:

**Palette / fuzzy**
- [ ] `/` shows builtins; after session load, server commands appear too (if pi returns any)
- [ ] Badge texts: builtin / ext / prompt / skill
- [ ] Fuzzy: `sn` matches `session` and `session-name` style names if present
- [ ] Space after command hides palette (`/model `)

**Keyboard**
- [ ] ↑↓ clamp, Tab complete+space, Esc dismiss, Return execute+consume
- [ ] Return with palette closed still sends normal messages
- [ ] Click candidate = Tab (complete only)

**Builtin mapping**
- [ ] `/compact` → compaction system messages
- [ ] `/name Hello` → sidebar/title updates
- [ ] `/name` bare → error banner 用法
- [ ] `/session` → banner with cost/context/model
- [ ] `/export` → HTML path flash + Finder select
- [ ] `/copy` after an assistant reply → pasteboard has text; with none → flash
- [ ] `/new` → new session selected
- [ ] `/quit` → current session closes
- [ ] `/model` bare → flash 底栏菜单提示
- [ ] `/model <provider/id>` → model switches (use a real id from menu)
- [ ] `/unknown-foo` → sent as normal user prompt (bubble appears)

**Busy behavior**
- [ ] During stream: `/compact` runs immediately
- [ ] During stream: `/some-extension-cmd` or plain text queues (queue strip)

**get_commands failure resilience**
- [ ] (Optional) broken pi: app still shows builtins only, no error spam from get_commands

- [ ] **Step 4: Final snapshot**

```bash
{
  echo "=== FINAL slash-commands snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  echo "Files:"
  ls -la Sources/PipiUI/SlashCommand.swift Sources/PipiUI/Views/SlashPalette.swift Package.swift Tests/PipiUITests/ README.md
  echo ""
  echo "=== swift test (run separately; paste summary if desired) ==="
} > .superpowers/sdd/slash-commands/final-diff.txt
# If git becomes available, also: git diff > ... ; else store full copies:
cp Sources/PipiUI/SlashCommand.swift .superpowers/sdd/slash-commands/
cp Sources/PipiUI/Views/SlashPalette.swift .superpowers/sdd/slash-commands/
cp Sources/PipiUI/Views/InputBar.swift .superpowers/sdd/slash-commands/
cp Sources/PipiUI/ChatSession.swift .superpowers/sdd/slash-commands/
cp Package.swift .superpowers/sdd/slash-commands/
```

---

## Self-Review (plan author)

### 1. Spec coverage

| Spec section | Task(s) |
|---|---|
| §2 Hybrid path (server get_commands + builtin local) | T2 parser, T4 builtin, T5 load+route |
| §3 Data model `SlashSource` / `SlashCommand` / BuiltinCommands | T2, T4 |
| §3 sourceInfo authoritative; path/location legacy | T2 tests both shapes |
| §4 `availableCommands`, loadInitialState get_commands | T5 |
| §4 sendPrompt builtin route; else queue/prompt | T5 |
| §4 flash | T5 |
| §4 onRequestNewSession / onRequestClose | T5 + T6 |
| §5 Builtin table (8) + mappings | T4 + T5 host methods |
| §6 Palette trigger / fuzzy / style / badges | T3 + T7 |
| §6 Keyboard ↑↓ Esc Tab Return; click=Tab | T8 (+ T7 click) |
| §7 Busy: builtin immediate; server queued | T5 route before queue; T9 manual |
| §8 Errors: get_commands quiet; unknown as prompt; missing args/closures flash | T2/T4/T5 |
| §9 Unit tests + manual UI | T1–T4 tests; T7–T9 manual |
| §10 Non-goals | Global Constraints; README limits |
| §11 File list | File Structure |

No intentional gaps vs approved scope B.

### 2. Placeholder scan

- No TBD/TODO left in steps.
- All code blocks are full implementations (not “similar to Task N”).
- Commands have expected outcomes.
- Snapshot paths replace git commit.

### 3. Type consistency

| Symbol | Defined | Used |
|---|---|---|
| `SlashSource.extension_` raw `"extension"` | T2 | T2/T4/T7 badge |
| `SlashCommand.id` | T2 | palette ForEach |
| `SlashCommandParser.parseGetCommandsResponse` | T2 | T5 loadInitialState |
| `SlashFuzzy.filter` | T3 | T7 refreshSlashPalette |
| `SlashPaletteQuery.paletteQuery` | T3 | T7 |
| `BuiltinCommandHost` | T4 | T5 ChatSession + mock |
| `BuiltinCommands.execute/parseInvocation/all` | T4 | T5 sendPrompt, T7/T8 executeSlash |
| `flash(_:)` | T5 | host + UI banner |
| `onRequestNewSession` / `onRequestClose` | T5 | T6 AppStore |
| `completeSlash` / `executeSlash` | T7 | T8 keys |
| `session.draftText` | existing | T7/T8 (not `@State draft`) |

### 4. Risks / implementer notes

- **SPM test→executable:** Task 1 includes fallback if `@main` blocks `swift test`.
- **`applyState` privacy:** `runShowSessionStats` must remain inside `ChatSession` type (extension in same file is fine).
- **Return vs onSubmit:** Task 8 monitor + `send()` guard both required; SwiftUI TextField can still submit on some OS builds.
- **`/copy` only text blocks:** images/thinking ignored by design for v1.
- **`export_html` without outputPath:** uses pi default path from response `data.path`.
- **Draft clearing on executeSlash:** clears even when validation flash (matches “attempt execute”); acceptable UX.
- **Name collision:** if server command named `compact` etc., palette shows both (different `id` via source); execute via `sendPrompt` hits **builtin first** because route uses builtin table only — server same-name only reachable if not in builtin table. Spec builtins take precedence; OK.

