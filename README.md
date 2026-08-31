# PipiUI

可组合的 Pi 应用 Workbench，Electron 实现，默认提供可直接使用的基础版与带全套扩展的 Coding 优化版，并可按项目切换为 TRPG、科研或其它产品。支持 macOS 14+ 与 Linux amd64。历史上的 Swift/SwiftUI 原生版已于 2026-08 退役并从仓库移除。

### 下载

- **macOS**：[PipiUI-latest.zip](https://pipi.aichattrpg.com/downloads/PipiUI-latest.zip)
- **Linux**：[PipiUI-linux-latest.deb](https://pipi.aichattrpg.com/downloads/PipiUI-linux-latest.deb)

官网：[https://pipi.aichattrpg.com/](https://pipi.aichattrpg.com/)

### 特性概览

Product Profiles、多会话并行、流式工具卡片、内置浏览器、Subagent 面板 + Boss 模式、远程接管、Computer Use（opt-in）、Memory 扩展。

## Product Profiles / 产品装配

设置 → **产品** 为当前项目选择 Product Profile：

- `base`（基础版，默认）：通用项目/会话左栏、Pi Conversation、模型选择、扩展/Profile 管理与 `create-pipiui-extension` skill；不启用 Coding 专有工具、Git、Subagents、Plan、Terminal 或 Coding prompt；
- `coding`（Coding 优化版）：在基础版上启用完整的项目/会话侧栏、Git、Subagents、Plan、Terminal、Browser 与 Coding runtime；
- 项目本地 Profile：放在 `{projectRoot}/.pi/agent/profiles/<slug>/pipiui-profile.json`，或在产品页选择“导入本地 Profile”。

新项目默认进入基础版；历史布尔扩展表会迁为 Coding 优化版以保留旧行为。Profile 切换只影响新会话。旧会话保留自己的 Profile 指纹并只读打开，避免拿另一套工具/提示继续写同一历史；顶栏“＋”可按当前 Profile 新建会话。扩展页按基础能力、工作流、Coding、文档与知识、自动化与设备、模型与外部服务、开发者分类展示。创建模板：

```bash
cd Electron
npx create-pipiui-extension --profile "TRPG" ./trpg-profile
```

架构与实施契约见 [`docs/superpowers/specs/2026-08-31-pipiui-workbench-profiles-v2-design.md`](./docs/superpowers/specs/2026-08-31-pipiui-workbench-profiles-v2-design.md)。

### 本地 Product Pack

产品页的“安装本地 Product Pack”接收一个明确选择的目录；它先校验全部 manifest，再把扩展写入 App-profile 的内容寻址 store、记录 receipt、切换 active/previous slot，并在当前项目激活 Profile。任何依赖或授权失败都会恢复该项目的 Profile 与全部 slot；不可变对象/receipt 作为审计记录保留。

```text
campaign-starter/
  pipiui-product-pack.json
  profile/pipiui-profile.json
  extensions/campaign-kit/pipiui-extension.json
  extensions/campaign-kit/agent/…
  extensions/campaign-kit/app/…
```

`pipiui-product-pack.json` 只声明组合，不含脚本、设置、secret 或 trust：

```json
{
  "schemaVersion": 1,
  "id": "campaign-starter",
  "name": "Campaign Starter",
  "profile": "profile/pipiui-profile.json",
  "extensions": [
    { "id": "campaign-kit", "path": "extensions/campaign-kit" }
  ]
}
```

本地 Pack 是开发/私有分发入口，会在 receipt 中明确标为 local；带 native artifact 的 Pack 仍必须走后续官方签名、按架构下载的发布路径。远程 catalog 与官方 bootstrap Pack 仍在 M6 后续切片，当前不会静默联网下载或替换现有 Coding 安装。

## 功能概览

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

在裸 Pi 中，安装/启用该 extension 后输入 `/memory` 可请求并打开同一 extension 提供的 Memory Center。业务 API、数据格式及运维说明都在 `Electron/resources/runtime/pi-ext/packages/memory-broker/README.md`。

## Computer Use（macOS 桌面控制，opt-in）

侧栏底部 `desktopcomputer` 按钮打开「Computer Use（桌面控制）」面板，其中的总开关是唯一的产品授权开关（默认关闭）。关闭时不导出桌面能力，工具不存在、没有前缀成本。打开后，内置扩展 `cua-extension`（`Electron/resources/runtime/extensions/cua-extension/`，默认启用）在**主会话**直接注册两个工具：`open_application` 按 bundle id 或应用名钉住精确 App 窗口，`computer` 执行有序动作批（`screenshot/click/type/key/scroll/wait/invoke_menu` 等 13 个动作；整批预校验、首个失败即停、逐动作返回 `outcomes` receipt）。没有 `computer_task`，也没有独立的 Computer Use agent——worker/subagent 拿不到任何桌面能力，桌面工作只发生在主会话。

调用链路：扩展 → loopback Host Capability broker（`native.cua` op + 一次性 token）→ Electron 主进程 `CuaDriverHost` → 内嵌 Rust cua-driver v0.22.0（MCP over stdio）。截图降采样到长边 ≤1568px 交付模型，观察携带 `screenshot: {width, height, scaleX, scaleY}`，模型坐标按交付截图像素空间解释，由宿主做边界检查并映射回 driver 像素；图像字节只保存在进程内存的 3 项 FIFO 中，写进会话历史的只有 opaque marker。驱动以 `--permission-mode unrestricted` embedded 运行，权限闸门在 App 层：macOS Screen Recording/Accessibility TCC（面板内可跳转授权）加目标 PID/窗口绑定、坐标边界、取消与 driver generation 清理等技术校验。不做逐会话、逐应用或逐操作确认。

Anthropic 白名单模型会把 `computer` 替换为官方 typed tool `computer_20251124` 并合并 beta header；其它 provider 使用通用 `actions:[...]` 自定义 schema，不声称支持 OpenAI 原生 `computer_call` 循环。

完整架构、错误语义、TCC 设置和手工验收步骤见 [`docs/computer-use.md`](./docs/computer-use.md)，线路契约见 [`docs/computer-runtime-v1.md`](./docs/computer-runtime-v1.md)。

## Subagent 面板 + Boss 模式

- **Subagent 面板**（工具栏 👥）：pi 通过 `subagent` 工具派出的所有子 agent 实时显示为树，点击每个 agent 看任务、当前动作、流式输出、费用和用时。上报来自 `~/.pi/agent/extensions/subagent/index.ts` 的 Pipi 集成补丁（无环境变量时完全静默，不影响终端使用）。
- **多层 subagent**：子进程通过 `PIPIUI_AGENT_ID/DEPTH` 环境变量继承树身份；`PIPIUI_AGENT_MAX_DEPTH` 默认且硬上限为 2（只能调低），所以整棵 agent 树最多三层。桌面能力是主会话专属：`computer` / `open_application` 对 subagent 不可声明、不可派发，桌面/外部 App 操作由主会话直接执行。
- **Boss 模式**（侧栏 👑 开关，默认开）：新会话注入大组长协议（`--append-system-prompt`）——主 agent 不下基层，全部派工：简单派单兵监工、复杂按独立切片直接扇出、调研按广度扇出 explore；配合失败恢复协议（同方案最多两次、BLOCKED 白名单、验收要新鲜证据）防早停防摆烂。
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

内存密钥库由 AI 通过 `secret_vault_*` 工具管理，不出现在设置或其它用户入口。只存在于当前 App 主进程内存，退出后清除。不使用钥匙串 / Secret Service / 磁盘密文。明文只注入已挂载会话的 Worker 环境。见 [`docs/electron-secret-vault-linux.md`](./docs/electron-secret-vault-linux.md)。

## 构建运行

**宪章（强制）：只有主工作区 `/Users/haoli/leehow/code/pipiui` 能创建 `build/PipiUI.app`；其他 worktree 只能跑 Electron 工作区 build/test，不能打包 App。** 详见 [`CONSTITUTION.md`](./CONSTITUTION.md)；agent 入口见 [`AGENTS.md`](./AGENTS.md)。

打包一律走 `pipiui-electron-build` skill：

```bash
~/.codex/skills/pipiui-electron-build/scripts/pipiui-electron-build fast-app   # host arch，签名，无 DMG/ZIP
~/.codex/skills/pipiui-electron-build/scripts/pipiui-electron-build release    # 双架构 + DMG/ZIP
```

开发调试与验证（不打包）：

```bash
cd Electron
npm run dev       # 开发模式
npm test          # vitest 工作区测试
```

要求：macOS 14+，已安装 pi CLI（在 `~/.npm-global/bin/pi`、`/opt/homebrew/bin` 或 PATH 中可找到）。

## 代码结构

| 目录 | 职责 |
|---|---|
| `Electron/apps/electron` | Electron 主进程/preload：窗口、浏览器宿主、Cua driver、远程控制 |
| `Electron/packages/ui` | React UI：会话、Subagent/文档/终端/浏览器面板 |
| `Electron/packages/pi-backend` | pi 子进程管理、会话租约、spawn 装配、密钥库 |
| `Electron/packages/host-api` | PipiHostAPI v2 协议（桌面与浏览器端共用） |
| `Electron/resources/runtime` | 随包 pi 运行时：pi-ext（subagent/memory-broker 等）、pi-philosophy 与 `extensions/` 内置扩展（cua-extension、web-access、webview-browser、memory） |
| `Relay/` | 远程配对与隧道中继服务 |

## 许可证

Pipi UI 基于 [Apache License 2.0](./LICENSE) 开源。
