# Subagent 工具展示对齐主 Agent

日期：2026-07-24  
状态：已实现

## 问题

1. 右侧 Subagent 流水工具行直接显示 `read {"path":…}` JSON，且不折叠。
2. 主会话 `SubagentToolCardView` 运行中副标题用 `activity` JSON，不用任务 title。
3. 「正在执行」条同样刷 JSON。

## 检索到的露 JSON 点

| 位置 | 现状 | 改法 |
|---|---|---|
| `SubagentToolCardView.statusLine` running | `agent.activity` | `listSubtitle`（title/task） |
| `AgentDetailView.runningActivity` | `agent.activity` | `ToolCallSummary` 摘要 |
| `AgentLogRow` kind=tool | `item.text` 原始 JSON | 主会话风格折叠行 + summary；展开看完整 args / 邻近 result |
| Agent 列表 `listSubtitle` | 已是 title/task | 不动 |
| 主会话 `ToolCardView` | 已用 argsSummary | 不动 |

## 实现要点

- 复用 `ToolCallSummary.summarize(name:args:)`；增加从 JSON 字符串 / `name {json}` activity 解析的入口。
- `AgentLogRow` 工具行视觉对齐 `ToolCardView` 头：图标 + 工具名 + summary，默认折叠；有结果时可展开。
- 成功打包刷新 `build/PipiUI.app`。
