# 已完成非文字块分组折叠 — Design

Date: 2026-07-24  
Status: Approved  
Scope: 转录渲染层（thinking / toolCall；跨 pi tool-round 消息）

## Problem

助手一轮里会产生大量 Thinking / tool 折叠条。结束后仍各自占一行，中间栏被非文字条占满，难扫正文。

## Goals

1. **流式整轮进行中**：thinking / tool 仍各自一条（方案 B）。
2. **整轮结束后**：两段文字之间连续的 thinking + toolCall 收成一条汇总 disclosure。
3. 汇总标题形如：`N steps · Thinking · read · bash`（按出现顺序列出标签）。
4. 点开汇总后，内部仍是原来的各条（各自可再展开）。
5. 文字、图片、视频始终单独显示，不进组。

## Non-goals

- 不改 `ChatBlock` / RPC / 入库形状
- 不做「边跑边收」（用户明确选 B）
- 不持久化组的展开状态
- 不把 image/video 并进组

## Approach

纯渲染层：

1. `AssistantBlockLayout.planTranscript(items:)` — 连续 `assistant` `ChatItem` 先拼 blocks（pi 每个 tool 回合一条消息），再 plan。
2. `AssistantBlockLayout.plan(blocks:groupFinished:)` →  
   `[.text | .singleton(ChatBlock) | .finishedGroup([ChatBlock])]`。

- 历史行走 `planTranscript`；streaming 行仍单条 `plan(..., groupFinished: false)`。
- 仅当连续可分组块 **≥ 2** 时生成 `finishedGroup`；单条保持 singleton。
- 可分组：`.thinking`、`.toolCall`。边界：`.text` / `.image` / `.video`；user/system 打断 coalesce。
- 先 `MessageTextBlocks.mergeAdjacent`，再 plan。

## UI

- `FinishedNonTextGroupView`：默认折叠；整条 header 可点 + 小手光标；chevron 作状态。
- 展开：`VStack` 内复用 `ThinkingBlockView` / `ToolCardView` / `SubagentToolCardView`。
- 历史助手行由 `AssistantSegmentsView` 渲染 coalesced segments。

## Tests

纯函数单测：流式不分组、结束后按文字切段分组、单条不包组、image 断组、summary 文案、跨 assistant 消息合并、user 打断 coalesce。
