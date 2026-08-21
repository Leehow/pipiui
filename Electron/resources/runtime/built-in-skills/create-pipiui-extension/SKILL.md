---
name: create-pipiui-extension
description: 创建或编写 PipiUI 扩展包（双半包 / extension package）。在用户要 创建/编写 PipiUI 扩展、搭 pipiui-extension.json、把 agent/ 功能半与 app/ 界面半粘成一包、或问 L0/L1 怎么写时使用。对冻结合约教写法；不是打包、调研或给核心提 PR。
---

# 编写 PipiUI 扩展包

权威合约：`docs/extension-architecture-v1.md`（下称 spec）。规则只在 spec 陈述一次；此处给作者配方，信封/表/枚举一律见对应 D 节。

## When to Use

在**至少一条**成立时加载：

- 用户要创建 / 编写 PipiUI 扩展、搭 extension package、写 `pipiui-extension.json`、或把功能与界面打成一包。
- 会话里的 agent 要在项目家可写位置自扩展（结构上已被合约容纳）。

不要用：改核心源码、做 L2 宿主特权、打包 Canonical App、调研、或绕过宿主另开通道。功能看起来需要进 main / 完整 `window.pipiHost` → 答案是给核心提 PR，不是扩展 workaround。

## 范式

**一包两半，一份 manifest 粘接。** `id` 共享；设置命名空间 `ext.<id>.*`；桥通道 `ext.<id>`。

| 半 | 目录 | 跑在哪 | 做什么 |
|---|---|---|---|
| agent | `agent/` | `pi --mode rpc` 子进程，经现有 `-e` 挂载 | 功能：tools / commands / events |
| app | `app/` | 渲染进程，经宿主可逆 registry | UI / 设置 |

信任（写作目标，见 spec D11）：

- **L0** 纯声明式（schema、slash 文案、slot、无 `entry`）— 能 L0 就 L0。
- **L1** agent 半代码 — 安装时确认 `capabilities`；之后服从该项目 `trust.json`。
- **L2** 宿主特权 — 第三方禁入。受控组件**不是**硬安全边界（与 renderer 同 origin，只靠 API 收窄）。

隔离红线：项目包装只写本项目 `.pi/agent`；禁止全局 `~/.pi`；启用决定按项目，永不从 App profile 播种。

**状态：** 合约已冻结；宿主按 M1 地基 → M2 包加载器 → M3 UI 通道 / `@pipiui/extension-api` → M4 治理落地（见 spec Further Notes）。本技能按合约教写法；机制未落地时当目标，不当现网能力。

## Procedure

### 1. 搭目录

```
<package>/
├── pipiui-extension.json
├── agent/            # 可省略 = 纯 UI/设置
│   ├── index.ts → dist/
│   └── skills/       # 可选；走现有 skillloader
└── app/              # 可省略 = 纯功能
    └── panel.tsx → dist/
```

`id` 稳定，形如 `[a-z][a-z0-9-]*`。布局合约见 spec D1。

### 2. 写 manifest

先最小骨架（`id` / `name` / `version` / `capabilities`），再按功能加字段。字段表见 spec D2。硬规则：

- 设置键**必须** `ext.<id>.*`；宿主拒绝无此前缀的 schema 属性。
- `"format": "secret"` → secret vault，**永不落盘**（list API 只返回存在性；落地在 M4）。
- `capabilities` 只声明代码**实际会调用**的最小集；安装时展示；空数组仅允许 L0（spec D8）。
- `ui.panels[].slot` v1 **仅** `"toolPanel"`。未知 slot = 加载 `error`，不是静默 no-op。
- 可省略 `agent.extension` 或整个 app 半；不要为「看起来完整」填空入口。

### 3. 写 agent 半

标准 pi extension：`export default function (pi: ExtensionAPI): void`。注册 tools / commands / events。不要依赖 TUI `ctx.ui`。

- agent → app：命名空间动作 `ext.emit`，信封见 **spec D4**。须声明 `bridge.emit`，且本会话已挂载该 `extensionId`、持有 minted `sessionCapability`。
- app → agent：宿主 `invokeExtension(id, method, params)`；用 `registerCommand` 响应，结果信封 `ExtInvokeResult` = `{ ok: true, data } | { ok: false, error: { code, message } }`，错误码见 **spec D4**（`not_found | disabled | no_session | capability_denied | agent_error | timeout`）。
- 设置只读：spawn 注入快照（或 `ext.settings_changed`）；**禁止** agent 半自己写盘。

### 4. 写 app 半（声明式优先）

按需声明，能 schema 就不要写组件（spec D7）：

1. **设置 JSON Schema** — 自动出表单；`settingsSections` 可无 `entry`。
2. **slashCommands** — 进同一 registry。
3. **toolRenderers** — 按工具名精确匹配；收到 `{ content, details? }`。过渡期 `content` 可以 `piui:v1` JSON envelope 开头（**spec D5**）；**解析不了 → 退回默认工具卡**。
4. **受控 React 组件** — 仅当声明式表达不了。只拿收窄扩展 API，**永远不要** `window.pipiHost`。`@pipiui/extension-api` 在 M3 才提供。

`themes` / `statusBar` 首版可空。隔离 webview 本规范不实现。

### 5. 设置：scope 与迁移

有 settings 时必填 `app.settings.scope` 与 `settingsVersion`（从 1 起）：

- `"app"` — 共享，落入 App profile `extensions[id]` 槽。
- `"project"` — 每项目，落入 `{project}/.pi/agent/ext-settings/<id>.json`。

**不要**另开第三套存储。`migrations[]` 按 `from→to` 从第一天就规划；失败则扩展进 `error`、不部分写盘（spec D6；落地在 M4）。

### 6. 开发循环

1. 把包装进 **项目级** `{project}/.pi/agent/extensions/<id>`（开发默认位置；三位置扫描见 spec D10）。
2. 启用。**已运行会话不热挂 agent 半** — 必须开**新会话**才 `-e` 挂载（spec D9）。
3. 迭代。每次改 agent 半同样要新会话。
4. 禁用必须零残留：每个 `register*` 返回 disposer，按扩展 ID 归集；禁用 = 整组 dispose。

禁止写入全局 `~/.pi`。`PI_CODING_AGENT_DIR` 始终是当前项目 agent 家。

### 7. 对照验收（目标行为，M2+）

见下一节 Verification；与 spec Testing Decisions 四条缝 + Further Notes M2 验收对齐。

## 模板与契约形状

最小 manifest：

```json
{
  "id": "my-ext",
  "name": "My Ext",
  "version": "1.0.0",
  "capabilities": []
}
```

按需追加（完整字段与示例见 spec D2）：`agent.extension` / `agent.skills`；`app.settings.{scope,schema}`；`app.ui.{panels,toolRenderers,settingsSections,slashCommands}`；非空时的 `settingsVersion` / `migrations`。`capabilities` 枚举见 spec D8：`settings.read` | `settings.write` | `bridge.emit` | `invoke.agent` | `stream.render` | `terminal.read` | `notifications`。

Agent 入口：

```ts
export default function (pi: ExtensionAPI): void {
  // pi.registerTool / registerCommand / events
  // ext.emit 动作信封 → spec D4（勿自造第四条传输）
}
```

App 工具卡：`(props: { content: string; details?: unknown }) => …`；envelope 见 spec D5。受控组件只接受按 `capabilities` 注入的服务对象，未声明的键不存在；运行时越权 → `capability_denied`。

## Pitfalls

- **无热挂。** enable 不影响已运行会话；disable 不从运行中子进程强卸 agent 半（随该会话结束）。
- **无第二套设置。** 不要自己写 JSON/env 当配置源；secret 不得出现在设置文件里。
- **不绕桥。** 禁止 agent 子进程与 renderer 直连；只经 `ext.emit` / `invokeExtension`（spec D4）。
- **工具卡必须降级。** envelope 解析失败 → 默认卡，不要撑破 transcript。
- **未知 panel slot = 加载错误**，不是静默忽略。
- **空 `capabilities` 跑不了代码入口**（不能既空又挂 `agent.extension` / 受控 `entry`）。
- **同 `id` 不覆盖内置文件**；项目只能覆盖启用状态。
- 不要把完整 host-api 当扩展公共 API；不要恢复 `settings.json` `packages` 自动发现。

## Verification

对照 spec Testing Decisions 与 D9，用最小假包经宿主 API 观察（不要钉内部路径）：

- [ ] manifest 校验通过 → `discovered` → `loaded`。
- [ ] 启用 → app 半 register；**新**会话 spawn 参数出现该包 `-e`。
- [ ] 声明的 panel / slash / toolRenderer 出现。
- [ ] `invokeExtension` 往返得到 `ExtInvokeResult`。
- [ ] 未声明 `bridge.emit` 的 `ext.emit` 被拒，码为 `capability_denied`。
- [ ] 禁用 → 页签/斜杠/renderer/订阅立即整组消失；**新**会话不再挂 `-e`；registry 无残留。

权威合约始终是 `docs/extension-architecture-v1.md`。
