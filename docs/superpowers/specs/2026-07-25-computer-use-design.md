# Computer Use（桌面控制）实施方案

日期：2026-07-25
状态：已实现 v1（代码与自动测试完成；真实 TCC / UI / 输入 V3 验收未执行）

> 2026-07-26 实现修订：以下十一项为最终实现约束并覆盖本文较早的单会话/单 action 表述：
>
> 1. `ComputerCoordinator` 是 process-global 单控制者，使用 session lease、固定目标 bundle、预算、超时、用户接管和急停。
> 2. OpenAI/Codex 不改写为原生 `computer_call`；v1 只对 Anthropic messages 使用官方 typed tool，其余统一自定义 batch schema。
> 3. 内部请求统一为 `actions:[ComputerAction]`；每个未取消且被接受的 batch 结束后强制截图。
> 4. 会话授权之外增加 bundle-id 应用授权；PipiUI、终端、密码管理器、钥匙串和 System Settings 永久拒绝。
> 5. 截图只驻留内存：pi session 中仅保存 opaque marker，`context` hook 在 provider 调用前重新注入 PNG。
> 6. 所有非纯截图 batch 都使用 request-id + 完整指纹绑定的 10 秒一次性确认；点击 PipiUI 确认只进入 `approvedAwaitingTargetRefocus`，原请求继续挂起，必须由用户手动切回原 bundle + PID 后才一次性启动。
> 7. 执行器有 20 秒 watchdog 和 17 秒静态预算；pi 35 秒 / bridge 40 秒超时或断连会按 request-id 取消输入、释放 held state 与 lease。
> 8. 每个实际 input post 都在与取消共用的串行 gate 内重新核对 exact frontmost bundle + PID；键盘/Unicode 使用 `CGEvent.postToPid`，取消先获得 gate 后不会再发生正常 post。
> 9. display id、输出像素尺寸与全局 point bounds 组成同一不可变 capture descriptor；选中显示器消失时 fail closed。
> 10. 每个鼠标/scroll post 还以前后顺序窗口命中结果约束到已授权 PID；Dock、菜单、其他 App 或空白区域拒绝。
> 11. held-key/mouse/Unicode cleanup-up 绕过正常授权以防输入卡住；键盘 cleanup 只发往记录的原目标 PID，Unicode cleanup 不重复文本。
>
> 运行说明、安全边界和 V3 手工验收见 [`docs/computer-use.md`](../../computer-use.md)。

## 问题

PipiUI 已有 `browser` 工具（应用内 WKWebView：navigate / content / eval / console / screenshot），模型能测网页。但它够不到**原生 App**：Xcode、iOS 模拟器、Finder、系统设置、设计稿工具，以及任何跨 App 流程。

Computer use = 给模型「看整块屏幕 + 合成鼠标键盘」的能力。本文是实施方案。

## 目标

- 一个 `computer` 工具，覆盖截屏 + 鼠标 + 键盘 + 滚动 + 拖拽
- **官方 Anthropic 工具优先**：模型是按 `computer_20251124` 训练的，走官方定义精度最高；其它 provider（Grok / GLM / Kimi / Codex）走同名同义的自定义 schema，共用同一套本地执行器
- 默认**关闭**，opt-in；开启后有会话级确认、可见指示、急停
- subagent 树默认**拿不到**这个工具
- 修好 TCC 签名基建，让权限不会每次 `make-app.sh` 后失效

## 非目标（v1）

- 不做多显示器全景拼图（用设置里选显示器 + `display_number`）
- 不读 Accessibility 控件树（AX API 比像素可靠也便宜，但工作量大得多，列为 v2）
- 不做录屏 / 视频、不做远程或无头
- 不接管输入法、不做 OCR
- 不实现 `zoom` action（v1.1，见下）

---

## 调研摘要

| 来源 | 结论 |
|------|------|
| `WebviewExtension.swift` + `BridgeServer.swift` + `WebViewStore.handle` | TS 扩展 → 127.0.0.1 HTTP 桥 → 主线程 handler → base64 图片回模型，**整条链路已跑通并在产**（`browser.screenshot`） |
| `ClaudeServerToolsExtension.swift` | pi 提供 `pi.on("before_provider_request")`，可改写发给 provider 的原始 `payload.tools` —— 这是「按 provider 换 wire shape」的现成先例 |
| `PiPlugin.swift` / `ChatSession.swift:493-514` | 扩展安装 + `-e` 挂载 + `PIPIUI_BRIDGE_PORT/SESSION_KEY` 注入的位置已定型 |
| `ToolSkillSettings.swift` | 已有工具开关框架（opt-**out** 语义）+ `--exclude-tools` CLI 注入 |
| Anthropic computer use 文档 | 当前工具 `type: "computer_20251124"`，beta header `computer-use-2025-11-24`（Sonnet 5 / Opus 4.8/4.7/4.6 / Sonnet 4.6 / Opus 4.5）；旧版 `computer_20250124` + `computer-use-2025-01-24` |
| 同上 | **schema-less 工具**：只给 `{type, name, display_width_px, display_height_px}`，input schema 内建在模型里，不可改 |
| 同上 | 截图会自动跑 prompt-injection 分类器，命中时模型会先要用户确认 —— 官方路径自带一层安全网 |
| `make-app.sh` | ad-hoc 签名 + 每次 `rm -rf` 重建；仓库无 `.entitlements`（**未沙盒**，CGEvent 可用） |

### 事实核对（写代码前不要凭记忆）

- 工具字段：`display_width_px`（必填）、`display_height_px`（必填）、`display_number`（可选，X11）、`enable_zoom`（可选，仅 `computer_20251124`）
- action 全集：`screenshot` `left_click` `type` `key` `mouse_move` `scroll` `left_click_drag` `right_click` `middle_click` `double_click` `triple_click` `left_mouse_down` `left_mouse_up` `hold_key` `wait`，以及 `zoom`（需 `enable_zoom: true`）
- 参数名：`coordinate: [x,y]`、`text`、`scroll_direction`、`scroll_amount`、`duration`、`start_coordinate`、`region: [x1,y1,x2,y2]`

---

## 关键设计决策

### D1. 一个执行器，两种 wire shape

本地只注册**一个** `computer` 工具（pi 按工具名派发），发给 provider 前按 provider 换形状：

| provider | tools 数组里的形状 | 前缀成本 |
|---|---|---|
| 精确 `anthropic` + `anthropic-messages` + 明确支持 20251124 的 model id | 官方 `{type:"computer_20251124", name:"computer", display_width_px, display_height_px}` | tools 里 ~30 token；Anthropic 服务端另加内建 system prompt |
| 其它 | 自定义 schema，action/参数名**逐字对齐**官方词表 | ~200-250 token |

做法照抄 `ClaudeServerToolsExtension`：`before_provider_request` 里只对 Sonnet 5、Opus 4.8/4.7/4.6、Sonnet 4.6、Opus 4.5 的显式 model-id 前缀，把 `payload.tools` 中名为 `computer` 的自定义条目**替换**成官方 typed 定义。旧模型、未知模型、Opus 5 和 proxy provider 都保留自定义工具且不加 beta header。名字不变 → pi 的 dispatcher 照样找得到本地执行器。

beta header 走**另一个事件**（已核对 `dist/core/extensions/types.d.ts:494-506`，两者是分开的钩子）：

```ts
pi.on("before_provider_headers", (event, ctx) => {
  if (!isAnthropicComputer20251124Model(ctx.model)) return;
  // 就地修改；返回值被忽略；置 null 表示删除该 header
  event.headers["anthropic-beta"] = mergeBeta(
    event.headers["anthropic-beta"], "computer-use-2025-11-24",
  );
});
```

注意 `anthropic-beta` 可能已被别的扩展占用（未来若加 `fast-mode` / `task-budgets` 等），必须**合并**成逗号分隔而不是覆盖。

因为两边 action 词表逐字相同，**没有翻译层**。

### D2. 坐标空间（bug 最集中的地方，必须纯函数 + 单测）

```
ComputerCaptureDescriptor ← 精确 display id + 输出 pixel size + CGDisplayBounds global points
SCStreamConfiguration.width/height  ←  descriptor 的输出尺寸（SCK 在 GPU 上缩放，不要先全量截图再 resize）
                                       scale = min(1, maxLongEdge / max(pxW, pxH))
display_width_px / display_height_px ←  就是上面这个目标尺寸（模型坐标空间）
```

回映射：使用同一 descriptor 中启动时捕获并在每个 action 前重新核对的 `CGDisplayBounds(displayID)`——它已经是**左上原点、全局 points**，正好是 `CGEvent` 用的坐标系，省掉 `NSScreen` 的翻转。provider 广告尺寸、输入验证、坐标映射和最终截图必须消费同一 descriptor；显示器缺失或几何变化时不回退主显示器。

```
globalPoint = bounds.origin + (imgX / imgW * bounds.width,
                               imgY / imgH * bounds.height)
```

`maxLongEdge` 默认 **1440**（对应 Opus 4.7+ 的 2576px 高分档但不打满；1080p 是文档给的性能/成本平衡点，720p / 1366×768 是省钱档）。设置里可调。

这段全部挤进 `CoordinateMap.swift` 的纯函数里，不依赖 TCC，可在 CI 跑。

### D3. 输入合成

- 鼠标：`CGEvent(mouseEventSource:mouseType:mouseCursorPosition:mouseButton:)` + `.post(tap: .cghidEventTap)`；down/up 成对；双击/三击靠 `setIntegerValueField(.mouseEventClickState, 2/3)`。每个实际 post 前都在 execution gate 内复核 exact frontmost PID 与 topmost-window owner PID。
- 拖拽：down → **若干中间 `mouseDragged` 帧** → up（一步到位很多 App 不认）
- 打字：`CGEvent.keyboardSetUnicodeString` —— 不建 keycode 表，中文/emoji 直接过，也绕开输入法；20 个 UTF-16 unit 的事件分块只能在 Swift `Character` 边界切分，不能切断 surrogate pair、组合字符或 emoji ZWJ 序列。Unicode 文本只附在 down，普通 up 与失败 cleanup-up 都不携带文本，并通过 `postToPid` 定向原目标进程。
- 快捷键：`key` 走 virtual keycode + modifier flags，需要一张**具名键**表（Return=36, Escape=53, Tab=48…）。这是有限机械枚举，不是开放语义分类；任意字符一律走 `type`
- 节流：事件之间 sleep 8–16ms，否则大量 App 丢事件

### D4. 授权与签名（**必须第一个做**）

需要两个 TCC 权限：**屏幕录制**（`CGPreflightScreenCaptureAccess` / `CGRequestScreenCaptureAccess`）+ **辅助功能**（`AXIsProcessTrustedWithOptions`）。App 未沙盒，两者都可拿。

问题在 `make-app.sh`：`rm -rf` + `codesign --sign -`（ad-hoc）→ 每次构建 cdhash 变 → macOS 当成另一个 App → **两个授权每次都失效**。按宪章「编译通过即打包」，等于每改一行都要回系统设置重勾。

改法：

```bash
SIGN_ID="${PIPIUI_SIGN_ID:-PipiUI Dev}"
if security find-identity -v -p codesigning | grep -q "$SIGN_ID"; then
  codesign --force --sign "$SIGN_ID" "$APP"
else
  codesign --force --sign - "$APP" 2>/dev/null || true
  echo "⚠️  ad-hoc 签名：屏幕录制/辅助功能授权会在每次构建后失效"
  echo "    见 docs/computer-use.md → 创建 'PipiUI Dev' 自签名证书"
fi
```

一次性准备：钥匙串访问 → 证书助理 → 创建证书 → 名称 `PipiUI Dev`、自签名根、类型 **代码签名**。之后 DR 稳定，授权跨构建保留。

Info.plist 不用改（macOS 的屏幕录制/辅助功能没有 usage-description key）。

开发期重置：`tccutil reset ScreenCapture com.leehow.pipiui`。

**`swift run` 路径**：裸二进制，TCC 归属终端而非 PipiUI.app，行为与 `.app` 不一致 —— 这个功能只能用 `.app` 测，写进文档。

### D5. 安全闸门（多层 + 边界）

1. **全局开关**（设置 → 工具，默认**关**）。关时扩展根本不 `-e` 挂载 → 工具不存在 → 前缀零成本。注意 `ToolSkillSettings` 是「缺省=启用」的 opt-out 语义，**不能复用**，需要独立的 opt-in key。
2. **会话级 + 应用级**：顶栏 🖥️ 指示器，激活时常亮；首次调用确认顶层会话，新 bundle/PID 捕获的应用身份另行确认。
3. **批次级写确认**：任何含非 screenshot action 的 batch 使用 request-id、完整动作指纹和 10 秒绝对期限；确认 UI 必须提交精确 approval id/request id/fingerprint。按钮只把请求推进 `approvedAwaitingTargetRefocus`，不激活 App、不同步执行；轮询检测原 bundle + PID 重新前台后清状态并启动一次。
4. **逐事件进程与窗口约束**：取消和每个实际 input post 共享串行 gate；gate 内先核对 execution + exact frontmost bundle/PID。每个 move/click/drag/scroll/down/up 再按 `CGWindowList` front-to-back 命中，最上层 owner PID 必须等于目标 PID；键盘用 `postToPid`。Dock、菜单栏、系统 UI、其他 App 和空白区域均拒绝。
5. **急停**：全局热键（⌥⇧Esc）先收集 active/in-flight/pending/paused/lease 会话，再撤销授权、取消对应生成并释放所有 down 状态。
6. **subagent 边界**：默认只有主会话能用。Boss 模式会派深度 2 的树、后台会话继续跑，无人值守时这是最大风险面。经补丁版 subagent 的工具禁用路径注入 `--exclude-tools computer`。
7. **审计**：每个动作写 JSONL（照 `Logging/TokenLedger` 的模式）。截图**不落盘**，只走内存 → base64。
8. 文档明说：截图可能含密码/私信；Anthropic 路径有自动 prompt-injection 分类器，其它 provider **没有**。

---

## 文件拆分（遵守 400 行规矩）

```
Sources/PipiUI/ComputerUseExtension.swift     ~200  TS 源（照 WebviewExtension 模式）+ provider 换形逻辑
Sources/PipiUI/Computer/ScreenCapture.swift   ~140  SCScreenshotManager 截屏 + 降采样 + PNG
Sources/PipiUI/Computer/InputSynth.swift      ~200  CGEvent 鼠标/键盘/滚动/拖拽 + 节流
Sources/PipiUI/Computer/KeyMap.swift          ~90   具名键 → virtual keycode（US 布局）
Sources/PipiUI/Computer/CoordinateMap.swift   ~70   纯函数：图像坐标 ↔ 全局显示坐标
Sources/PipiUI/Computer/ComputerCoordinator*.swift  全局 lease、精确批次确认、watchdog、急停与 monitor 生命周期
Sources/PipiUI/Computer/ComputerCaptureDescriptor.swift  显示器 pixel/point 单一事实来源
Sources/PipiUI/Computer/ComputerWindowConfinement.swift  front-to-back 窗口 owner PID 命中
Sources/PipiUI/ComputerUseSettings.swift      ~90   opt-in 开关 + 显示器/分辨率 + JSON 同步
Sources/PipiUI/Views/ComputerConsentBar.swift ~90   顶栏指示 + 急停 + 授权引导

Tests/PipiUITests/ComputerCoordinateTests.swift
Tests/PipiUITests/ComputerKeyMapTests.swift
Tests/PipiUITests/ComputerUseSettingsTests.swift
Tests/PipiUITests/ComputerSafetyTests.swift
```

`AppStore` 的 bridge handler 加一个分支：`computer_*` action 路由到 `ComputerCoordinator`，不进 `WebViewStore`（后者只负责 webview）。

---

## 任务拆分

| # | 任务 | 验收 |
|---|---|---|
| **T1** | 签名基建：`make-app.sh` 支持稳定自签名证书 + 文档 | 连续两次 `make-app.sh`，手动授权的屏幕录制**不失效** |
| **T2** | 权限探测 + 设置 UI（纯状态显示，无控制能力） | 设置页实时显示两个权限状态，「去授权」按钮能打开对应系统设置面板 |
| **T3** | 截屏 + 坐标映射（只读，最低风险） | `ComputerCoordinateTests` 绿；bridge 手工调用能拿到降采样 PNG |
| **T4** | 输入合成（写路径） | 能点开 Finder 菜单、输入中文、滚动、拖拽 |
| **T5** | TS 扩展 + provider 换形 + beta header 合并 + opt-in 挂载 | Anthropic 会话里工具以 `computer_20251124` 出现且 header 带 `computer-use-2025-11-24`；Kimi 会话里以自定义 schema 出现；两边同一执行器 |
| **T6** | 安全闸门：会话确认、顶栏指示、急停、subagent 排除、审计日志 | 急停 1s 内生效；subagent 会话里 `computer` 不存在 |
| **T7** | 文档 + `ToolSkillCatalog` 条目 + 前缀 token 实测（对齐 `docs/progressive-disclosure.md` 的表） | 表里多一行实测数字 |

**T1 必须最先做** —— 否则 T3~T6 每轮构建都要重新授权，开发体验会崩。

---

## 风险

| 风险 | 缓解 |
|---|---|
| Retina 坐标算错 → 点偏 | 纯函数 + 单测；先做只读的 T3 验证坐标，再开 T4 写路径 |
| TCC 授权反复失效拖垮开发 | T1 排在最前 |
| `anthropic-beta` 被别的扩展覆盖 → 官方工具 400 | 合并而非覆盖；T5 验收时实测 header 内容 |
| 无人值守 agent 树误操作 | 默认关 + subagent 排除 + 每写批确认 + 全局 lease + 急停 + 审计 |
| 请求超时后仍继续点击 | request-id 取消、20 秒 watchdog、35/40 秒传输 deadline、held-input 清理 |
| PipiUI 确认按钮抢走焦点导致批准必失败 | 确认后等待用户手动切回原 bundle + PID；同 PID 才启动一次，替换/超时/取消 fail closed |
| 点击或键盘落到其他 App | 每个 post 与取消串行；逐事件 exact frontmost PID，pointer 再做 topmost owner PID 命中，键盘 `postToPid` |
| 截图泄露敏感信息 | 不落盘；文档明示；建议只在需要时开 |
| 官方工具进 tools 数组会让 Anthropic 注入内建 system prompt → 前缀变化 | 开关只在 spawn 时生效（与现有 `--exclude-tools` 行为一致），会话内工具集恒定，不毁缓存 |

---

## 待定（需要实测数据才能定）

1. **`enable_zoom`**：`computer_20251124` 的 `zoom` action 是「看清小字」的正解，比拉高截图分辨率便宜。v1 先不做，等 T3 的分辨率实测数据再定要不要进 v1.1。
2. **默认 `maxLongEdge`**：1440 是拍脑袋值，T3 用真实任务对比 1080p / 1366×768 / 1440 的准确率和 token 成本再定。
3. **`effort` 建议值**：Anthropic 对 computer use 给了实测建议（Opus 4.7 默认 `high`、高吞吐用 `low`；4.6 系默认 `medium`、避免 `max`）。要不要在开 computer 工具时自动调 `ModelTierSettings` 的档位，还是只写进文档由用户自己选。
