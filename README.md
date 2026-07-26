# Pipi UI

纯 Swift/SwiftUI 原生的 pi coding agent 图形界面，通过 `pi --mode rpc`（JSONL over stdin/stdout）驱动，无 Web 技术栈。

## 功能

- **左侧栏**：项目文件夹管理（持久化）+ 每个项目的历史会话列表（从 `~/.pi/agent/sessions/` 自动发现，显示会话名和时间）
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

## API key 与凭据管理

所有 API key 统一存放在 `~/.pi/agent/.env`（0600，原子写入）：模型 key 在 spawn 会话子进程时注入环境（改 key 需重启会话生效），搜索 key 每次搜索热读即时生效；OAuth 凭据永远留在 pi 自己的 `auth.json`（refresh token 轮转）。首次启动自动把 `auth.json` 里的旧 `api_key` 条目迁入 `.env`（备份 `auth.json.pipiui-bak`，`.env` 已有值优先）。设置页 key 输入框不回显、留空即不修改，`.env` 与 `auth.json` 双份残留时给出冲突警告 + 一键清理。终端里直接用 pi TUI 需在 shell rc 里 source 该文件。详见 [`docs/key-management.md`](./docs/key-management.md)。

## 构建运行

**宪章（强制）：每个 AI 任务使用独立 branch + linked worktree；worker 构建
只写自己的工作区，只有 clean integration worktree 可以安装 canonical App。**
详见 [`CONSTITUTION.md`](./CONSTITUTION.md)；agent 入口见
[`AGENTS.md`](./AGENTS.md)。

```bash
./scripts/init-integration-line.sh --base <committed-ref>
swift run                        # Worker 快速调试，仅当前 worktree
./scripts/verify-worker.sh       # Worker 默认: 真实 debug 编译+测试，不打 release
./scripts/verify-worker.sh --package-preview # 显式: test + 本地 release .app
./scripts/integrate-worker.sh --branch ai/codex/<task>
./scripts/promote-green.sh       # full test 后原子推进 green
./make-app.sh                    # Worker: release 本地打包，不安装
./scripts/build-app.sh           # Worker: test + 本地打包，不安装
./scripts/ship-app.sh            # Release main: 唯一 canonical 安装入口
open -a PipiUI                   # 打开最近一次 canonical ship
```

新任务示例（可从 dirty checkout 调用，只要 `--base` 是 committed ref）：

```bash
./scripts/new-ai-worktree.sh \
  --tool codex \
  --work-id settings \
  --topic sidebar \
  --base integration/green
```

该 helper 支持外部 coding 工具：`codex`、`claude`、`cursor`、`kimi`、
`qoder`、`zcode`，并生成 `ai/<tool>/<work-id>-<topic>`。默认在主 checkout
的同级 `pipiui-wt/` 下创建临时目录。工具必须打开返回的新 worktree 根目录，
而不是在共享目录中切分支。Kimi CLI、Qoder 和 ZCode 直接读取根 `AGENTS.md`；
不要为其复制规则或提交本地 permissions。PipiUI Boss 仍是唯一使用 native
lifecycle 的例外。

`verify-worker.sh` 只接受真实 linked worktree 中的 `ai/*` 和
`pipiui/agent-*` worker 分支；primary checkout 即使手动切成该名称也会被拒绝。
它的成功仅表示 worker-local verification passed，不能声称已更新 Launchpad
中的 App。
默认验证只跑 `swift test`/debug；只有明确需要本地可双击预览时才加
`--package-preview`。

`PIPIUI_INSTALL_APP=/absolute/other/PipiUI.app` 可为受控验证覆盖安装位置；
普通 worker 不得使用该变量绕过 `ship-app.sh`。已有 ship lock 必须先调查其
owner 记录，脚本不会自动删除。

### Green / staging 共享迭代主线

`main` 只用于 release；`integration/green` 是最近一次完整测试通过的共享 head，
不应 checkout；`integration/staging` 是唯一串行 merge/test candidate，其 linked
worktree 也是 PipiUI Boss 的项目根目录。首次用显式 committed base 初始化：

```bash
./scripts/init-integration-line.sh --base <committed-ref>
```

外部 worker 从 `integration/green` 创建，在自己的 worktree 真实编译并跑相关
测试。完成后 integration owner 在 clean staging 中一次接收一个：

```bash
./scripts/integrate-worker.sh --branch ai/codex/<work-id>-<topic>
```

它执行 `--no-ff` merge，再调用 `promote-green.sh` 跑完整 `swift test`；只有通过
才用 expected-old 原子推进 green。Merge/test 失败时 staging 保留给 fixer，
green 与 main 不变，且在 staging 恢复并 promote 前拒绝下一个 external worker。

Active divergent task 不强行同步 green。完成的 worktree 退役；下一个任务从最新
green 新建。IDE 只在 idle + clean 时同步。最终由 integration owner 在 helper
之外显式 merge green → main，然后只从 clean main 运行一次 `ship-app.sh`。
这些 helper 与 Boss runtime 都不直接推进 Git `main`。

同一时间 staging 只能有一个 lifecycle owner。Boss child running、auto-merge、
post-merge verify 或 recovery 期间，禁止运行 `integrate-worker.sh` /
`promote-green.sh`；external integrate/promote 运行期间也不得启动或恢复 Boss
wave。`pipiui-integration-line.lock` 只串行 shell helpers，native
`MainRepoSerialQueue` 不使用它，二者不能并发协调。系统不做不可靠的自动探测，
integration owner 必须显式交接 owner。

### PipiUI Boss native lifecycle（优先）

- Boss 主会话应打开在专用、clean 的 `integration/staging` linked worktree；
  active development 不直接使用 shared dirty primary checkout 或 Git `main`。
- Native extension 独占 `.pi/worktrees/*` child 创建/复用、`pipiui/*` 命名、
  attested structured verify、串行 auto-merge、成功移除与失败 worktree
  recovery。auto-merge target 是当前 session project root，不必是 Git `main`。
  每份 implementation brief 的 structured verify 必须包含真实编译和相关测试，
  不能只做 lint/diff；成功移除 worktree 时其 `.build` 也会回收。
- Boss/native workers 不调用 `new-ai-worktree.sh`，也不手工 merge。verified
  runtime auto-merge 明确允许；“worker 不得 merge”只指 leaf worker。
- Merge/verify failure 服从 `BossPrompt.swift` 的 same-agent/fixer recovery；
  BossPrompt/native runtime 与通用外部 IDE 规则冲突时，native lifecycle 优先。
- Boss wave terminal、无 active/recovery agent、post-merge verified 且 staging
  clean 后，由 integration owner 运行 `promote-green.sh`；Boss 不直接
  auto-merge Git `main`。

### 构建开销

Git branch 本身不构建；每个 active linked worktree 各有 `.build/` 与 `build/`。
这能避免产物互踩，但执行命令时会重复编译。每个 worker 做聚焦 debug/test，
不要默认做 release package；build-heavy 验证应限并发或串行，最后只做一次
integration ship。所有代码改动仍须在各自 worktree 真实编译并跑相关测试；
只省掉重复 release `.app` 打包。不要使用共享 SwiftPM scratch path。

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
