# PipiUI 扩展架构规范 v1

**状态:** 设计冻结 / 未实现

本文档冻结 PipiUI 开源后的扩展系统合约。实现须遵守本合约，不得另起平行通道。规则只在其规范节陈述一次，他处仅引用。

---

## Problem Statement

PipiUI 即将开源，但贡献与扩展路径仍是「改核心源码」，不是产品能力。扩展用户装不上、关不掉、也看不到权限；扩展作者无法把「功能 + 界面」当成一个单位交付；项目维护者每加一块表面都要手改宿主。

从使用者视角，痛点是：

1. **贡献者无法在不改核心的情况下加功能。** 斜杠命令是静态数组，工具结果渲染按工具名硬分支，设置页签是写死的 union，右侧 ToolPanel 是枚举。没有贡献点，就没有第三方入口。
2. **加一项设置要动四处。** 宿主 API 方法、后端 case、设置字段、UI 控件各改一遍。没有 JSON Schema，没有泛化读写。扩展用户因此永远等核心发版。
3. **没有通用宿主插件 SDK。** 现有机制都是内部的：HostBackend 的 `withX` decorator 栈、SpawnFeatures、项目 `user-extensions` 的 `-e` 挂载、项目 `.pi/mcp.json`。作者拿不到可依赖的公开面。
4. **没有扩展生命周期。** 无 discovered / loaded / enabled / disabled / unloaded，无按扩展 ID 归集的卸载。用户不能安装、启用、禁用；禁用后界面残渣无处可收。
5. **功能与 UI 不是一个包。** 作者不能把 agent 半（功能）和 app 半（界面/设置）作为同一单位分发。用户也不能按包启用一整条能力。

开源若只交出 Canonical App 而不交出扩展合约，外部贡献只能 PR 进核心，产品会迅速不可维护。扩展用户今天甚至没有「安装一个包」的动作：没有发现、没有启用表、没有权限确认、禁用也无处可点。作者今天也不能把设置、面板、斜杠、工具卡当作一份可卸载的单位——改完核心四处之后，卸不干净。

---

## Solution

对用户而言：一个扩展包 = 一份 pi extension（agent 半，功能）+ 一份 Electron 扩展（app 半，界面/设置），由一份 manifest `pipiui-extension.json` 粘接。安装就是把目录或 npm 包放到三个位置之一；启用/禁用可按 App 或按项目；信任分级；一切只经宿主中介。

- **一包一功能。** 目录或 npm 包同时交付两半。身份是 `id` + `version`。
- **一份 manifest 声明一切。** 入口、设置 schema、UI 贡献点、能力、生命周期、迁移。宿主按声明扫描、校验、注入、挂载。
- **三安装位置。** 内置（Bundled runtime）、App 用户级（App profile `pi-agent`）、项目级（该项目 `.pi/agent`）。扫描顺序：内置 → App → 项目。
- **启用分层。** App 级启用表在 App profile；项目级覆盖只写该项目家。信任从不跨项目播种。
- **分级信任 L0 / L1 / L2。** 声明式默认信任；agent 代码走 pi 子进程 + 该项目 trust；宿主特权默认拒绝。
- **只经宿主中介。** 扩展拿不到完整 `window.pipiHost`；agent 半不直连渲染进程；桥走现有 HostBridge 与 pi RPC，不新开第四条传输。

发现由宿主扫描三位置并入统一 Extension Registry（内存 + 启用持久化）。同 `id` 不比拼文件覆盖：项目只能覆盖启用状态。安装时展示 `capabilities`；运行时一切调用经宿主校验。核心功能走同一可逆 registry（dogfood）。Agent 自扩展（模型在项目 `.pi/agent` 写下双半目录）结构上已被容纳，无需改架构。

---

## User Stories

1. 作为扩展作者，我希望用一个目录同时交付 agent 半与 app 半，以便一次分发就能同时提供功能与界面。
2. 作为扩展作者，我希望包既可以是本地目录也可以是 npm 包，以便按成熟度选择分发形态，且不走被剥离的 `settings.json` `packages` 自动发现。
3. 作为扩展作者，我希望用一份 `pipiui-extension.json` 声明 `id`/`name`/`version`、两半入口、设置、贡献点、能力与迁移，以便宿主无需猜测包结构。
4. 作为扩展作者，我希望 `id` 稳定且形如 `[a-z][a-z0-9-]*`，以便设置前缀、HostEvent 通道与 invoke 路由都由此派生。
5. 作为扩展作者，我希望 agent 半就是标准 pi extension（default export `(pi: ExtensionAPI) => void`），以便复用 tools / events / commands / providers，而不依赖 TUI `ctx.ui`。
6. 作为扩展作者，我希望可以省略 `agent.extension` 做成纯 UI/设置包，也可以省略 app 半做成纯功能包，以便并非每个包都要两半齐全。
7. 作为扩展作者，我希望声明 `agent.skills` 目录，以便 SKILL.md 树走现有 skillloader，而不是另开技能通道。
8. 作为扩展作者，我希望 app 半优先声明式（schema、slot、按工具名匹配），以便没有自定义 UI 时也能交付配置面与文案贡献。
9. 作为扩展作者，我希望需要自定义界面时提供受控组件 `entry`，以便超出声明式能力时仍能画面板与工具卡。
10. 作为扩展作者，我希望声明 `app.ui.panels`（首版 slot 仅 `toolPanel`），以便在右侧工具区增加页签。
11. 作为扩展作者，我希望声明 `app.ui.toolRenderers` 并按工具名精确匹配，以便为指定工具画富卡片。
12. 作为扩展作者，我希望声明 `app.ui.settingsSections`（可无 `entry`），以便设置页出现本包页签，无入口时由 schema 出表单。
13. 作为扩展作者，我希望声明 `app.ui.slashCommands`，以便斜杠命令进入同一 registry；自定义 action 走受控组件或 agent command。
14. 作为扩展作者，我希望声明 `app.ui.themes` 与 `app.ui.statusBar`（首版可空实现），以便贡献 CSS 变量与壳状态条槽，且明确不是 pi TUI theme。
15. 作为扩展作者，我希望未知 panel slot 在加载时进入 error 而不是静默忽略，以便合约违规可诊断。
16. 作为扩展作者，我希望设置键强制 `ext.<id>.*`，以便不与其他扩展或核心设置冲突；宿主拒绝无此前缀的 schema 属性。
17. 作为扩展作者，我希望 `app.settings.scope` 为 `"app"` 或 `"project"`，以便设置落到现有两套家，而不是第三套存储。
18. 作为扩展作者，我希望把密钥字段标 `"format": "secret"`，以便写入 secret vault、永不落盘，list API 只返回存在性。
19. 作为扩展作者，我希望用 `settingsVersion` 与 `migrations[]` 按 `from→to` 顺序演进设置，以便升级不丢用户数据。
20. 作为扩展作者，我希望声明 `capabilities` 后只被注入对应类型化服务，以便未声明的服务从注入对象上消失，而不是面对一袋函数。
21. 作为扩展作者，我希望 agent 半经 `ext.emit` 把事件送到 `channel:"ext.<id>"`，以便告警等实时信息能画在 app 半。
22. 作为扩展作者，我希望 app 半能 `invokeExtension(id, method, params)`（默认可指定 `sessionId`）并收到统一信封，以便按钮点击驱动功能半。
23. 作为扩展作者，我希望 invoke 失败时拿到稳定错误码（含 `timeout`），以便 UI 不会无限等待。
24. 作为扩展作者，我希望工具结果带可选 `details`，过渡期允许 `content` 以 `piui:v1` JSON envelope 开头，以便富渲染不必解析散文。
25. 作为扩展作者，我希望 envelope 无法解析时退回默认工具卡，以便坏输出不撑破 transcript。
26. 作为扩展用户，我希望把包放到三个安装位置之一即可被发现：内置、App 用户级、项目级，以便按「随 Canonical App / 随我这个 App profile / 仅本项目」选择作用域。
27. 作为扩展用户，我希望扫描顺序为内置 → App → 项目，后者可覆盖前者的启用状态但不可静默替换内置文件，以便覆盖语义清晰。
28. 作为扩展用户，我希望同 `id` 时项目启用覆盖 App 覆盖内置默认，以便本项目可以关掉全 App 已开的包。
29. 作为扩展用户，我希望在扩展管理 UI 看到发现结果、生命周期状态与 error 原因，以便知道什么已加载、什么失败。
30. 作为扩展用户，我希望按 App 或按项目启用/禁用扩展，以便同一 Canonical App 下不同项目可以有不同扩展集。
31. 作为扩展用户，我希望禁用后页签、斜杠、renderer、订阅立即整组消失且无残留，以便界面可逆。
32. 作为扩展用户，我希望禁用时正在跑的会话里 agent 半不热卸载，而是随该会话结束，以便当前对话不被打断。
33. 作为扩展用户，我希望启用后已运行会话不热挂 agent 半，下一新会话才 `-e` 挂载，以便生命周期可预期。
34. 作为扩展用户，我希望卸载用户级/项目级包时先 disable 再删目录，以便卸载可逆且 registry 无残留。
35. 作为扩展用户，我希望内置包不能卸载、只能禁用，以便 Bundled runtime 的核心能力不被误删。
36. 作为扩展用户，我希望安装时看到该包声明的能力列表，L1 一次确认，以便我知道它要什么权限。
37. 作为扩展用户，我希望 L0 纯声明式包默认信任，以便 schema/文案/slot 贡献不制造仪式。
38. 作为扩展用户，我希望 L2 宿主特权默认拒绝，以便第三方代码进不了 main 进程。
39. 作为扩展用户，我希望新项目不从 App profile 播种信任或扩展启用表，以便项目隔离不被悄悄打破。
40. 作为扩展用户，我希望密钥永不出现在设置 JSON 里，以便分享项目家时不泄露凭证。
41. 作为扩展用户，我希望设置表单由 schema 自动生成，有 `settingsSections[].entry` 时可与受控段并存，以便不必等作者手写整页设置。
42. 作为扩展用户，我希望迁移失败时扩展进入 `error`、不部分写盘、不自动重试，以便坏升级可回退。
43. 作为扩展用户，我希望运行中改设置经宿主校验后落盘，并向已运行会话推送 `ext.settings_changed`，以便 agent 半只读快照而不自己写盘。
44. 作为项目维护者，我希望核心面板/斜杠/工具卡/设置段走同一可逆 registry，以便 dogfood 证明机制够用，禁止内置旁路。
45. 作为项目维护者，我希望每个 `register*` 返回 disposer 并按扩展 ID 归集，禁用 = 整组 dispose，以便卸载语义只有一条。
46. 作为项目维护者，我希望存量 `user-extensions` 标准化为 registry 生成的 agent 半 `-e` 挂载，以便老项目有迁徙路径、不再扫裸源文件。
47. 作为项目维护者，我希望 Bundled runtime 的内置层（含 built-in skills 与 philosophy layer）可分阶段收成内置包，以便 feature flag 有归宿。
48. 作为项目维护者，我希望包可声明 `mcpServers` 并由宿主合并进现有 user MCP 列表，以便 `.pi/mcp.json` 进入同一包模型。
49. 作为项目维护者，我希望 npm 形态复用现有钉版机制，而不恢复 `settings.json` `packages` 自动加载，以便供应链面可控。
50. 作为项目维护者，我希望 M3 提供 `@pipiui/extension-api` 与 `create-pipiui-extension` 脚手架，以便第三方按合约开工且禁止把完整 host-api 当扩展公共 API。
51. 作为项目维护者，我希望将来接线 pi 原生 `extension_ui_*` 与 `ext.emit` 并存，以便官方 pi UI 钩子与包级自定义事件各走各的、互不替代。
52. 作为 agent 自身，我希望能在可写的项目 `.pi/agent` 写下双半包目录并被扫描发现，以便模型自扩展不改架构。
53. 作为 agent 自身，我希望只有持有 minted `sessionCapability` 且本会话确已挂载该 `extensionId`、且声明了 `bridge.emit` 时才能 `ext.emit`，以便伪造会话发不出事件。
54. 作为扩展用户，我希望 `toolRenderers` 冲突时项目级覆盖 App 级覆盖内置，以便本项目可以换掉默认卡片。
55. 作为扩展用户，我希望空 `capabilities` 数组仅允许 L0 声明式贡献，以便不声明能力的包跑不了代码入口。

---

## Implementation Decisions

下列形状编码合约（本规范允许的内联例外）；实现须按形状校验，不得另起字段名或通道名。

**D1. 双半包，manifest 是唯一粘接处。** 两半分处两个运行时：agent 半在 `pi --mode rpc` 子进程，app 半在渲染进程。共享 `id`、设置命名空间 `ext.<id>.*`、桥通道 `ext.<id>`。包布局合约：

```
<package>/
├── pipiui-extension.json
├── agent/            # pi extension（功能半，L1）
│   ├── index.ts → dist/
│   └── skills/ …     # 可选声明式资产
└── app/              # Electron 扩展（L0 声明式 / L1 受控组件）
    └── panel.tsx → dist/
```

**D2. Manifest 形状。** 字段语义见下表；下列 JSONC 即合约：

```jsonc
{
  "id": "quota",
  "name": "Quota Monitor",
  "version": "1.0.0",
  "agent": {
    "extension": "agent/dist/index.js",
    "skills": ["agent/skills"]
  },
  "app": {
    "settings": {
      "scope": "app",
      "schema": {
        "type": "object",
        "properties": {
          "ext.quota.threshold": { "type": "number", "default": 80, "title": "告警阈值（%）" },
          "ext.quota.apiKey": { "type": "string", "format": "secret", "title": "可选 API Key" }
        }
      }
    },
    "ui": {
      "panels": [{ "slot": "toolPanel", "id": "quota", "title": "用量", "entry": "app/dist/panel.js" }],
      "toolRenderers": [{ "tool": "get_quota", "entry": "app/dist/quota-card.js" }],
      "settingsSections": [{ "id": "quota", "title": "用量监控" }],
      "slashCommands": [{ "name": "quota", "description": "查看当前用量" }],
      "themes": [],
      "statusBar": []
    }
  },
  "capabilities": ["settings.read", "settings.write", "bridge.emit", "invoke.agent", "stream.render"],
  "lifecycle": { "onDisable": "dispose-app-immediate; unmount-agent-on-next-session" },
  "settingsVersion": 1,
  "migrations": []
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 稳定标识；`[a-z][a-z0-9-]*` |
| `name` | string | 是 | 展示名 |
| `version` | string | 是 | semver；L2 升级须重授权 |
| `agent.extension` | path | 否 | 缺省 = 无 agent 半 |
| `agent.skills` | path[] | 否 | 声明式技能目录 |
| `app.settings.scope` | `"app" \| "project"` | 有 settings 时是 | 落到现有两套家 |
| `app.settings.schema` | JSON Schema | 有 settings 时是 | 属性名强制 `ext.<id>.*` |
| `app.ui.panels` | array | 否 | 首版 `slot` 仅 `"toolPanel"` |
| `app.ui.toolRenderers` | array | 否 | 按工具名精确匹配 |
| `app.ui.settingsSections` | array | 否 | 可无 `entry`（纯 schema） |
| `app.ui.slashCommands` | array | 否 | 声明式斜杠 |
| `app.ui.themes` / `app.ui.statusBar` | array | 否 | 首版可空 |
| `capabilities` | string[] | 是 | 安装时展示；按此 inject |
| `lifecycle` | object | 否 | 缺省即 D9 行为 |
| `settingsVersion` | number | 有 settings 时是 | 从 1 起 |
| `migrations` | array | 否 | 按 `from→to` 顺序 |

**D3. Agent 半走现有 `-e` 挂载通道。** 它是标准 pi extension，由 spawn 组装把已启用包的 agent 半加入新会话的 `-e`，与存量 user-extensions 同一通道，由 registry 生成挂载列表而非扫裸文件。不要求桌面去实现 TUI `ctx.ui`；桌面 UI 走 D4。

**D4. 桥 = 现有 HostBridge 上的命名空间通用动作 + 现有 host-api 上的通用 invoke。不新开第四条传输。** 现状三条管道（HostBridge 环回 RPC、pi RPC JSONL、磁盘 Findings/Ledger）保持；只加动作与方法。宿主路由并鉴权：minted `sessionCapability` + 调用方会话确已挂载该 `extensionId` + manifest 已声明对应 capability。禁止环境继承残留 `PIPIUI_*`。

agent → app 动作信封：

```json
{ "schemaVersion": 1, "sessionCapability": "…", "action": "ext.emit",
  "extensionId": "quota", "event": "warning", "payload": { "used": 92 } }
```

通过后转为 HostEvent（`pipi-host:v1` protocol v2）：

```
{ protocolVersion: 2, channel: "ext.quota", event: { type: "warning", payload } }
```

渲染端 `subscribeExt(id, cb)`；禁用时自动 unsubscribe。

app → agent：`invokeExtension(id, method, params, opts?: { sessionId })`，默认活动会话。经 `writeCommand` 写入该会话 pi RPC stdin；agent 半以 `registerCommand`（或约定 invoke handler）响应。

invoke 结果信封与错误码：

```ts
type ExtInvokeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
// code: not_found | disabled | no_session | capability_denied | agent_error | timeout
```

运行中 `updateExtensionSettings` 向已运行会话推送 `ext.settings_changed`。Spawn 时把该扩展设置快照注入 agent 半（env `PIPIUI_EXT_SETTINGS_<ID>` JSON，或 RPC 初始化帧）。agent 半只读，不自行写盘。全桥时序（合约，非实现草图）：

```
  agent 半 (pi child)          HostBridge / 宿主后端           renderer (app 半)
  --------------------         ----------------------         ------------------
  POST /rpc ext.emit    -----> dispatch + auth
                               HostEvent channel:ext.<id> --> subscribeExt(id)
  registerCommand       <----- writeCommand invokeExtension <- invokeExtension()
  ExtInvokeResult       -----> stdin/stdout map             --> { ok, data|error }

  tool_execution_end    -----> StreamEvent.tool_result
                               (+ details | piui:v1)        --> toolRenderer({content,details})

  spawn env snapshot    <----- assemble spawn settings
  ext.settings_changed  <----- updateExtensionSettings      <- settings form
```

**D5. 工具输出富渲染。** Host `StreamEvent.tool_result` 增加可选 `details`（从 pi `tool_execution_end.result` 投影）。接线完成前允许过渡：`content` 以 JSON envelope 开头：

```json
{ "piui:v1": { "kind": "quota", "used": 1200, "limit": 1500 } }
```

`toolRenderers` 收到 `{ content: string, details?: unknown }`。无法解析则退回默认工具卡。冲突：项目级覆盖 App 级覆盖内置。

**D6. 设置 = JSON Schema 驱动，不新开存储族。** 键强制 `ext.<id>.*`。`scope: "app"` 落入 App profile 设置文件的 `extensions[id]` 槽（原子 RMW）；`scope: "project"` 落入 `{project}/.pi/agent/ext-settings/<id>.json`。读写走泛化 `getExtensionSettings(id)` / `updateExtensionSettings(id, patch)`，按 manifest schema 校验；非 schema 属性拒绝。`"format": "secret"` → secret vault，永不写入上述 JSON。加载时若磁盘 `settingsVersion` < manifest，按 `migrations[]` 顺序执行；失败则该扩展进入 `error`，不部分应用。

**D7. UI 贡献点由可逆 registry 支撑。** 贡献点：`panels` / `settingsSections` / `toolRenderers` / `slashCommands` / `themes` / `statusBar`。每个 `register*(extId, contribution)` 返回 disposer，按扩展 ID 归集。**禁用 = 整组 dispose。** 核心功能（Subagents / Plan / Browser / Document / Terminal、内置斜杠、computer_task 卡等）自己走同一机制。app 半三种形态：① 声明式/schema（首选，L0）；② 受控 React 组件，只注入 D8 收窄 API，拿不到完整 `window.pipiHost`；③ 隔离 webview 本规范不实现。

**D8. 扩展 API = 按声明注入的类型化服务，不是一袋函数。** 未声明的服务不存在于注入对象上。运行时调用未授权能力 → `capability_denied`。空 `capabilities` 仅允许 L0。类型包 `@pipiui/extension-api` 在 M3；禁止把完整 host-api 当扩展公共 API。

能力枚举（合约）：

| capability | 注入服务 | 含义 |
|---|---|---|
| `settings.read` | `settings.get()` | 读本扩展 schema 内设置 |
| `settings.write` | `settings.update(patch)` | 写本扩展设置（经宿主校验） |
| `bridge.emit` | （agent 半）`bridge.emit(event, payload)` | 发到 `channel:"ext.<id>"` |
| `invoke.agent` | `invoke(method, params)` | `invokeExtension` 收窄到本 id |
| `stream.render` | 工具卡 props `{ content, details }` | 注册 toolRenderer 的前提 |
| `terminal.read` | 只读终端快照/订阅 | 不授予写入 |
| `notifications` | `notify(title, body)` | 桌面通知；不暴露任意 IPC |

**D9. 生命周期状态机与转换语义。**

```
discovered → loaded → enabled ⇄ disabled → unloaded
                 ↘ error ↙
```

| 状态 | 含义 |
|---|---|
| `discovered` | 三位置扫描到 manifest，未加载代码 |
| `loaded` | manifest 校验通过，贡献点未激活 |
| `enabled` | app 半已 register；后续**新**会话挂载 agent 半 `-e` |
| `disabled` | 整组 dispose；新会话不再挂 `-e` |
| `unloaded` | 包移除或显式卸载；registry 无残留 |
| `error` | 校验/迁移/加载失败；原因可见；不自动重试写盘 |

- 安装/扫描 → `discovered` →（校验）`loaded`。内置包可默认 `enabled`。
- 用户启用 → `enabled`：register app 半；**已运行会话不热挂 agent 半**。
- 用户禁用 → `disabled`：**app 半立即 dispose**；**agent 半随该会话结束**（不向运行中子进程强杀扩展模块）。
- 卸载 → 先 disable，再删包目录（用户级/项目级）。**内置包不可卸载，只能禁用。**

**D10. 三位置、启用持久化与信任不播种。** 扫描顺序：内置 → App → 项目。后者可覆盖前者的**启用状态**，不可静默替换内置文件。位置合约：内置 = Bundled runtime 的 extensions 树（经 runtime install 同步到 runtime root）；App 用户级 = App profile `pi-agent/extensions/<id>`；项目级 = `{project}/.pi/agent/extensions/<id>`。扫描结果合并进统一 Extension Registry。App 级启用表存 App profile。项目级覆盖存该项目 `.pi/agent`（不进会被剥离的 pi `settings.json` 键）。项目级启用决定不从 App profile 复制到新项目——与新项目不播种 `trust.json` 同一 isolation binding。禁止全局 `~/.pi` 扩展家。`PI_CODING_AGENT_DIR` 始终是当前项目 agent 家。App 级扩展不得在 spawn 时改写其他项目家。

**D11. 信任分级；受控组件不是硬安全边界。**

| 级 | 内容 | 默认 |
|---|---|---|
| **L0** | 纯声明式（schema、slash 文案、slot、无 `entry`） | 信任 |
| **L1** | agent 半 TS/JS（pi 子进程） | 安装时展示 capabilities 一次确认；之后服从该项目 `trust.json`。宿主不代写 trust |
| **L2** | 宿主特权（main 模块、decorator、任意 host API、原生驱动） | **默认拒绝**。首版仅官方内置。将来 trusted 安装须显式授权，**每次升级重授权** |

诚实声明：受控组件与渲染进程同 origin，只靠 API 收窄与 code review。隔离强度：agent 子进程（进程边界 + capability token）> 受控组件（API 子集，同渲染进程）> 隔离 webview（未实现）。第三方代码不进 main。

**D12. 将来接线 `extension_ui_*` 作为平行通道，不替换 `ext.emit`。** 协议已定义、宿主实现为零。接通后服务官方 pi UI 钩子（notify/confirm/select/input/widget）；`ext.emit` 仍服务包级自定义事件。

**D13. 存量机制映射。** `user-extensions` → 标准化 agent 半挂载（仍是 `-e`，由 registry 生成）。Bundled runtime 内置层 → 内置包（可分阶段把 feature flag 收进 manifest）。项目 `.pi/mcp.json` → 包可声明 `mcpServers`，由宿主合并进现有 user MCP 列表。managed npm 钉版可复用；不恢复 `settings.json` `packages` 自动加载。

---

## Testing Decisions

**好测试钉外部行为，不钉内部文件布局。** 断言应能从宿主 API、spawn 参数、动作信封上观察，换实现仍绿。典型外部行为：register→dispose 后无残留页签/斜杠/renderer/订阅；enable/disable 转换可从宿主 API 与**新**会话的 `-e` 挂载参数观察（已运行会话不出现热挂/热卸）；桥信封在动作处理缝被接受或拒绝；设置校验按 schema 接受/拒绝，secret 字段不出现在设置 JSON。

**缝（尽可能高、尽可能少）——选定四条：**

1. **HostBridge 动作分发缝。** `ext.emit` 的鉴权与路由：无 `sessionCapability`、会话未挂载该 `extensionId`、未声明 `bridge.emit` → 拒绝；通过则出现 `channel:"ext.<id>"` 的 HostEvent。
2. **registry/disposer 缝。** 生命周期正确性：按 ID 整组 dispose；再 enable 可重新 register；core dogfood 与第三方走同一 API。
3. **设置校验缝。** schema 强制、未知键拒绝、`format: secret` 改道 vault、迁移失败进 `error` 且不写半新数据。
4. **spawn 组装缝。** 已启用扩展只出现在**新**会话的 `-e` 挂载中；disabled / unloaded 不出现；已运行会话的 spawn 参数不因中途 enable 而变。

不在渲染像素、不在 main 进程内部对象图、不在磁盘路径字符串上做一等断言。测试夹具用最小假包（一份合法/非法 manifest + 空 agent/app 入口），经宿主 API 驱动生命周期，而不是去 import 实现模块的私有函数。

四条缝覆盖 D4 鉴权、D7/D9 可逆性、D6 schema/secret/迁移、D3/D9 的「只影响新会话」；其余实现细节不得升格为一等测试。

**对标。** 镜像现有 pi-backend 测试风格（terminal-projection / watchdog / runtime-install：钉宿主可观察的协议与安装结果）以及 renderer 的 store/component 测试（钉 registry 投影到 UI 状态，而非 DOM 细节）。

---

## Out of Scope

下列为冻结的非目标，实现不得借「顺手」做进去：

- **不做 Cordis 式整产品插件树重写。** 保留 `pi --mode rpc` 子进程 + Electron 分层；宿主侧已有 `withX` decorator 组合，不把 main 拆成微内核。
- **不引入 YAML patch / profile 组合系统。** 三安装位置 + 项目级启用覆盖已够。将来最多做纯依赖型「扩展合集包」，不做配置替换语言。
- **第三方代码不进 main 进程；不做进程内假沙箱。** 对「`node:vm` 不是安全边界」保持同等诚实。agent 半的进程级隔离更强，保持。
- **不引入全局 `~/.pi` 任何形式的扩展家目录。**
- **不为扩展单独开第二套设置存储。**
- **不做扩展市场/在线分发。** v1 = 本地目录 + npm 包。
- **不把 agent 半热挂进运行中会话。** 见 D9。

本仓库无 issue tracker；本规范的发布面就是 `docs/` 下本文件，不定义 triage 标签。

实现任务由 Boss 拆成 Brief/Wave，验收以 Attestation 为准。本文件只冻结合约，不代替 Ledger 或 Shared context。

---

## Further Notes

**dsh 对照（只塑造三条决策，规范独立成立）。** deepseek-harness 的双面包校验 → 本规范的双半 + manifest 粘接（D1/D2）；`ctx.effect` → 可逆 registry（D7）；`inject: string[]` → 类型化服务 API（D8）。刻意分歧：进程级隔离强于进程内 fiber；不做 profile/patch 组合（见 Out of Scope）。

**里程碑（地基 / 包加载器 / UI 通道 / 治理）：**

| 里程碑 | 内容（摘要） | 验收（外部行为） | 依赖 |
|---|---|---|---|
| **M1 地基** | 可逆 registry；状态机先服务内置 dogfood；`ext.emit` + 鉴权；泛化设置读写；`details` / `piui:v1` | 禁用 dogfood 模块后贡献点与监听无残留；无 capability 的 `ext.emit` 被拒；schema 校验读写；envelope 能交给试验 renderer | 无 |
| **M2 包加载器** | manifest 落地；三位置扫描；agent 半并入 `-e`；双向桥；设置快照注入 | 项目级放置合法包并启用后，新会话挂上 agent 半、app 半出现面板；`invokeExtension` 往返成功；禁用后新会话不再 `-e` | M1 |
| **M3 UI 通道** | 受控组件；`@pipiui/extension-api`；脚手架；接线 `extension_ui_*` | 脚手架包可在三位置之一加载；受控组件拿不到 `window.pipiHost`；官方 pi 示例的 `ctx.ui.notify` 能在 GUI 弹出 | M2 |
| **M4 治理** | 能力授权 UI；扩展管理页；secret→vault；`settingsVersion` + migrations | 安装 L1 弹出 capability 并一次确认；secret 不出现在 settings JSON；迁移失败进 `error` 且不写半新数据 | M3 |

**北极星。** Agent 自扩展（模型撰写双半包）在结构上已被容纳：包 = 目录，项目 `.pi/agent` 可写，扫描与启用走同一状态机。不需要为「模型当扩展作者」改架构。

Boss/Worker 编排、Brief/Wave/Findings/Shared context 亦不在本扩展合约内——扩展系统服务会话内的功能与 UI，不服务编排运行时。

fast-app / Canonical App 的打包面也不在本合约内：扩展装在运行中的 App profile 与项目家，不装进 Bundled runtime，除非项目维护者把某包收成内置。

**证据锚点（Findings，名称级）。** 本冻结设计的 recon 写在：

- `.pi/findings/agent-7c09c2dd4410f67d.md` — pi runtime 扩展点
- `.pi/findings/agent-dce17ab852a9dc2c.md` — Electron host 架构
- `.pi/findings/agent-1cd59356b4bc83a1.md` — renderer 架构
- `.pi/findings/agent-6f15759788d74993.md` — 设置体系端到端
- `.pi/findings/agent-ba904be5cfad9874.md` — agent↔host 桥探测
- `.pi/findings/agent-c94dc0d28c8a8bfc.md` — deepseek-harness 对照

关键存量机制（只点名、不引代码）：HostBridge 动作表、`pipi-host:v1` protocol v2、`-e` spawn-mount 通道、`extension_ui_*`（已定义、未接线）、Bundled runtime、Canonical App / fast-app 发布面、App profile `pi-agent` 与项目 `.pi/agent` 两套家。
