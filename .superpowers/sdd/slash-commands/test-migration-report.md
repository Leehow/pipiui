# Test migration report: MiniXCTest → standard SPM XCTest

**Status:** DONE  
**Date:** 2026-07-23

## Goal

Replace CLT-era `PipiUITestRunner` + `MiniXCTest` harness with standard `swift test` / XCTest, without touching business source under `Sources/`.

## Files changed

| Action | Path |
|--------|------|
| Modified | `Package.swift` — `executableTarget PipiUITestRunner` → `testTarget PipiUITests` |
| Converted | `Tests/PipiUITests/SlashCommandTests.swift` — `import XCTest`, real `XCTestCase`, drop `throws` / `try` on asserts |
| Unchanged | `Tests/PipiUITests/BuiltinHostMock.swift` — no MiniXCTest dependency |
| Deleted | `Tests/PipiUITests/MiniXCTest.swift` |
| Deleted | `Tests/PipiUITests/main.swift` |

### Package.swift

- **Kept:** library target `PipiUI`, executable product `PipiUI` → target `PipiUIApp`
- **Replaced:**
  - before: `.executableTarget(name: "PipiUITestRunner", dependencies: ["PipiUI"], path: "Tests/PipiUITests")`
  - after: `.testTarget(name: "PipiUITests", dependencies: ["PipiUI"], path: "Tests/PipiUITests")`
- Removed CLT/MiniXCTest comments.

### SlashCommandTests.swift

- `import Foundation` → `import XCTest` (+ keep `import PipiUI`)
- Class already subclassed `XCTestCase` (was Mini stub); now inherits real XCTest
- Removed comment: `// All methods are thrown-asserts via MiniXCTest (CLT harness).`
- All `func test…() throws` → `func test…()`
- All `try XCTAssert*` → `XCTAssert*` (Equal/true/false/nil/notNil)
- Assertion content/logic unchanged
- 27 `func test` methods preserved

### BuiltinHostMock.swift

- No change. Pure `BuiltinCommandHost` mock (`import Foundation` + `import PipiUI` only). Compiles under test target.

### Removed harness pieces

- `MiniXCTest` free functions + stub `XCTestCase`
- `PipiUITestsMain.allTests` manual registry
- `assertRegistryComplete(knownCount: 27)` drift guard
- `main.swift` runner entry (`swift run PipiUITestRunner`)

Standard XCTest discovery replaces the registry.

## Verification

### `swift test` (fresh)

```
Build complete! (7.65s)
Test Suite 'All tests' started at 2026-07-23 下午12:35:38.880.
...
Test Suite 'SlashCommandTests' passed at 2026-07-23 下午12:35:38.890.
	 Executed 27 tests, with 0 failures (0 unexpected) in 0.006 (0.008) seconds
Test Suite 'PipiUIPackageTests.xctest' passed at 2026-07-23 下午12:35:38.890.
	 Executed 27 tests, with 0 failures (0 unexpected) in 0.006 (0.008) seconds
Test Suite 'All tests' passed at 2026-07-23 下午12:35:38.890.
	 Executed 27 tests, with 0 failures (0 unexpected) in 0.006 (0.010) seconds
```

All 27 named cases passed (model, parser, palette, fuzzy, builtin table/parse/execute).

### `swift build` (fresh)

```
Build complete! (0.17s)
```

(First concurrent `swift build` raced with `swift test` on `MessageViews.swift` and failed; solo re-run green. Pre-existing Sendable warning in `ChatSession.swift` unrelated.)

### Expected absence

- `PipiUITestRunner` product/target removed — `swift run PipiUITestRunner` no longer applies (not re-run).
- `Tests/PipiUITests/` now only: `BuiltinHostMock.swift`, `SlashCommandTests.swift`

## Self-check

- [x] Only `Package.swift` + `Tests/PipiUITests/` touched; no `Sources/` business logic edits
- [x] Library + `PipiUI` app executable product structure retained
- [x] No MiniXCTest / PipiUITestRunner / manual registry retained
- [x] 27 tests via `swift test`, 0 failures
- [x] `swift build` green
- [x] No git commit (per non-project-git convention)
- [x] BuiltinHostMock left as-is (no MiniXCTest dep)
