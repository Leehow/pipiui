# PipiUI 跨平台 Electron 版 Spec

日期：2026-08-10
状态：待批准执行
关联计划：`pipiui-electron-shared-ui-v2`

## Problem Statement

PipiUI 目前是纯 Swift/SwiftUI 实现，只能跑在 macOS 上。这带来三个问题：

1. **无法跨平台**：Windows/Linux 用户无法使用；也无法以无界面方式部署到服务器。
2. **远程界面是另一套实现**：现有远程链接功能（Relay）维护着独立的 Web 界面，与本地 SwiftUI 界面是两套代码、两套交互，功能持续产生分叉，每加一个特性要做两遍。
3. **前端能力重复造轮子**：流式 Markdown 渲染、长列表滚动性能、diff 展示等在 Swift 侧均为手写实现，耗费大量精力，而 Web 生态有成熟现成的方案。

与此同时，项目近期完成了一次关键重构：MCP、Web 搜索、PDF 提取、GitHub fetch 等能力已从 Swift 代码迁移为第三方 pi 扩展包（`pi-mcp-extension`、`pi-web-access` 等），subagent 调度、philosophy、memory-broker 等自有能力也全部以 pi 扩展（TypeScript）形式存在于 `Sources/PipiUI/PiExt/`，由 pi 进程通过 `-e` 参数加载。这意味着**能力层已经与 Swift 宿主解耦**，跨平台的真实剩余工作量集中在前端 UI 层。

## Solution

新增一个 **Electron + React/TypeScript** 版本的 PipiUI，与现有 Swift 版**长期共存、并行开发**，并满足三条核心需求：

1. **双版本共存**：SwiftUI 版与 Electron 版同时构建、同时打开、同时可用。两边共享 pi 的全部持久化数据（会话、认证、模型配置、skills、扩展），因为核心都是 pi。
2. **一套 UI 双端跑**：同一套 React UI 既跑在 Electron 桌面壳里，也跑在服务器浏览器里。服务端做能力裁剪（隐藏本机专属功能），保证界面与本地一致，最终取代现有的独立远程 Web 界面。
3. **复用优先**：能用现成开源方案的绝不自己造轮子（界面组件、Markdown 解析、diff、虚拟列表、终端、打包工具全部选型现成方案）。

**界面 1:1 复刻当前 PipiUI**：左侧项目/会话列表，中间主聊天区，右侧工具面板——尤其是作为产品特色的 **Subagents 多 Agent 编排面板**（agent 树列表 + 实时详情 + 全套控制操作），必须完整复刻。

## User Stories

1. 作为用户，我希望能同时打开 Swift 版和 Electron 版 PipiUI，以便逐步迁移并随时回退。
2. 作为用户，我希望在 Electron 版里看到我在 Swift 版里的全部会话历史，反之亦然，以便无缝切换。
3. 作为用户，我希望当同一会话在另一版本里正在运行时得到明确提示并只能只读查看，以便不会写坏会话数据。
4. 作为用户，我希望 Electron 版左侧是我熟悉的项目列表和会话列表，以便零学习成本。
5. 作为用户，我希望中间主界面的消息流、Thinking、工具卡片、输入区与 Swift 版一致，以便体验不降级。
6. 作为用户，我希望右侧工具面板包含 Subagents、Terminal、Document、WebView、Plan 等页签，以便保持现有工作流。
7. 作为多 Agent 编排用户，我希望 Subagents 面板上半部分实时显示所有 agent 的树形列表、运行状态、费用，以便掌控全局。
8. 作为多 Agent 编排用户，我希望选中某个 agent 后下半部分实时滚动它的 thinking/工具调用/工具结果日志和 diff，以便追踪它在做什么。
9. 作为多 Agent 编排用户，我希望能 abort 运行中的 agent、resolve 失败实例、查看 worktree merge/discard 状态，以便完整控制编排生命周期。
10. 作为用户，我希望 MCP、Web 搜索、PDF、subagent 等能力在 Electron 版里开箱即用，以便功能不打折。
11. 作为远程用户，我希望通过随机配对链接在浏览器里打开与本地一致的界面，以便在服务器上跑无界面 PipiUI。
12. 作为远程用户，我希望不需要注册账号、邮箱验证或 OTP 就能完成配对，以便保持现有零门槛体验。
13. 作为 Windows/Linux 用户，我希望能安装并使用 PipiUI 的核心聊天与会话功能，以便脱离 macOS。
14. 作为维护者，我希望远程 Web 界面和桌面界面是同一套代码，以便新特性只做一遍。
15. 作为维护者，我希望 Markdown 流式渲染、diff 展示、长列表虚拟化使用成熟开源组件，以便停止维护手写实现。

## Implementation Decisions

### 总体架构

```
packages/ui        ← 唯一一套 React UI（Electron 与浏览器共用）
apps/electron      ← electron-vite；transport = preload/IPC；spawn pi 子进程
apps/server        ← Node host：静态托管同一 React 构建 + WSS；spawn pi 子进程
```

- 传输层抽象：Electron 内走 preload/contextBridge IPC；浏览器走 WebSocket（WSS）。两者实现同一个 `PipiHostAPI` 接口，UI 层不感知差异。
- pi 接入：第一阶段使用 pi 官方 typed `RpcClient`（stdio RPC 模式），保留未来切换同进程 SDK 的缝隙。不手写 JSONL 客户端。
- Electron 分层：main / sandboxed renderer / preload 严格分离，文件系统与进程权限不直接暴露给 React。
- 架构蓝本：craft-agents-oss（Apache-2.0）的"一套 renderer 双端跑 + headless server + WSS"模式；pi 进程边界参考 pi-gui（MIT）。抄模式，不整体 fork。

### 双版本共存

- 产物：`build/PipiUI.app`（Swift，不动）与 `build/PipiUI Electron.app`（新），不同 Bundle ID，可同时打开。
- 只有主 checkout 可以打包这两个 App；worktree 仍只能 `swift build`/`npm build` 验证。
- 共享数据：`~/.pi/agent/sessions`、`~/.pi/agent/settings.json`、认证、skills、prompts、用户扩展。窗口布局等 UI 设置各自保存。
- **会话单写者租约**：同一运行中会话不允许两个独立 pi 进程同时写入。实现跨 Swift/Electron 的租约文件 + 崩溃后过期回收；未持有租约的一侧可发现会话、刷新历史、只读展示，并显示"由另一版本运行中"，禁止静默启动第二个写进程。
- 双向验证：Electron 创建的会话可被 Swift 发现（名称、模型、分支、历史兼容），反之亦然。

### 能力层：零移植

- Electron 侧复刻 `PipiSpawnAssembly` 的 `-e` 参数组装逻辑（含全部 feature 开关），pi 扩展（MCP、pi-web-access、PDF、arxiv-fetch、memory-broker、subagent、philosophy 等）由 pi 进程加载，Electron 版自动继承。
- Computer Use（macOS 原生）暂留 Swift 版；Electron 声明为平台能力，可关闭。Windows/Linux 自动化能力独立排期，不阻塞核心版本。

### 界面复刻（1:1 对齐当前结构）

三栏布局，对应现有 Swift 视图：

| 区域 | Swift 对应 | React 实现要点 |
|---|---|---|
| 左栏：项目/会话列表 | `SidebarView` | 项目分组、会话列表、新建/切换 |
| 中栏：主聊天区 | `ChatDetailView` / `MessageViews` / `InputBar` | 流式 Markdown、Thinking、工具卡片、附件、队列 |
| 右栏：工具面板 | `SubagentPanel` / `TerminalPanel` / `DocumentPanel` / `WebViewPanel` / `PlanStatusView` | 页签切换，按平台能力降级 |

**Subagents 面板（核心特色，完整复刻 `SubagentPanel.swift`）：**
- 上半：agent 树列表——每行实时状态（running/stalled/terminal）、计数与费用徽标、失败处置；新 agent 到达贴底跟随，用户上滚脱离；分页窗口。
- 下半：选中 agent 实时详情——thinking/tool/toolResult 日志行、diff 行（绿色 +/红色 −）；上下分栏可拖拽调比例并持久化。
- 控制面：abort、resolve、手动状态检查、worktree merge/discard 状态展示，全部经 `PipiHostAPI` 订阅同一 pi 扩展事件流，双端状态天然一致。

### 开源选型（已调研定稿）

| 用途 | 选型 | 许可证 | 备注 |
|---|---|---|---|
| 整体架构参考 | craft-agents-oss | Apache-2.0 | 抄双端模式，不 fork 产品 |
| pi 进程边界参考 | pi-gui / openpi | MIT | SessionDriver、生命周期管理 |
| 聊天 UI runtime | assistant-ui（custom runtime / ExternalStore） | MIT | 把 pi RPC 事件映射进 store |
| 流式 Markdown | Streamdown + Shiki | OSS/MIT | 专为不完整 Markdown 流设计；Mermaid/KaTeX 懒加载 |
| Diff 渲染 | @git-diff-view/react 或 react-diff-view | MIT | GitHub 风格 |
| 长列表虚拟化 | react-virtuoso 核心包 | MIT | ⚠️ 禁用其商业 Message List 包 |
| 终端 | xterm.js + node-pty | MIT | 唯一原生依赖，可二期 |
| Electron 工程化 | electron-vite + electron-builder + electron-updater | MIT | 标准组合 |
| 排除项 | opcode/claudia（AGPL + 停更）、Chainlit（Python 栈）、chatbot-ui（整应用非库） | — | 不采用 |

- 复用 Apache/MIT 代码时更新 `ThirdPartyNotices`，不复制商标或产品资源。

### 服务器 / 远程

- Node host 复用现有 Relay 的配对与隧道逻辑，接到统一 `PipiHostAPI`。
- 服务端直接托管同一 React 构建；随机配对链接直达，不新增账号/邮箱/OTP。
- 服务端按 capability 隐藏本机专属能力（访达显示、Computer Use 等）。
- Web UI 达到核心平齐后，退役现有独立远程页面，不再维护两套界面。

### 跨平台构建

- macOS `.app`/DMG、Windows installer、Linux AppImage/deb。
- Windows/Linux CI 编译与测试；node-pty 等原生依赖走 electron-rebuild。
- 平台能力、路径、shell、签名差异化处理。

## Testing Decisions

- 只测外部行为，不测实现细节；优先复用现有测试缝（`Tests/Node/` 的 .mjs 契约测试模式、`Tests/PipiUITests/` 的 harness 模式）。
- 关键验收项（对应集成验收任务）：
  1. Swift App 与 Electron App 同时运行。
  2. 双向发现新旧会话；同一会话并发写被租约可靠阻止。
  3. Electron 与浏览器渲染同一共享 UI（同组件快照/DOM 结构）。
  4. Subagents 面板：多 agent 运行时状态、日志流、abort/resolve 全链路可操作。
  5. 10MB+ 长会话、快速流式输出、多 Subagent 场景无明显性能退化。
  6. 双产物时间戳核对（遵守 AGENTS.md 的打包验证规则）。
- transport 抽象层用同一套契约测试分别跑 IPC 与 WSS 两个实现。

## Out of Scope

- 不替换/下线现有 Swift 版；两版长期共存。
- Computer Use 的跨平台移植（首版仅声明能力可关闭，macOS 自动化继续由 Swift 版提供）。
- 不新增账号体系、邮箱验证、OTP 等任何用户门槛。
- 不整体 fork craft-agents-oss 的产品层（inbox、MCP 产品面等）。
- 不重写 pi 本身；不改 `~/.pi` 数据格式。
- Windows/Linux 的 Computer Use 等价能力（独立排期）。

## Further Notes

- 首个里程碑目标：**双 App 共存 + 共享会话 + Electron 核心聊天可用 + Subagents 面板可用 + 服务器浏览器跑同一 UI**。不是一次性复制全部 Swift 功能。
- 扩展迁移（MCP/Web/PDF 等 → pi 扩展包）已使"能力移植"工作量大幅收窄；Electron 版真实工作量 = 共享 React UI + transport 抽象 + 会话租约 + Electron 壳/打包。
- 执行任务清单见计划 `pipiui-electron-shared-ui-v2`（11 项）。
- 调研来源：craft-agents-oss（github.com/craft-ai-agents/craft-agents-oss，Apache-2.0）、pi-gui（MIT）、openpi（MIT）、assistant-ui、Streamdown、react-virtuoso、electron-vite/electron-builder 官方文档。
