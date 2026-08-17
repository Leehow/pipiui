# PipiUI Electron 集成验收清单（integration-acceptance）

依据：`docs/plans/2026-08-10-electron-cross-platform-spec.md` 的 Testing Decisions 与
`docs/plans/2026-08-10-session-lease-protocol.md`。本清单只做验收，不改变产品代码。

状态约定：
- ✅ 已实现 + 自动测试绿（`Electron/` 内 `npm test` 全绿）
- 🔶 部分实现（单侧/结构级就绪，另一侧或端到端待合入）
- ⬜ 待合入（依赖项未合入，当前无法验收）
- 🖐 手动验收项（需真实双 App / 系统环境操作）

> ⚠️ 信息快照（2026-08-10 08:10）：`Electron/` 工作区处于**活跃并行开发中**（git 未跟踪）。
> 观测：08:06 npm test 52/52 全绿；08:06–08:09 期间 `apps/server/src/index.ts` 已落盘远程接线（静态托管 `packages/ui/dist/browser`、`/pair/:pairID`、`/pair/:pairID/claim`、配对链接 CLI 输出），同时 `contract.test.ts` 正被改造（引用尚未落库的 `createContractMockBackend`、`pairing: false`）→ 08:09 npm test 短暂变红（6 failed）。本清单以合入后的稳定绿态为验收基准。

自动项由 `scripts/acceptance-check.sh` 覆盖；人工项在脚本末尾列出勾选占位。

---

## 验收项 1：双 App 同开（Swift + Electron 同时运行互不干扰）

**验收方法**
- 自动（`acceptance-check.sh`）：`build/PipiUI.app` 与 Electron App 产物均存在；双产物时间戳不早于各自源码最新修改（遵守 AGENTS.md 打包验证规则）；Bundle ID 不同。
- 手动：同时启动两个 App → 各自新建/打开同一项目的会话并正常收发消息；各自右栏（终端、subagent 等）独立响应；观察数分钟无崩溃、无抢占同一数据导致的异常；退出其一不影响另一个。

**通过标准**
- 两进程并存期间双方 UI 均流畅响应，无崩溃/卡死；
- 无共享资源冲突（`~/.pi/agent/sessions` 下无损坏 JSONL、无并发写痕迹）；
- `com.leehow.pipiui`（Swift）与 `com.leehow.pipiui-electron`（Electron）可同时注册运行。

**当前预期状态**：🔶 产物已存在（`build/PipiUI.app` 2026-08-10 06:48、`build/pipiui_e.app` 2026-08-10 06:29，均当日构建）；同开实测 🖐 待做。
产物路径保持 `build/PipiUI Electron.app`（`productName`=`PipiUI Electron`，避免覆盖 Swift `PipiUI.app`）；Launchpad/Dock 显示名为 **PipiUI**（`CFBundleDisplayName` / `CFBundleName`）。

---

## 验收项 2：会话双向发现（Electron 创建 → Swift 可见，反向）

**验收方法**
- 自动：`packages/pi-backend` 会话索引/发现逻辑测试（`session-index-memory.test.ts`、`session-manager-semantics.test.ts`、`pi-backend.test.ts`）覆盖从 `~/.pi/agent/sessions` 读取 JSONL、恢复历史、模型/分支元数据。
- 手动（双 App 同开时执行）：
  1. 仅开 Electron：新建会话 A → 退出 Electron → 打开 Swift：左侧列表可见 A（名称、模型、历史可读）；
  2. 反向：仅开 Swift 新建会话 B → 退出 → 打开 Electron：可见 B；
  3. 双方已各自打开时，另一方新建会话，刷新列表可发现（发现为只读操作，不依赖租约）。

**通过标准**
- 双向都能列出对方创建的全部会话，名称/模型/分支/历史与源端一致；
- 历史消息完整可读（同一 JSONL 直读）。

**当前预期状态**：🔶 Electron 侧读取同一 `~/.pi/agent/sessions`（`createPiHostBackend` 默认 `~/.pi/agent/sessions`）已实现且有测试；跨 App 双向 E2E 🖐 待双 App 手动验证（只读发现不依赖租约，可先于项 3 验收）。

---

## 验收项 3：并发写阻止（同一会话同时写被租约阻止）

**验收方法**
- 自动：`packages/pi-backend/test/lease.test.ts`（4 项）——排他授予（两 writer 仅一个可写）、过期租约恢复（模拟 `pipiui-swift` holder 过期后接管）、无/过期/自持租约的 query 语义、force takeover 替换活跃 holder。
- 手动（双 App 同开）：
  1. Swift 端运行会话 X → Electron 端打开同一会话 X：显示只读徽标与"由 pipiui-swift 运行中"，composer 禁用，不可静默启动写进程；
  2. 反向：Electron 持有 → Swift 端进入只读并提示；
  3. 崩溃恢复：强杀持有进程 → 另一方在心跳过期（45s）后能重新获取；
  4. 强制接管：只读侧点"强制接管" → 原持有侧心跳失败并降级为只读。

**通过标准**
- 任何时刻同一会话至多一个活跃 writer；冲突侧只读且提示 holder 名称；
- 崩溃后 45s 内自然恢复可写；强制接管仅经用户显式操作。

**当前预期状态**：🔶 **只完成一半**。Electron 侧 `LeaseManager`（`packages/pi-backend/src/lease.ts`）已实现 + 4 项测试绿（含模拟 Swift holder 的过期恢复场景）；但 **Swift 侧无任何租约实现**（`Sources/` 中无 `LeaseManager`/`.lease.json`/holder 写入逻辑）→ "由 X 运行中"只读体验与反向阻止 ⬜ 待 Swift 侧合入租约协议（按 `session-lease-protocol.md` v1）后才能验。

---

## 验收项 4：Electron 与浏览器渲染同一 UI（同组件/DOM）

**验收方法**
- 自动：
  - 单套 `packages/ui` 双构建目标：electron-vite renderer 与 `vite.browser.config.ts` → `dist/browser`（构建产物结构一致）；
  - 同一 transport 契约测试跑 IPC 与 WSS 两个实现（`packages/host-api/test/contract.test.ts`，双 transport 同套断言）；
  - UI 面板测试共用同一组件（`App.test.tsx`、`SubagentPanel`/`DocumentPanel`/`TerminalPanel`/`BrowserPanel` `.test.tsx`）。
- 手动/待远程：Node host 静态托管 `dist/browser` + 配对链接 → 浏览器打开后 DOM 结构/交互与 Electron 内一致（同组件快照对比）。

**通过标准**
- 同一组件在两种宿主下渲染出的 DOM 结构一致（快照级）；
- IPC 与 WSS 下全部 host API 行为一致（契约测试双绿）；
- 浏览器端按能力裁剪（Browser/Computer Use 等隐藏或占位），布局与桌面一致。

**当前预期状态**：🔶 共享 UI 与双 transport 契约已成立（构建级 + 契约级）；远程 Node host 接线**已于 08-10 08:06 落盘**（`apps/server/src/index.ts`：静态托管 `dist/browser`、`/pair/:pairID` 配对页、`/pair/:pairID/claim`、配对链接 CLI 输出；`relay-pairing.ts` 已被引用），配套契约测试改造进行中（`createContractMockBackend` 未落库导致 npm test 短暂红）→ 合入后复核：浏览器端到端（配对链接 → 浏览器 UI）与 DOM 级快照对比。

---

## 验收项 5：长会话性能（10MB+ JSONL 打开不卡）

**验收方法**
- 自动（结构级证据）：Transcript 使用 `react-virtuoso` 虚拟化（`App.tsx` MessageList，`followOutput`/`atBottomStateChange`），流式 Markdown 用 Streamdown 流模式。
- 手动：构造/复用 ~10MB+ 会话 JSONL（万级消息）→ Electron 打开：初始渲染无明显卡顿（可接受秒级以内）、滚动流畅、回到最新正常；与 Swift 版同会话体验对比；流式输出时 UI 不冻结。

**通过标准**
- 10MB+ 会话初始加载与滚动无明显卡顿（无整表渲染）；长会话下输入/流式输出响应正常。

**当前预期状态**：🔶 虚拟化已实现（结构性就绪）；10MB+ 实测 🖐 待做（无独立 perf 自动化测试，属手动验收项）。

---

## 验收项 6：多 Subagent 场景

**验收方法**
- 自动：`SubagentPanel.test.tsx`（agent 树行选中、运行中/失败状态、时长/双币种费用、abort/resolve/merge/discard 全操作）；`contract.test.ts`（`listAgents`/`checkAgent`/`abortAgent`/`resolveAgent`/`mergeWorktree`/`discardWorktree` + `subscribeAgents`/`subscribeAgentLog` 事件流）。
- 手动（真实 pi）：同一会话排队 2+ subagents → 树列表实时状态/费用、选中 agent 下半区 thinking/工具/结果日志与 diff 流式滚动、abort 运行中 agent、resolve 失败实例、worktree merge/discard 状态展示。

**通过标准**
- 多 agent 并发时面板实时反映状态与日志，无错乱；全部控制操作全链路生效且双端（Swift/Electron）状态一致（同一 pi 事件流）。

**当前预期状态**：✅ 组件层 + 契约层已测绿；真实 pi 多 agent 运行实测 🖐 待手动（需真实模型配置与 subagent 扩展）。

---

## 验收项 7：浅色/深色跟随系统

**验收方法**
- 自动：`App.test.tsx` 已测 `useSystemTheme()`（`prefers-color-scheme` 变化 → `.pipiui-shell[data-theme]` 在 light/dark 间切换）；`TerminalPanel.test.tsx` 已测 xterm 明/暗主题令牌。
- 手动：macOS 系统外观切换（或 `osascript` 触发）→ Electron UI 即时跟随；Terminal 面板配色同步；Swift 版行为一致。

**通过标准**
- 系统外观变化即时反映到 UI（无重启要求）；终端面板主题同步。

**当前预期状态**：✅ 实现 + 测试绿；真机系统切换 🖐 待手动确认。

---

## 验收项 8：右栏四页（Subagents / Document / Terminal / Browser）

**验收方法**
- 自动：四面板均有组件测试（`SubagentPanel`/`DocumentPanel`/`TerminalPanel`/`BrowserPanel` `.test.tsx`）+ `browser-host.test.ts`（Electron main 的 BrowserView 页签管理：新建/切换/关闭/导航/快照/事件）。
- 手动：
  1. 四 tab 逐一打开并交互（文档选择/渲染、终端输入回显、subagent 面板、浏览器加载页面）；
  2. Browser 能力降级：远程/浏览器连接（无桌面浏览器能力）→ 显示"Browser 不可用"占位而非报错；
  3. Plan 页签存在性（spec 右栏含 Plan，UI 已实现 `PanelTab` 含 `Plan`）。

**通过标准**
- 四页签各自核心交互可用；无桌面浏览器能力的连接优雅降级；UI 层不直接接触文件系统/进程权限（preload 沙箱边界）。

**当前预期状态**：🔶 四面板组件 + BrowserTabsHost 已实现且测试绿；Electron 桌面内真实浏览器会话依赖共享 pi 的 browser 能力（`spawn-assembly.ts` 已接 `browser` → `-e webview` 扩展，能力门控 `capabilities().browser`）——真实浏览器会话 ⬜ 待 Browser 扩展合入；远程端降级展示 🖐 待远程 Node host 合入后验证。

---

## 附：双产物时间戳核对（自动，AGENTS.md 规则）

- `build/PipiUI.app/Contents/MacOS/PipiUI` 与 Electron App 二进制 mtime 不早于各自源码最新修改（Swift: `Sources/`；Electron: `Electron/packages|apps` 源码，排除 `node_modules`/`dist`/`out`）。
- 仅当 `build/` 产物与源码时间戳同时新鲜才可宣称"验收就绪"；只有 `.build/*` 新鲜不算。

---

## 已知缺口汇总（合入前必须决策/补齐）

1. **Swift 侧租约缺失**（项 3 反向）：`Sources/` 无租约实现 → "由另一版本运行中"的只读体验与反向写阻止无法验收。Electron 侧已就绪并兼容 `pipiui-swift` holder 名。
2. **远程 Node host 接线已落盘但配套重构未完成**（项 4/8 远程侧）：`apps/server/src/index.ts`（08-10 08:06）已含静态托管/配对页/claim/配对链接输出；`contract.test.ts`（08:09）正改为 `createContractMockBackend` + `pairing:false`，该 mock 未落库 → npm test 短暂红（6 failed）。验收以合入后绿态复核，并补 DOM 级快照对比。
3. **Electron 产物命名**：路径为 `build/PipiUI Electron.app`（`productName` 不改，避免覆盖 Swift）；用户面向名为 **PipiUI**（macOS `CFBundleDisplayName` / `CFBundleName`）。
4. **`Electron/` 整个工作区未提交**（git 未跟踪）：验收前需先合入主仓，否则无法作为可复核基线。
5. **Browser 真实能力**：Browser 面板与 `browser-host.ts` 已就绪，但真实浏览器会话依赖共享 pi 扩展（webview）合入；远程连接下按能力降级。
6. 无独立 perf 自动化（项 5 为手动）；无 Electron E2E（Playwright 等），双 App 同开为手动项。
