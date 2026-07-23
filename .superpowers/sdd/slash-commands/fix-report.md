# Fix Report — Final Review 4× Important

**Date:** 2026-07-23  
**Source:** `.superpowers/sdd/slash-commands/final-review.md` Important #1–#4  
**Scope:** `InputBar.swift` + `MiniXCTest.swift` only（未 commit）

---

## 修复摘要

| # | Important | 状态 |
|---|---|---|
| 1 | `availableCommands` 异步到达后浮层不刷新 | ✅ |
| 2 | 媒体（非 `.chat`）模式与 slash 路径不一致 | ✅ |
| 3 | 附件图 × slash 双路径分叉 | ✅ |
| 4 | MiniXCTest 手写 registry 漏登静默跳过 | ✅ |

---

## 1. `availableCommands` 异步到达后浮层刷新

**文件:** `Sources/PipiUI/Views/InputBar.swift`

**改法:** 与 `draftText` 的 `onChange` 同级，增加：

```swift
.onChange(of: session.availableCommands) { _, _ in
    refreshSlashPalette()
}
```

用户在 `get_commands` 返回前已输入 `/` 时，服务端命令到达会立刻刷新候选，无需再敲一键。

---

## 2. 非 `.chat` 模式不显示浮层

**文件:** 同上 `refreshSlashPalette()`

**改法:** 函数入口增加守卫：

```swift
guard session.composerMode == .chat, session.draftImages.isEmpty else {
    slashPaletteVisible = false
    slashMatches = []
    slashSelectedIndex = 0
    refreshSlashKeyMonitorActive()
    return
}
```

并挂：

```swift
.onChange(of: session.composerMode) { _, _ in
    refreshSlashPalette()
}
```

媒体模式下不弹浮层、monitor inactive，避免 palette Return 直跑 builtin 而正常 send 走 `generateMedia` 的分叉。

---

## 3. 有附件图时不显示浮层

**文件:** 同上（与 #2 同一 `guard`）

**条件:** `session.draftImages.isEmpty` 为假时强制关浮层并清空 matches。

并挂：

```swift
.onChange(of: session.draftImages.count) { _, _ in
    refreshSlashPalette()
}
```

（`DraftImage` 非 `Equatable`，用 `count` 驱动 onChange。）

与 Phase B「带图跳过 builtin 闸门、走正常 prompt」一致：有图时不进 palette 执行路径，发送按钮仍把 `/cmd`+图当普通多模态 prompt。

---

## 4. MiniXCTest registry 自检

**文件:** `Tests/PipiUITests/MiniXCTest.swift`

**改法:**

- 新增 `assertRegistryComplete(knownCount:)`：`allTests.count != knownCount` → `fatalError` 明确提示登记新测试并更新 knownCount。
- `runAll()` 开头调用 `assertRegistryComplete(knownCount: 27)`。
- 注释标明 27 = 当前 `SlashCommandTests` 上 `func test…` 个数；未来加测需同步 bump。

---

## 验证证据（本轮新鲜）

### `swift build`

```
Building for debugging...
[4/9] Emitting module PipiUI
[5/9] Compiling PipiUI InputBar.swift
...
[8/13] Compiling PipiUITestRunner MiniXCTest.swift
...
Build complete! (3.56s)
```

**结果:** 绿。

### `swift run PipiUITestRunner`

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

**结果:** 27/27 全过；`assertRegistryComplete(knownCount: 27)` 未误报（registered == knownCount == 27）。

### 自检对照

| 项 | 值 |
|---|---|
| `rg 'func test' SlashCommandTests.swift` | 27 |
| `allTests.count` | 27 |
| `knownCount` | 27 |

---

## 文件清单

| Path | 变更 |
|---|---|
| `Sources/PipiUI/Views/InputBar.swift` | onChange×3 + refresh 守卫（mode/images） |
| `Tests/PipiUITests/MiniXCTest.swift` | `assertRegistryComplete` + runAll 入口调用 |

未改其它源文件；未 git commit。
