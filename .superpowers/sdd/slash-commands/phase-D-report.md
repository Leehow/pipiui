# Phase D Report — Slash Commands 收尾（Task 9）

**Status:** PASS  
**Date:** 2026-07-23  
**Scope:** 文档 + 快照 + 实机验收清单 only。**未改任何源码。**  
**Commit:** none（非 git 仓库）

---

## Summary

Phase D 完成斜杠命令特性收尾：

1. **README** 融入「斜杠命令（`/`）」专节（触发/键盘、内置表、服务端来源、忙时、限制），并补功能 bullet、代码结构两行、已知限制、`PipiUITestRunner` 说明。
2. **final-snapshot.txt** 列出本特性全部新增/修改文件 + 职责 + 行数；拷贝关键源文件到 SDD 目录。
3. **acceptance-checklist.md** 可勾选实机清单（≥12 核心项 + 完整扩展项）。
4. **验证**：`swift build` 绿；`swift run PipiUITestRunner` **27/27**；MiniXCTest 方法数==注册数 27。

---

## Files created / modified (docs only)

| Path | Action |
|---|---|
| `README.md` | **Modified** — 功能 bullet；新增 `## 斜杠命令（/）`；代码结构 `SlashCommand.swift` / `SlashPalette.swift`；ChatSession 职责补斜杠；已知限制；构建节 TestRunner |
| `.superpowers/sdd/slash-commands/final-snapshot.txt` | **Created** — 最终文件清单 + 行数 + 验证摘要 |
| `.superpowers/sdd/slash-commands/acceptance-checklist.md` | **Created** — 实机验收勾选清单 |
| `.superpowers/sdd/slash-commands/phase-D-report.md` | **Created** — 本报告 |
| `.superpowers/sdd/slash-commands/progress.md` | **Modified** — Phase D 勾完 |
| `.superpowers/sdd/slash-commands/SlashCommand.swift` 等 | **Copied** — 无 git 时的源码快照副本（SlashCommand / SlashPalette / InputBar / ChatSession / Package.swift） |

**Source code:** not modified.

---

## README 变更要点（对照 plan Task 9 + 用户 brief）

- `## 功能` 增加斜杠命令 bullet（plan Step 1 文案）。
- 独立专节 `## 斜杠命令（/）`：表格写键盘交互 + 8 条内置映射（spec §5）+ 服务端 `get_commands` + 忙时行为 + 未知 `/xxx` + ⌘V 不受影响。
- `## 代码结构` 增加：
  - `SlashCommand.swift` — 模型 / 解析 / fuzzy / 内置路由
  - `SlashPalette.swift` — `/` 补全浮层
  - `ChatSession` 行补一句斜杠职责
- `## 已知限制（v1）` 增加斜杠 v1 限制（spec §10）：无 `/model` 列表补全；无 RPC 的 TUI 命令不在面板；扩展对话框仍自动取消；流式中服务端命令排队。
- `## 构建运行` 注明 `swift run PipiUITestRunner`。

---

## Acceptance checklist coverage

`acceptance-checklist.md` 覆盖用户要求的核心项：

1. 浮层出现  
2. 过滤  
3. ↑↓  
4. Tab 补全  
5. Return 执行  
6. Return 不双发  
7. Esc  
8. 未知 `/xxx` 正常发送  
9. 流式中 builtin 立即执行不入队  
10. 服务端命令经队列  
11. ⌘V 粘贴不受影响  
12–17. `/copy` `/session` `/name` `/new` `/quit` `/model`  

另含徽标、空格关浮层、点击=Tab、各 builtin 细节、get_commands 韧性等。**实机勾选未在本轮执行**（文档任务只交付清单；UI 需人手 `swift run`）。

---

## Verification evidence (this session)

### `swift build`

```
Building for debugging...
Build complete! (0.17s)
EXIT_BUILD=0
```

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
EXIT_TEST=0
```

### MiniXCTest registration audit（progress 遗留 Important）

| Check | Result |
|---|---|
| `func test…` in SlashCommandTests.swift | 27 |
| entries in `PipiUITestsMain.allTests` | 27 |
| 方法数 == 注册数 | **OK** |

---

## Self-check

| Item | OK? |
|---|---|
| 未改源码 | ✅ |
| README 文风与「浏览器/Subagent」节一致（表+简述） | ✅ |
| 内置 8 命令与 spec §5 一致 | ✅ |
| 已知限制照搬 spec §10 | ✅ |
| final-snapshot 含新增/修改 + 行数 + 职责 | ✅ |
| acceptance ≥12 核心场景 | ✅（17 核心线 + 扩展项） |
| swift build 绿 | ✅ |
| 27/27 单测 | ✅ |
| 非 git、无 commit | ✅ |

---

## Follow-ups（非本阶段阻塞）

- 人手按 `acceptance-checklist.md` 跑一遍 `swift run` 实机勾选。
- 若后续引入完整 Xcode，可将 `PipiUITestRunner` 与正式 `swift test` 双轨或迁移。
