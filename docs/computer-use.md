# PipiUI Computer Use

Runtime 线路契约见 [`computer-runtime-v1.md`](./computer-runtime-v1.md)；扩展侧
模型 schema、坐标契约与 marker 管线见
[`Electron/resources/runtime/extensions/cua-extension/README.md`](../Electron/resources/runtime/extensions/cua-extension/README.md)。

状态（2026-08-29）：桌面自动化的唯一入口是内置扩展 `cua-extension`
（`Electron/resources/runtime/extensions/cua-extension/`，默认启用，不可卸载），
由设置里的 Computer Use 总开关控制（侧栏底部 `desktopcomputer` 按钮打开
「Computer Use（桌面控制）」面板）。它在**主会话**注册且只注册两个工具：
`open_application`（按 bundle identifier 或应用名钉住精确 App 窗口）和
`computer`（有序动作批）。`computer_task`、`computer-agent` 包
（Leader/Operator/Verifier/worker）、旧 `computer_*` 桥路由与 worker 桌面授权
已全部删除；worker/subagent 没有任何桌面能力——`computer`/`open_application`
是主会话专属保留工具，agent frontmatter 声明即被拒绝，桌面工作只发生在主会话。
真实打包 Electron App 的 TCC 归属和 GUI 任务仍须在主 checkout 手工验收，不能由
worktree 的 Node/TypeScript 测试代替。

## 架构

```text
cua-extension（主 Pi 会话进程内）
  -> loopback bridge `host_capability` action
     （Host Capability API broker：`native.cua` op + 一次性 capability token；
     desktop-grant `computerCapability` 随每个请求的 params 传递）
  -> CuaDriverHost（Electron 主进程，apps/electron/src/main/cua-driver-host.ts）
  -> Rust cua-driver v0.23.2（embedded daemon + stdio MCP proxy）
```

扩展每次调用先经 loopback `host_capability_token` op 让宿主铸一枚一次性 token，
broker 在分发前依次校验 hostApi 版本范围、manifest 声明权限（`native.exec`）、
项目授权与 desktop grant，然后消费 token 才把 `params` 原样交给
`CuaDriverHost.handle`。driver wire action 不变：
`computer_runtime_capabilities` / `computer_open_application` /
`computer_batch` / `computer_cancel`。

宿主在同一主进程内启动两个子进程（不经过 Launch Services）：

- daemon：`cua-driver serve --embedded --parent-liveness-stdio
  --no-permissions-gate --socket <私有 /tmp socket> --host-bundle-id
  com.leehow.pipiui-electron --permission-mode unrestricted
  --dangerously-bypass-approvals`
- MCP proxy：`cua-driver mcp --embedded --socket <同一 socket>
  --host-bundle-id com.leehow.pipiui-electron`，stdio JSON-RPC，MCP
  initialize 固定 `2025-06-18`

TCC/Accessibility 权限、driver 生命周期、精确 pid/window 绑定、截图管线与清理
都留在 Electron 宿主；扩展不直接启动或调用 helper。

## 模型路由优先级

Computer Use 是混合桌面能力包，不等于所有任务都从截图中找坐标。模型侧工具说明
固定采用以下顺序：

1. **确定性应用生命周期优先**：启动或激活目标 App 使用 `open_application`；它只
   接受 bundle identifier 或 application name，不接受 path/URL。运行状态检查和
   优雅退出继续优先使用已有 shell/macOS lifecycle 命令，默认不 force quit /
   `kill -9`。
2. **Accessibility/AX 或应用内快捷键其次**：窗口已选定后，只要最新 snapshot
   提供 `element_index` / `element_token`，就优先使用 AX element action。
   Finder 目录导航推荐先固定 Finder，再发送 `Cmd-Shift-G`、输入精确绝对路径并
   按 Enter。
3. **截图坐标最后**：只有生命周期命令和 AX 都不能完成目标时，才回退到截图像素
   坐标。

这只是给模型的路由纪律；目录/文件导航留在已经固定的目标窗口内完成。扩展会拒绝
直接、wrapper 或嵌套 shell 中的 `/usr/bin/open` / `open`，并引导模型先调用
`open_application`，再使用 `computer` AX/快捷键。Web URL 优先使用现有 browser
工具。

普通 Web 任务仍优先使用 browser 工具。若用户明确要求操作 Chrome、Safari 等外部
浏览器 App，则先用 `open_application` 固定该浏览器，把完整 percent-encoded URL
通过 `printf '%s' '<URL>' | pbcopy` 放入剪贴板，再在固定窗口上用一个
`computer` batch 顺序执行 `CMD+L → CMD+V → RETURN → wait`。不要用
AppleScript/`osascript` 或 shell `open` 做外部浏览器导航，避免 AppleEvents TCC
提示或无响应。

## 动作集与批次语义

支持的动作恰好是：`screenshot`、`wait`、`click`、`left_click`、`right_click`、
`middle_click`、`double_click`、`triple_click`、`type`、`key`、`keypress`、
`scroll`、`invoke_menu`。`invoke_menu` 用 `path` 传无点菜单路径（如
`File > Save As…`），宿主原样转发给 driver。每批最多 64 个动作；`wait` 的
duration 上限 10 秒，`scroll_amount` 1–50。扩展 `tool_call` 钩子与宿主
`SUPPORTED_COMPUTER_ACTIONS` 保持同一集合。

- **整批预校验**：批内出现支持集之外的动作时以 `unsupported_action`
  （retryable:false）整体拒绝，任何动作都不执行，message 列出支持的类型。
- **逐动作 receipt**：`computer_batch` 返回 `outcomes[]`，逐动作给出
  `ok | failed | not_executed`；首个失败即停批，尾部全部 `not_executed`。
- **批中断**：动作落定后发现可操作上下文或 AX snapshot 已变化时，返回
  `ok:true, batchOK:false, batchInterrupted:true`，
  `interruptionReason` 为 `actionable_context_changed` 或 `snapshot_changed`，
  并带 `requiresReplan:true`——先重新观察再规划，不要续跑旧计划。
- **未知后果**：mutation 发出后 driver 超时/失败时，宿主观察一次并返回
  `mutation_outcome_unknown` + `outcomeUnknown:true`，尾部不再执行；禁止盲重放。
- 绑定旧 snapshot 的 element 动作以 `stale_snapshot`（retryable:true）拒绝：
  重新观察、重新定位，不要复用旧 token/坐标。

## 目标与坐标

`open_application` 接受 `bundle_identifier` 或 `application_name`。driver
`launch_app` 返回 PID 后，宿主执行 `bring_to_front` 并原子保存该会话的精确
target（pid + 固定 window id）；后续 batch 不使用「当前前台 App」选择目标，主
会话窗口成为前台也不会抢走 target。已有 root target 的会话收到未经证实的别名
替换时返回 `target_handoff_untrusted`；钉住窗口后再发 App 切换快捷键
（Cmd-Tab）同样以该码拒绝。primary window 消失（同 PID 仍有其他窗口）时清
target，要求重新 `open_application`，绝不把旧坐标/AX snapshot 漂移到 sibling
window。

截图经 Electron `nativeImage` 管线（`apps/electron/src/main/index.ts`）降采样到
长边 ≤1568px 再交付模型；每次观察带顶层
`screenshot: { width, height, scaleX, scaleY }`——交付图像的像素尺寸和回到
driver 像素的缩放。**模型坐标按交付截图像素空间解释**：宿主做边界检查（越界即
`coordinate_out_of_bounds`，retryable:true，message 含有效像素范围），再按
最新 scale 映射回 driver 像素。模型不要自行 rescale。

每次观察的 AX 抓取固定 `max_elements: 2000`、`max_depth: 25`。扩展在写入模型
上下文前再做一次 `compactAccessibility`：可交互控件优先、保留
window/sheet/dialog/drawer 结构脊，上限 48 个元素
（`MAX_ACCESSIBILITY_ELEMENTS_IN_CONTEXT`），`elementCount` 始终反映裁剪前
真实总数。

## 上下文卫生

toolResult 只把 opaque `[PIPIUI_COMPUTER_SCREENSHOT:id]` marker 写进 agent
state/session JSONL（图像字节不落盘）；扩展的 provider-context 钩子做
prune+inject：带 marker 的消息，其 inline image 被重建为「该 marker ID 仍在
3 项内存 FIFO（`MAX_IN_MEMORY_SCREENSHOTS = 3`，对齐 Anthropic 官方默认）中」
的那些图像——被淘汰的截图从 provider 上下文剔除，不再无限累积；不带 marker 的
消息原样放行，其它工具的图像不受影响。

## Provider 适配

Anthropic `anthropic-messages` 且命中白名单（claude-sonnet-5、claude-opus-4-8/
4-7/4-6、claude-sonnet-4-6、claude-opus-4-5 前缀）时，扩展在 provider 请求边界
把 `computer` 替换为官方 typed tool `computer_20251124` 并合并
`anthropic-beta: computer-use-2025-11-24` header；typed tool 仍可能发出支持集
之外的动作（如 `mouse_move`），宿主以 `unsupported_action` 预校验拒绝、如实
失败。其它 provider 使用通用 `actions:[...]` 自定义 schema；不承诺 OpenAI 原生
`computer_call` / `computer_call_output`。

## 错误语义

失败响应统一为 `{ ok:false, error, runtimeError:{ code, message, retryable,
requiresObservation } }`；`retryable:true` 只在满足 `requiresObservation`（先
重新观察）后才可重试，绝不表示盲重试。当前宿主实际发出的稳定码：

- `unsupported_protocol_version` / `unsupported_platform` /
  `driver_unavailable`：不可重试；修协议版本、平台（仅 macOS）或打包驱动。
- `missing_session`：请求缺 sessionKey，不可重试。
- `target_unavailable`：没有钉住精确 target 或 launch 未返回精确 pid/window；
  用 `open_application` 建立目标后重试。
- `target_handoff_untrusted`：target 交接不权威（别名替换、窗口归属校验失败、
  钉住后使用 App 切换快捷键）；重新 `open_application`。
- `stale_snapshot`：动作绑定旧 AX snapshot；重新观察定位。
- `mutation_outcome_unknown`（带 `outcomeUnknown:true`）：mutation 后果未知；
  禁止盲重放，观察后再决定下一步。
- `unsupported_action`：批预校验拒绝，未执行任何动作；改用支持集内动作。
- `coordinate_out_of_bounds`：坐标超出最新交付截图像素空间；message 含有效
  范围，重新观察取坐标。
- `cua_driver_rpc_timeout`：driver 单次 RPC 超过 32s；若发生在 mutation 之后按
  未知后果处理。
- `desktop_already_active`：driver 被同会话另一操作占用且超过宿主有界重试预算
  （约 2.5s 内多次退避）；等当前桌面操作结束再重试。

## 并发与取消

宿主用 `requestTail` 串行化所有 runtime 请求；driver 返回「desktop 忙」时宿主
在同会话内有界退避重试（20ms→1s，总预算约 2.5s），超过后报
`desktop_already_active`。`computer_cancel` 与工具 abort 信号触发宿主
`cancel()`：原子递增 request generation、拒绝全部挂起 RPC、清空
target/observation/scale 缓存，并对当前 daemon/proxy generation 做
SIGTERM→SIGKILL 有界回收、删除私有 socket；取消前排队或竞态出现的请求一律
fail closed，下一次调用启动全新 generation。

## 固定 helper 与签名

打包侧由 `Electron/scripts/fetch-cua-driver.mjs` +
`Electron/cua-driver-assets.json`（tag + sha256 固定，当前 v0.23.2）拉取各架构
cua-driver slice；macOS universal 二进制按目标架构 `lipo -thin` 出单架构
slice，打包进 `Contents/Resources/cua-driver/cua-driver`（刻意裸 Mach-O，不包
Helper.app，避免重新触发 Gatekeeper），运行时物化为 userData 下的 detached
host 再执行。MIT notice 安装到 `Contents/Resources/ThirdPartyNotices/`。这足够
记录 Cua 项目自身许可，但**不代表公开再分发合规已经完成**：public release 前仍
须从精确固定的 dependency graph 生成完整第三方 notices，并完成 MPL 组件的对应
源码提供 gate。打包与签名一律经 `pipiui-electron-build` skill（见 `AGENTS.md` →
Electron packaging adapter），不要手调 electron-builder。

## 权限

打包 App 需要给 PipiUI App 本身授予两项 macOS TCC 权限：

1. System Settings -> Privacy & Security -> Screen Recording
2. System Settings -> Privacy & Security -> Accessibility

Computer Use 设置面板（`computer-use-permissions.ts`）实时显示两项状态并可直接
打开对应 System Settings 面板请求授权；driver 以
`--permission-mode unrestricted` embedded 运行，权限闸门在 App 层。权限变化后应
完全退出并重启 App，以重建 embedded daemon generation。dev 模式
（`npm run dev`）的 TCC 身份不等价于签名后的 `PipiUI.app`，不能作为
产品权限验收。

## 验证边界

自动测试覆盖 broker 一次性 token/权限闸门、driver generation 启动/teardown/
reap、MCP initialize、精确 bundle、primary window 消失但 sibling 存活、
snapshot 绑定与 `stale_snapshot`、批预校验与逐动作 outcomes、
`actionable_context_changed`/`snapshot_changed` 批中断、坐标边界检查与
scale 映射、`mutation_outcome_unknown`、FIFO marker prune+inject、AX 裁剪上限、
Anthropic typed tool 替换与 beta header、`/usr/bin/open` 拦截。

仍需在主 checkout 单独完成：

1. 通过 `pipiui-electron-build` 在主 checkout 生成 canonical
   `build/PipiUI.app`，核对 helper、外层 App 签名/entitlements 和产物
   freshness；
2. PipiUI 单一 TCC 归属与权限重启；
3. TextEdit 编辑保存、Finder 文件操作、浏览器表单、Office 编辑导出和跨工具任务；
4. 两个真实 Pi session 并发、取消和 target-loss；
5. 登录、Touch ID、密码提示等系统/应用保护弹窗只由用户在真实桌面处理，宿主不
   代填也不永久拒绝。

在这些 live checks 完成前，只能报告源码和自动测试通过，不能报告 Computer Use
产品验收完成。
