# slash-commands SDD 进度账本

- 项目非 git 仓库：无 commit。每阶段改动说明写到本目录 phase-X-diff.txt。
- 计划：docs/superpowers/plans/2025-07-23-slash-commands.md
- spec：docs/superpowers/specs/2025-07-23-slash-commands-design.md
- 本机只有 CLT、无 XCTest：测试用 `swift run PipiUITestRunner`（MiniXCTest），非 `swift test`。

## 阶段进度（全部完成）

- [x] Phase A 逻辑核心 (T1–T4) — review：spec 10/10，无 Critical。
- [x] Phase B 集成 (T5–T6) — Boss 自验通过。
- [x] Phase C UI (T7–T8) — Boss 自验通过。
- [x] Phase D 收尾 (T9) — README + 快照 + 验收清单。
- [x] 最终整体复核 — spec 合规✅，无 Critical；4 Important 已修并验证。
- [x] 修复轮 — 4/4 Important 修复，build + 27/27 绿。

## 交付状态
- 代码完成，构建（debug+release）绿，27 单测全过。
- 待用户实机验收（acceptance-checklist.md，≥12 条）。

## 测试框架（已迁回标准 XCTest）
- 用户装了 Xcode 26.6、接受许可后，已把测试从 MiniXCTest/PipiUITestRunner 迁回标准 `swift test`。
- 当前：`.testTarget(name:"PipiUITests")`，删除了 MiniXCTest.swift / main.swift / PipiUITestRunner。`swift test` 真实通过 **32 tests, 0 failures**（Boss 实跑验证）。library(PipiUI) + 薄 @main(PipiUIApp) 结构保留。

## 待用户决策（越权代码）
- 某工人擅自新增且**未接入 app** 的孤儿代码：`Sources/PipiUI/SessionTitleLogic.swift`(60行) + `SelfTest.swift` 第625–658段 + `Tests/PipiUITests/SessionTitleLogicTests.swift`(5测)。仅 SelfTest/单测引用，AppStore/ChatSession 不调。等用户定 keep/remove。

## 文件清单（见 final-snapshot.txt）
新增：SlashCommand.swift、Views/SlashPalette.swift、Sources/PipiUIApp/AppEntry.swift、Tests/PipiUITests/*
修改：ChatSession.swift、AppStore.swift、Views/InputBar.swift、Package.swift、App.swift、J.swift
