# 工具调用摘要可读化设计（find / grep / subagent）

- 日期：2026-07-26
- 类型：设计文档（documentation-only，本文档不改动任何 Swift / TS / 测试 / 构建）
- 状态：已批准，待实现

## 1. 背景与目标

截图证据：`find` / `grep` 卡片头直接展示原始 JSON（如 `{"pattern":"*.swift","path":"Sources"}`）。根因是集中式摘要层未识别这三个工具，回退到通用 JSON 输出。

目标：在**集中式摘要层**（`ToolCallSummary`）为 `find`、`grep`、`subagent` 增加专用分支，使所有展示面都拿到可读摘要；不改任何视图，不改任何工具调用本身。

## 2. 范围（Scope）

为以下三种工具在 `ToolCallSummary` 中新增可读摘要与截断回退：

- `find`：输出 `pattern`（可选 ` in path`）。
- `grep`：输出 `/pattern/`（可选 ` in path`）。
- `subagent`：按下文优先级输出 `abort <agentId>` / `<agent> — <truncated task>` / `<N> tasks` / `<N>-step chain`。

集中层修复后自动覆盖全部消费面（见 §4）。

## 3. 非目标（Non-goals）

- 不改 `SubagentToolCardView`、`ToolCardView`、`SubagentPanel` 等任何视图；它们只读取 `ToolCallBlock.argsSummary`。
- 不改 TS 端 `PiExt/subagent/index.ts` 的终端渲染（已正确，作为本设计的格式参考）。
- 不改工具参数 schema、不改任何工具的 `execute` 行为。
- 不改 `make-app.sh` / `scripts/` / 打包流程。
- 不为其它工具（write/edit/bash/read/ls/web_*/generate_image/browser，已有专用分支）改行为。

## 4. 数据流与根因

### 4.1 集中式入口

所有摘要由 `Sources/PipiUI/ChatSession.swift` 中的 `enum ToolCallSummary` 唯一产出：

- `summarize(name:args:)`（`J` 入参，主转录流走这里，见 `ChatSession.swift:1461`、`:1779`）。
- `summarize(name:argsJSON:)`（JSON 字符串入参；subagent 面板 item 头走这里，见 `SubagentPanel.swift:628`）。
- `summarizeActivity(_:)`（`"toolName {json…}"` 入参；subagent 面板“正在执行”行走这里，见 `SubagentPanel.swift:370`）。

后两者最终都汇入 `summarize(name:args:)`，因此单点修复即覆盖所有面。

### 4.2 根因

`summarize(name:args:)` 的 `switch` 没有 `find`/`grep`/`subagent` 分支，落入 `default` → `legacySummary`。`legacySummary` 只识别 `command` / `path` / `file_path`：

- `find`/`grep` 的关键参数是 `pattern`（不匹配）；
- `subagent` 的参数是 `agent` / `task` / `tasks` / `chain` / `action` / `agentId`（无一匹配）。

于是 `legacySummary` 退到末尾的 `args.compactJSON`，卡片头渲染出原始 JSON。

### 4.3 为何 `SubagentToolCardView` 仍需好值

主转录中的 `SubagentToolCardView`（`MessageViews.swift:454`）通常**绕过** `argsSummary`，按 agent 行渲染；但两处仍依赖集中层：

1. agent 尚未到达时的早期 fallback（`agentsFor(call).isEmpty` 时退回普通 `ToolCardView`，读 `argsSummary`）；
2. subagent 面板的“正在执行”行（`summarizeActivity`）与 item 头（`summarize(name:argsJSON:)`）。

因此修复点必须落在集中层，而非视图。

## 5. 精确格式规则

### 5.1 `find`

`summarize(name: "find", args:)`：

- `pattern = args["pattern"].string`；为空/缺失时取 `"*"`。
- `path = args["path"].string`（非空时使用）。
- 输出：`pattern`；当 `path` 非空时追加 ` in <path>`。

> 例：`{"pattern":"*.swift","path":"Sources"}` → `*.swift in Sources`；
> `{"pattern":"*.md"}` → `*.md`。

### 5.2 `grep`

`summarize(name: "grep", args:)`：

- `pattern = args["pattern"].string`；为空/缺失时取 `"…"`。
- `path = args["path"].string`（非空时使用）。
- 输出：`/<pattern>/`；当 `path` 非空时追加 ` in <path>`。

> 例：`{"pattern":"ToolCallSummary","path":"Sources"}` → `/ToolCallSummary/ in Sources`。

### 5.3 `subagent`

`summarize(name: "subagent", args:)`，按下列**优先级**取第一个命中：

| 优先级 | 条件 | 输出 |
|---|---|---|
| 1 | `args["action"] == "abort"` | `abort <agentId>`；`agentId` 缺失时 `abort …` |
| 2 | `agent` 非空 | `<agent>` +（`task` 非空时 ` — <truncated task>`） |
| 3 | `tasks` 数组非空 | `<N> tasks`（N = `tasks.count`） |
| 4 | `chain` 数组非空 | `<N>-step chain`（N = `chain.count`） |
| 5 | 兜底 | `…` |

任务文本截断规则（用于第 2 项的 `truncated task`）：

- 将连续空白折叠为单个空格。
- 长度 > 80 时截断为前 80 字符并追加 `…`。（与现有 `generate_image` 的 80 字符上限一致。）
- 分隔符为「空格 + U+2014 + 空格」（` — `）。

> 例：`{"agent":"researcher","task":"查找 X 的实现"}` → `researcher — 查找 X 的实现`；
> `{"action":"abort","agentId":"agent-abc-123"}` → `abort agent-abc-123`；
> `{"tasks":[{…},{…}]}` → `2 tasks`；
> `{"chain":[{…},{…},{…}]}` → `3-step chain`。

### 5.4 截断参数文本的回退（`scrapeSummary`）

subagent 桥会在 ~400 字符处截断 args（edit/write 已知会变成非法 JSON），`summarize(name:argsJSON:)` 解析失败后调用 `scrapeSummary`。需为其补齐对 `pattern` / `path` / `agent` / `task` / `action` / `agentId` 的识别：

- `find` / `grep`：抓取 `pattern`（缺失按 §5.1/§5.2 的默认值）与 `path`，按 §5.1/§5.2 同样拼装。
- `subagent`：复用 §5.3 优先级，但字段来自 `scrapeJSONString(key:from:)`：
  - 抓到 `action == "abort"` → `abort <agentId or …>`。
  - 否则抓到 `agent` → `<agent>` +（抓到 `task` 时 ` — <截断 task>`）。
  - 否则 `…`（`tasks`/`chain` 被截断时计数通常不可解析，回退 `…`，绝不输出原始 JSON）。
- `summarizeActivity` / `summarize(name:argsJSON:)` 的现有“含 `{` 且 > 120 字符则截断”兜底保持不变；本文新增分支后，`find`/`grep`/`subagent` 在到达该兜底前即被消费。

不变约束：对这三种工具，输出**永远不得包含 `{`**。

## 6. 测试验收标准（实现阶段新增于 `ToolCallSummaryTests.swift`）

需覆盖以下断言（每条都断言 `summary.contains("{") == false`）：

1. **直接摘要（`summarize(name:args:)`）**
   - `find` + `pattern` + `path` → `*.swift in Sources`；无 `path` → `*.md`；无 `pattern` → `*`。
   - `grep` + `pattern` + `path` → `/foo/ in Sources`；无 `pattern` → `/…/`。
   - `subagent`：single → `<agent> — <task>`；仅 `agent` → `<agent>`；abort → `abort <agentId>`；abort 无 id → `abort …`；`tasks`（2 项）→ `2 tasks`；`chain`（3 项）→ `3-step chain`；空 → `…`。
   - `subagent` 长 `task`（> 80 字符）截断且以 `…` 结尾、不含 `{`。
2. **截断 args 文本（`summarize(name:argsJSON:)`）**
   - `find`/`grep`/`subagent` 各给一段被截断的非法 JSON，仍能抓出 `pattern`/`agent`/`task` 并输出可读摘要，不含 `{`。
3. **活动文本（`summarizeActivity`）**
   - `"find {\"pattern\":\"*.swift\",\"path\":\"Sources\"}"` → `*.swift in Sources`，不含 `{`。
   - `"subagent {\"agent\":\"researcher\",\"task\":\"do X\"}"` → `researcher — do X`，不含 `{`。
4. **回归**：现有 write/edit/bash/generate_image/read/activity 用例保持不变。

## 7. 后续预期改动文件（实现阶段，本文档不触碰）

- `Sources/PipiUI/ChatSession.swift`
  - `ToolCallSummary.summarize(name:args:)`：新增 `find` / `grep` / `subagent` 分支（建议加私有 helper `findSummary` / `grepSummary` / `subagentSummary`）。
  - `ToolCallSummary.scrapeSummary(name:from:)`：新增对 `find` / `grep` / `subagent` 的抓取分支。
  - 不改 `legacySummary`、`summarizeActivity`、`summarize(name:argsJSON:)` 的外层骨架。
- `Tests/PipiUITests/ToolCallSummaryTests.swift`：按 §6 新增用例。

无视图、无 TS、无构建脚本改动。
