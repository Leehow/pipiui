# 工具调用可读摘要设计（find / grep / subagent）— 本次修复权威规格

- 日期：2026-07-26
- 类型：设计文档（documentation-only；本规格不改动任何 Swift / TypeScript / 测试 / 脚本 / 构建）
- 状态：已批准，待实现

> **权威性声明**：本文件（复数 `…summaries…`）是本次"工具调用摘要可读化"修复的**权威规格**。
> 同目录旧文件 `2026-07-26-tool-call-readable-summary-design.md`（单数）为更早草案，**不**作为本次修复的依据；本规格与之在 grep 是否包裹斜杠、subagent 分隔符与并行/链格式、以及是否覆盖 TypeScript 活动通道上均有差异，一律以本规格为准。该旧文件保持不变，不修改、不删除。

## 1. 目标与非目标

### 1.1 目标
将**主工具卡片**与**子代理活动**中 `find` / `grep` / `subagent` 三个工具的摘要，从原始参数 JSON 改为人类可读的简短文字。所有可读文字由集中摘要层产出，视图层只读取、不自行解析。

### 1.2 非目标（明确不动）
- 不改任何工具的执行行为（`execute` / 工具参数 schema）。
- 不改 `ToolRun` 的输出与执行状态。
- 不改卡片展开/折叠、选中/置灰等任何卡片状态。
- 不改任何视图结构（`ToolCardView` / `SubagentToolCardView` / `SubagentPanel` 仅照常读取摘要）。
- 不为其它工具（write / edit / bash / read / ls / web_search / fetch_content / generate_image / browser，已有专用分支）改行为。
- 不改 `make-app.sh` / `scripts/` / 打包流程。

## 2. 数据流

两条相互独立的摘要通道，外加一条与之独立的执行通道。

### 2.1 Swift 主通道（主工具卡片）
`ToolCallSummary → ToolCallBlock.argsSummary → ToolCardView`

- 集中摘要器 `ToolCallSummary.summarize(name:args:)`（`Sources/PipiUI/ChatSession.swift`，约 `:61`）产出 `(summary, payloadChars)`。
- 摘要写入 `ToolCallBlock.argsSummary`（同文件）。
- 主转录卡片 `ToolCardView`（`Sources/PipiUI/Views/MessageViews.swift:1331`）读取 `argsSummary` 渲染卡片头。
- 子代理面板的两个入口最终都汇入同一 `summarize(name:args:)`：
  - `summarize(name:argsJSON:)`（`ChatSession.swift:81`）：面板日志项 item 头；args 为 JSON 字符串，解析失败时走 `scrapeSummary` 抓字段。
  - `summarizeActivity(_:)`（`ChatSession.swift:152`）：面板"正在执行"行，入参形如 `toolName {json…}`。

### 2.2 TypeScript 活动通道（子代理活动）
`summarizeToolArgsForUI → bridge activity/log → SubagentStore → SubagentPanel`

- `summarizeToolArgsForUI(toolName, args)`（`Sources/PipiUI/PiExt/subagent/index.ts:131`）产出纯文本摘要。
- 该摘要写入两条桥报文（`index.ts` 内）：
  - 活动行：`pipiuiActivity = `${part.name} ${summary}``（`:1653`）。
  - 日志项：`pipiuiItems.push({ itemType:"tool", name, text: summary })` → `pipiuiReport({ kind:"log", … })`（`:1657` / `:1664`）。
- 桥报文经 Swift `SubagentStore`（`Sources/PipiUI/ChatSession.swift`）落地为面板模型。
- `SubagentPanel`（`Sources/PipiUI/Views/SubagentPanel.swift`）渲染活动行与日志 item 头（分别经 `summarizeActivity` 与 `summarize(name:argsJSON:)`）。

### 2.3 执行通道（独立）
`ToolRun`（`Sources/PipiUI/ChatSession.swift:251`）承载工具的真实输入/输出与执行状态，与 §2.1 / §2.2 两条摘要通道完全独立；本规格不触碰其输出。

## 3. 精确摘要契约（Swift 与 TypeScript 同输入 → 同正文）

实现须保证：对同一份（已解析的）参数，Swift `summarize(name:args:)`、`summarizeActivity`、`summarize(name:argsJSON:)` 的可解析分支，与 TS `summarizeToolArgsForUI` 产出**逐字符相同**的正文。Swift `scrapeSummary`（仅处理被截断的 JSON 字符串，无 TS 对应）须在所需字段可恢复时收敛到同一正文。

记号：某字符串字段"非空"指去首尾空白后长度 > 0。

### 3.1 find
- `pattern = args["pattern"]`；缺失/空 → `"*"`。
- `path = args["path"]`；非空时使用。
- 输出：`<pattern>`；`path` 非空时追加 ` in <path>`。
- 例：`{pattern:"*.swift", path:"Sources"}` → `*.swift in Sources`；`{pattern:"*.md"}` → `*.md`；`{}` → `*`。

### 3.2 grep
- `pattern = args["pattern"]`；缺失/空 → `"…"`。
- `path = args["path"]`；非空时使用。
- `ignoreCase = args["ignoreCase"]` 为真时使用。
- 输出：`<pattern>`；`path` 非空时追加 ` in <path>`；`ignoreCase` 为真时再追加 ` (ignore case)`。
- 例：`{pattern:"foo", path:"src", ignoreCase:true}` → `foo in src (ignore case)`；`{pattern:"foo"}` → `foo`；`{}` → `…`。

> 注意：本规格 grep 输出为**裸** `pattern`，不包裹斜杠；这与同目录旧草案不同，以本规格为准。

### 3.3 subagent
按下列优先级取第一个命中（`A` / `S` / `P` / `C` 定义见表后）：

| 优先级 | 条件 | 输出 |
|---|---|---|
| 1 | `A`（`action == "abort"`） | `abort <agentId>`；`agentId` 缺失/空 → `abort …` |
| 2 | `S + P + C` 中真值 ≥ 2（非法混合模式） | `…` |
| 3 | `P`（`tasks` 为数组） | 非空 → `parallel×<N>`（`N = tasks.count`）；空 → `…` |
| 4 | `C`（`chain` 为数组） | 非空 → `chain×<N>`（`N = chain.count`）；空 → `…` |
| 5 | `S`（`agent` 或 `task` 非空） | `<agent|…>: <task|…>`（task 走 §3.4） |
| 6 | 兜底 | `…` |

定义：
- `A = (args["action"] == "abort")`。
- `S = (args["agent"] 非空) OR (args["task"] 非空)`。
- `P = (args["tasks"] 为数组)`（不论是否为空）。
- `C = (args["chain"] 为数组)`（不论是否为空）。

优先级 5 的槽位默认：`agent` 缺失/空 → 槽位取 `…`；`task` 缺失/空 → 槽位取 `…`。

例：
- `{agent:"researcher", task:"查找 X 的实现"}` → `researcher: 查找 X 的实现`
- `{agent:"researcher"}`（缺 task）→ `researcher: …`
- `{action:"abort", agentId:"agent-abc-123"}` → `abort agent-abc-123`
- `{action:"abort"}`（缺 agentId）→ `abort …`
- `{tasks:[{…},{…}]}` → `parallel×2`
- `{tasks:[]}` → `…`
- `{chain:[{…},{…},{…}]}` → `chain×3`
- `{agent:"x", tasks:[…]}`（非法混合）→ `…`
- `{}` → `…`

### 3.4 task 文本规整与截断
适用于 §3.3 优先级 5 的 task 槽位：
1. 将连续空白（含空格、制表、换行）折叠为单个空格，并去首尾空白。
2. 按"用户可见字符"（Unicode extended grapheme cluster）计数；超过 80 个时，取前 80 个并追加 `…`。
3. 奇偶性：Swift 用 `String.count`（即 grapheme cluster 数）；TS 须用 grapheme 切分（`Array.from(str)` 展开或 `Intl.Segmenter`），保证与 Swift 同输入同结果。测试输入以 ASCII / CJK 为主（两引擎下均为 1 个可见字符），避免 emoji 等会导致两引擎计数差异的边界。

### 3.5 不变式
- 对 `find` / `grep` / `subagent`，输出**永远不得包含 `{`**（即绝不向用户回显原始 JSON）。
- 缺省占位符统一为 `…`（U+2026）；`find` 缺 pattern 的占位符为 `*`；subagent abort 缺 agentId 为 `abort …`。

## 4. 修改边界

### 4.1 预期改动（实现阶段；本规格不触碰任何源码 / 测试）
- `Sources/PipiUI/ChatSession.swift`
  - `ToolCallSummary.summarize(name:args:)`：新增 `find` / `grep` / `subagent` 分支（建议私有 helper `findSummary` / `grepSummary` / `subagentSummary`）。
  - `ToolCallSummary.scrapeSummary(name:from:)`：为 `find` / `grep` / `subagent` 补字段抓取（`pattern` / `path` / `agent` / `task` / `action` / `agentId`），按 §3 同契约拼装；`ignoreCase` 抓取为布尔真时同样追加 ` (ignore case)`；`tasks` / `chain` 被截断不可解析时回退 `…`。
  - 外层骨架（`legacySummary`、`summarizeActivity`、`summarize(name:argsJSON:)` 的截断兜底）不变。
- `Tests/PipiUITests/ToolCallSummaryTests.swift`：按 §5 新增用例。
- `Sources/PipiUI/PiExt/subagent/index.ts`：`summarizeToolArgsForUI` 新增 `find` / `grep` / `subagent` 分支，与 Swift 同契约。该函数当前未导出，为实现可单元测试，将其改为 `export function` 或抽到可导入的纯函数。
- TS 测试：新增 node 直接运行的 `Sources/PipiUI/PiExt/subagent/summarizeToolArgsForUI.test.ts`，用 `node --experimental-strip-types` 执行（与 `scripts/check-skilltier-gate.sh:81` 既有做法一致），断言与 Swift 同输入同输出。

### 4.2 禁止项
- 不重构任何视图。
- 不改 `ToolRun`、工具 `execute`、参数 schema。
- 不改构建 / 打包脚本。
- 不改同目录旧草案 `2026-07-26-tool-call-readable-summary-design.md`。

## 5. 测试、手工验收与回滚

### 5.1 自动化测试用例（Swift `ToolCallSummaryTests.swift` + TS `summarizeToolArgsForUI.test.ts`）
每条用例额外断言 `summary.contains("{") == false`。
1. **正常路径**
   - find：`{pattern,path}` → `*.swift in Sources`；无 path → `*.md`；无 pattern → `*`。
   - grep：`{pattern,path,ignoreCase:true}` → `foo in src (ignore case)`；无 path → `foo`；无 pattern → `…`；`ignoreCase:false` 不追加后缀。
   - subagent：single → `<agent>: <task>`；仅 agent → `<agent>: …`；abort → `abort <agentId>`；abort 无 id → `abort …`；`tasks`(2) → `parallel×2`；`tasks`([]) → `…`；`chain`(3) → `chain×3`；非法混合 → `…`；空 → `…`。
2. **空字段 / 缺字段**：上述"无 / 缺"分支均覆盖。
3. **Unicode 截断**：subagent `task` 含 CJK + 空白混排、长度 > 80 → 输出前 80 个可见字符 + `…`，且不含 `{`；Swift 与 TS 结果逐字符相同。
4. **非法 / 截断 JSON**（仅 Swift `summarize(name:argsJSON:)` + `scrapeSummary`）：给 find / grep / subagent 各一段在 ~400 字符处被截断的非法 JSON，仍能抓出 `pattern` / `agent` / `task` 并按契约输出可读摘要，不含 `{`；`tasks` / `chain` 被截断不可解析时回退 `…`。
5. **activity 入口**（仅 Swift `summarizeActivity`）：入参形如 `toolName {json}`，返回可读摘要正文、不含 `{`、不含工具名前缀。
   - `"find {\"pattern\":\"*.swift\",\"path\":\"Sources\"}"` → `*.swift in Sources`。
   - `"subagent {\"agent\":\"researcher\",\"task\":\"do X\"}"` → `researcher: do X`。
   - （工具名前缀由调用方 / 桥按现有边界拼接，摘要器内不加前缀。）
6. **既有工具回归**：write / edit / bash / read / ls / web_search / fetch_content / generate_image / browser 的现有摘要用例保持不变。

### 5.2 手工验收
- 主转录中触发 find / grep / subagent 工具调用：卡片头显示可读文字，不再是 JSON。
- 子代理面板"正在执行"行与日志 item 头显示可读文字。
- 卡片展开后的工具输出（`ToolRun`）、执行状态、展开/折叠行为与修复前一致。
- 同一调用在主卡片与子代理面板的文字表述一致。

### 5.3 回滚
- 仅新增 / 修改集中摘要层分支与对应测试；回滚即 revert 摘要器的 find / grep / subagent 分支及测试新增，视图与工具执行不受影响。

## 6. 自审
- [x] 无 TBD / 模糊项：所有字段、缺省值、分隔符、截断规则、测试位置均已明确。
- [x] 与 §3 契约一致：grep 为裸 pattern + 可选 ` in <path>` + 可选 ` (ignore case)`；subagent 单任务为 `<agent>: <task>`（冒号分隔），并行 `parallel×N`，链 `chain×N`，abort `abort <agentId>`；缺省 `…`，find 缺 pattern 为 `*`。
- [x] 奇偶性已规定（Swift `String.count` ↔ TS grapheme 切分）。
- [x] 数据流两条通道 + `ToolRun` 独立均已标注 `file:line`。
- [x] 修改边界明确：仅摘要器与相应测试；禁止重构视图 / 工具执行 / 打包。
- [x] 不变式：三类工具输出永不包含 `{`，不回显 JSON。
- [x] 与同目录旧单数草案的关系已声明：本规格为权威，旧草案保持不变。
