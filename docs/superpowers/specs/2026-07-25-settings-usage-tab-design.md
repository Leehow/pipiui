# 设置 → 用量 Tab（TokenLedger 聚合）

日期：2026-07-25  
状态：已实现（按 plan 经 SDD 重做）

## 问题

设置里已有模型列表（可见性 / 弱模型等），但缺少跨会话的 token / 费用消耗视图。用户需要回答：

1. 哪个模型最贵？
2. 消耗主要在主 agent，还是 explore / plan / general-purpose 等 subagent？
3. 哪些工具常出现在高消耗轮次？（近似归因，非精确计费）

社区 pi 扩展（`pi-usage`、`pi-token-usage` 等）是 TUI `/usage`，不能直接嵌进 macOS `SettingsSheet`。PipiUI 已有 `TokenLedger`（主会话 + subagent per-turn JSONL），应在此之上做 SwiftUI 聚合，而不是装 npm 扩展。

## 目标

- 设置新增独立 **用量** Tab（与模型 / 工具 / Subagent 模型并列）
- 数据源 v1：**仅** `TokenLedger`（active + `.1` 滚动备份）
- 三视图切换：`按模型` / `按角色` / `按工具`
- 精简行（Calls · Tokens · Cost）可展开看 ↑In / ↓Out / CacheR / CacheW / 命中率
- 二级拆分用于分析消耗大户（见下）

## 非目标（v1）

- 不扫原生 `~/.pi/agent/sessions`（预留 v2）
- 不装社区 pi usage / cost 扩展，不桥接 TUI
- 不导出 CSV / JSON
- 不接 provider 账号 quota API（Codex 5h 等）
- 不按 session / 项目 / 工作目录下钻
- 不按工具做「精确计费拆分」（API 只给整轮 usage）
- 不改 ledger 滚动策略 / 文件名（仍 `pipiui-token-ledger.jsonl`）

---

## 调研摘要

| 来源 | 结论 |
|------|------|
| 社区扩展 | 普遍扫 `~/.pi/agent/sessions/**/*.jsonl` 或自建 ledger；UI 为 pi TUI |
| PipiUI `TokenLedger` | 主会话 `message_end` + subagent `kind:"usage"` 已写 per-turn；字段含 model / channel / agentName / in/out/cache/cost |
| 工具维度 | `message.content[].type == "toolCall"` 可得工具名；usage 仍是整轮 |

**方案选择**：基于 TokenLedger + Settings UI（不装扩展）。工具维度采用「整轮计入每个工具」。

---

## UI

### 入口与布局

- `SettingsTab` 增加 `usage = "用量"`（排在「模型」之后）
- Sheet 约 `640 × 620`（多列数字需要宽度）
- 打开用量 Tab / 切换时间或视图 / 点刷新 → 后台读盘聚合

### 顶部控件

1. **时间**（segmented）：今日 / 7 天 / 30 天 / 全部（默认今日）
2. **视图**（segmented）：按模型 / 按角色 / 按工具（默认按模型）
3. **刷新**按钮
4. **合计**条：Calls · Tokens · Cost（**始终按 turn 去重**，即使按工具视图）

按工具视图额外一行说明：整轮归因会使各工具之和可能大于合计；历史无 `tools` 的记录归入 `(无工具)`。

### 行展示

**折叠行**

| 列 | 内容 |
|----|------|
| 主键 | 模型 id / 角色名 / 工具名 |
| Calls | 计入该行的 turn 次数（按工具时 = 含该工具的轮次数） |
| Tokens | `input + output + cacheWrite`（不含 cacheRead） |
| Cost | `$…`（ledger `cost` 累加；全 0 显示 `$0`） |

**展开**

1. 明细：`↑In` · `↓Out` · `CacheR` · `CacheW` · 可选命中率  
   `命中 = cacheRead / (input + cacheRead + cacheWrite)`
2. **二级行**：
   - 按模型 → 二级 = 角色（`main` / `explore` / …）
   - 按角色 → 二级 = 模型
   - 按工具 → 二级 = 角色  
   二级同样显示 Calls · Tokens · Cost（不再第三层嵌套）

排序：Cost 降序；Cost 全相同则 Tokens 降序；再按 key 字典序。

空数据文案：「暂无用量记录。发送消息或派出 subagent 后会出现在这里。」

---

## 角色键

| ledger 字段 | 显示键 |
|-------------|--------|
| `channel == "main"` | `main` |
| `channel == "subagent"` 且 `agentName` 非空 | `agentName`（explore / plan / general-purpose / reviewer / lead / …） |
| 其余 | `subagent` |

---

## 工具归因（按工具视图）

### 写入

每条 ledger 记录可选字段 `tools: string[]`：

- 主会话：`TokenLedger.toolNames(from: message)` —— 从 assistant `content` 提取 unique `toolCall.name`，排序后写入
- Subagent：`index.ts` 在 `message_end` 的 `pipiuiReport({ kind: "usage", tools })` 带上同名列表；`SubagentStore` 原样写入 ledger
- 无工具 / 旧行缺字段：聚合时主键为 `(无工具)`

空 `tools` 不写进 JSONL（保持行紧凑）；解析时缺省为 `[]`。

### 聚合语义（整轮归因）

- 一轮 `tools = ["bash","read"]`、cost = $1 → **bash 与 read 各计 $1 / 全量 tokens / calls+1**
- **合计**仍对该 turn 只加一次（各工具行之和可以 > 合计）
- Calls（工具行）= 「包含该工具的 turn 数」，不是工具调用次数（同轮多次同名工具已在写入时去重）

---

## 数据层

### `TokenUsageStats`（只读）

- `loadRecords(from:)` / `loadSharedRecords()`：读 active + `.1`；缺文件跳过
- `aggregate(records:period:groupBy:now:calendar:)` → `Report(total, rows)`
- 时间：今日 = 同日历日；7/30 天 = `now - N days` 起；全部 = 不过滤
- 打开用量前对 shared ledger `flushSync()`

### `TokenLedger` 变更

- `append(..., tools: [String] = [])`
- `Record.tools`；`toJSONLine` 仅在非空时写出 `tools`
- `rolledFileURL` 供聚合读取
- `toolNames(from: J)` 静态提取

### 不改

- append 的 session / channel / agentId / agentName / depth / model / turn / usage 语义
- 文件滚动阈值与 `.1` 单备份策略

---

## 测试

| 覆盖 | 要点 |
|------|------|
| `TokenLedgerTests` | 写入含 `tools`；`toolNames` 去重排序 |
| `TokenUsageStatsTests` | 按模型拆角色；按角色拆模型；按工具整轮归因与合计去重；`(无工具)`；JSONL 加载；今日过滤 |

---

## 实现落点

| 文件 | 职责 |
|------|------|
| `Sources/PipiUI/Logging/TokenUsageStats.swift` | 聚合 |
| `Sources/PipiUI/Logging/TokenLedger.swift` | `tools` 字段 + `toolNames` |
| `Sources/PipiUI/ChatSession.swift` | 主会话写入 tools |
| `Sources/PipiUI/SubagentStore.swift` | 透传 tools |
| `Sources/PipiUI/PiExt/subagent/index.ts` | usage 上报带 tools |
| `Sources/PipiUI/Views/SettingsSheet.swift` | 用量 Tab UI |
| `Tests/PipiUITests/TokenUsageStatsTests.swift` | 聚合单测 |
| `Tests/PipiUITests/TokenLedgerTests.swift` | 写入 / toolNames |

---

## v2 预留

- 可选合并扫 `~/.pi/agent/sessions`（与 TokenLedger 去重策略需另定）
- 导出 CSV
- 按 session / 项目下钻
- 工具维度改为「均分」或「仅调用次数」的开关（当前固定整轮归因）
