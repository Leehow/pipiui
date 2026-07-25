# Subagent 详情头一行指标 + 合并失败交回主 Agent

日期：2026-07-24  
状态：已实现

## 问题

1. 右侧 Subagents 面板选中 agent 后，详情区顶部占用过大（标题、任务书、model/turns/cost、分支路径），信息密度低。
2. 工人 `ok` 结束时产品会 **自动 merge 进主工作区并删 worktree**；合并失败时目前只在侧栏红字，主 Agent 不知道，用户被晾在「审核中 + 报错」状态。

## 目标

### A. 详情头一行指标

默认一行：

`标题 …  38k/256k  缓存 72%  Σ 1.2m`

需要审核 worktree 时，这一行下方再出现合并/丢弃操作条。

### B. 自动合并失败 → 只在失败时打断主 Agent

- **成功**：静默（不发「已合并」骚扰消息）。
- **失败**：向主会话注入一条系统式用户消息（前缀 `[worktree-merge-failed]`），让主 Agent 接着处理。
- Boss 协议：**尽量自己处理**；只有真正需要用户拍板的歧义/不可逆决策才问用户，禁止动辄打扰。

## 非目标

- 不改 agent 列表行布局
- 不改工作流水（log）区
- 不把合并/丢弃挪到右键菜单
- 不引入圆环 / popover
- 不发「合并成功」推送
- 不把 merge 逻辑挪回 Node（仍由 Swift `SubagentStore` 负责）

---

## UI（详情头）

### 默认（一行）

| 区 | 内容 | 规则 |
|---|---|---|
| 左 | 标题 | `agent.title`，空则 `task`；单行截断；可选中复制 |
| 右 | 上下文 | `当前占用/窗口`，`TokenFormat.compact`；缺窗口时只显示占用 |
| 右 | 缓存命中 | `缓存 NN%`；无用量时隐藏 |
| 右 | tokens 总消耗 | `Σ` + compact(`input+output` 累计)；无用量时隐藏 |

去掉：多行任务书、model 字符串、turns、`$cost`、时长、分支/路径常驻展示。

### 条件第二行：worktree 审核

仅当 `agent.canReviewWorktree` 为真时显示：

- lifecycle 小徽章
- 「查看 diff / 合并到主分支 / 丢弃 worktree」
- 错误文案（侧栏仍可显示，但主路径是主 Agent 收到失败消息）

### 布局

```
[标题 ………………  38k/256k  缓存 72%  Σ 1.2m]   ← 固定矮头
[审核条：徽章 + 合并/丢弃]                     ← 条件
[正在执行 …]                                   ← 仅 running
────────
log scroll
```

detail `minHeight` 可略降（约 48–64）。

---

## 数据（usage 累加）

`SubagentInfo` 增加并持久化：

| 字段 | 含义 |
|---|---|
| `contextTokens` | 最近一轮占用 |
| `contextWindow` | 模型窗口（能解析则填） |
| `totalInput` / `totalOutput` | 累计 |
| `totalCacheRead` / `totalCacheWrite` | 累计 cache |

派生：

- 缓存命中率 = `totalCacheRead / (totalInput + totalCacheRead + totalCacheWrite)`（分母 0 不显示）
- Σ tokens = `totalInput + totalOutput`

窗口来源：usage/end 载荷 → `agent.model` 查 `availableModels` → 否则只显示占用。

`"usage"` 分支：写 TokenLedger **并**更新上述字段。

---

## 合并失败交回主 Agent

### 现状

`SubagentStore` 在 `"end"` 且 `state == .ok` + pending worktree 时 `DispatchQueue.main.async` 调用 `mergeWorktree`。失败只设 `worktreeActionError`。

### 新行为

1. **自动 merge 失败**（上述 end 路径）：在设置 `worktreeActionError` 之外，通过所属 `ChatSession` **注入一条 prompt**（走现有队列：忙碌则排队，空闲则立刻开一轮）。
2. **合并成功**：不注入任何消息。
3. **手动点「合并到主分支」失败**：同样注入（与自动失败同格式），便于主 Agent 接手；侧栏红字保留。
4. Worktree **保持 pendingReview、不删除**（与现逻辑一致）。

### 消息格式

```
[worktree-merge-failed] agentId=<id> name=<name> branch=<branch> path=<short-or-full>

error:
<git/merge 错误原文>

Worktree 仍保留（pendingReview）。请你自行决策并处理：优先用 git/read/subagent 工具解决（例如查看主工作区与分支差异、在主仓合理 stash/commit 后重试合并、解决冲突、或丢弃过时 worktree）。只有无法自行裁决的歧义或不可逆选择时才简短问用户一次。不要把这条消息当成用户新需求。
```

UI：与 `[subagent-done]` 类似——可折叠卡片 / 不当成普通可编辑用户气泡（`MessageActions` 排除前缀；`MessageViews` 可复用或轻量解析）。

### 注入路径

- `SubagentStore` 增加回调，例如 `onWorktreeMergeFailed: ((SubagentInfo, String) -> Void)?`
- `ChatSession` 在 init/`bindMainProject` 附近设置回调 → 组装消息 → `sendPrompt`（或内部等价：入队 + drain），**不要**走 steer
- 防抖：同一 `agentId` 连续相同错误不重复刷屏（可选：60s 内同 error 去重）

### BossPrompt 修订

Worktree 工作流第 3 条补充：

- ok → 默认自动 merge；成功无需你操作、也无成功推送。
- 若收到 **`[worktree-merge-failed]`**：这是合并失败信号，不是用户新任务。
- **先自己处理**：查主工作区脏文件/冲突原因 → stash 或提交合理改动 → 再合并 / 派工人修冲突 / 丢弃无价值 worktree。
- **少烦用户**：仅当两边都有真实有效改动且无法自动判定取舍、或需不可逆授权时，才用一句话问用户一个具体选择。
- 禁止：把完整 git 报错甩给用户让用户「看着办」；禁止不查证就再开一个重复工人。

---

## 测试

**指标行**

- usage 累加：Σ / 缓存命中率正确
- 无 usage：只留标题
- 有占用无窗口：`38k` 而非 `38k/?`

**合并失败**

- merge 抛错 → 回调触发且消息带 `[worktree-merge-failed]` + agentId/error
- merge 成功 → 不回调
- 消息解析 / MessageActions 不把该条当普通可编辑用户消息
- BossPrompt 文本含 merge-failed 自处理指引（字符串断言即可）

## 验收

1. 详情顶默认一行指标；待审核时下方才有操作条
2. 自动合并成功：无新聊天气泡
3. 自动合并失败（如主仓有未提交改动挡 merge）：主会话出现 `[worktree-merge-failed]`，主 Agent 开始处理；侧栏仍可看红字与按钮
4. 主 Agent 优先自助，不无故弹窗烦用户
5. `./scripts/build-app.sh` 通过并刷新 `build/PipiUI.app`
