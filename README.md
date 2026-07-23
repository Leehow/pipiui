# Pipi UI

纯 Swift/SwiftUI 原生的 pi coding agent 图形界面，通过 `pi --mode rpc`（JSONL over stdin/stdout）驱动，无 Web 技术栈。

## 功能

- **左侧栏**：项目文件夹管理（持久化）+ 每个项目的历史会话列表（从 `~/.pi/agent/sessions/` 自动发现，显示会话名和时间）
- **会话**：新建 / 点击恢复历史会话；每个打开的会话独立一个 `pi --mode rpc` 子进程，后台会话继续运行（绿点表示正在生成）
- **聊天区**：用户气泡、Markdown 正文（含围栏代码块）、Thinking 折叠块、工具调用卡片（bash/read/edit 图标、实时流式输出、成功/失败状态、可展开）
- **输入栏**：Enter 发送；生成中消息进入会话 follow-up 队列（完成后按序发送），可「撤回编辑」；停止按钮在有队列时为「中止并发送队首」；模型/thinking 菜单；多图附件（粘贴/拖入/选文件预览，经 RPC `images` 发给模型，用户气泡与历史会话可显示图片）
- **斜杠命令**：输入 `/` 弹出补全面板（↑↓ 选择，Tab 补全，Enter 执行，Esc 关闭）；内置 `/compact` `/new` `/name` `/session` `/export` `/copy` `/quit` `/model` `/reload` 走本地/GUI 或专用 RPC；扩展/prompt/skill 来自启动时 `get_commands`，经 `prompt` 发送（忙时入队）
- **状态**：顶栏实时显示会话费用和上下文占用百分比；自动重试 / 压缩事件有提示

## 内置浏览器 + pi browser 工具

每个会话有一个内置 WKWebView 面板（顶栏 🌐 按钮开关，pi 调 `browser_navigate` 时自动弹出），带地址栏/前进后退/刷新。App 启动时会把一个 pi 扩展写到 `~/Library/Application Support/PipiUI/pipiui-webview.ts`，并在 spawn pi 时自动 `-e` 加载，注册以下工具供模型测试网页开发：

| 工具 | 作用 |
|---|---|
| `browser_navigate` | 打开 URL 并等待加载完成 |
| `browser_content` | 读取页面可见文本或完整 HTML |
| `browser_eval` | 在页面里执行任意 JS（DOM 检查、触发点击等） |
| `browser_console` | 读取捕获的 console 输出 / JS 异常 / 导航失败 |
| `browser_screenshot` | 页面截图，以图片形式返回给模型（模型能看） |

实现：App 内起一个仅监听 127.0.0.1 的 HTTP 桥接服务，扩展通过 `PIPIUI_BRIDGE_PORT` / `PIPIUI_SESSION_KEY` 环境变量找到它并按会话路由；未知 key 兜底路由到当前选中会话（终端里手动跑 `pi -e pipiui-webview.ts` 也能驱动 GUI 面板）。调试钩子：`PIPIUI_AUTO_SESSION=<项目路径>` 启动可自动建会话。

## Subagent 面板 + Boss 模式

- **Subagent 面板**（工具栏 👥）：pi 通过 `subagent` 工具派出的所有子 agent 实时显示为树（lead 组长带其工人缩进展示），点击每个 agent 看任务、当前动作、流式输出、费用和用时。上报来自 `~/.pi/agent/extensions/subagent/index.ts` 的 Pipi 集成补丁（无环境变量时完全静默，不影响终端使用）。
- **多层 subagent**：子进程通过 `PIPIUI_AGENT_ID/DEPTH` 环境变量继承树身份，`lead` agent（`~/.pi/agent/agents/lead.md`，tools 含 subagent）可再派工人；`PIPIUI_AGENT_MAX_DEPTH`（默认 2）防递归失控，即 Boss(0) → lead(1) → worker(2) 封顶。
- **Boss 模式**（侧栏 👑 开关，默认开）：新会话注入大组长协议（`--append-system-prompt`）——主 agent 不下基层，按难度派工：简单派单兵监工、复杂拆工作流派多个 lead、调研按广度扇出 explore；配合失败恢复协议（同方案最多两次、BLOCKED 白名单、验收要新鲜证据）防早停防摆烂；与已安装的 superpowers 技能（subagent-driven-development / verification-before-completion / systematic-debugging 等）对接作为 SOP。

## 斜杠命令（`/`）

输入框以 `/` 开头时弹出补全浮层（候选 = 9 条内置 ∪ 服务端命令）；空格进入参数后浮层关闭。键盘与点击：

| 操作 | 行为 |
|---|---|
| `↑` / `↓` | 在候选中移动（边界 clamp） |
| `Tab` / 点击候选 | 补全为 `/name `，焦点留在输入框继续打参数 |
| `Return` | 执行当前选中命令（拦截普通发送，不双发） |
| `Esc` | 关闭浮层 |
| 实时输入 | fuzzy 子序列过滤候选 |

**内置命令**（本地/GUI 或专用 RPC，不当普通 prompt 发；忙时立即执行、不入队）：

| 命令 | 参数 | 行为 |
|---|---|---|
| `/compact` | — | 触发上下文压缩（`compact` RPC） |
| `/new` | — | 新建会话 |
| `/name` | `<name>` | 设置当前会话名 |
| `/session` | — | 弹出费用 / 上下文 / 模型等会话摘要 |
| `/export` | — | 导出 HTML，并在 Finder 中选中 |
| `/copy` | — | 复制最后一条 assistant 文本的纯文本到剪贴板 |
| `/quit` | — | 关闭当前会话 |
| `/model` | `<provider/model>` | 切换模型；无参时提示用底栏菜单 |
| `/reload` | — | 热重载扩展 / skills / prompts / 上下文（经内部扩展命令 `pipiui_reload`） |

**服务端命令**：会话启动时自动 `get_commands`，解析 extension / prompt / skill 三类并入候选（徽标 `ext` / `prompt` / `skill`）。执行走现有 `prompt` 路径；生成中入 follow-up 队列。`get_commands` 失败或为空时仅显示内置，不报错刷屏。

**其它规则**：未知 `/xxx`（不在内置与服务端列表）当普通消息发出；⌘V 粘贴等既有输入行为不受影响。

## 构建运行

```bash
swift run              # 开发运行
./make-app.sh          # 构建 release 并打包 build/PipiUI.app
open build/PipiUI.app
```

要求：macOS 14+，已安装 pi CLI（在 `~/.npm-global/bin/pi`、`/opt/homebrew/bin` 或 PATH 中可找到）。

单测（本机仅 CLT、无 XCTest 时用自研 runner）：

```bash
swift run PipiUITestRunner
```

## 代码结构

| 文件 | 职责 |
|---|---|
| `Sources/PipiUI/PiProcess.swift` | pi RPC 子进程：JSONL 分帧（仅 LF）、请求/响应 id 关联、事件回调（主线程投递） |
| `Sources/PipiUI/ChatSession.swift` | 单会话状态机：事件流 → transcript、流式组装、模型/thinking/统计命令；斜杠 builtin 路由与 `get_commands` |
| `Sources/PipiUI/AppStore.swift` | 项目持久化、会话发现（目录名转义规则 `--<cwd 中 / 换 - >--`）、多会话进程管理 |
| `Sources/PipiUI/J.swift` | 轻量动态 JSON 访问器 |
| `Sources/PipiUI/ImageAttachment.swift` | 图片附件：MIME/缩放/粘贴板/拖入、RPC payload |
| `Sources/PipiUI/SlashCommand.swift` | 斜杠命令模型、`get_commands` 解析、fuzzy、内置命令路由 |
| `Sources/PipiUI/Views/SlashPalette.swift` | `/` 补全浮层 |
| `Sources/PipiUI/Views/` | SidebarView / ChatDetailView / MessageViews / InputBar |

## 已知限制（v1）

- 扩展的交互式对话框（select/confirm/input）暂不弹窗：confirm 自动拒绝、其余自动取消，并在对话流里提示
- 聊天气泡内图片暂不支持点击放大/保存；assistant/tool 结果中的图不渲染
- Markdown 为简化渲染（行内语法 + 代码块），无表格/语法高亮
- 斜杠命令 v1：无 `/model` 模型列表补全（手输 id）；TUI 专有且无 RPC 的命令（`/settings` `/login` `/share` `/import` `/trust` `/hotkeys` `/scoped-models`）不出现在面板；扩展交互对话框仍自动取消；流式中 extension/prompt/skill 命令会排队、无法即时执行（`/reload` 等 builtin 可即时执行）
