# 侧栏设置 · 模型设置

日期：2026-07-24

## 问题

侧栏左下（Boss 开关旁）缺少设置入口。用户需要管理「已有 Pi 凭据的模型」：控制底栏模型菜单可见性、删除凭据、以及按 pi TUI `/login` 方式添加（账号登录 / API key）。

## 调研摘要

- Footer：`SidebarView` 的 `.safeAreaInset(edge: .bottom)`，当前仅 Boss Toggle（`.background(.bar)`）。截图中的「已归」实为 List 内「已归档」Section，不是 footer。
- 底栏模型列表：`ChatSession.availableModels` ← RPC `get_available_models`（仅有凭据的模型）；`InputBar.modelMenu` 无二次过滤。
- 凭据权威文件：`~/.pi/agent/auth.json`（`{providerId: {type, …}}`）。`/logout` 按 **provider** 删键。
- PipiUI 无设置页、无 login RPC、无模型可见性偏好。pi TUI 的 `enabledModels` 用于 Ctrl+P，语义不同，本功能不复用。
- `/login`：先选 auth 类型（oauth / api_key）→ 选 provider → OAuth 开浏览器或输入 API key → 写 `auth.json`。RPC 进程改凭据后需重启才能刷新可用模型。

## 方案对比

| 方案 | 做法 | 利 | 弊 |
|------|------|----|----|
| A. 纯 Swift 写 auth + 自建 OAuth | 手写各 provider OAuth | 无 Node 依赖 | 脆弱、难对齐 pi |
| B. 拉起终端跑 `pi` + `/login` | 指导用户在 TUI 操作 | 实现最薄 | UX 差、难测 |
| **C. 推荐：Swift UI + Node 桥接 pi SDK** | 可见性/API key/删除在 Swift；OAuth（及完整 login）走 Resource 内 helper 调 `ModelRuntime.login` | 对齐 `/login`；API key 路径也可走 SDK | 依赖本机 `pi`/npm 包路径 |

## 设计（采用 C）

### 入口

- 侧栏 footer：`[齿轮按钮] …… [Boss toggle]`（齿轮靠左，Boss 靠右或保持现有左对齐并在左侧加齿轮）。
- 点击 → `.sheet`「设置」，首个/主模块为「模型设置」。

### 模型设置列表

- 数据源：与底栏相同——有会话则用其 `availableModels`；否则临时 RPC/`pi` 拉一次「可用模型」。
- 按 provider 分组。每行：勾选（是否出现在底栏菜单）、显示名、删除（删该 **provider** 整份凭据，确认后执行）。
- 勾选默认全部开启；取消勾选立即反映到底栏菜单。

### 可见性持久化

- UserDefaults：`pipiui.hiddenModelIds: [String]`，元素为 `provider/modelId`（与 `ModelInfo.id` 一致）。
- **opt-out**：未出现在列表中的模型默认可见。
- 过滤点：`InputBar.modelMenu`（及 `groupedProviders`）。当前选中模型若被隐藏，菜单仍可显示当前项，但不出现在「可选」列表外的其它隐藏项。

### 删除凭据

- 从 `auth.json` 删除 provider 键（对齐 `/logout`）；不动 env / `models.json`。
- 成功后：重启所有 `openSessions` 的 pi 进程（已有 `AppStore.restartSession`），并刷新设置列表。

### 添加模型（对齐 `/login`）

1. 选认证方式：账号登录（OAuth）/ API key。
2. 选 provider（helper 列出与 pi 相同的可 login providers）。
3. API key：密文输入 → helper `ModelRuntime.login(..., "api_key", …)` 或等价写入。
4. OAuth：helper 跑 `login`；`auth_url` 时 `open` 浏览器；进度回传 Swift sheet。
5. 成功后重启 open sessions，新模型默认可见。

Helper：`Sources/PipiUI/Resources/pi-auth-helper.mjs`，经 `node` 调用本机 `@earendil-works/pi-coding-agent`（相对 `pi` 可执行文件解析）。

### 测试

- 可见性过滤（hidden 集合 → 菜单候选）。
- auth.json 读写/删除（临时文件）。
- 不测真实 OAuth 网络。

### 非目标

- 完整通用「设置」多页（字体/缩放仍走菜单）。
- 同步 pi `enabledModels` / `/scoped-models`。
- 不提交 git（本轮）。

## 默认决策（若需拍板）

1. 可见性用 PipiUI 独立 UserDefaults，不对齐 TUI `enabledModels`。
2. 删除粒度为 provider（与 `/logout` 一致），UI 文案说明会影响该 provider 下所有模型。
3. OAuth/完整 login 走 Node helper，不在 Swift 重写 OAuth。
