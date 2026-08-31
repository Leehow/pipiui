# PipiUI Workbench / Product Profiles v2 设计

日期：2026-08-31
状态：v2 MVP 与本地 Product Pack 事务已实现；Product Pack 远程分发与最终 App slimming 仍在 M6
范围：Electron PipiUI 的产品壳、Profile/产品包、一级 Workbench 贡献点、Pi spawn 装配、扩展安装与验收

## 0. 一句话决策

PipiUI v2 是一个 **Pi 应用 Workbench**，不是一份固定的 AI Coding 产品。

核心只保留 Electron 生命周期、通用 Pi 会话、扩展/Profile 管理、权限与宿主能力中介、通用工作台布局；Coding、TRPG、电镜等产品形态由 **Product Profile + 一组普通扩展** 组成。

首个迁移版本提供两个真实 Profile：

- `base`（基础版）：通用左栏、Pi 对话、模型/扩展管理与扩展创作技能，不加载 Coding 专有能力；
- `coding`（Coding 优化版）：在基础版上无行为损失地恢复当前 PipiUI Coding 体验与完整 Coding 扩展集。

“模块化完成”不以目录数量判断，而以 **删除测试** 判断：禁用或删除 `coding` 产品包后，Git、Terminal、Subagents、Plan、Worktree、Code Retrieval、外部 Coding 会话和 Coding prompt/skills 的复杂度必须随包消失，不得散落在核心接口或条件分支中。

当前实现落点：

- `base` / `coding` 与 project-local Profile 的发现、迁移、切换和依赖解析；
- Workbench 一级 container/view、header action 和 Profile-filtered auxiliary panel；
- `base` 的 UI + Pi spawn 无 Coding 残留测试；
- Conversation Profile snapshot、错配只读和按当前 Profile 新建会话；
- `coding-runtime` 对 coding tools/Git/reload 的 registry-owned mount；
- 本地 Profile 导入、`create-pipiui-extension --profile` 与 v2 扩展模板。
- 本地 Product Pack：内容寻址 extension object、local receipt、active/previous slot、项目 Profile 激活与失败回滚。

仍未完成的发布面：官方远程 Product Pack catalog/下载事务、把全部 legacy mounts 拆成普通包、以及从基础版发行物中物理移除所有大体积 optional artifact。

## 1. 背景与当前证据

现有 `docs/extension-architecture-v1.md` 已实现以下地基：

- 双半扩展包：Pi agent 半 + Electron app 半；
- manifest、三位置发现、启用/禁用、能力授权、迁移与卸载；
- project/App 两级设置与项目隔离；
- settings、slash command、tool renderer、document renderer、右栏 panel、provider/auth 等贡献点；
- agent 半按新会话 `-e` 挂载，app 半可立即 dispose；
- Web、Browser、CUA、Memory 等能力已有扩展身份。

这套 v1 合约继续有效。v2 不另建平行插件系统，而是扩展同一 manifest、registry、loader 和 capability grant 体系。

但 v1 有意不处理整产品组合，因此当前仍存在以下产品耦合：

1. `Sidebar.tsx` 固定建模为 Project → Session，行状态直接包含 `subagents-running`，底部固定暴露 Computer Use、Remote、Subagent Models。
2. `App.tsx` 同时拥有项目、会话、Git、Subagent、Plan、Browser、Terminal、Computer Use、Composer、模型、扩展与整体布局状态。
3. `builtin-panels.tsx` 虽通过 registry 注册，但统一挂在不可拆的 `pipiui` builtin 下；`PanelRenderContext` 仍直接暴露 worktree、subagent、plan、terminal、projectPath 等 Coding 知识。
4. `spawn-assembly.ts` 用 `SpawnFeatures` / `SpawnPaths` 枚举 philosophy、goal、git、subagent、codingTools、terminal、browser 和各家 server tools。
5. `PipiHostAPI` 与 `PiBackend.handle` 是产品能力总表；新增领域能力经常意味着继续加方法与 `case`。
6. bundled 目录来源会隐式决定默认启用且不可卸载；大体积扩展随 App 一并携带。
7. 当前“添加扩展”主要复制一段提示给 Pi，没有安装计划、依赖解析、Profile 事务或缺包回滚。
8. `themes` / `statusBar` 等 v1 声明只完成了部分传输或 registry，尚未成为完整可见 Workbench surface。

因此当前形态是“能力插件化的 Coding App”，不是“由插件定义产品形态的 Pi Workbench”。

## 2. 目标

### 2.1 产品目标

1. 同一份 Canonical Electron App 可在 `coding`、`trpg`、`microscopy` 等 Profile 间切换。
2. 不同项目可绑定不同 Profile；项目 A 的启用、授权、设置、memory、browser session 和 trust 不影响项目 B。
3. 安装 TRPG 产品包不要求用户理解 npm、MCP、目录结构或基础设施。
4. `base` Profile 是可实际启动、创建会话、管理模型/扩展并创作新扩展的产品，不是开发测试模式。
5. Coding 能力退出后不留下空按钮、隐藏分支、模型提示或 Pi spawn 残留。
6. 非 Coding 产品可替换一级导航、工作区页面、右栏、Composer 附件/动作、消息富渲染和领域状态，而无需修改核心源码。
7. 大体积可选能力按需安装；禁用与卸载是两个清晰动作。

### 2.2 架构目标

1. 只建立确有两个 Adapter 的 seam，不为“也许可换”制造空接口。
2. Workbench、Profile 解析和会话运行时是深 Module：调用者学习少量 Interface 即获得完整行为。
3. 贡献点声明可在不执行扩展代码时被发现；不可见、未使用的 UI 不提前激活。
4. Host 特权继续由宿主中介；第三方 app 半拿不到完整 `window.pipiHost`，第三方 agent 半不进入 Electron main。
5. 现有 v1 扩展可迁移，不要求一次性重写所有扩展。

## 3. 非目标

- 不把 Electron main 拆成微内核或引入 OSGi、独立依赖注入框架。
- 不为每个 React 控件建立贡献点；只插件化会改变产品形态或领域行为的 surface。
- 不让 Profile 使用继承、YAML patch、条件脚本或任意代码修改其他 Profile。
- 不让普通扩展任意写环境变量、拼接 CLI 参数或 import Electron main 模块。
- 不在 v2 首版实现完整 TRPG 或电镜产品；框架验收使用真实 `coding`、`base` 和最小非 Coding fixture。
- 不自动删除用户包。卸载必须是明确动作；Profile 移除只禁用并报告未使用包。
- 不改变“app 半立即卸载、agent 半只影响新会话”的 v1 生命周期语义。
- 不创建全局 `~/.pi` 家目录，不恢复 Pi `settings.json` 的全局 packages 自动加载。

## 4. 术语与领域模型

### 4.1 Kernel

始终存在、不是扩展、不可禁用的最小实现。Kernel 不出现在扩展列表中，也不得伪装成 `builtin extension`。

Kernel 拥有：

- Electron App/window/IPC/WebSocket 生命周期；
- 项目隔离与 App-profile 明确例外；
- 通用 Pi 会话、消息流、队列、模型选择和基础 transcript/composer；
- Extension Runtime；
- Profile Resolver；
- Workbench；
- Host Capability Broker；
- trust、secret、签名、内容寻址 store 与更新事务；
- 错误关闭、可访问性、主题和基础布局。

### 4.2 Extension Package

沿用 v1 的双半包。扩展提供一项或一组内聚能力，可声明依赖、UI contribution、agent entry、settings、权限和 native resource。

扩展包不是 Profile。Provider、Browser、PDF、Code Retrieval、COC Keeper、显微镜 driver UI 都是 Extension Package。

### 4.3 Product Profile

一份纯声明式、可校验的产品装配：选择扩展集合、Workbench 初始布局和项目关联。Profile 不包含可执行代码，不覆盖扩展设置，不修改其他 manifest。

### 4.4 Product Pack

面向用户的安装单位。它包含一个 Product Profile、依赖锁定与所需 Extension Package 的来源/哈希。安装 Product Pack 是事务；运行时仍只看到普通 Profile 和普通扩展。

### 4.5 Workspace

一个产品上下文的通用身份。Coding Adapter 可把它映射为代码目录；TRPG Adapter 可映射为战役；Microscopy Adapter 可映射为仪器项目或采集批次。

每个 Workspace 都必须有一个独立的本地 `projectRoot`，其 Pi 家仍是
`{projectRoot}/.pi/agent`。Coding 可直接使用用户选择的代码目录；没有天然内容目录的
TRPG/仪器 Workspace 由宿主创建或让用户选择一个独立 Workspace 目录，绝不能把整个
Application Support `pi-agent` 当作 project root。

对普通 UI/扩展公开的 WorkspaceRef 只包含语义 `id`、`kind` 和展示信息；`projectRoot`
是宿主记录，只有获得文件/领域 capability 的 Adapter 才能通过收窄服务访问。Kernel
不把“必须是 Git 目录”写入 Workspace Interface。

### 4.6 Conversation

一条 Pi 会话及其历史、队列、模型状态和 extension snapshot。Conversation 可隶属 Workspace，但不规定 Workspace 的领域含义。

### 4.7 Contribution

扩展向 Workbench 或 Conversation 提供的声明式或受控实现。所有 Contribution 必须由 extension id 拥有并可整组 dispose。

### 4.8 Product activation snapshot

新 Conversation 创建时冻结的 `{profileId, extension ids + versions, agent mounts}`。Profile 中途变化不重写运行中 Pi 子进程。

## 5. 核心不变式

1. **来源不等于启用。** `builtin`、`app`、`project` 只描述包来源，不能隐式决定 enabled。
2. **Kernel 不是扩展。** 真正不可禁用的行为直接属于 Kernel；不得通过 `uninstallable:false` 伪装成可管理扩展。
3. **Profile 是纯数据。** 无继承、无脚本、无 patch、无动态表达式。
4. **项目决定产品。** Workspace/Profile 关联与项目级启用覆盖只写当前 `{projectRoot}/.pi/agent`。
5. **共享代码，隔离状态。** 不可变内容寻址包可在 App profile 共享；enablement、settings、trust、memory、browser session 继续项目隔离。
6. **新会话冻结。** agent 半/Profile 变化只影响新 Conversation；运行中会话不热挂/热卸。
7. **UI 可逆。** Profile/扩展禁用后，其 view、menu、command、composer item、renderer、订阅和状态立即整组消失。
8. **无 Coding 旁路。** Kernel 不 import GitBranchMenu、SubagentPanel、PlanPanel、TerminalPanel、Code Retrieval 或 Coding external session 实现。
9. **宿主中介。** 扩展只能使用声明且获授的类型化 capability；缺失服务在注入对象上不存在。
10. **语义 ID。** Profile、Workspace、Contribution、Command 和可由模型跨调用引用的稳定 ID 使用短、唯一、可读 slug。
11. **安装原子性。** Product Pack 的下载、验证、grant 检查和 Profile commit 任一步失败，都不产生半启用产品。
12. **最短用户路径。** 官方 Product Pack 的正常安装不要求账号、邮箱、手工 token 或基础设施知识；只有扩展本身确需外部凭据时才在启用后请求。

## 6. 总体架构

```text
┌───────────────────────────────────────────────────────────────┐
│                        PipiUI Kernel                          │
│                                                               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │Profile Resolver│  │ExtensionRuntime│  │   Workbench    │  │
│  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘  │
│          │                   │                   │           │
│  ┌───────▼────────┐  ┌───────▼────────┐  ┌──────▼─────────┐ │
│  │Pi Conversation │  │CapabilityBroker│  │Package Store   │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
└──────────────────────────────┬────────────────────────────────┘
                               │ resolved contributions/mounts
        ┌──────────────────────┼────────────────────────┐
        ▼                      ▼                        ▼
  Coding Profile          TRPG Profile          Microscopy Profile
  coding-* extensions     coc-* extensions      microscope-* extensions
  shared optional packs   shared optional packs shared optional packs
```

五个外部 seam：

1. `ProfileResolver`：输入安装清单、Profile 与项目覆盖；输出一个完整、确定、可解释的 activation plan。
2. `ExtensionRuntime`：扫描、校验、安装、启用、激活、dispose 和 agent mount snapshot。
3. `Workbench`：消费贡献并渲染一级产品工作台；不理解贡献背后的领域。
4. `PiConversation`：管理 Conversation 生命周期、历史、发送、队列、模型和 stream。
5. `HostCapabilityBroker`：把浏览器、终端、Git、桌面、文件、仪器等宿主资源以类型化 lease 交给已授权扩展。

它们内部可以继续拆分私有实现，但不得把内部状态机逐项暴露给调用者。

## 7. Product Profile 合约

### 7.1 文件名与安装位置

Profile 文件名固定为 `pipiui-profile.json`。

来源：

- bundled recovery profiles：App resources 中只读、小体积定义；
- App-installed profiles：App-profile 内容寻址 store；
- project-local development profile：`{projectRoot}/.pi/agent/profiles/<id>/pipiui-profile.json`。

项目激活状态复用并升级 `{projectRoot}/.pi/agent/ext-enabled.json`，不建立共享全局 enablement：

```json
{
  "schemaVersion": 2,
  "profile": "coding",
  "overrides": {
    "pdf-extension": "enabled",
    "computer-use": "disabled"
  }
}
```

旧的 `{ "extension-id": true|false }` 在首次读时迁移为 `profile:"coding"` + 等价 overrides；写入原子替换，失败保留旧文件。

### 7.2 Profile schema v1

```jsonc
{
  "schemaVersion": 1,
  "id": "coding",
  "name": "AI Coding",
  "description": "PipiUI coding workbench",
  "extensions": {
    "required": [
      { "id": "coding-workbench", "version": "^1.0.0" },
      { "id": "coding-runtime", "version": "^1.0.0" }
    ],
    "recommended": [
      { "id": "code-retrieval", "version": "^1.0.0" },
      { "id": "webview-browser-extension", "version": "^0.1.0" }
    ]
  },
  "layout": {
    "primarySidebar": "coding.sessions",
    "center": "pipi.conversation",
    "auxiliarySidebar": "coding.subagents",
    "activity": ["coding.sessions", "coding.search", "shared.documents"]
  }
}
```

约束：

- Profile id 满足 `[a-z][a-z0-9-]*`；
- `required` 缺失或版本不满足时整个 Profile 不可激活；
- `recommended` 缺失时允许激活，但显示一条可关闭的 degraded 诊断；
- v2 首版不支持 Profile 继承；
- layout 只能引用本次 resolution 中实际存在的 Contribution id；
- Profile 不能携带扩展设置值、secret、trust 决定或环境变量；
- Profile 本身不获得 capability。

### 7.3 Extension dependency schema

现有 `pipiui-extension.json` 增加：

```jsonc
{
  "dependencies": {
    "required": [{ "id": "agent-orchestration", "version": "^1.0.0" }],
    "optional": [{ "id": "web-access-extension", "version": "^0.1.0" }],
    "conflicts": ["legacy-coding-tools"]
  }
}
```

规则：

- required 形成有向图；cycle 是 resolution error；
- optional 不参与激活原子性；
- conflicts 在执行任何代码前检查；
- 同 id 仍只允许一个已解析实例，项目来源不得静默替换内置/已安装代码；
- 版本范围复用现有 Host API semver 子集，不引入第二套范围语法。

### 7.4 Profile resolution

`ProfileResolver.resolve(input)` 是纯函数式深 Module：

```ts
type ProductActivationPlan = {
  profile: { id: string; version?: string }
  enabled: ResolvedExtension[]
  disabled: ResolvedExtension[]
  missingRequired: DependencyIssue[]
  missingRecommended: DependencyIssue[]
  conflicts: DependencyIssue[]
  grantsRequired: CapabilityGrantRequest[]
  layout: ResolvedWorkbenchLayout
  fingerprint: string
}

interface ProfileResolver {
  resolve(input: ProfileResolutionInput): ProductActivationPlan
}
```

Interface 不提供 `enableOne()`、`resolveDependency()`、`mergeOverlay()` 等浅方法；这些都是内部实现。

确定性排序：required 拓扑序 → recommended 拓扑序 → extension id。相同输入必须得到字节一致 fingerprint。

### 7.5 激活事务

```text
read profile + project overrides
    -> resolve dependency graph
    -> calculate missing artifacts
    -> download/copy into staging
    -> verify hash/signature/hostApi/native arch
    -> calculate new capability grants
    -> ask only for genuinely new grants
    -> atomic store slot switch
    -> atomic project activation-state write
    -> apply Workbench contributions
    -> new Conversations use new agent snapshot
```

失败时：

- 不改当前 active Profile；
- 不改 ext-enabled；
- 不部分启用 UI；
- 已下载且校验成功的不可变 object 可留在 cache，但不进入 active slot；
- 错误必须可关闭并给出缺失包/冲突/授权的稳定诊断码。

## 8. Extension Runtime v2

### 8.1 包状态与启用状态分离

```text
artifact: absent -> staged -> installed -> superseded
activation: discovered -> loaded -> enabled <-> disabled -> error
```

`installed` 不等于 `enabled`；`builtin` 不等于 `enabled`；`disabled` 不删除 artifact。

ExtensionDescriptor 增加：

```ts
type ExtensionArtifactState = "absent" | "staged" | "installed" | "superseded"
type ExtensionActivationSource = "profile" | "project-override"
```

Kernel 条目不走 ExtensionDescriptor。原 `pi-ext`、`pi-philosophy`、`pi-goal`、`built-in-skills` 必须在迁移中选择：

- 真正所有产品必需的部分下沉 Kernel；或
- 作为普通扩展进入某个 Profile。

不得继续保持“不可卸载但可见的假扩展”中间态。

### 8.2 声明式发现与按需激活

- 扫描 manifest 不执行 app/agent 代码；
- schema settings、commands、menus、view metadata 可先登记；
- 受控 app entry 在 view 首次可见、command 首次执行或 renderer 首次匹配时加载；
- agent entry 仅在创建/恢复需要启动 Pi 子进程的新 Conversation 时挂载；
- 已安装但当前 Profile 未引用的扩展不加载代码、不创建 browser partition、不启动 sidecar。

### 8.3 禁用与卸载

- disable：立即 dispose app contributions；新 Conversation 不挂 agent 半；运行中子进程保留 snapshot；
- uninstall：先确认没有 active Profile required 依赖，再 disable，最后删除 active slot；
- 删除只允许 App/project extension jail 内精确目录；内容寻址 object 若仍被其他 slot/profile 引用则保留；
- Product Pack 移除默认只解除 Profile 关联，列出 unused artifacts；不自动删除用户文件。

## 9. Workbench Module

### 9.1 Kernel 布局

Kernel 只拥有稳定区域，不拥有领域内容：

```text
┌──────────────┬─────────────────────────┬──────────────────┐
│ primary      │ center                  │ auxiliary        │
│ sidebar      │ views / conversation    │ sidebar          │
├──────────────┴─────────────────────────┴──────────────────┤
│ status bar / transient overlays / dialogs               │
└───────────────────────────────────────────────────────────┘
```

窄屏时仍由 Kernel 负责 overlay、focus、resize、恢复与可访问性。Profile 只选择默认 container，不实现响应式算法。

### 9.2 统一 View Container / View 贡献点

替换首版只允许 `toolPanel` 的单槽接口：

```jsonc
{
  "app": {
    "ui": {
      "viewContainers": [
        {
          "id": "coding.sessions",
          "location": "primarySidebar",
          "title": "项目与会话",
          "icon": "app/assets/folder.svg",
          "order": 10
        }
      ],
      "views": [
        {
          "id": "coding.sessions.tree",
          "container": "coding.sessions",
          "entry": "app/dist/sessions-view.js",
          "activation": "visible"
        }
      ]
    }
  }
}
```

`location` 首版闭集：

- `primarySidebar`
- `center`
- `auxiliarySidebar`
- `statusBar`
- `overlay`

现有 `panels[slot:"toolPanel"]` 兼容映射到 `auxiliarySidebar`，一个版本周期后再移除旧字段。

### 9.3 Workbench Interface

```ts
interface Workbench {
  apply(plan: ResolvedWorkbenchPlan): () => void
  snapshot(): WorkbenchSnapshot
  subscribe(listener: () => void): () => void
  execute(command: CommandInvocation): Promise<CommandResult>
}
```

`apply` 原子替换一整份 resolved plan，并返回 disposer。调用者不逐项 register view、menu、badge；Extension Runtime 在内部把扩展贡献归集成 plan。

现有细粒度 registries 可作为 Workbench 内部 seam 保留，但不继续扩张成 App 的公共知识面。

### 9.4 Commands 与 Menus

新增统一贡献：

```jsonc
{
  "commands": [
    { "id": "coding.session.new", "title": "新建会话", "handler": "app/dist/commands.js#newSession" }
  ],
  "menus": [
    { "location": "workspace.row", "command": "coding.session.new", "when": "workspace.kind == coding" },
    { "location": "conversation.header", "command": "coding.git.switchBranch" }
  ]
}
```

`when` 不是任意 JavaScript，只允许由 Kernel 维护的等值/存在性 context keys；表达式解析失败使该 contribution 进入 error，不影响其他扩展。

### 9.5 Conversation enrichments

基础 transcript、文本 composer、发送/停止、队列、模型选择继续属于通用 PiConversation。

扩展可贡献：

- `conversation.sessionDecorators`：行图标、badge、只读描述；
- `conversation.composerItems`：附件类型、按钮、发送前 gate；
- `conversation.messageRenderers`：领域消息/receipt 富渲染；
- `conversation.messageActions`：复制/重发之外的领域动作；
- `conversation.emptyState`：当前 Workspace kind 的首次使用说明。

每项受控 entry 只拿到对应 props 和声明能力，不拿完整 `PipiHostAPI`。

Composer gate 合并规则：

1. Kernel 校验空输入、lease、队列和基础附件大小；
2. enabled contribution 按 extension id 排序执行纯 `inspect`；
3. 任一 `blocked` 阻止发送并返回一条可关闭错误；
4. 所有 gate 通过后才产生一次 send receipt；
5. gate 不得自行发送、修改 Conversation 或弹出隐式登录。

### 9.6 当前 UI 的迁移归属

| 当前 UI | v2 归属 |
|---|---|
| App/window/layout/resize/theme | Kernel Workbench |
| 基础 Transcript/Composer/Queue/Model picker | Kernel PiConversation |
| Project → Session Sidebar | `coding-workbench` |
| Git branch menu / Git onboarding | `git-capability`（manifest-controlled header contribution） |
| Subagent panel / model modal | `coding-orchestration` |
| worktree disposition 的 Git 操作 | `git-capability` 服务；`agent-orchestration` / `coding-orchestration` 仅请求与呈现结果 |
| Plan panel / approval bar | `plan-extension`（shared optional） |
| Terminal panel | `terminal-extension`（shared optional，coding Profile 默认启用） |
| Browser panel | `webview-browser-extension`（shared optional） |
| Document panel | `document-workbench`（shared optional） |
| Computer Use panel | `cua-extension`（shared optional） |
| 外部 Codex/Claude/Cursor 会话 | `external-coding-sessions` |
| Remote connection | Kernel transport UI 或独立 `remote-access`；不得归 Coding |
| Settings / Extensions / Profiles | Kernel Workbench |

## 10. Workspace 与左侧导航

v2 不把当前 Project type 简单改名后继续固定两层树。

### 10.1 Workspace Interface

```ts
type WorkspaceRef = {
  id: string
  kind: string
  title: string
  icon?: string
  updatedAt?: number
}

interface WorkspaceAdapter {
  list(): Promise<WorkspaceRef[]>
  open(id: string): Promise<WorkspaceContext>
  subscribe(listener: (event: WorkspaceEvent) => void): () => void
}
```

创建、删除、重命名、reveal、Git init 等不是所有 Workspace 的共同 Interface。它们通过 commands/menus 由具体 Adapter 贡献，避免把 Coding 操作做成几十个 optional method。

`WorkspaceAdapter.open()` 返回的 WorkspaceContext 也不直接公开绝对路径；Coding
Adapter 通过获授的 workspace-files capability 得到自己的 root。测试必须证明一个
无路径 UI Adapter 无法从 WorkspaceRef 推断其他项目路径。

### 10.2 两个 Adapter 的证明

- production Adapter：`coding-workspace`，读取用户明确添加的代码目录；
- test Adapter：`campaign-workspace-fixture`，提供“战役 → 场景会话”且没有 rootPath/Git。

Workbench 集成测试必须用两者跑同一 Interface。只有 production Adapter 的行为不得泄漏到共享测试断言。

### 10.3 左侧导航策略

v2 首版允许两种实现：

1. 完整受控 View：Coding 迁移可直接把现有 Sidebar 包进扩展，最快保行为；
2. `treeDataProvider`：新扩展可复用 Kernel 的标准树、搜索、分页、pin 与拖拽 UI。

`treeDataProvider` 是 Workbench 内部可选 Adapter，不是所有扩展必须实现的公共大接口。TRPG 需要角色卡等富 UI 时可使用完整 View。

## 11. Pi Conversation Module

### 11.1 核心职责

PiConversation 隐藏当前分散在 App 与 PiBackend 的会话状态机：

- list/create/resume/rename/archive Conversation；
- history paging 与 selected-session projection；
- lease/takeover；
- send、queue、cut-in、stop、compaction；
- model state；
- stream settlement；
- activation snapshot；
- extension event route。

Workbench 不直接组合几十个 host methods，只消费一个 Conversation Controller snapshot 与 commands。

### 11.2 Interface

```ts
interface PiConversation {
  open(ref: ConversationRef): Promise<ConversationController>
  create(input: CreateConversationInput): Promise<ConversationController>
  list(workspaceId: string, page?: PageRequest): Promise<ConversationPage>
}

interface ConversationController {
  snapshot(): ConversationSnapshot
  dispatch(command: ConversationCommand): Promise<ConversationReceipt>
  subscribe(listener: (event: ConversationEvent) => void): () => void
  close(): Promise<void>
}
```

`ConversationCommand` 是闭合 union，而不是字符串方法袋；每个 receipt 携带稳定结果/错误码。Browser、Git、instrument control 不进入该 union。

### 11.3 Activation snapshot

每条 Conversation header 或 session-owned sidecar 记录：

```json
{
  "schemaVersion": 1,
  "profileId": "coding",
  "profileFingerprint": "sha256:...",
  "extensions": [
    { "id": "coding-runtime", "version": "1.0.0", "contentHash": "sha256:..." }
  ]
}
```

content hash 是机器内部完整性元数据，不要求模型复述。用户看到的是语义 Profile/extension id。

恢复旧 Conversation 时：

- 已安装精确版本优先；
- 只有兼容的新版本时显示 migration diagnostic；
- 缺少 required extension 时只读打开历史，不静默用当前 Profile 替换；
- 当前 Workspace 已切换到另一 Profile 时，旧 Conversation 同样只读，并使用 Kernel
  的通用 transcript/tool fallback；disabled app contributions 不因查看历史而复活；
- 用户明确“用当前 Profile 继续”才派生一条新 Conversation，原历史不改写。

## 12. Pi spawn 装配

### 12.1 目标形态

`SpawnFeatures` / `SpawnPaths` 不再是产品功能枚举。新装配输入只包含 Kernel runtime 与 resolved extension snapshot：

```ts
type PiSpawnPlan = {
  conversation: ConversationLaunch
  kernel: KernelRuntimeMounts
  extensions: ResolvedAgentMount[]
  capabilityLeases: SpawnCapabilityLease[]
  model: ModelLaunchConfig
}

interface PiSpawnAssembler {
  assemble(plan: PiSpawnPlan): SpawnOutput
}
```

`ResolvedAgentMount` 只来自已校验 manifest/store：

```ts
type ResolvedAgentMount = {
  id: string
  version: string
  entry: string
  skillRoots: string[]
  promptLayers: string[]
  settingsSnapshot?: unknown
  secretEnv: Record<string, string>
}
```

扩展不能在 manifest 中直接声明任意 env。`secretEnv` 和 capability token 由 Kernel 根据 settings schema/grant 生成；固定路径、NODE_PATH 与架构 slice 由安装器解析。

### 12.2 Prompt 与 skills

当前 `pi-philosophy` / `built-in-skills` 必须拆分归类：

- `pi-foundation`：所有 Pi 产品共同需要的最小方法层，可进入 Kernel runtime；
- `coding-method`：代码修改、Git、测试、debug、worktree 规则，归 Coding Profile；
- `research-method`、`document-method` 等跨产品能力，作为 shared optional extension；
- TRPG Keeper、电镜安全操作各自由领域扩展贡献 prompt/skills。

Profile 不拼接 prompt；它只启用拥有 prompt layer 的扩展。Prompt 顺序由 manifest 的阶段枚举与 extension id 决定，禁止任意数字优先级互相踩踏：

```text
foundation -> product -> capability -> project -> session
```

同阶段按 extension id 排序；replace 仅允许 extension 明确 patch 自己拥有的 agent/prompt target。

### 12.3 当前 runtime 迁移表

| 当前 mount/feature | v2 归属 |
|---|---|
| secret vault bridge / host protocol | Kernel runtime |
| Pi base RPC/session handling | Kernel runtime |
| codingTools / reload | `coding-runtime` |
| structured Git / repository status+checkout / worktree placement+finalizer+recovery | `git-capability` |
| subagent dispatch core | `agent-orchestration` shared extension；通过 required dependency 请求 `git-capability` worktree 服务 |
| Coding 产品工作台分组 | `coding-orchestration`；不拥有 Git/worktree 实现 |
| plan / goal | shared optional extensions |
| web/browser/CUA/memory | 已有扩展，移除 legacy fallback 后完全 registry-owned |
| provider server tools | provider extensions |
| code retrieval | `code-retrieval`，只在 Coding Profile 推荐/启用 |
| office/pdf/anydoc | document extensions，按 Profile 安装 |
| context optimization | shared optional extension |

每迁移一项，先使 registry-owned Adapter 成为唯一权威，再删除旧 `SpawnFeatures` 分支；禁止长期双路由。其他扩展需要 repository/worktree 能力时必须声明对 `git-capability` 的依赖并请求 provider；不得自行执行 worktree Git 或保留 fallback。

## 13. Host Capability Broker

### 13.1 目的

Native/browser/terminal/Git/instrument 等能力确实需要 Electron main 或宿主资源，但不能因此把每个领域方法继续加进 `PipiHostAPI`。

Broker 拥有授权、lease、路由、审计和生命周期；具体 Adapter 拥有领域实现。

### 13.2 Interface

```ts
interface HostCapabilityBroker {
  describe(extensionId: string): Promise<CapabilityDescriptor[]>
  acquire<T extends CapabilityName>(request: CapabilityRequest<T>): Promise<CapabilityLease<T>>
  revoke(extensionId: string, capability?: CapabilityName): Promise<void>
}
```

对扩展公开的仍是类型化服务：

```ts
type ExtensionServices = {
  browser?: BrowserService
  terminal?: TerminalService
  git?: GitService
  desktop?: DesktopService
  instrument?: InstrumentService
}
```

Extension Runtime 根据 manifest permissions 只注入获授字段；扩展代码不直接调用 `acquire` 泛型逃逸类型约束。

### 13.3 Adapter 分类

| Capability | production Adapter | test Adapter |
|---|---|---|
| browser | Electron WebContentsView | in-memory browser fake |
| terminal | node-pty host | headless framebuffer fake |
| git | local Git executable | temp repository Adapter |
| desktop | CuaDriverHost | deterministic receipt fake |
| instrument | approved microscope gateway | simulator/read-only fake |

Microscopy 写操作必须由 instrument extension 自己定义状态机、许可与 receipt；Kernel 只执行已授权、类型化请求，不猜测设备安全规则。

## 14. Product 组合

### 14.1 `base`

只包含 Kernel 加基础版 Skill Loader。允许：

- 添加/打开 Workspace；
- 通用 Workspace → Conversation 左栏、搜索、置顶、归档与新建会话；
- 创建通用 Pi Conversation；
- 文本对话、模型/provider 管理；
- 安装扩展/Product Pack；
- 基础设置、错误与 Profile 切换；
- 用 `create-pipiui-extension` skill 创建自己的扩展或 Profile 骨架。

禁止出现：Git、Terminal、Subagents、Plan、Worktree、Coding 外部会话、Code Retrieval、Coding onboarding、Coding 专有 prompt/skills。

### 14.2 `coding`

必须无行为损失地恢复当前产品，初始映射：

```text
required:
  coding-workspace
  coding-workbench
  coding-runtime
  coding-orchestration
recommended:
  agent-orchestration
  plan-extension
  goal-extension
  terminal-extension
  web-access-extension
  webview-browser-extension
  code-retrieval
  external-coding-sessions
  document-workbench
```

Provider、Office、PDF、CUA、Memory、Headroom 不因“目前随 App 打包”自动成为 Coding required；按实际核心流程分别归 shared recommended 或用户可选。

### 14.3 `trpg` 目标形态

未来 Product Pack 可贡献：

- Campaign/Scenario/Character Workspace view；
- Keeper/Player Conversation decorators；
- dice、rules、state、handout、map、story director tools/renderers；
- TRPG prompt/skills；
- 可选 Browser、Document、Image Gen、Memory。

不得依赖 Git、Terminal、worktree 或 Coding agents。

### 14.4 `microscopy` 目标形态

未来 Product Pack 可贡献：

- instrument/project/run primary navigation；
- status、stage、acquisition、image viewer center/auxiliary views；
- instrument capability Adapter 与 read/write tools；
- 安全 receipt、实时状态和数据文件 renderer；
- 可选科研搜索、PDF、Office、Memory。

不得因复用 PipiUI 而继承 Coding prompt、Git UI 或 worker worktree。

## 15. 安装与分发

### 15.1 Canonical App 内容

最终 **Kernel core** 只要求：

- Kernel；
- `base` Profile；
- 小体积 recovery metadata/catalog；
- 启动当前 Profile 所必需且无法在线恢复的最小 runtime；
- 当前平台的 Kernel native slice。

Code Retrieval indexer、OfficeCLI、PDF OCR/native engine、额外 provider、TRPG assets、仪器 driver 等大资产不得仅因“官方”永久打进核心包。

为保持当前用户的开箱 Coding 体验，发行流程可把一个签名的 `coding` Product Pack
作为**独立 bootstrap artifact** 随安装器交付并在首次启动导入 store；它仍有普通
receipt/slot、可禁用、可替换，且不得通过 Kernel import 或默认 builtin 旁路激活。
面向 TRPG/电镜的发行物可选择对应 bootstrap pack，而不携带 Coding 大资产。所有发行物
仍生成同一个 Canonical `build/PipiUI.app`，不创建并存的产品 App target。

### 15.2 官方 catalog

v2 首版 catalog 是只读签名 metadata，不要求账户：

```jsonc
{
  "profiles": [{ "id": "coding", "manifestUrl": "https://...", "sha256": "..." }],
  "extensions": [{ "id": "coding-runtime", "version": "1.0.0", "artifactUrl": "https://...", "sha256": "...", "signature": "..." }]
}
```

复用现有 extension update engine 的 HTTPS、hash、signature、bytes、arch、active/previous slot 和 receipt，不另写下载器。

### 15.3 本地开发安装

开发者可选择本地扩展/Profile 目录；宿主将其复制/链接进 project-local development jail，显示 `source:project`。不得让任意外部路径在每次启动时自动执行。

### 15.4 用户流程

安装一个 Product Pack 的默认路径：

```text
选择产品包 -> 查看将安装的能力摘要 -> 一次确认新增权限
-> 下载并校验 -> 设为当前项目 Profile -> 新建/继续会话
```

不要让用户逐个安装十个底层依赖。高级扩展列表仍可单独启用/禁用 recommended 项。

## 16. 存储与隔离

继续遵守 Constitution §6：

| 数据 | 位置 | 共享性 |
|---|---|---|
| immutable extension/profile objects、slots、receipts | App profile | 所有项目共享只读代码 |
| `.env`、`auth.json`、`models.json` | App profile canonical | 明确共享例外 |
| active profile、extension overrides | `{projectRoot}/.pi/agent/ext-enabled.json` | 项目隔离 |
| extension settings | `{projectRoot}/.pi/agent/ext-settings/<id>.json` 或声明的 app scope | 按 schema scope |
| trust/grants | `{projectRoot}/.pi/agent` | 项目隔离，不播种 |
| sessions/memory/resources/browser state | `{projectRoot}/.pi/agent` | 项目隔离 |
| host bookkeeping / package cache | App profile | 仅宿主元数据 |

Profile 安装不得复制其他项目的 trust、settings 或 memory。Profile export 默认只导出 id/version/layout，不导出 secret、授权或本机路径。

## 17. 兼容与迁移

### 17.1 向后兼容

- v1 manifest 不含 dependencies/viewContainers 时继续加载；
- `panels.slot=toolPanel` 映射到 auxiliary sidebar；
- 旧 `ext-enabled.json` 原子迁移；
- 旧 Conversation 无 activation snapshot 时标记 `legacy-coding`，使用兼容 resolver；
- 现有 App profile extensions 不搬家，只补 store receipt/slot metadata；
- 当前项目 isolation 和 trust 决定不得删除或重写。

### 17.2 Strangler 顺序

每个领域迁移采用：

```text
建立新 seam + Adapter
-> current implementation 接入 Adapter
-> 通过旧行为 parity
-> Profile 改为引用 Adapter
-> 删除旧 import/case/feature flag
```

禁止为了“过渡”长期保留两个权威写路径。兼容 Adapter 必须有删除里程碑和测试。

### 17.3 当前默认行为

新项目默认 `base`；旧布尔 enablement table 迁为 `coding` 以保留既有行为。不得发布一个功能缺失的空壳再要求用户手工找回能力。

## 18. 测试策略

测试只钉五条外部 seam，不钉内部文件布局。

### 18.1 Profile Resolver seam

- required/optional/conflict/cycle/版本范围；
- app + project override 优先级；
- 同输入 fingerprint 稳定；
- 缺 required 时零部分激活；
- 旧 enable table 迁移失败不改原文件。

### 18.2 Extension Runtime seam

- installed 与 enabled 分离；
- source 不隐式启用；
- lazy app activation；
- disable 后所有 contribution/subscription 无残留；
- running Conversation 保持旧 agent snapshot，新 Conversation 使用新 snapshot；
- uninstall 引用中包时拒绝并列出依赖者。

### 18.3 Workbench seam

同一测试分别加载 `coding-workspace` 与 `campaign-workspace-fixture`：

- primary/center/auxiliary container 可替换；
- Coding view 不出现在 fixture；
- command/menu context 正确；
- narrow/desktop layout 由 Kernel 一致处理；
- dispose 后 focus、快捷键、badge、status item 无残留。

### 18.4 PiConversation seam

- create/open/history/send/queue/stop/lease；
- activation snapshot 持久化与恢复；
- 缺 extension 的旧会话只读打开；
- 用当前 Profile 继续产生新 Conversation，不改旧历史；
- background events 只投影必要状态。

### 18.5 Capability Broker seam

- 未声明、未授权、已撤销、过期 lease 均 fail closed；
- 每个 production Adapter 有本地 fake；
- project A capability 不可用于 project B；
- disable extension 同步 revoke；
- native/instrument receipt 不被 UI 文案替代。

## 19. 端到端验收

### 19.1 Base Profile gate

在 fresh isolated project home：

1. App 启动并显示通用 Workspace/Conversation 左栏、通用 Pi Conversation 与 Profile/Extension 管理；
2. 可选模型并完成一次文本问答；
3. UI 不出现 Git、Terminal、Subagents、Plan、Worktree、外部 Coding 会话、Code Retrieval；
4. Pi spawn args 不含 codingTools/git/subagent/worktree/code-retrieval/Coding prompt；`skill-loader-extension` 与扩展创作 skill 可用；
5. tool catalog 与 system prompt 中无 Coding 专有能力；
6. App 不启动可选 sidecar/browser partition/native runtime；
7. 禁用/未安装大包不占 active runtime tree。

### 19.2 Coding parity gate

安装/激活 `coding` Product Pack 后：

- 当前项目/会话左栏行为、pin/archive、历史、Git branch、Terminal、Browser、Subagents、Plan、Composer、外部会话均保持；
- 现有 targeted Electron workspace tests 通过；
- 新实现不需要 Kernel import Coding UI；
- 当前可见功能全部由 resolved Profile/Contribution/Capability 解释；
- 不允许“为了 parity”在 App.tsx 写 `if (profile === "coding")`。

### 19.3 Non-Coding proof gate

加载 `campaign-workspace-fixture`：

- 左栏显示“战役 → 场景”，没有 filesystem path/Git；
- center 仍可使用通用 Conversation；
- fixture 贡献一个 dice receipt renderer 与一个 Composer action；
- 禁用 fixture 后四者立即消失，新 Conversation mount 清空；
- Kernel 测试无需修改 Coding Adapter 数据结构。

### 19.4 Package/install gate

- fresh App 不包含 Code Retrieval/OfficeCLI/PDF engine 的大体积 artifact；
- 安装 Coding/Document pack 后 hash/signature/arch/receipt/active slot 全部可验证；
- 下载失败、断电模拟、坏签名、版本冲突均回到旧 active Profile；
- 卸载 unused artifact 只删除精确 store object/slot，不触碰项目数据。

### 19.5 Deletion test gate

CI 增加架构检查：Kernel-owned paths 中禁止出现以下 imports/稳定标识：

```text
GitBranchMenu
SubagentPanel
SubagentModelModal
PlanPanel
retainedWorktreeDisposition
code-retrieval
external-coding-sessions
PIPIUI_CODING_TOOLS_EXT
```

允许项必须位于明确的 compatibility allowlist，并标注删除 milestone；最终 M6 allowlist 为空。

静态 grep 只是辅助。真正 gate 是运行 `base` Profile 后 observable UI、tool catalog、spawn args 与 loaded processes 都无 Coding 残留。

## 20. 实施阶段与文件所有权

### M0 — 冻结合约与基线

交付：

- 本 spec；
- current Coding capability inventory；
- Base/Coding observable acceptance fixtures；
- Kernel-owned / extension-owned path manifest；
- 当前 App、spawn、tool catalog、package-size 基线。

不改用户行为。

### M1 — Profile Resolver（行为不变）

建议新增：

```text
Electron/packages/host-api/src/profile.ts
Electron/packages/pi-backend/src/profile-manifest.ts
Electron/packages/pi-backend/src/profile-resolver.ts
Electron/packages/pi-backend/src/profile-store.ts
Electron/resources/runtime/profiles/base/pipiui-profile.json
Electron/resources/runtime/profiles/coding/pipiui-profile.json
```

当前默认仍 resolve 为 Coding；先证明 plan/fingerprint/迁移/事务，不迁 UI。

### M2 — Workbench Module 与一级贡献点

建议新增：

```text
Electron/packages/ui/src/workbench/Workbench.tsx
Electron/packages/ui/src/workbench/workbench-store.ts
Electron/packages/ui/src/workbench/workbench-plan.ts
Electron/packages/extension-api/src/workbench.ts
```

先让当前布局通过 Workbench plan 渲染，再把 Coding Sidebar/Header 包装为受控扩展 View。共享 facade/barrel 由单一 integrator 修改。

### M3 — Coding UI 产品包

建议新增：

```text
Electron/packages/pipiui-coding-workbench/
  pipiui-extension.json
  app/
  test/
```

迁移 Sidebar、Git、Coding 初始状态、外部 coding sessions、Subagent/Plan 入口。Kernel App 只消费 Workbench/PiConversation snapshot。

### M4 — PiConversation 与 runtime 装配

建议新增/拆分：

```text
Electron/packages/host-api/src/conversation.ts
Electron/packages/pi-backend/src/conversation-runtime.ts
Electron/packages/pi-backend/src/pi-spawn-assembler.ts
Electron/packages/pipiui-coding-runtime/
Electron/packages/pipiui-agent-orchestration/
```

按一项一个权威的顺序删除 `SpawnFeatures` Coding 条目和 App/PiBackend 专有 case。

### M5 — Capability Broker 与 shared extensions

把 browser/terminal/git/desktop/document 适配为 broker-owned typed services；现有 Electron main Host Adapter 可复用，不重写成熟实现。

优先顺序：Git → Terminal → Browser → CUA → instrument fixture。每项必须 production + fake 两个 Adapter。

### M6 — 按需安装与 App slimming

复用 update engine 建 Product Pack 安装事务；把大体积 optional artifact 移出 Canonical App；完成 recovery、rollback、uninstall 与 size budget gate。

### M7 — 非 Coding 开发者体验

更新：

- `create-pipiui-extension` 支持 view container、conversation contribution、dependencies；
- 新增 `create-pipiui-profile` 或同 CLI 的 `--profile` 模式；
- 提供 campaign fixture；
- 文档说明如何创建 TRPG/科研/仪器产品包；
- manifest/profile JSON Schema 与错误诊断。

## 21. 并发实施边界

为避免多 worker 冲突：

- Profile manifest/resolver/store 可独立 lane；
- Workbench store/layout 可独立 lane；
- Coding package 内容迁移可按 Sidebar、Header、Auxiliary views 分 lane，但共享 manifest/facade 只有一个 writer；
- PiConversation 与 spawn assembler 在 Interface 冻结后分 lane；
- Git/Terminal/Browser capability Adapter 可各自分 lane；
- `App.tsx`、`PipiHostAPI` barrel、`PiBackend.handle` 和 extension manifest parser 是 integration-only 热点，同一 wave 单 writer；
- 打包配置只在 M6 且由主 checkout 单 lane 修改。

任何 lane 遇到当前用户/其他 worker 的同路径 dirty work必须停止并报告，不 stash、restore、reset 或吸收。

## 22. 风险与止损

### 22.1 过度插件化

风险：把普通 UI 状态也暴露成贡献点，形成比实现更大的浅 Interface。

止损：只有会随 Product Profile 改变的 surface 才进入 Workbench plan；resize、focus、theme、queue、基础 transcript 留 Kernel。

### 22.2 Profile 与 session snapshot 不一致

风险：UI 已切 Profile，运行中 Pi 仍有旧工具。

止损：Conversation 明示 snapshot；Profile 变化只影响新会话；旧会话显示“使用旧产品快照”并只读打开，不热改子进程，也不为查看历史复活 disabled app contributions。用户选择“用当前 Profile 继续”时派生新 Conversation。

### 22.3 迁移期双权威

风险：旧 feature flag 与新扩展都挂同一工具。

止损：每项迁移有唯一 ownership test；registry package 一旦存在即使 disabled/error，也阻止 legacy fallback 重新注册。

### 22.4 包安装扩大供应链面

风险：Profile 一次拉多个可执行 artifact。

止损：官方 HTTPS + hash + signature + bytes + arch + receipt；本地开发包明确标记；L2/native 升级重新授权；不执行未激活包。

受控 React entry 与宿主 renderer 同 origin，收窄 Interface 是维护/授权契约，不是硬沙箱。
安装 UI 必须诚实展示该信任级别；未知第三方自定义 UI 不得被描述为“已隔离”。需要更强
隔离时另行设计 webview/iframe UI host，不在本 spec 中用 `node:vm` 伪装安全边界。

### 22.5 Spec 变成大重写

风险：长期分支失去可用产品。

止损：M1 行为不变，M2 先适配当前实现，M3 后才移动 Coding UI；每个 milestone 都保持 `coding` Profile 可用并有独立 acceptance。

## 23. 完成定义

只有同时满足以下条件才可称为“可插装的基础版底子”完成：

1. `base` Profile 有完整的通用左栏、模型/扩展管理、扩展创作能力且没有 Coding 残留；
2. `coding` Profile 无行为回退；
3. 最小非 Coding fixture 不改 Kernel 即能替换一级导航并贡献领域 UI/receipt；
4. Coding prompt、skills、tools、worktree、Git、Terminal、Subagents、Plan 的 ownership 可追溯到扩展/Profile；
5. Pi spawn 由 resolved extension snapshot 驱动，不再由 Coding feature enum 驱动；
6. Kernel 不依赖 Coding UI 或 Coding host methods；
7. Profile install/activate/rollback/uninstall 有事务证据；
8. 大体积可选包不随基础版 App 携带；
9. project isolation、trust 不播种、App-profile canonical auth/models 例外全部保持；
10. fresh isolated end-to-end acceptance 保留日志、profile fingerprint、extension snapshot、spawn args、tool catalog、loaded-process 与包体积证据。

## 24. 外部实践对照

本设计只借鉴已验证的形状，不复制其完整平台：

- VS Code Contribution Points：manifest 声明 commands、views/view containers、custom editors、menus、configuration 等一级 workbench surface；对应本 spec 的 Workbench plan。
  - https://code.visualstudio.com/api/references/contribution-points
- VS Code Profiles：Profile 保存扩展集合、设置与 UI 布局；对应本 spec 的 `base` / `coding` 项目关联。
  - https://code.visualstudio.com/docs/configure/profiles
- Eclipse runtime plug-in model：平台 runtime 发现声明式 extension points，未使用插件不必激活；对应本 spec 的 manifest-first discovery 与 lazy app activation。
  - https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/runtime_model.htm

刻意分歧：PipiUI 不引入 OSGi，不允许 Profile 脚本化，不让第三方代码进入 Electron main，并保留 Pi agent 子进程作为更强的执行隔离。

## 25. 与 extension architecture v1 的关系

v2 **继承** v1 的：

- 双半包与 manifest；
- 三位置发现；
- settings/secret/migration；
- L0/L1/L2 信任；
- bridge/invoke；
- reversible registry；
- 新会话 mount 语义；
- project isolation。

v2 **明确取代** v1 的以下非目标：

- “不做整产品插件树”；
- “不引入 Profile 组合系统”；
- “所有官方能力随 Bundled runtime 默认启用”；
- “只需右栏 toolPanel 即足够表达产品 UI”。

取代只发生在本 spec 明确覆盖的范围，v1 其余安全与生命周期条款继续有效。
