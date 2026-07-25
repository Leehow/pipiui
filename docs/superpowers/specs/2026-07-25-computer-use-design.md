# Computer Use（桌面控制）实施方案

日期：2026-07-25
状态：待批准（未开工）

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
| Anthropic computer use 文档 | 当前工具 `type: "computer_20251124"`，beta header `computer-use-2025-11-24`（Opus 5 / Sonnet 5 / Opus 4.8/4.7/4.6 / Sonnet 4.6 / Opus 4.5）；旧版 `computer_20250124` + `computer-use-2025-01-24` |
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
| `anthropic` + `anthropic-messages` | 官方 `{type:"computer_20251124", name:"computer", display_width_px, display_height_px}` | tools 里 ~30 token；Anthropic 服务端另加内建 system prompt |
| 其它 | 自定义 schema，action/参数名**逐字对齐**官方词表 | ~200-250 token |

做法照抄 `ClaudeServerToolsExtension`：`before_provider_request` 里把 `payload.tools` 中名为 `computer` 的自定义条目**替换**成官方 typed 定义。名字不变 → pi 的 dispatcher 照样找得到本地执行器。

beta header 走**另一个事件**（已核对 `dist/core/extensions/types.d.ts:494-506`，两者是分开的钩子）：

```ts
pi.on("before_provider_headers", (event, ctx) => {
  if (!isAnthropicMessagesModel(ctx.model)) return;
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
SCStreamConfiguration.width/height  ←  直接设成降采样后的目标尺寸（SCK 在 GPU 上缩放，不要先全量截图再 resize）
                                       scale = min(1, maxLongEdge / max(pxW, pxH))
display_width_px / display_height_px ←  就是上面这个目标尺寸（模型坐标空间）
```

回映射：用 `CGDisplayBounds(displayID)`——它已经是**左上原点、全局 points**，正好是 `CGEvent` 用的坐标系，省掉 `NSScreen` 的翻转。

```
globalPoint = bounds.origin + (imgX / imgW * bounds.width,
                               imgY / imgH * bounds.height)
```

`maxLongEdge` 默认 **1440**（对应 Opus 4.7+ 的 2576px 高分档但不打满；1080p 是文档给的性能/成本平衡点，720p / 1366×768 是省钱档）。设置里可调。

这段全部挤进 `CoordinateMap.swift` 的纯函数里，不依赖 TCC，可在 CI 跑。

### D3. 输入合成

- 鼠标：`CGEvent(mouseEventSource:mouseType:mouseCursorPosition:mouseButton:)` + `.post(tap: .cghidEventTap)`；down/up 成对；双击/三击靠 `setIntegerValueField(.mouseEventClickState, 2/3)`
- 拖拽：down → **若干中间 `mouseDragged` 帧** → up（一步到位很多 App 不认）
- 打字：`CGEvent.keyboardSetUnicodeString` —— 不建 keycode 表，中文/emoji 直接过，也绕开输入法
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

### D5. 安全闸门（三层 + 边界）

1. **全局开关**（设置 → 工具，默认**关**）。关时扩展根本不 `-e` 挂载 → 工具不存在 → 前缀零成本。注意 `ToolSkillSettings` 是「缺省=启用」的 opt-out 语义，**不能复用**，需要独立的 opt-in key。
2. **会话级**：顶栏 🖥️ 指示器，激活时常亮；未激活时首次调用弹确认（授权只对当前会话有效）。
3. **急停**：全局热键（⌥⇧Esc）→ 立即撤销会话级授权 + 中断生成。
4. **subagent 边界**：默认只有主会话能用。Boss 模式会派深度 2 的树、后台会话继续跑，无人值守时这是最大风险面。经补丁版 subagent 的工具禁用路径注入 `--exclude-tools computer`。
5. **审计**：每个动作写 JSONL（照 `Logging/TokenLedger` 的模式）。截图**不落盘**，只走内存 → base64。
6. 文档明说：截图可能含密码/私信；Anthropic 路径有自动 prompt-injection 分类器，其它 provider **没有**。

---

## 文件拆分（遵守 400 行规矩）

```
Sources/PipiUI/ComputerUseExtension.swift     ~200  TS 源（照 WebviewExtension 模式）+ provider 换形逻辑
Sources/PipiUI/Computer/ScreenCapture.swift   ~140  SCScreenshotManager 截屏 + 降采样 + PNG
Sources/PipiUI/Computer/InputSynth.swift      ~200  CGEvent 鼠标/键盘/滚动/拖拽 + 节流
Sources/PipiUI/Computer/KeyMap.swift          ~90   具名键 → virtual keycode（US 布局）
Sources/PipiUI/Computer/CoordinateMap.swift   ~70   纯函数：图像坐标 ↔ 全局显示坐标
Sources/PipiUI/Computer/ComputerStore.swift   ~180  bridge action 分发 + 授权状态 + 会话闸门 + 审计
Sources/PipiUI/ComputerUseSettings.swift      ~90   opt-in 开关 + 显示器/分辨率 + JSON 同步
Sources/PipiUI/Views/ComputerConsentBar.swift ~90   顶栏指示 + 急停 + 授权引导

Tests/PipiUITests/ComputerCoordinateTests.swift
Tests/PipiUITests/ComputerKeyMapTests.swift
Tests/PipiUITests/ComputerUseSettingsTests.swift
```

`AppStore.swift:161` 的 bridge handler 加一个分支：`computer_*` action 路由到 `ComputerStore`，不进 `WebViewStore`（那是 webview 的）。

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
| 无人值守 agent 树误操作 | 默认关 + subagent 排除 + 急停 + 审计 |
| 截图泄露敏感信息 | 不落盘；文档明示；建议只在需要时开 |
| 官方工具进 tools 数组会让 Anthropic 注入内建 system prompt → 前缀变化 | 开关只在 spawn 时生效（与现有 `--exclude-tools` 行为一致），会话内工具集恒定，不毁缓存 |

---

## 待定（需要实测数据才能定）

1. **`enable_zoom`**：`computer_20251124` 的 `zoom` action 是「看清小字」的正解，比拉高截图分辨率便宜。v1 先不做，等 T3 的分辨率实测数据再定要不要进 v1.1。
2. **默认 `maxLongEdge`**：1440 是拍脑袋值，T3 用真实任务对比 1080p / 1366×768 / 1440 的准确率和 token 成本再定。
3. **`effort` 建议值**：Anthropic 对 computer use 给了实测建议（Opus 4.7 默认 `high`、高吞吐用 `low`；4.6 系默认 `medium`、避免 `max`）。要不要在开 computer 工具时自动调 `ModelTierSettings` 的档位，还是只写进文档由用户自己选。
