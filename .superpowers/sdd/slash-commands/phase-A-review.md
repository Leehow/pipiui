# Phase A Review — Slash Commands (Tasks 1–4)

**Reviewer role:** senior code review (spec compliance + code quality)  
**Date:** 2025-07-23  
**Scope:** Plan `docs/superpowers/plans/2025-07-23-slash-commands.md` lines 48–938  
**Implementer report:** `.superpowers/sdd/slash-commands/phase-A-report.md`  
**Verdict:** **PASS — 放行 Phase B**

---

## Files Reviewed

| Path | Lines / notes |
|---|---|
| `Sources/PipiUI/SlashCommand.swift` | 1–235 (full) |
| `Tests/PipiUITests/SlashCommandTests.swift` | 1–293 (full) |
| `Tests/PipiUITests/MiniXCTest.swift` | 1–125 (full) |
| `Tests/PipiUITests/BuiltinHostMock.swift` | 1–32 (full) |
| `Tests/PipiUITests/main.swift` | 1–10 (full) |
| `Package.swift` | full |
| `Sources/PipiUI/App.swift` | entry: `@main` removed; `public struct PipiUIApp` |
| `Sources/PipiUIApp/AppEntry.swift` | thin `@main` → `PipiUIApp.main()` |
| `Sources/PipiUI/J.swift` | `package struct J` + `package init` |
| Scope negative check | No `SlashPalette.swift`; no Slash/Builtin refs in `ChatSession.swift` / `AppStore.swift` / `Views/InputBar.swift` |

**Fresh verification (reviewer-run):**
- `swift run PipiUITestRunner` → **27/27 passed**, exit 0  
- `swift build --product PipiUI` → exit 0  
- Method registry parity: 27 `test*` methods ↔ 27 `PipiUITestsMain.allTests` entries (no drift today)

---

## Spec 合规裁定

| # | 要求 | 裁定 | 证据 |
|---|---|---|---|
| 1 | `SlashSource` 四值；`extension_` rawValue `"extension"` | ✅ | `SlashCommand.swift:5–11`：`builtin` / `extension_ = "extension"` / `prompt` / `skill`；`testBuiltinSourceRawValue` 断言四 rawValue |
| 2 | `SlashCommand` 字段 + `id = "\(source.rawValue):\(name)"` | ✅ | `SlashCommand.swift:13–25`：`name`/`description`/`source`/`argumentHint` + computed `id`；`testSlashCommandIdIncludesSourceAndName` → `"prompt:fix-tests"`；skill 用例 id `"skill:skill:brave-search"` |
| 3 | `get_commands` 解析：modern `sourceInfo`；legacy `path`/`location` 兼容且忽略；失败/缺失 `[]`；跳过未知 source 与缺 name | ✅ | `parseGetCommandsResponse` `SlashCommand.swift:33–67`：读 `name`/`source`/`description`，`argumentHint: nil`，不读 path/location/sourceInfo；success≠true → `[]`；`mapSource` 未知 → nil。测试：`testParseGetCommandsModernSourceInfoShape` / `LegacyPathLocationStillWorks` / `FailureOrMissingReturnsEmpty` / `SkipsUnknownSourceAndMissingName` |
| 4 | `SlashPaletteQuery`：`/` 前缀且命令 token 无空白 → query；有参或无 `/` → nil | ✅ | `SlashCommand.swift:74–86`；测试 Shows/HidesWhenArgs/HidesWithoutSlash（含 leading WS、`"/"→""`、`"/model "`→nil） |
| 5 | `SlashFuzzy`：空 query 保序；子序列；前缀排序优先；大小写不敏感；无匹配空 | ✅ | `score`/`filter` `SlashCommand.swift:93–141`：bonus +1/+3 contiguous/+5 prefix/+2 boundary；空 q 原序；sort score desc then name. Tests: Empty/Subsequence/PrefixRanks/CaseInsensitive/NoMatch |
| 6 | builtin 恰 8 条；name/description/argumentHint 与 spec §5 一致 | ✅ | `BuiltinCommands.all` `SlashCommand.swift:159–168` 逐字：compact/new/name/session/export/copy/quit/model + 中文 description + hints `<name>` / `<provider/model>` / 其余 nil。`testBuiltinAllHasEightCommands` 覆盖 count/names/source/hints（description 见实现源码，测试未逐条 assert 中文文案 — 不构成 ❌） |
| 7 | `parseInvocation`：`/name args` | ✅ | `SlashCommand.swift:179–188`；`testParseInvocation`：trim、args、bare `/` 与 `/ ` → nil、非 slash → nil |
| 8 | `execute` 路由规则 | ✅ | `SlashCommand.swift:193–233` + 对应 11 个 execute 测试：未知 false 无 flash；compact/session/export/copy 调 host；name/model 空参 flash 且不执行；带参调 host；new/quit 闭包/flash 退化。Flash 文案与 plan 一致 |
| 9 | `BuiltinCommandHost` 方法齐全 | ✅ | `SlashCommand.swift:146–156`：flash / runCompact / runSetSessionName / runShowSessionStats / runExportHTML / runCopyLastAssistant / runSetModel(providerSlashId:) / onRequestNewSession / onRequestClose。Mock 完整实现 |
| 10 | 范围纪律：未动 ChatSession/InputBar/AppStore；未建 SlashPalette | ✅ | 全仓 Swift grep：Slash/Builtin 仅出现在 `SlashCommand.swift` + Tests。无 `SlashPalette.swift`。`InputBar` 在 `Sources/PipiUI/Views/InputBar.swift`，无 slash 引用 |

### 遗漏（相对 Phase A 范围）
- **无功能性遗漏。** Phase A 接口面与 plan Task 2–4 一致。

### 多余（YAGNI）
- **无 plan 外业务功能。** 仅有环境强制的脚手架：`MiniXCTest`、`PipiUITestRunner`、library/`PipiUIApp` 拆分、`package` 可见性、`J` package init — 均由 plan Task 1 fallback + CLT 约束授权，不算 scope creep。

### 授权偏离（不记为缺陷）
| 偏离 | 评估 |
|---|---|
| Library `PipiUI` + `PipiUIApp` 薄入口 | Plan Task 1 fallback；正确 |
| 无 SPM `.testTarget`；`PipiUITestRunner` + MiniXCTest | 环境强制；断言为 throw 失败，**非空壳**（见下） |
| `package` 替代 `@testable` | 同 package 跨 target 正确做法 |
| `J` 升为 `package` + package init | 测试构造 `J([...])` 所需；其余成员仍 internal |

---

## 代码质量裁定

### Strengths
1. **逻辑与 plan 代码基本逐字一致**（parser / fuzzy bonuses / builtin table / execute 文案与分支），跨 Task 命名与签名统一，Task 5 可直接对接。
2. **边界处理扎实**：空 draft、bare `/`、args 仅空白（model/name trim 后 empty）、未知 source、success=false、legacy 字段忽略。
3. **测试有效**：`MiniXCTest` 的 `XCTAssert*` 在失败时 `throw XCTFailError`；runner 计 failed 并以 exit 1 退出。对照实现确认**不是“永远 pass”的空壳**。当前 27 方法与 registry 一一对应，本机复跑全绿。
4. **范围克制**：纯逻辑层未提前污染 ChatSession/UI。
5. **Host 协议设计干净**：副作用经 `BuiltinCommandHost` 注入；new/quit 闭包可选 + flash 退化便于 Task 5 前独立测。

### Issues

#### Critical
*无。*

#### Important
1. **`MiniXCTest` 手动 registry 易漏测（Silent skip）** — `MiniXCTest.swift:62–97`  
   新增 `func test…` 若未同步写入 `allTests`，runner 不会执行且 exit 0。今日无 drift，但是 CLT harness 的结构性风险。  
   **建议（可 Phase B 顺手）：** registry 旁加注释 checklist；或启动时用 Mirror/`#file` 约定做 count 自检 assert；或生成脚本 diff method vs registry。

#### Minor
1. **`execute` 的 `default: return false` 为死分支** — `SlashCommand.swift:229–230`  
   已有 `guard byName[name] != nil`；保留与 plan 一致，可删或 `preconditionFailure` 以表意图。
2. **builtin 中文 `description` 未进断言** — `testBuiltinAllHasEightCommands` 只查 names/source/hints。实现正确，但 copy 回归靠读源码。
3. **parser「裸 data 对象」路径无单测** — 代码 `else { data = resp }`（`SlashCommand.swift:41–42`）支持 plan 注释的 bare `{commands:[…]}`，仅有 full-response 测试。
4. **fuzzy `isBoundary` 每次首字符匹配 `Array(name)`** — 与 plan 相同；命令列表很短可接受。
5. **filter 子串匹配逻辑较松** — `testFuzzySubsequenceMatch` 只 assert contains/not contains，不锁排序稳定性以外的 score 细节（plan 测试同样如此）。
6. **`J` 整体 `package`** — 仅 init 需跨模块；类型升级 package 略宽，可接受。勿再扩大 `string`/`subscript` 为 package，除非测试真需要。

### 与计划一致性
| 区域 | 一致性 |
|---|---|
| Task 2 model+parser | 一致（+ `package` + 显式 memberwise init） |
| Task 3 fuzzy+palette | 一致 |
| Task 4 builtin+host+execute | 一致 |
| Task 1 脚手架 | 合理偏离（CLT fallback），验证入口改为 `swift run PipiUITestRunner` |

### 跨任务类型/签名一致性
- 全部 `package`，无 public/internal 混用矛盾。
- `execute(name:args:host:) -> Bool` + `@discardableResult` 与报告/Task 5 sketch 对齐。
- `runSetModel(providerSlashId:)` 命名贯穿 protocol / mock / execute。

---

## Boss 一句话结论

**Phase A（Tasks 1–4）spec 全 ✅、无 Critical，逻辑层与计划对齐且 27/27 实测通过 — 放行进入 Phase B（Task 5 ChatSession host）。** 唯一建议跟进：CLT harness 的手动 test registry 防漏（Important，不阻塞）。

---

## 给 Task 5 的复核侧提示（非阻塞）

- `ChatSession: BuiltinCommandHost` 时注意 `onRequestNewSession` / `onRequestClose` 由 AppStore 注入，未注入路径已有中文 flash。
- `sendPrompt`：仅 `execute == true` 时吞掉；未知 `/xxx` 应走原发送（execute false）。
- `get_commands` 失败保持 `[]`，**不要** flash（parser 契约）。
- Palette 数据源：`BuiltinCommands.all + availableCommands`，query 用 `SlashPaletteQuery.paletteQuery`（nil 时隐藏，勿传空串误显示全表——产品语义在 UI 层决定）。
