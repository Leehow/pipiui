# Phase A Report — Slash Commands Tasks 1–4

**Status:** DONE_WITH_CONCERNS  
**Date:** 2025-07-23  
**Scope:** Task 1–4 only (no ChatSession / InputBar / SlashPalette / AppStore integration)

## One-line summary

Slash-command pure logic (model, `get_commands` parser, fuzzy filter, builtin table + host protocol + execute) is implemented and **27/27 unit tests pass** via `swift run PipiUITestRunner`; app `swift build` is green. SPM `swift test` cannot execute cases on this CLT-only host (no Xcode/XCTest).

---

## Status detail

| Field | Value |
|---|---|
| Status | **DONE_WITH_CONCERNS** |
| Concern | Host has Command Line Tools only (no full Xcode). `XCTest.framework` is absent; Apple's `swiftpm-testing-helper` loads the test bundle but does **not** run Swift Testing cases (exit 0, zero output, no xunit). Verification uses executable target `PipiUITestRunner` with a tiny XCTest-compatible harness (`MiniXCTest`). |
| Blockers for Task 5 | None for code. Task 5 should `conform` `ChatSession` to `BuiltinCommandHost`. |

---

## Files created / modified

### Created
| Path | Role |
|---|---|
| `Sources/PipiUI/SlashCommand.swift` | Model, parser, fuzzy, palette query, builtins + host |
| `Sources/PipiUIApp/AppEntry.swift` | Thin `@main` entry calling `PipiUIApp.main()` |
| `Tests/PipiUITests/SlashCommandTests.swift` | 27 unit tests (plan Tasks 2–4) |
| `Tests/PipiUITests/BuiltinHostMock.swift` | Mock `BuiltinCommandHost` |
| `Tests/PipiUITests/MiniXCTest.swift` | CLT assert helpers + `PipiUITestsMain.runAll()` |
| `Tests/PipiUITests/main.swift` | `PipiUITestRunner` entry |
| `.superpowers/sdd/slash-commands/task-{1..4}-diff.txt` | Per-task snapshots |
| `.superpowers/sdd/slash-commands/phase-A-diff.txt` | Phase A change list |
| `.superpowers/sdd/slash-commands/phase-A-report.md` | This report |

### Modified
| Path | Change |
|---|---|
| `Package.swift` | Library `PipiUI` + executable `PipiUIApp` (product name `PipiUI`) + executable `PipiUITestRunner` |
| `Sources/PipiUI/App.swift` | Removed `@main`; `public struct PipiUIApp` + `public init()` / `public var body` |
| `Sources/PipiUI/J.swift` | `package struct J` + `package init` (parser API surface) |
| `make-app.sh` | Comment only (product binary still named `PipiUI`) |

### Not touched (by design)
- `ChatSession.swift`, `InputBar.swift`, `AppStore.swift`
- No `SlashPalette.swift`
- Tasks 5–9 deferred

---

## Key public / package API signatures

```swift
package enum SlashSource: String, Hashable, Codable {
    case builtin
    case extension_ = "extension"
    case prompt
    case skill
}

package struct SlashCommand: Identifiable, Hashable {
    package let name: String
    package let description: String?
    package let source: SlashSource
    package let argumentHint: String?
    package var id: String { "\(source.rawValue):\(name)" }
    package init(name:description:source:argumentHint:)
}

package enum SlashCommandParser {
    package static func parseGetCommandsResponse(_ resp: J) -> [SlashCommand]
}

package enum SlashPaletteQuery {
    package static func paletteQuery(from draft: String) -> String?
}

package enum SlashFuzzy {
    package static func score(query: String, name: String) -> Int?
    package static func filter(commands: [SlashCommand], query: String) -> [SlashCommand]
}

package protocol BuiltinCommandHost: AnyObject {
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

package enum BuiltinCommands {
    package static let all: [SlashCommand]  // 8 builtins
    package static func command(named name: String) -> SlashCommand?
    package static func parseInvocation(_ text: String) -> (name: String, args: String)?
    @discardableResult
    package static func execute(name: String, args: String, host: BuiltinCommandHost) -> Bool
}
```

Access is `package` (not `public`) so Task 5 `ChatSession` in the same package can conform/use without widening app ABI. Tests use `import PipiUI` (same package).

---

## Builtin table (exact)

| name | description | argumentHint |
|---|---|---|
| compact | 压缩上下文 | nil |
| new | 新建会话 | nil |
| name | 重命名会话 | `<name>` |
| session | 显示会话统计 | nil |
| export | 导出 HTML | nil |
| copy | 复制最后一条助手回复 | nil |
| quit | 关闭当前会话 | nil |
| model | 切换模型 | `<provider/model>` |

---

## Verification (fresh evidence)

### `swift build --product PipiUI`
```
Build of product 'PipiUI' complete! (0.15s)
```
Exit 0.

### Planned `swift test` — **not usable on this host**
Evidence:
1. `import XCTest` → `error: no such module 'XCTest'` (CLT only; no Xcode.app).
2. With Swift Testing + CLT framework flags, link succeeds but:
   ```
   swiftpm-testing-helper ... --testing-library swift-testing
   ```
   exits 0 with **no test output**, no xunit file, `swift test list` empty.
3. Simple `executableTarget` + `@testable import` also pulled `PipiUIApp.$main` into the test bundle before library split.

### Substitute (full suite) — `swift run PipiUITestRunner`
```
Test Suite 'SlashCommandTests' started
✔ testSlashCommandIdIncludesSourceAndName
✔ testBuiltinSourceRawValue
✔ testParseGetCommandsModernSourceInfoShape
✔ testParseGetCommandsLegacyPathLocationStillWorks
✔ testParseGetCommandsFailureOrMissingReturnsEmpty
✔ testParseGetCommandsSkipsUnknownSourceAndMissingName
✔ testPaletteQueryShowsForSlashPrefix
✔ testPaletteQueryHidesWhenArgsStarted
✔ testPaletteQueryHidesWithoutSlash
✔ testFuzzyEmptyQueryPreservesOrder
✔ testFuzzySubsequenceMatch
✔ testFuzzyPrefixRanksHigher
✔ testFuzzyCaseInsensitive
✔ testFuzzyNoMatchReturnsEmpty
✔ testBuiltinAllHasEightCommands
✔ testParseInvocation
✔ testExecuteUnknownReturnsFalse
✔ testExecuteCompact
✔ testExecuteNameRequiresArgs
✔ testExecuteNameWithArgs
✔ testExecuteModelRequiresArgs
✔ testExecuteModelWithArgs
✔ testExecuteNewWithoutClosureFlashes
✔ testExecuteNewWithClosure
✔ testExecuteQuitWithoutClosureFlashes
✔ testExecuteQuitWithClosure
✔ testExecuteSessionExportCopy
Test Suite 'SlashCommandTests' finished
Executed 27 tests, with 0 failures (27 passed)
```
Exit 0.

Filter example: `swift run PipiUITestRunner testParseInvocation`

---

## Deviations from plan code (and why)

| Deviation | Reason |
|---|---|
| Library `PipiUI` + thin `PipiUIApp` entry instead of single executable | Plan Task 1 fallback. Needed so tests don't link `@main`. Product name remains `PipiUI` for `swift run` / `make-app.sh`. |
| No SPM `.testTarget`; executable `PipiUITestRunner` instead | CLT has no XCTest; Swift Testing helper does not execute. Same test bodies as plan, driven by `MiniXCTest` + `PipiUITestsMain`. |
| `package` access instead of implicit internal + `@testable` | Runner is a separate module; `@testable` requires `-enable-testing` on the library (test-target only). `package` is the intended same-package visibility. |
| `J` marked `package` | `parseGetCommandsResponse` takes `J` across the package boundary for tests constructing `J([...])`. |
| `MiniXCTest.swift` not in plan | Environment necessity; API mirrors `XCTAssert*` used by plan tests. |
| Tests use `throws` + `try XCTAssert*` | Harness reports failures via thrown errors. |

Logic of parser / fuzzy scoring / builtin execute matches plan code **verbatim**.

---

## Task 1 path taken

1. Tried simple `executableTarget PipiUI` + `testTarget` → no XCTest module.
2. Tried Swift Testing with `-F` / rpath to CLT Testing.framework → builds, helper does not run tests.
3. Applied plan fallback: **library + thin entry**.
4. Added **PipiUITestRunner** executable compiling `Tests/PipiUITests/*` as the verification vehicle.

---

## Hints for Task 5 (`ChatSession` host conformance)

`ChatSession` should:

```swift
extension ChatSession: BuiltinCommandHost {
    func flash(_ message: String) { /* set lastError / banner */ }
    func runCompact() { /* existing compact RPC */ }
    func runSetSessionName(_ name: String) { ... }
    func runShowSessionStats() { ... }
    func runExportHTML() { ... }
    func runCopyLastAssistant() { ... }
    func runSetModel(providerSlashId: String) { /* parse provider/model id */ }
    // store:
    // var onRequestNewSession: (() -> Void)?
    // var onRequestClose: (() -> Void)?
}
```

`sendPrompt` gate sketch:

```swift
if let inv = BuiltinCommands.parseInvocation(text),
   BuiltinCommands.execute(name: inv.name, args: inv.args, host: self) {
    // clear draft; do NOT enqueue
    return
}
// else existing queue / sendPromptNow (including unknown /xxx)
```

`loadInitialState`: call `get_commands`, then  
`availableCommands = SlashCommandParser.parseGetCommandsResponse(resp)`  
(on failure leave `[]`; **no** flash).

Palette candidates later: `BuiltinCommands.all + availableCommands` filtered by  
`SlashFuzzy.filter(commands:query: SlashPaletteQuery.paletteQuery(from: draftText) ?? "")`.

AppStore `makeSession`: inject `onRequestNewSession` / `onRequestClose`.

---

## Self-check

- [x] Cross-task names match plan (`SlashSource`, `SlashCommand`, `SlashCommandParser`, `SlashFuzzy`, `SlashPaletteQuery`, `BuiltinCommands`, `BuiltinCommandHost`).
- [x] Modern `sourceInfo` + legacy `path`/`location` both parse (legacy fields ignored).
- [x] Eight builtins; unknown execute → `false` no flash; missing closures flash Chinese messages.
- [x] Fuzzy empty query preserves order; prefix beats mid-string (`model` > `remodel`).
- [x] No Task 5–9 files modified.
- [x] No git commit.
- [x] `swift build` green; full unit suite green via runner.
