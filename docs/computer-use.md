# PipiUI Computer Use

状态（2026-07-27）：Cua Driver 集成、工具协议、精确目标、坐标变换、取消路径和自动测试已实现。真实打包 App 的 TCC 归属、TextEdit/Finder/Xcode/Simulator 操作仍须在主 checkout 手工验收，不能由 `swift test` 代替。

## 架构

PipiUI 的 `computer` 与 `open_application` 仍是 provider 可移植的自定义工具；Anthropic 支持的模型会在 provider 边界改写为官方 `computer_20251124`。v1 不假设 Pi 能处理 OpenAI 原生 `computer_call` / `computer_call_output`。

桌面执行由嵌入 App 的 Cua Driver 完成：

```text
Pi extension
  -> loopback BridgeServer + session capability
  -> process-global ComputerCoordinator
  -> cua-driver serve --embedded (private Unix socket)
  -> cua-driver mcp --embedded (stdio JSON-RPC)
  -> target window screenshot + AX metadata / background input
```

GUI App 用 `Foundation.Process` 直接启动两个子进程，不经过 Launch Services。运行环境固定为：

```text
CUA_DRIVER_EMBEDDED=1
CUA_DRIVER_HOST_BUNDLE_ID=com.leehow.pipiui
CUA_DRIVER_PERMISSION_MODE=unrestricted
CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS=1
CUA_DRIVER_RS_TELEMETRY_ENABLED=false
```

每个 daemon generation 使用完整 UUID 的独立 `/tmp` socket。readiness 会用 `lstat` 验证它是当前用户拥有的 `0600` Unix socket，而不是仅检查同名路径存在。daemon 使用官方 embedded host 的 `--parent-liveness-stdio --no-permissions-gate --host-bundle-id com.leehow.pipiui --permission-mode unrestricted --dangerously-bypass-approvals` 形态，并由 App 持有专用 stdin liveness pipe 的写端；MCP 也显式传 `--host-bundle-id`。MCP initialize 只接受固定版本支持的 `2025-06-18`，随后 `check_permissions` 必须同时返回 `source.attribution == host`、`source.embedded == true` 和精确 host bundle ID，否则 teardown。App 不在运行时下载代码。

## 模型路由优先级

Computer Use 是混合桌面能力包，不等于所有任务都从截图中找坐标。模型侧工具说明固定采用以下顺序：

1. **确定性应用生命周期优先**：启动或激活目标 App 使用 `open_application`；它只接受 bundle identifier 或 application name，不接受 path/URL。运行状态检查和优雅退出继续优先使用已有 shell/macOS lifecycle 命令，默认不 force quit / `kill -9`。
2. **Accessibility/AX 或应用内快捷键其次**：窗口已选定后，只要最新 snapshot 提供 `element_index` / `element_token`，就优先使用 AX element action。Finder 目录导航推荐先固定 Finder，再发送 `Cmd-Shift-G`、输入精确绝对路径并按 Enter。
3. **截图坐标最后**：只有生命周期命令和 AX 都不能完成目标时，才回退到截图像素坐标。

这只是给模型的路由纪律；目录/文件导航留在已经固定的目标窗口内完成。扩展会拒绝直接、wrapper 或嵌套 shell 中的 `/usr/bin/open` / `open`，并引导模型先调用 `open_application`，再使用 `computer` AX/快捷键。Web URL 优先使用现有 browser 工具。

普通 Web 任务仍优先使用 browser 工具。若用户明确要求操作 Chrome、Safari 等外部浏览器 App，则先用 `open_application` 固定该浏览器，把完整 percent-encoded URL 通过 `printf '%s' '<URL>' | pbcopy` 放入剪贴板，再在固定窗口上用一个 `computer` batch 顺序执行 `CMD+L → CMD+V → RETURN → wait`。不要用 AppleScript/`osascript` 或 shell `open` 做外部浏览器导航，避免 AppleEvents TCC 提示或无响应。

## 目标与坐标

`open_application` 接受 `bundle_identifier` 或 `application_name`。Cua `launch_app` 返回 PID 后，PipiUI 执行 `bring_to_front` 与 `get_window_state`，并为 bridge session 原子保存：

- bundle ID、应用名和 PID；
- 当前 window ID、同 PID 的 window ID 集合和 revision；
- screenshot identity；
- Cua 原图到 provider 公布尺寸的精确 aspect-fit/letterbox 变换。

若调用者给出精确 bundle ID，`launch_app` 的返回值必须大小写不敏感地精确匹配，否则不会保存 target。后续 batch 不使用“当前前台 App”来选择目标。执行前后都按保存的 PID、bundle ID 和**固定 primary window ID** 复核；primary window 消失时即使同 PID 仍有其他窗口，也会清 target 并要求重新 `open_application`，绝不把旧坐标/AX snapshot 漂移到 sibling window。不同 session 的 target 独立，但所有真实桌面调用共享 process-global in-flight mutex。

截图在内存中变换成 provider 已公布的固定像素尺寸。模型坐标先反变换为 Cua 原图坐标；落在 letterbox 黑边中的输入会被拒绝。每个 session target 会保存该截图的 `element_index -> element_token` 映射；纯 index 动作在调用 Cua 前改成该 session 的 snapshot token，使另一 session 刷新同窗 AX cache 时由 Cua 的 stale-token 机制 fail closed。显式 `element_token` 仍直接使用，`delivery_mode` 会传给支持的动作。

初次打开和每批动作后的两次 `get_window_state` 都显式使用 `max_elements: 256`、`max_depth: 12`。这会同时限制 Cua 的 structured elements 与兼容 markdown；模型侧只保留上游推荐的 structured `elements`，不再重复 `tree_markdown`。元素中的 `element_index` / `element_token` 完整保留，截图仍作为深层节点未进入 AX 预算时的 fallback。工具 `details` 只保存小型状态与 AX element count，不再复制整个模型上下文。

批量动作支持截图、Cua overlay 指示、左右/中键点击、双击/像素三击、拖拽、Unicode 输入、按键/快捷键、滚动和等待。`mouse_move` 在固定 v0.12.5 的 window scope 只移动可见 agent overlay，结果会明确报告 `nativeHover: false`，不声称触发 macOS hover。上游没有 key-down/up，因此 `hold_key` 不在通用自定义 schema 中，直接调用也会明确拒绝。AX double click 使用 Cua `double_click`；AX triple click 被拒绝，像素 triple click 继续使用 count=3。`left_mouse_down -> mouse_move* -> left_mouse_up` 只允许出现在同一批连续序列，并合并为一次真实 Cua `drag`。

所有坐标、duration/duration_ms 和 scroll amount 在任何浮点到整数转换前都必须 finite 且处于技术边界内（坐标绝对值不超过 1,000,000；duration 0–10 秒；scroll 1–50）。每个已落定 batch 都重新取得目标状态并返回最新 PNG 和 AX metadata，同时返回真实观察到的 foreground App/window 与 focus drift，而不是把 target 伪装成 foreground。

## 生命周期与急停

只有一个 Cua 操作可处于 in-flight；并发调用返回 `computer_busy`。会话释放会结束其 Cua session，App 释放全部桌面状态时会停止 daemon/proxy。

急停和 transport cancel 不会在主线程对 MCP 串行队列执行 `sync`。它们会：

1. 原子递增 cancellation generation；
2. 立即向当前登记的 daemon/proxy PID 发 `SIGTERM`；
3. 由子进程退出唤醒可能阻塞的 MCP `poll/read`；
4. 由 transport 所属队列 bounded reap、关闭 liveness/stdio、注销 `Process` identity 并清 socket；延迟强杀只针对仍登记的同一个 `Process` 对象，不保留可误杀 PID reuse 的裸 PID。

新调用捕获 generation；取消前排队或在 spawn 中竞态出现的进程都会 fail closed。任何 cancellation、timeout、child exit 或协议失败都会终止该 generation；下一次调用会启动全新 daemon/proxy。若写动作已经发出但 transport 或最终 observation 失败，响应保留已完成 outcomes、标记 `outcomeUnknown`，明确禁止盲重试，并清 target 要求重新打开/观察。

认证、Touch ID、密码或授权提示被识别为 `user_handoff_required`：PipiUI 不尝试填写或永久拒绝，用户完成系统/应用提示后再让模型重试。

## 固定 helper 与签名

`scripts/fetch-cua-driver.sh` 固定：

- release tag：`cua-driver-rs-v0.12.5`
- asset：`cua-driver-rs-0.12.5-darwin-universal-binary.tar.gz`
- SHA-256：`898a143559694d6083feb89e3991581c87f5c9adf997876588cc262ade529e35`

只有主 checkout 的 `make-app.sh` 会下载/复用经 SHA-256 验证的 archive，并把 universal helper 安装为：

```text
PipiUI.app/Contents/Helpers/cua-driver
```

MIT notice 安装到 `Contents/Resources/ThirdPartyNotices/`。这足够记录 Cua 项目自身许可，但**不代表公开再分发合规已经完成**：public release 前仍须从精确固定的 v0.12.5 dependency graph 生成完整第三方 notices，并完成 MPL 组件的对应源码提供 gate。本轮只验证本地/内部开发集成，不能声称已完成公开发布合规。

固定 release helper 的实测签名元数据包含 hardened runtime，以及：

```xml
<key>com.apple.security.automation.apple-events</key><true/>
<key>com.apple.security.device.screen-capture</key><true/>
```

因此重签不能裸用 `codesign --force --sign`。`make-app.sh` 使用
`--preserve-metadata=identifier,entitlements,flags,runtime`，先签并严格验证 helper，再签资源 bundle，最后签外层 App。对下载的固定 helper 用 `PipiUI Dev` 实测重签后，两项 entitlement、runtime flag 和 identifier 均保留，`codesign --verify --strict` 通过。这里不使用 `com.apple.security.inherit`：Cua 的文档明确说明这是非沙箱 host 的 TCC responsibility chain，不是 App Sandbox entitlement inheritance。

`make-app.sh` 默认查找稳定 identity `PipiUI Dev`；缺失时退回 ad-hoc 并打印 TCC grant 可能失效的警告。其他证书可用：

```bash
PIPIUI_SIGN_ID="Developer ID Application: Example" ./make-app.sh
```

## 开发与权限

打包 App 从 `Contents/Helpers/cua-driver` 加载 helper。环境变量覆盖只在 DEBUG 构建启用；测试也可通过显式 initializer 注入 helper：

```bash
PIPIUI_CUA_DRIVER_PATH=/absolute/path/to/cua-driver swift run
```

需要给 PipiUI App 本身授予：

1. System Settings -> Privacy & Security -> Screen Recording
2. System Settings -> Privacy & Security -> Accessibility

权限变化后应完全退出并重启 App，以重建 embedded daemon generation。`swift run` 的 TCC 身份不等价于签名后的 `PipiUI.app`，不能作为产品权限验收。

## 验证边界

自动测试覆盖真实 Unix socket 的 fake MCP initialize/host attribution、timeout 后 generation teardown/reap/自动重启、parent-liveness launch flags、精确 bundle、primary window 消失但 sibling 存活、session-pinned AX token、模型生命周期/AX/像素路由指引、数值边界、overlay/hold/double/triple 语义、最终观察失败的 unknown-outcome、真实 foreground/focus metadata、坐标/letterbox、急停无队列阻塞、固定 artifact/hash、nested signing 顺序与输入框不抢焦点。

所有工具卡的 AppKit/SwiftUI 文本布局输入都有独立的 display-only 硬预算：展开最多 12,000 UTF-16 units，折叠最多 4,000，并显示明确截断提示；`ToolRun` / session 原始数据不因此改写。`computer` 与 `open_application` 的截图不会触发工具卡自动展开，避免历史或新结果在未点击时立即排版大段 AX 内容。

仍需在主 checkout 单独完成：

1. `./make-app.sh`，核对 helper 与外层 App 签名/entitlements 和产物 freshness；
2. PipiUI 单一 TCC 归属与权限重启；
3. TextEdit 中英文输入与保存、Finder 文件操作、Xcode Run、Simulator 无账号流程；
4. 两个真实 Pi session 并发、急停和 target-loss；
5. 登录、Touch ID、密码提示只返回 user handoff。
6. 公开分发前生成精确 v0.12.5 dependency notices/MPL source package；本地打包验收不能替代该 release gate。

在这些 live checks 完成前，只能报告源码和自动测试通过，不能报告 Computer Use 产品验收完成。
