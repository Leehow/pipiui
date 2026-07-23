# Thinking 折叠头实时估算 tokens — Design

Date: 2026-07-23  
Status: Approved (pending user review of written spec)  
Scope: Thinking block UI + MessageRow streaming flag only

## Problem

长思考时折叠头只有静态 `Thinking` 文案，用户无法判断 agent 是否仍在工作。需要折叠头上有一个持续上涨的估算 tokens 数，并在进行中有活态指示。

## Goals

1. 流式 thinking 过程中，折叠头显示估算 tokens，并随已流出正文上涨。
2. 进行中附加活态（mini spinner）。
3. 结束后保留最终估算，去掉 spinner。
4. 估算口径：`chars ÷ 4`（非真实 tokenizer）；大数用 `~1.2k` 形式；后缀带 `tokens`。

## Non-goals

- 不接入真实 API / RPC usage tokens
- 不改 PiProcess、RPC 协议、`get_session_stats`
- 不在顶栏/输入栏重复显示本次 stream tokens
- 不改 thinking 默认展开行为
- 不增加耗时计时（首版；无字长时间仅靠 spinner）
- 不改 tool 卡片、subagent 面板的 activity 文案

## Approach（已选）

**方案 1：纯 UI 层估算**

- `ThinkingBlockView` 根据 `text` + `isStreaming` 本地计算并展示
- `MessageRow` 增加 `isStreaming`，由 `ChatDetailView` 对 `streamingItem` 传入 `true`
- 不增加 `ChatSession` 新的 `@Published` 累计字段

未选：Session 级 `streamingThinkingTokens`（过重）；仅顶栏全局计数（不解决 Thinking 头死寂问题）。

## UI Spec

### 折叠头状态

| 状态 | 展示 |
|------|------|
| 流式中、text 空 | `brain` + `Thinking` + mini `ProgressView` |
| 流式中、text 非空 | `brain` + `Thinking · ~{fmt} tokens` + mini `ProgressView` |
| 已结束、text 非空 | `brain` + `Thinking · ~{fmt} tokens` |
| 已结束、text 空 | `brain` + `Thinking`（与现网一致） |

展开区：保持现有 italic / secondary / 可选中正文，不变。

### 估算与格式

```swift
// 估算
let n = text.isEmpty ? 0 : max(1, Int((Double(text.count) / 4.0).rounded()))

// 格式化 fmt（不含 ~ 与单位）
// n < 1000  → "\(n)"            e.g. 123
// n < 10_000 → one decimal k    e.g. 1.2k  (n/1000, 一位小数，去掉无意义 .0 可选：统一一位或整数 k)
// 约定：
//   n < 1000           → "\(n)"
//   n >= 1000          → String(format: "%.1fk", Double(n) / 1000.0) 并去掉末尾 ".0k"→"k" 若为整千
// 例：1000 → 1k；1200 → 1.2k；15_400 → 15.4k
```

完整标签片段：`Thinking · ~1.2k tokens`（中间用中间点 `·` 或 ` · `，与 app 内 subagent 完成行风格一致）。

空 text 时**不**显示 `· ~0 tokens`。

### 组件 API

```swift
struct ThinkingBlockView: View {
    let text: String
    var isStreaming: Bool = false
    // expanded state 保持 @State private
}
```

```swift
struct MessageRow: View, Equatable {
    let item: ChatItem
    let toolRuns: [String: ToolRun]
    var subagents: [SubagentInfo] = []
    var isStreaming: Bool = false   // NEW；纳入 ==
    var onSelectAgent: ((String) -> Void)? = nil
}
```

`MessageRow` 内：`ThinkingBlockView(text:text, isStreaming: isStreaming)`  
（仅当前 message 在流式时为 true；历史行恒 false。同一 assistant 消息内多个 thinking 块共享该 flag 可接受——流式消息通常进行中。）

### 接线

`ChatDetailView`：

- `ForEach(session.transcript)` → `MessageRow(..., isStreaming: false)`
- `session.streamingItem` → `MessageRow(..., isStreaming: session.isStreaming)`

### 活态

- `ProgressView().controlSize(.mini)` 放在 label 行尾（`Thinking` 文案与 tokens 之后），与 `ToolCardView` 运行中 spinner 一致。
- 不强制改 `DisclosureGroup` 展开行为；用户仍可手动展开看正文。

## Data flow

```
message_update → ChatSession.scheduleStreamFlush (50ms)
  → streamingItem.blocks[.thinking(text)]
  → ChatDetailView MessageRow(isStreaming: true)
  → ThinkingBlockView(text, isStreaming: true)
  → label 显示 ~tokens + spinner
agent_settled / message_end
  → 进入 transcript，isStreaming: false
  → 保留最终 ~tokens，无 spinner
```

## Testing

1. 开 thinking 等级非 off，发一条会触发长思考的消息。
2. 观察折叠头：先 spinner，随后 `~N tokens` 随流上涨（节流约 50ms 一跳，属预期）。
3. 结束后 spinner 消失，最终 `~N tokens` 仍在。
4. 刷新/重开历史会话：已落盘的 thinking 块显示最终估算，无 spinner。
5. thinking off 或无 thinking 块：UI 无回归。
6. 展开/折叠 thinking 正文仍正常。

## Files to touch

| 文件 | 变更 |
|------|------|
| `Sources/PipiUI/Views/MessageViews.swift` | `ThinkingBlockView` 估算+label；`MessageRow` 加 `isStreaming` |
| `Sources/PipiUI/Views/ChatDetailView.swift` | 给 streaming 行传入 `isStreaming` |

预计不改：`ChatSession.swift`、`PiProcess.swift`、InputBar、统计请求。

## Risks / follow-ups

- 模型长时间 thinking 却迟迟不吐字：仅 spinner、数字不涨 → 首版接受；若不够再加耗时。
- chars/4 对中文偏低估、对代码偏高估 → 产品接受为“活跃指示”而非计费。
- `MessageRow` Equatable 必须包含 `isStreaming`，否则流式开始/结束时可能不刷新 label 活态。
