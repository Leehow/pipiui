# Tool 结果图不进折叠 + 灯箱点背景关闭 — Design

Date: 2026-07-24  
Status: Approved  
Scope: `AssistantBlockLayout.plan` + `ImageLightboxChrome`

## Problem

1. `browser_screenshot` 等工具的结果图挂在 `ToolRun.images` 上；折叠只认 `toolCall`，整卡进组后缩略图被藏起来。
2. 灯箱灰色背景本意可点关闭，但图片视图 hit 区几乎全屏，吞掉了背景点击。

## Goals

1. 含结果图的 toolCall **不进** `finishedGroup`，单独 singleton 显示（作分组边界）。
2. 点灯箱灰色背景关闭；点图片本身不关；Esc / × 仍可用。

## Non-goals

- 不改 RPC / 入库
- 不把 tool 结果图提升为 `ChatBlock.image`
- 不改折叠组展开后的内部布局

## Approach

1. `plan(blocks:groupFinished:toolRuns:)`：
   - 已知出图工具（`generate_image`、`browser_screenshot`）始终 `isGroupable == false`（避免 message_end 后、images 写入前被收进包）；
   - 其它 toolCall 若 `toolRuns[id].images` 非空 → 同样不进组。
2. `planTranscript` 传入 session `toolRuns`。
3. `generate_image` 头栏摘要显示 `prompt`，不甩 JSON。
4. `ImageLightboxChrome`：按图片 aspect 计算实际显示 frame，仅该区域吸收点击；背景 `Color` 负责 dismiss。

## Tests

- 连续 thinking + bash + screenshot(有图) + thinking → screenshot 为 singleton，两侧可各自成组。
- （灯箱为 AppKit/SwiftUI 交互；手动验证点背景关闭。）
