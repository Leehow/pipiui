# write / edit 卡片：路径 + 流式 tokens — Design

Date: 2026-07-24  
Status: Approved  
Scope: `ToolCallBlock` 摘要字段 + `ToolCardView` 头栏（仅 write / edit）

## Problem

大文件 `write`（及大段 `edit`）时，模型先长时间流式生成 tool 参数。当前卡片：

1. 只显示路径（或更糟：参数未齐时 `compactJSON` 整段 JSON 截断），看不出是否还在推进；
2. 用户会以为卡住。

Thinking 折叠头已有 `· ~N tokens` 活态；write/edit 需要对齐。

## Goals

1. write / edit 头栏：**工具名 + 文件路径 + 流式上涨的估算 tokens**。
2. **绝不**在 write/edit 头栏展示 arguments 的 JSON / compactJSON。
3. 估算口径与 Thinking 一致：`chars ÷ 4`，大数 `~1.2k`，后缀 `tokens`。
4. 流式进行中有 mini spinner；结束后保留最终 `~N tokens`，去掉 spinner（或改回完成勾）。

## Non-goals

- 不接真实 API / RPC usage tokens
- 不改 bash / read / grep 等其它工具的摘要策略（可继续用现有 `argsSummary`）
- 不在卡片默认展开正文预览
- 不把完整 `content` 存进 `ToolCallBlock`（只存字符数）
- 不改 tool 执行结果区（`ToolRun.output`）

## Approach（已选）

**纯 convert + UI：**

- `ToolCallBlock` 增加可选 `payloadChars: Int`（默认 0）。
- `ChatSession.convert` / `argsSummary` 对 write/edit 专用摘要：
  - 路径：`path` 或 `file_path`；尚未解析出字符串时显示 `…`（**禁止** JSON fallback）。
  - `payloadChars`：write → `content` 字符串长度；edit → 各 `edits[].newText`（及旧版顶层 `newText`）长度之和。缺省 0。
- `ToolCardView`：当 `name` 为 `write`/`edit` 且 `payloadChars > 0` 时，在路径旁显示 `· ~{fmt} tokens`（复用 `ThinkingTokenEstimate`）。
- 活态：`isStreaming || run?.isRunning == true` 时显示 mini spinner（需把 `isStreaming` 传入 `ToolCardView`，与 Thinking 同源）。

未选：存全文预览（过重）；仅 `tool_execution` 阶段显示（长等待发生在参数流，太晚）。

## UI Spec

头栏（write / edit）：

| 状态 | 展示 |
|------|------|
| 流式中、尚无 path | `pencil` + `write` + `…` + spinner |
| 流式中、有 path、content 空 | `pencil` + `write` + `{path}` + spinner |
| 流式中、有 path、有 content | `pencil` + `write` + `{path}` + `· ~{fmt} tokens` + spinner |
| 已结束、有 content | `pencil` + `write` + `{path}` + `· ~{fmt} tokens` + ✓/✗ |
| 已结束、无 content | `pencil` + `write` + `{path}` + ✓/✗（与现网接近） |

`edit` 同理（工具名 `edit`）。路径仍用现有 `PathLinkedText`（可点路径）。

## Data

```swift
struct ToolCallBlock {
    let id: String
    let name: String
    let argsSummary: String  // write/edit: path or "…" only
    var payloadChars: Int = 0
}
```

提取规则（纯函数，单测覆盖）：

- `write`: `content` string utf16/Character count（与 Thinking 同一 `text.count`）
- `edit`: sum of `edits` array `newText` strings；若无 `edits`，回退顶层 `newText`
- 其它工具：`payloadChars = 0`，`argsSummary` 行为不变

## Tests

- write 有 path+content → summary=path，payloadChars=content.count
- write 仅部分 JSON 无 path → summary=`…`，绝不含 `{`
- edit 多段 newText → payloadChars 为合计
- `ThinkingTokenEstimate.labelSuffix` 对 payload 字符复用（或薄封装）格式正确
- 流式 MessageRow 把 `isStreaming` 传到 ToolCard

## Out of scope follow-ups

- 展开区预览正在写入的 content 尾部
- 按行数显示（`N lines`）作为 tokens 的补充
