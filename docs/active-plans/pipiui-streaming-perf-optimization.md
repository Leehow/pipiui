# 流式性能优化（token→像素热路径）

> 状态：进行中（2026-08-07）。来源：`opt-a-datapath` / `opt-b-viewpath` / `our-md-recon` 三轮代码级盘点 + hermes `StreamingMd`(#67236) 对照。
> 范围：**商定要做的一组** = S4 / S1a / A4 / S1b / S2 / A2 / markdown①②。明确**排除**（本计划不做）：S3 历史上翻虚拟化、B 内存裁剪、A1 stampToolDurations、A3 回放风暴、远端全量→增量快照。

## 目标（可验证）

1. 流式出 token 时主线程更省：去掉每 delta 的 O(n) 计长 + 每事件落盘 + 全量 partial 重建（S1a/S1b/A2）。
2. 流式渲染更顺：tail 增量解析、流式态延迟高亮 + 测高/渲染节流（markdown①②/S2）。
3. 远端不再强行拽回底部（S4，UX bug）。
4. 拖右栏不再每帧 reflow 全部 markdown（A4）。

验收总则：**用户可见行为不变**（流式可见性、贴底、渲染结果、远端显示），现有 `StreamingVisibilityTests` / `TypingPerfTests` 通过；`swift build` 通过。

---

## Slice A — 远端"强制贴底"UX 修复（S4）

- **文件**：`Sources/PipiUI/Remote/LocalRemoteWebPage.swift`
- **现状**：`pollSnapshot` → changed 时 `transcript.replaceChildren(...)` 后**无条件** `transcript.scrollTop = transcript.scrollHeight`（~677），用户往上翻历史会被拽回底部。
- **改动**：实现"仅当用户已在底部附近时才自动贴底"。跟踪滚动位置（记录上次 scroll 位置 / 是否在底部阈值内），用户主动上翻则保持其位置；新内容到达只在"贴底态"下跟随。参照桌面端 `StickToBottomTracker` 的语义（但这是浏览器端 JS，独立实现）。
- **不做**：不动全量 snapshot JSON / 全 DOM 重渲（那是"远端全量→增量"，本计划排除）。
- **验收**：远端流式中用户上翻→停在上翻位置不被拽回；在底部→仍自动跟随。
- **verify**：`swift build`

## Slice B — 右栏拖宽 settled-freeze（A4）

- **文件**：`Sources/PipiUI/Views/ChatDetailView.swift`（`rightPanelDragWidth` ~608-616、`.frame(width:)` ~588-591、`scheduleChatColumnWidthSettleRepin` ~776-823）、`Sources/PipiUI/ResizeThrottle.swift`、`Sources/PipiUI/App.swift`（现有窗口 live-resize settled 冻结 ~179-200，作为要照抄的模式）。
- **现状**：拖右栏分栏时 `rightPanelDragWidth` 连续写入并立刻用于 `.frame(width:)`，列宽变化使所有 markdown `normalizedWidth` 失效重测；窗口拖动有 `ResizeThrottle` settled 冻结，右栏没有。
- **改动**：把窗口拖动那套"live-resize 期间冻结 settled 布局、松手后 re-pin"的现成模式接到右栏拖动上。拖动中不重测 markdown，松手 settle 后再重测。
- **约束**：**只动右栏拖动相关区域**；不要碰 `StickToBottomTracker` / transcript 滚动区域（那是别的 slice 的关注点）。
- **验收**：拖右栏分栏时 transcript/markdown 不再每帧 reflow（与拖窗口同等顺滑）。
- **verify**：`swift build`

## Slice C — markdown 渲染热区（S2 + markdown①② + opt-b#11）

- **文件**：`Sources/PipiUI/Views/MarkdownView.swift`（`MarkdownStreamingRenderer` ~519-650、`MarkdownNativeLayoutView` 测高 ~668-1009、`cachedParse`/`parseCache` ~28-45）、`Sources/PipiUI/Views/MessageViews.swift`（streaming 行 `AssistantBlockLayout.plan` ~215-221）。
- **改动**：
  1. **markdown① 增量行扫描游标**：`MarkdownStreamingRenderer` 的 tail 不再每次把整段 tail 字符串丢进 `cachedParse` 全量重解析；维护前向扫描游标 + 行缓冲，只消费新增完整行，partial fence 行攒到 `\n` 再判。tail 成本 O(新行) 而非 O(tail)。
  2. **markdown② + S2 流式延迟高亮 + 测高节流**：流式态下 settled 块才做重高亮/重布局，tail 只跑轻量解析；给 tail 渲染加一层节流（~30/s 或 ~50ms），避免每个 50ms coalesce 都触发 `sizeThatFits`/`ensureLayout` 全量测高。settled 后补全高亮。
  3. **opt-b#11**：streaming 行 `AssistantBlockLayout.plan` 不要每次 flush 全量重 plan（增量/缓存）。
- **约束**：**不改变 settled 渲染结果**（已结算消息的显示完全不变）；只优化流式态热路径。保持现有 stable/tail 边界语义（open-fence 内空行不算边界、未闭合 ``` EOF flush 成完整 code 块）。
- **验收**：长消息流式时主线程开销下降（tail 增量、高亮延迟、测高节流）；settled 渲染不变；`StreamingVisibilityTests` 通过。
- **verify**：`swift build`；worker 另跑 `swift test --filter StreamingVisibility` 与 `TypingPerfTests` 并上报。

## Slice D — 数据通路热区（S1a + S1b + A2）

- **文件**：`Sources/PipiUI/ChatSession.swift`（`handleEvent` `message_update` ~1870-1891、`message_start` ~1863-1868、`convert`/`materializePendingStreamMessage` ~2107-2353、`contentLength` ~1886-1888/2293-2303）、`Sources/PipiUI/StreamingMessageAssembler.swift`（`buildPartialMessage` ~131-161、toolcall 每 delta 全量 `parseObject` ~70-79）、`Sources/PipiUI/DiagnosticsStream.swift`（~25-42 每事件 open/seek/write/close）、`Sources/PipiUI/FileChangePresentation.swift`（~15-29 write 读全 content cap 120k）。
- **改动**：
  1. **S1a 计长**：用增量维护的字符计数替换每条 `message_update` 的 O(n) `contentLength` 全文扫描。
  2. **S1a 诊断落盘**：`DiagnosticsStream` 不要每事件 open/seek/write/close；批量/节流写盘（或移出热路径）。
  3. **S1a message_start**：把 `message_start` 立即 `convert`+发布（~1863-1868）改成走 50ms 桶，去掉开头那一次同步发布抖动。
  4. **S1b 全量 partial**：收敛"每条 delta 在 50ms 节流前就 `apply`+`buildPartialMessage` 全量快照"。让 50ms flush 成为物化点；apply 阶段做廉价累加、不构造全量 partial 快照（hidden 会话已跳过 convert，扩展到 apply/build 也变便宜）。
  5. **A2 convert tool 路径**：不要每 delta 全量重 parse `argumentsJSON`；缓存 `ToolCallSummary`/`FileChangePayload`；write 不每 flush 重读全 content。
- **先量后改**（执行细节，不是审批门）：开工前先用现有 `TypingPerfTests` / 计时日志建立 baseline，确认瓶颈位置，改完再量、上报 before/after。
- **约束**：**用户可见行为不变**（`StreamingVisibilityTests` 是契约）。不破坏 50ms 合并语义、hidden 会话优化、双协议（legacy snapshot / delta）分路径。
- **验收**：流式 per-delta 主线程税下降；可见性测试通过；行为不变。
- **verify**：`swift build`；worker 另跑 `swift test --filter StreamingVisibility` 与 `TypingPerfTests` 并上报。

---

## 切片划分依据（文件互不冲突 → 一轮并行）

| Slice | 主文件 | 与其他 slice 是否冲突 |
| ----- | ------ | -------------------- |
| A | LocalRemoteWebPage.swift | 无 |
| B | ChatDetailView.swift (+ResizeThrottle/App) | 无（右栏区域） |
| C | MarkdownView.swift + MessageViews.swift | 无 |
| D | ChatSession.swift + StreamingMessageAssembler + DiagnosticsStream + FileChangePresentation | 无 |

## 风险

- **C/D 是热路径核心**：最易回归"流式可见性"。缓解：契约测试 `StreamingVisibilityTests` + 我 review + 对 C/D 单独派 reviewer。
- **D 的 S1b**（收敛全量 partial）设计敏感：若 50ms 物化点改错，可能出现显示滞后或丢字。worker 必须保留 50ms 合并语义并跑可见性测试。
- **代码级发现未实测**：所有"O(n)/~20Hz"都是读码推断；D 的"先量后改"用于校准，若实测显示真瓶颈另在他处，上报后调整。

## 明确不做（避免范围蔓延）

S3 历史上翻虚拟化（大改、单独 slice）｜ B 内存裁剪（长会话才显现）｜ A1 stampToolDurations 索引 ｜ A3 回放风暴合并 ｜ 远端全量→增量快照（等 tunnel-reconnect 收尾后同主题做）。
