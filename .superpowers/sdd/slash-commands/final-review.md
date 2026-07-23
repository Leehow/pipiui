# Final Review — Slash Commands (`/`) 全阶段整体复核

**Reviewer:** senior code review（fresh 视角，跨 Phase A–D）  
**Date:** 2026-07-23  
**Spec:** `docs/superpowers/specs/2025-07-23-slash-commands-design.md`  
**Plan:** `docs/superpowers/plans/2025-07-23-slash-commands.md`  
**Snapshot:** `.superpowers/sdd/slash-commands/final-snapshot.txt`  
**Verify (reviewer-run):** `swift run PipiUITestRunner` → **27/27 passed**, exit 0；registry 方法数 27 == `func test…` 数 27  

---

## Files Reviewed

| Path | Lines / scope |
|---|---|
| `Sources/PipiUI/SlashCommand.swift` | 1–234（全文） |
| `Sources/PipiUI/Views/SlashPalette.swift` | 1–78（全文） |
| `Sources/PipiUI/Views/InputBar.swift` | 1–752（全文；焦点 6–88 monitor、131–138 浮层、187–229 生命周期、439–534 slash/send） |
| `Sources/PipiUI/ChatSession.swift` | 属性 91–97；`loadInitialState` 182–205；`sendPrompt` 455–488；`flash` 721–723；`BuiltinCommandHost` 726–817 |
| `Sources/PipiUI/AppStore.swift` | `makeSession` 107–148（闭包注入） |
| `Sources/PipiUI/App.swift` | 入口：`public struct PipiUIApp` 无 `@main` |
| `Sources/PipiUI/J.swift` | 1–51（`package` 可见性） |
| `Sources/PipiUIApp/AppEntry.swift` | 1–9 |
| `Package.swift` | 全文（库 + App + TestRunner） |
| `Tests/PipiUITests/SlashCommandTests.swift` | 1–292 |
| `Tests/PipiUITests/MiniXCTest.swift` | 1–124 |
| `Tests/PipiUITests/BuiltinHostMock.swift` | 1–32 |
| `Tests/PipiUITests/main.swift` | 1–10 |
| 对照文档 | spec / plan / phase-A–D reports / acceptance-checklist / final-snapshot |
| 负向抽查 | `PiProcess.swift` 未改（通用 `request` + 主线程回调约定仍成立，见文件头注释与 `DispatchQueue.main.async`） |

---

## 一、Spec 合规裁定：**✅ 通过（主路径全覆盖）**

判定基准：设计 spec §2–§10；计划仅作实现注释，冲突时以 spec 为准。授权适配（library 拆分 / MiniXCTest / `package`）不记缺陷。

| # | Spec 要求 | 裁定 | 证据 |
|---|---|---|---|
| 1 | 混合路径：服务端 `get_commands` + 内置静态表，统一浮层 | ✅ | `availableCommands` + `get_commands`：`ChatSession.swift:201–204`；`allSlashCommands` = builtins + server：`InputBar.swift:439–441` |
| 2 | 模型：`SlashSource` 四值；`SlashCommand` 字段与 `id` | ✅ | `SlashCommand.swift:5–25`；`extension_ = "extension"`；`id = "\(source.rawValue):\(name)"` |
| 3 | `get_commands` 映射 name/description/source；忽略 legacy path/location；失败/空不报错 | ✅ | parser `SlashCommand.swift:33–67`；失败 → `[]`；`loadInitialState` 注释明确 no flash：`ChatSession.swift:202–204` |
| 4 | 内置 8 条及映射（compact/new/name/session/export/copy/quit/model） | ✅ | 表 `SlashCommand.swift:159–168`；execute `193–233`；host 实现 `ChatSession.swift:728–817`；`/new` `/quit` 经 AppStore 闭包 `AppStore.swift:140–145` |
| 5 | 浮层触发：trim 后 `/` 开头且命令 token 无空白；有空格关闭 | ✅ | `SlashPaletteQuery.paletteQuery`：`SlashCommand.swift:74–86`；`refreshSlashPalette`：`InputBar.swift:443–455` |
| 6 | 候选 fuzzy 子序列 + 评分排序 | ✅ | `SlashFuzzy`：`SlashCommand.swift:90–141`；空 query 保序；+1/+3 contiguous/+5 prefix/+2 boundary |
| 7 | UI：字段上方、material、name+desc+source 徽标、选中高亮 | ✅ | `SlashPalette.swift` 全文；VStack 挂在 TextField 上方：`InputBar.swift:131–138`（采用 plan preferred 布局，优于 fragile ZStack） |
| 8 | 键盘：↑↓ clamp；Tab=补全；Return=执行并拦 onSubmit；Esc 关；点击=补全 | ✅ | `ComposerSlashKeyMonitor`：`InputBar.swift:42–88`；handlers `195–214`；`completeSlash`/`executeSlash` `458–502`；`send()` 双发守卫 `516–521` |
| 9 | 忙时：builtin 立即不入队；服务端走既有队列 | ✅ | 闸门在 queue 之前 return：`ChatSession.swift:470–477`；palette builtin 直调 execute：`InputBar.swift:495–496`；server → `sendPrompt` → queue：`498–501` + `482–487` |
| 10 | 未知 `/xxx` 当普通 prompt | ✅ | `execute` 未知 → false：`SlashCommand.swift:193`；闸门不吞，落入 prepare+send/queue：`ChatSession.swift:470–487` |
| 11 | 参数缺失 / 闭包未注入 → `flash` | ✅ | name/model 空参 flash；new/quit 无闭包 flash：`SlashCommand.swift:197–227`；`flash`→`lastError`：`ChatSession.swift:721–723` |
| 12 | 不做项（settings/login、model 补全、extension_ui 等） | ✅ | 未引入额外内置；无 model 列表补全；未改 extension_ui 行为 |
| 13 | 纯逻辑单测 + UI 手测 | ✅ | 27 单测全绿；`acceptance-checklist.md` 供实机 |

### Spec 遗漏（相对 v1 正文）

- **无功能性遗漏。** 主聊天路径的浮层/键盘/8 内置/服务端 prompt/忙时/未知命令/边界均有对应实现与（逻辑层）测试。

### Spec 多余 / 授权偏离

| 项 | 说明 |
|---|---|
| `sendPrompt` 闸门内额外 `draftText`/`draftImages` 清空 | plan 原文仅 `return`；实现多了清空（`ChatSession.swift:474–475`）。对 InputBar 已先清空的路径幂等；属合理加固，**非 scope creep** |
| library + `PipiUIApp` + `PipiUITestRunner` / MiniXCTest / `package` | CLT 授权适配，正当 |
| palette 行展示 `argumentHint` | plan UI 写明，符合 |

### 边缘行为（记入质量 Issues，不构成 spec ❌）

见下文 Important：media 模式与 slash 交叉、附件图 + slash 双路径不一致、`availableCommands` 到达后未主动 refresh 浮层。

---

## 二、代码质量 / 集成裁定

### Strengths

1. **分层干净**：纯逻辑（`SlashCommand.swift`）与 UI/会话集成分离；`BuiltinCommandHost` 可测、无 AppStore 硬耦合。
2. **跨阶段签名一致**：`SlashSource` / `SlashCommand` / `SlashFuzzy` / `SlashPaletteQuery` / `BuiltinCommands` / `availableCommands` / `flash` / `onRequestNewSession` / `onRequestClose` 与 Phase A 定义及 B/C 使用处逐字对齐。
3. **键盘契约扎实**：`isActive = focused && palette && !matches.isEmpty`；⌘/⌥/⌃ 不吞；与 `ComposerPasteCatcher` 同生命周期（appear/start、disappear/stop、deinit/stop）；Return 双保险（monitor 吞事件 + `send()` 守卫）。
4. **内存/线程**：AppStore 注入 `[weak self]`；PiProcess 约定主线程回调（`ChatSession` 文件头 + `PiProcess`）；`get_commands`/host RPC 均 `[weak self]`，无环。
5. **忙时语义正确**：builtin 在 enqueue 前 return 或 palette 直调；server/未知走原 queue。
6. **测试有效**：MiniXCTest 失败会 throw 并计 failed；27/27 与 registry 无 drift；非空壳。
7. **闸门副作用**：InputBar `send()` 先 snapshot 再清 draft，再 `sendPrompt`；builtin 闸门再清一次幂等，**不会**导致「清两次丢已 snapshot 的发送内容」或双发用户气泡。

### Issues

#### Critical

*无。*

#### Important

1. **`availableCommands` 异步到达后浮层不自动刷新** — `InputBar.swift:221–223` 仅 `onChange(of: session.draftText)`；`ChatSession.swift:201–204` 写 `availableCommands` 无联动  
   **现象：** 用户在 `get_commands` 返回前就输入 `/` 并保持浮层打开时，只见内置；服务端命令要等到下一次 draft 变更才出现。  
   **建议：** `onChange(of: session.availableCommands)`（或 `onReceive`）里调用 `refreshSlashPalette()`。

2. **媒体生成模式与 slash 路径不一致** — `ChatSession.sendPrompt` 先判 `composerMode`（`455–467`）再 builtin 闸门（`470–477`）；而 `executeSlash` 对 builtin **绕过** `sendPrompt`（`InputBar.swift:495–496`）  
   **现象：**  
   - 浮层 Return 选中 `/compact`：即时执行 builtin（即使仍在「生成图像/视频」模式）。  
   - Tab 补全后手打参数再 Return，或 Esc 后发送：`/compact` / `/name x` 会当 **media prompt** 进 `generateMedia`，不走 builtin。  
   - 服务端 slash 经 `executeSlash`→`sendPrompt` 时同样被 media 分支吞掉。  
   **建议（择一）：** (a) `composerMode != .chat` 时不显示浮层且 `refreshSlashPalette` 直接隐藏；或 (b) 将 builtin（及可选「明确的 slash 调用」）路由挪到 media 判断之前，与 palette 直调语义对齐。

3. **附件图 + slash：send 路径 vs palette 执行路径分叉** — 闸门要求 `images.isEmpty`（`ChatSession.swift:472`）；`executeSlash` 无条件丢弃 `draftImages` 后执行（`InputBar.swift:487–488`）  
   **现象：** 已贴图时，palette Return 会丢掉图片并执行 builtin；点发送按钮则把 `/compact`+图当普通多模态 prompt 发出。  
   **建议：** 统一策略——有图时要么拒绝 slash 并 flash「斜杠命令请先清空附件」，要么始终优先 builtin 并明确丢弃附件（两处同一行为）。

4. **CLT `MiniXCTest` 手动 registry 静默漏测风险** — `MiniXCTest.swift:62–97`  
   今日 27==27 无 drift，但新增 `func test…` 若未登记，`runAll` 仍 exit 0。  
   **建议：** 启动自检 assert（方法 Mirror/源码计数 vs `allTests.count`），或生成脚本；与 Phase A review 同源，仍未修。

#### Minor

1. **过滤变更不重置选中到 0** — `InputBar.swift:452–454` 仅越界 clamp；query 从宽变窄时高亮可能停在「新列表的中部」。常见 UX 是 query 变化时 `selectedIndex = 0`。
2. **builtin 名大小写敏感** — `byName[name]` 精确匹配（`SlashCommand.swift:173–174, 193`）。浮层选中用规范小写名无问题；手打 `/Compact` 会当未知 prompt。可 `lowercased()` 规范化（若产品需要）。
3. **`flash` 复用 `lastError` 红条** — 信息类 `/session`、导出成功也走错误样式（`ChatDetailView` error banner）。计划已授权；后续若有 toast 再拆 info/error。
4. **`execute` 的 `default: return false` 死分支** — `SlashCommand.swift:229–230`（guard 已覆盖）；可删或 `preconditionFailure`。
5. **`runCopyLastAssistant` 不含进行中的 `streamingItem`** — 仅扫 `transcript`（`ChatSession.swift:783`）；流式未 settle 时可能 flash「没有可复制」。可接受的 v1 边界。
6. **Shift 未纳入 monitor 修饰键过滤** — `InputBar.swift:55` 只拦 ⌘/⌥/⌃；Shift+Tab 仍会 complete。通常无害。
7. **无 `sendPrompt` 闸门 / host 集成单测** — 计划允许 UI 手测；回归依赖实机清单。后续可用 mock `PiProcess` 或抽 gate 函数补测。

### 跨阶段集成一致性（专项）

| 检查项 | 结果 |
|---|---|
| Phase A 类型/协议 vs B host 实现 | ✅ 方法集一致 |
| Phase A vs C InputBar 调用 | ✅ `availableCommands` / `BuiltinCommands.all` / `SlashFuzzy` / `SlashPaletteQuery` |
| `executeSlash` builtin vs server 分发 | ✅ `cmd.source == .builtin` 分支正确；server 拼 `/\(name) args` 再 `sendPrompt` |
| AppStore 闭包 | ✅ weak；`/new`→`newSession`；`/quit`→`closeSession` |
| Return 防双发 | ✅ monitor nil + `send()` 守卫 |
| Monitor 生命周期 | ✅ start/stop/deinit；与 focus/visibility 同步 `isActive` |
| sendPrompt 闸门 vs InputBar.send 清 draft | ✅ snapshot 后清空；闸门再清幂等；无双发气泡 |

### YAGNI / DRY / 命名

- 无 v1 外命令或 RPC。
- 命名与 plan 全局约束一致。
- 轻微重复：builtin 可通过 `sendPrompt` 闸门或 `executeSlash` 直达两路进入（有意：palette 要绕过 onSubmit/media）；需用上面 Important #2/#3 收紧交叉场景。

### 已授权适配正当性

| 适配 | 裁定 |
|---|---|
| `PipiUI` library + `PipiUIApp` 薄入口 | 正当；`@main` 仅在 `AppEntry` |
| `PipiUITestRunner` + MiniXCTest | 正当；断言可失败；非空壳 |
| `package` 替代 `@testable` | 正当（同 SPM package 跨 target） |
| `J` package 化 | 测试构造所需；可接受 |

适配实现本身：**MiniXCTest 手写 registry** 见 Important #4；其余无额外 bug。

---

## 三、与阶段复核的增量

| 来源 | 本轮是否仍成立 |
|---|---|
| Phase A：registry 漏测风险 | ✅ 仍 Important，未修 |
| Phase A：死 default / description 未断言等 Minor | ✅ 仍在 |
| Phase B/C 报告宣称主路径完成 | ✅ 代码证实 |
| **本轮新发现（跨阶段）** | media×slash 分叉；images×slash 分叉；`availableCommands` 无 onChange |

---

## 四、一句话结论

**可交付用户做实机验收（主聊天路径 spec ✅，无 Critical；`swift build`/27 测绿）。**  
建议在验收前后尽快修 3 条 Important 集成边角：`availableCommands` 变更刷新浮层、非 `.chat` 模式禁用或统一 slash 路由、附件图与 slash 行为两路径对齐；**不阻塞**按 `acceptance-checklist.md` 开测，但若验收覆盖「生成图像模式」或「带图 + `/`」可能踩坑。

### 交付门禁摘要

| 门禁 | 状态 |
|---|---|
| Spec 主路径 | ✅ |
| Critical issues | 0 |
| Important issues | 4（边角/工具链；建议修，非合并硬阻塞） |
| 单元测试 | 27/27 |
| 实机验收 | 待用户按 checklist |

