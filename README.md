# Pipi UI

纯 Swift/SwiftUI 原生的 pi coding agent 图形界面，通过 `pi --mode rpc`（JSONL over stdin/stdout）驱动，无 Web 技术栈。

## 功能

- **左侧栏**：项目文件夹管理（持久化）+ 每个项目的历史会话列表（从该项目 `{project}/.pi/agent/sessions/` 发现，显示会话名和时间）
- **会话**：新建 / 点击恢复历史会话；每个打开的会话独立一个 `pi --mode rpc` 子进程，后台会话继续运行（绿点表示正在生成）
- **聊天区**：用户气泡、Markdown 正文（含围栏代码块）、Thinking 折叠块、工具调用卡片（bash/read/edit 图标、实时流式输出、成功/失败状态、可展开）
- **输入栏**：Enter 发送；生成中消息进入会话 follow-up 队列（完成后按序发送），可「撤回编辑」；停止按钮在有队列时为「中止并发送队首」；模型/thinking 菜单；多图附件（粘贴/拖入/选文件预览，经 RPC `images` 发给模型；用户/助手/工具图片可点击放大、右键「在访达中显示 / 打开 / 存储…」）
- **路径链接**：Markdown 正文与工具参数/输出中的绝对路径、`file://` 可点击并在访达中显示（围栏代码块内不链接）
- **斜杠命令**：输入 `/` 弹出补全面板（↑↓ 选择，Tab 补全，Enter 执行，Esc 关闭）；内置 `/compact` `/new` `/name` `/session` `/export` `/copy` `/quit` `/model` `/reload` 走本地/GUI 或专用 RPC；扩展/prompt/skill 来自启动时 `get_commands`，经 `prompt` 发送（忙时入队）
- **状态**：顶栏实时显示会话费用和上下文占用百分比；自动重试 / 压缩事件有提示

## 内置浏览器 + pi browser 工具

每个会话有一个内置 WKWebView 面板（顶栏 🌐 按钮开关，pi 调 `browser` 的 navigate 时自动弹出），带地址栏/前进后退/刷新。App 启动时会把一个 pi 扩展写到 `~/Library/Application Support/PipiUI/pipiui-webview.ts`，并在 spawn pi 时自动 `-e` 加载，注册**单个** `browser` 工具供模型测试网页开发（合并前是 5 个 `browser_*` 工具，占前缀 517 token；合为一个后约 110 token，且工具集恒定不会毁缓存——见 [`docs/progressive-disclosure.md`](./docs/progressive-disclosure.md)）：

| `browser({action})` | 作用 |
|---|---|
| `navigate {url}` | 打开 URL 并等待加载完成 |
| `content {mode?}` | 读取页面可见文本（默认）或完整 HTML |
| `eval {js}` | 在页面里执行任意 JS（DOM 检查、触发点击等） |
| `console {clear?}` | 读取捕获的 console 输出 / JS 异常 / 导航失败 |
| `screenshot` | 页面截图，以图片形式返回给模型（模型能看） |
| `help` | 返回上述全部参数说明（细节走 tool result，不进前缀） |

实现：App 内起一个仅监听 127.0.0.1 的 HTTP 桥接服务，扩展通过 `PIPIUI_BRIDGE_PORT` / `PIPIUI_SESSION_KEY` 环境变量找到它；后者是每个顶层会话独立的高熵 capability，桥在分发任何请求前都会校验。未知或已关闭的 capability 一律拒绝，不会回退到当前选中会话。调试钩子：`PIPIUI_AUTO_SESSION=<项目路径>` 启动可自动建会话。

## Memory（extension-native Learning Loop）

设置 → **记忆** 中勾选「启用记忆」即可安装并启用正式的 `pipiui-memory-broker` extension；安装、Catalog/Retrieval/Curator、学习循环、管理页与 eval 都属于该 extension。状态只显示 extension 的版本和 ready/degraded 摘要。点击 **打开 Memory Center** 时，PipiUI 仅通过当前活动 Pi 会话请求一次短期 opaque 描述符并打开 extension 页面；没有活动会话会提示先打开会话，不会自动创建或重启会话。短期 URL 过期后回到设置重试即可。

在裸 Pi 中，安装/启用该 extension 后输入 `/memory` 可请求并打开同一 extension 提供的 Memory Center。业务 API、数据格式及运维说明都在 `Sources/PipiUI/PiExt/packages/memory-broker/README.md`，不属于 Swift 宿主契约。

## Computer Use（macOS 桌面控制，opt-in）

设置 → 工具与 Skills 中可显式开启 Computer Use。默认关闭时不导出桌面能力，工具不存在、没有前缀成本。开启后主会话只导出 `PIPIUI_COMPUTER_*` 环境（供嵌套派发 host-check），**不**挂载 `computer` / `open_application`；桌面工具仅注入给带 desktop 授权的 subagent（`operator`）。

底部 `desktopcomputer` 按钮是 PipiUI 唯一的产品授权开关。打开即进入无限制模式：PipiUI 不做逐会话、逐应用、高风险、敏感文本/快捷键或破坏性写操作确认；PipiUI 自身、Terminal、System Settings、密码管理器、未知应用以及历史持久 deny 都走同一条无提示路径。普通鼠标、键盘和滚动输入不会暂停或取消操作。只保留 macOS Screen Recording/Accessibility TCC、手动/`⌥⇧Esc` 急停、实际执行期间的 process-global mutex，以及目标 PID/焦点/动态代码身份、窗口截图、坐标、event-post、取消和 held-input 清理等技术校验。每个 batch 或 `open_application` 成功、失败或取消落定后都会释放互斥槽；每批动作结束给模型一张新截图，PNG 只保存在进程内存中，不写入 pi 会话 JSONL。

Anthropic `anthropic-messages` 请求会把同名自定义工具替换为官方 `computer_20251124` 并合并 beta header；OpenAI/Codex 与其他 provider 使用通用 `actions:[...]` 自定义工具，不声称支持 OpenAI 原生 `computer_call` 循环。

完整运行边界、稳定签名/TCC 设置和手工验收步骤见 [`docs/computer-use.md`](./docs/computer-use.md)。

## Subagent 面板 + Boss 模式

- **Subagent 面板**（工具栏 👥）：pi 通过 `subagent` 工具派出的所有子 agent 实时显示为树，点击每个 agent 看任务、当前动作、流式输出、费用和用时。上报来自 `~/.pi/agent/extensions/subagent/index.ts` 的 Pipi 集成补丁（无环境变量时完全静默，不影响终端使用）。
- **多层 subagent**：子进程通过 `PIPIUI_AGENT_ID/DEPTH` 环境变量继承树身份；`PIPIUI_AGENT_MAX_DEPTH`（默认 2）防递归失控。桌面操作派给专用 `operator` agent（派发时带 desktop 授权），由它持有 `computer` / `open_application`，主会话不下桌面。
- **Boss 模式**（侧栏 👑 开关，默认开）：新会话注入大组长协议（`--append-system-prompt`）——主 agent 不下基层，全部派工：简单派单兵监工、复杂按独立切片直接扇出、调研按广度扇出 explore、桌面/外部 App 操作派 `operator`；配合失败恢复协议（同方案最多两次、BLOCKED 白名单、验收要新鲜证据）防早停防摆烂。
- **没有难度分级，也没有模型强弱分档**：协议不再要求先给任务贴 `[T0..T3]` 标签再按级别执行，也不再按模型档位切换规划路线（原 `SkillTierExtension` / `ModelTierSettings` 与设置里的「弱模型」勾选已整体移除）。取而代之的是一条判断原则——流程重量必须匹配工作量，加一步之前要能说出它能抓到上一步没抓到的什么；路线不明就先走便宜的那条，让失败的 worker 把证据交上来，比一上来铺五个 worker 便宜也好收拾。剩下的由模型自己决定。
- **先想再查**：协议鼓励主 agent 在形成自己的判断**之后**用 `web_search` / `fetch_content` 交叉验证或找灵感（先搜会被别人对问题的框定带跑），并明确划线——已经知道怎么修且只涉及本仓库的直接动手；只有当问题大概不只出现在这个代码库（库/系统行为反常、别人也会撞到的报错、API 或版本可能变了、平台怪癖、「这思路对不对」这类需要前人方案的设计选择），或者结论依赖一个未经验证的第三方行为假设时才检索。检索结果是证据不是权威——仓库证据、复现、attested 命令都排在任何帖子之上；真的因为某个来源改了决定就给出 URL，只是印证了自己就别堆链接。这是判断题，不是必经步骤。
- **与外部技能库解耦**：Boss 协议自己就是会话的流程主人，设计/计划文档只在用户明确要求时才产出——计划是一串可派工的编号步骤，不是一篇文档。外部技能库降级为 opt-in：主会话不再被注入「回答前必须先调技能」的 bootstrap，只有用户点名时才加载；派出去的 subagent 一律 `--no-skills` 且运行时屏蔽技能 bootstrap，worker 只认自己的 agent 提示词 + brief。只读角色（plan / explore / reviewer）交付的是报告，运行时会丢弃 brief 里给它们的 `verify`，不会再出现「要求落盘却禁止写文件 → 验收必然失败 → 反复重派」的死循环。
- **技能按需加载**（`SkillLoaderExtension`，仅主会话）：pi 默认把每个技能的完整描述渲染进系统提示，同时把 `disable-model-invocation` 的技能完全藏起来——两半都不合用：描述是每轮都在付的菜单税，藏起来的技能模型永远够不着。改成提示里**只留名字**，描述走 `skill_search`，正文走 `skill_load`，和延迟加载工具 schema 是同一笔交易。实测 1108 → 283 token（加两个工具 schema 181 token，净省 644/轮），并且那 13 个重流程技能现在模型自己能翻出来用。**开不开那个盒子是模型自己的判断** —— 索引只告诉它代价（多步流程、会产出文档或工单、部分需要本项目没配的 issue tracker），不设告知义务、不设审批闸门。`skill_load` 只收技能名不收路径，且遵守设置里的技能开关。
- **技能库翻译规则**：技能是为别的 harness 写的，Boss 协议要求「翻译而非照做」——要求中途找用户确认的，brief 即确认（worker 没有对话通道，等人就是挂死）；说用 `Task`/`Agent` 派工的，映射到 `subagent`（评审→`reviewer`，实现→`general-purpose`，双轴并行评审=一次调用派两个 reviewer）；需要 issue/工单/PRD/label 的，本项目没有，状态记在 ledger 里；要求「先有复现再动手」的照做，但拿不到复现不等于 BLOCKED，先走两条实质不同的路线。

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

## API key 与凭据管理

所有 API key 存放在当前项目 `{project}/.pi/agent/.env`（0600），OAuth 凭据在该项目的 `auth.json`。禁止使用全局 `~/.pi/agent`。详见 [`docs/key-management.md`](./docs/key-management.md)。

设置 → **密钥库** 是全局加密密钥库（Electron `safeStorage`）。Linux x64（Ubuntu 22.04/24.04 桌面会话）需要自行安装并解锁系统密钥服务；缺依赖时密钥库 fail-closed，普通聊天不受影响。见 [`docs/electron-secret-vault-linux.md`](./docs/electron-secret-vault-linux.md)。

## 构建运行

**宪章（强制）：只有主工作区 `/Users/haoli/leehow/code/pipiui` 能创建唯一的 `build/PipiUI.app`；其他 worktree 只能编译/测试，不能打包 App。** 详见 [`CONSTITUTION.md`](./CONSTITUTION.md)；agent 入口见 [`AGENTS.md`](./AGENTS.md)。仅 `swift build` / `swift run` 成功而主工作区 `.app` 仍旧时，不得宣称「可打开 App」。

```bash
swift run                 # 任意 worktree 的开发调试（不更新 .app）
cd /Users/haoli/leehow/code/pipiui
./make-app.sh             # 唯一 release 包 → build/PipiUI.app
./scripts/build-app.sh    # 可选：先 swift test 再 make-app.sh（--skip-tests 跳过测试）
open build/PipiUI.app     # 启动唯一打包后的 App
```

打包后核对 build 二进制新于源码，例如：

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  Sources/PipiUI/Views/ImagePreview.swift
```

要求：macOS 14+，已安装 pi CLI（在 `~/.npm-global/bin/pi`、`/opt/homebrew/bin` 或 PATH 中可找到）。

单测（本机仅 CLT、无 XCTest 时用自研 runner）：

```bash
swift test                # 有 XCTest 时
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
- 图片灯箱为等比适应窗口，暂不支持捏合/滚轮缩放与多图左右翻页；无 path 时依赖 `.pi/attachments` 内容匹配或「存储…」
- 绝对路径自动链接 v1：不识别带空格的路径；围栏代码块内不做路径链接
- Markdown 为简化渲染（行内语法 + 代码块/表格），无语法高亮
- 斜杠命令 v1：无 `/model` 模型列表补全（手输 id）；TUI 专有且无 RPC 的命令（`/settings` `/login` `/share` `/import` `/trust` `/hotkeys` `/scoped-models`）不出现在面板；扩展交互对话框仍自动取消；流式中 extension/prompt/skill 命令会排队、无法即时执行（`/reload` 等 builtin 可即时执行）

## 许可证

Pipi UI 基于 [Apache License 2.0](./LICENSE) 开源。
