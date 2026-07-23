# 设计：pipiui 接入 pi 斜杠命令（`/`）

- 日期：2025-07-23
- 状态：已通过 brainstorming，待转实现计划
- 范围决议：B（服务端原生命令 + 常用内置命令映射）；交互 B（浮层 + 键盘导航）；忙时行为 B（本地立即、服务端排队）

## 1. 背景与依据

pipiui 是纯 Swift/SwiftUI 的 pi 图形客户端，经 `pi --mode rpc`（JSONL over stdin/stdout）驱动。pi 的 `/` 命令分两层：

- **内置 TUI 命令**（`BUILTIN_SLASH_COMMANDS`，22 条）：只在交互模式本地处理；经 RPC `prompt` 发 `/model` 这类文本**不会**执行，须映射到 RPC API 或 GUI 本地实现。
- **extension / prompt 模板 / skill 命令**：pi 提供 `get_commands` RPC 枚举这三类；发 `{"type":"prompt","message":"/<name> <args>"}` 会自动展开/执行。
- pi 无 `--list-commands`、无专门触发命令的 RPC、无 completion RPC。

pipiui 现状：`InputBar`（`TextField`+`@State draft`，Enter→`onSubmit(send)`）→ `ChatSession.sendPrompt`（忙时入本地 `SessionMessageQueue`）→ `PiProcess.request(["type":"prompt"])`。**未调 `get_commands`，无 `/` 补全，无命令概念。** 已有 `ComposerPasteCatcher`（`InputBar.swift:6`）用 `NSEvent.addLocalMonitorForEvents(.keyDown)` 捕获键盘事件，可复用做键盘导航。

## 2. 总体方案（混合路径）

- 服务端命令：启动时调一次 `get_commands` 拉取，存 `ChatSession.availableCommands`；执行发 `prompt`。
- 内置命令：Swift 静态表，走本地 GUI 动作或已有 RPC，不当 prompt 发。
- 统一进输入栏 `/` 补全浮层，两类并列展示，带 source 徽标。

## 3. 数据模型（新增 `Sources/PipiUI/SlashCommand.swift`）

```swift
enum SlashSource: String { case builtin, extension_, prompt, skill }

struct SlashCommand: Identifiable, Hashable {
    let name: String          // 不含 '/'
    let description: String?
    let source: SlashSource
    let argumentHint: String? // 如 "/model" → "<provider/model>"
    var id: String { "\(source.rawValue):\(name)" }
}
```

- `BuiltinCommands`：静态 `[SlashCommand]`（8 条，见 §5）+ `execute(name, args, session) -> Bool`（返回 false 表示未匹配）。涉及会话生命周期的 `/new`、`/quit` 通过 `ChatSession` 暴露的可空闭包回退到 AppStore（见 §4），不在数据模型里直接耦合 AppStore。
- 服务端命令：`get_commands` 的 `data.commands[]`（字段 `name/description/source/sourceInfo`）映射为 `SlashCommand`，`source` ∈ extension/prompt/skill，统一 `sendAsPrompt`。**以代码/d.ts 的 `sourceInfo` 为准**（`docs/rpc.md` 示例的 `path`/`location` 已过时）。

## 4. ChatSession 改动

- 新增 `@Published var availableCommands: [SlashCommand] = []`。
- `loadInitialState()` 末尾加 `proc?.request(["type": "get_commands"]) { resp in ... }`，解析 `data.commands` 填充。失败/为空则只保留内置表，不报错。
- `sendPrompt(_:)` 入口加路由：trim 后若命中 builtin → `BuiltinCommands.execute(...)` 并 `return`（不发 pi）；否则走原 `sendPromptNow`/队列路径（extension/skill/prompt/plain 文本照旧）。
- builtin 复用现有方法：`/compact`→`request(["type":"compact"])`；`/name <x>`→`setSessionName`；`/export`→`export_html`；`/session`→`refreshStats` 后提示；`/copy`→最后一条 assistant 文本写剪贴板；`/model <p/m>`→`setModel`，无参→提示用底栏菜单。
- `/new`、`/quit` 需触达 AppStore：`ChatSession` 新增两个可空闭包 `var onRequestNewSession: (() -> Void)?`、`var onRequestClose: (() -> Void)?`，由拥有该 session 的 AppStore/ChatDetailView 注入；builtin execute 调用它们，未注入时退化为提示文案。
- 错误/提示文案统一走一个 `ChatSession.flash(_:)`（若项目无现成 toast，用现有 inline 提示机制；实现时确认）。

## 5. 内置命令映射表

| 命令 | argumentHint | 执行 | 忙时 |
|---|---|---|---|
| `/compact` | — | `compact` RPC | 立即 |
| `/new` | — | AppStore 新建会话 | 立即 |
| `/name` | `<name>` | `set_session_name` | 立即 |
| `/session` | — | `get_session_stats`+`get_state` → 提示 | 立即 |
| `/export` | — | `export_html` | 立即 |
| `/copy` | — | 剪贴板（最后 assistant 文本） | 立即 |
| `/quit` | — | 关闭当前会话进程 | 立即 |
| `/model` | `<provider/model>` | `set_model`，无参→提示用菜单 | 立即 |

## 6. InputBar 补全浮层（新增 `Sources/PipiUI/Views/SlashPalette.swift`）

- **触发**：`onChange(of: draft)`——draft 去掉首行空白后以 `/` 开头、且命令 token 内无空格 → 显示浮层；出现空格（进入参数）→ 关闭。
- **候选**：`BuiltinCommands.all + session.availableCommands`，按 `/` 后文本做 fuzzy（子序列匹配 + 评分排序）。
- **样式**：TextField 正上方浮层，`.regularMaterial`；每行 = `/name` + 灰色 description + 右侧 source 徽标（builtin/ext/skill/prompt）；选中行高亮。样式参考现有 InputBar 的 strip 与 Menu capsule。
- **键盘导航**：仿 `ComposerPasteCatcher` 加一个 `addLocalMonitorForEvents(.keyDown)` monitor（仅浮层开时生效）：
  - `↑/↓` 移动选中（clamp）；`Esc` 关闭浮层。
  - `Tab` = 补全选中命令名进 draft（`/name `），留在输入框继续打参数，关闭浮层。
  - `Return`（浮层开时）= 直接执行选中命令（builtin 本地跑 / 服务端发 prompt）；需参数但没给 → toast/inline 报错；并拦截原 `onSubmit(send)`。
  - 浮层关时 `Return` 仍走原 `onSubmit(send)`。
- **点击候选** = 补全名字（同 Tab）。

## 7. 忙时行为

- 内置命令：立即执行，不被流式队列阻塞。
- 服务端命令（extension/skill/prompt）：沿用现有 `SessionMessageQueue`（忙时入队、空闲按序发）。

## 8. 边界与错误

- `get_commands` 失败/空 → 只显示内置命令，不报错。
- 未知 `/xxx`（不在任何列表）→ 当普通文本发 prompt（pi 自行处理：是 skill/ext 就跑，否则当用户消息）。
- builtin 参数缺失 / 闭包未注入 → 走 `ChatSession.flash(_:)` 提示。

## 9. 测试

- 纯逻辑加单元测试（建议 `Tests/PipiUITests/`）：fuzzy 过滤、builtin 路由（匹配/不匹配/参数校验）、`get_commands` JSON→`[SlashCommand]` 解析。
- UI/键盘交互手动验收。

## 10. 不做（v1 已知限制）

- 扩展交互对话框（select/confirm/input）仍自动取消（沿用现状）。
- 无 RPC 的内置（`/settings` `/login` `/share` `/import` `/trust` `/reload` `/hotkeys` `/scoped-models`）不在浮层出现。
- `/model` 参数补全（列可选模型）v1 不做，手输 id。
- 流式中 extension 命令无法即时执行，会排队。

## 11. 涉及文件

- 新增：`Sources/PipiUI/SlashCommand.swift`、`Sources/PipiUI/Views/SlashPalette.swift`、（建议）`Tests/PipiUITests/SlashCommandTests.swift`
- 改：`Sources/PipiUI/ChatSession.swift`（`get_commands` 拉取 + `sendPrompt` 路由 + builtin 执行钩子）、`Sources/PipiUI/Views/InputBar.swift`（浮层挂载 + 键盘 monitor）
- 基本不动：`Sources/PipiUI/PiProcess.swift`（通用 `request` 已够）
