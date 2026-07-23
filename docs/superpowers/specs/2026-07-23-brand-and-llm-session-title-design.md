# 品牌头 + LLM 会话标题 — Design

Date: 2026-07-23  
Status: Approved  
Scope: 侧栏品牌、主区会话标题位置、自动 LLM 起名/前 5 轮复核、打字机展示

## Problem

1. 产品名「Pipi UI」目前占在主区 `navigationTitle`（无会话名时的 fallback）和空状态，品牌没有固定落在左侧头部。
2. 会话标题来自 pi `sessionName` / jsonl `session_info` / 首条用户消息截断 / 文件名，**没有**结合对话主题的 LLM 分析。
3. 用户希望：商标在左；会话标题在现「Pipi UI」主区顶栏位置；标题由 LLM 生成并在前几轮随主题校正；展示带打字机感。

## Goals

1. **左侧头部品牌**：侧栏顶部展示 **Pipi UI**，其中「Pipi」的**第二个 i**（词末 i）为青色。
2. **主区顶栏**：展示**当前会话标题**；不再用「Pipi UI」作为会话标题 fallback（改为「新会话」等会话语义文案）。
3. **LLM 自动标题**（走**当前会话** pi RPC）：
   - 用户**第一条消息成功发出后**触发首次起名；
   - **前 5 轮**每一轮 `agent_settled` 后复核主题，必要时改标题；
   - 第 6 轮起不再自动改；
   - 用户**手动改名**后该会话永久停止自动标题。
4. 起名/复核过程**不进入**用户可见 transcript。
5. 标题首次写入或自动变更时，在**主区顶栏 + 侧栏会话行**用**打字机效果**展示。
6. 文案：约 8–16 字短短语（或等价英文），**跟随用户语言**，无引号、无「标题：」前缀。

## Non-goals

- 不改窗口 `WindowGroup` / Dock `CFBundleDisplayName` 的纯文本「Pipi UI」（系统无法富文本着色）
- 不引入第二套外部 LLM API Key；不另起与会话无关的长期 pi 进程做标题（选定走当前会话 RPC）
- 不起名过程的完整 transcript 持久化；不在聊天气泡里展示起名 prompt/回复
- 不改会话归档/恢复/重命名 RPC 协议本身（沿用 `set_session_name`）
- 不做标题历史版本、不做多语言强制翻译
- 不在本设计内改 subagent 面板或 WebView 面板布局

## Approach（已选）

**方案 1：幽灵 prompt + UI 层过滤 + 现有 `set_session_name`**

- App 在调度点通过**同一会话** pi RPC 发送短起名/复核指令。
- `ChatSession` 将本次往返标为 `titleJob`：**所有相关事件不写入 transcript**，只解析最终短文本。
- 成功后调用现有 `setSessionName` → 侧栏 meta 更新 → UI 打字机。
- 与主 agent 冲突时：**仅在 session idle 时发送幽灵 prompt**；若首条已发出但主 agent 仍在跑，则等本轮 settled 再起名（仍计入第 1 轮复核节奏）。

未选：

- 方案 2（pi 扩展 settled 钩子静默起名）：双轨状态、难与 Swift 轮次/手动改名对齐。
- 方案 3（正常气泡再删除）：会闪、jsonl 可能留痕，违背「完全隐藏」。

## UI Spec

### 品牌 `BrandMark`

- 文案结构：`Pip` + `i`(第二个 i) + ` UI`
- 第二个 i：系统青色（SwiftUI `.cyan` 或与 App 强调色一致的固定 Color，需在 light/dark 下可读）
- 其余字符：主标签色（`.primary`）
- 字重：semifold / title 级，侧栏顶与空状态可共用组件，空状态可略大
- 不可点击（v1）；不替代窗口交通灯

### 侧栏顶部

```
┌─────────────────────┐
│  Pipi UI            │  ← BrandMark（第二个 i 青色）
├─────────────────────┤
│ 项目            [+] │
│ ...                 │
│ 会话 · xxx          │
│  (打字机标题)       │
└─────────────────────┘
```

- 实现偏好：`safeAreaInset(edge: .top)` 或 `VStack { BrandMark; List... }`，与底部 Boss inset 对称
- 不占用「项目」「会话」section header 文案

### 主区顶栏（原 Pipi UI 位置）

- `ChatDetailView`：`navigationTitle` 绑定会话展示标题
- Fallback 链：`sessionName`（或打字机目标文案）→ `"新会话"`  
- **禁止**再 fallback 到 `"Pipi UI"`
- 工具栏按钮（subagent / web）保留

### 空状态

- 中心大标题改用 `BrandMark`（第二个 i 青色），副文案不变

### 打字机

| 项 | 约定 |
|----|------|
| 范围 | 主区标题 + 侧栏对应会话行标题 |
| 触发 | 自动标题**文本发生变化**（首次或复核修改） |
| 不触发 | 用户手动改名；切换会话；文本未变；磁盘加载历史名 |
| 节奏 | 约 1 字 / 30–40ms（实现时可抽常量） |
| 进行中 | 已有旧标题则保持到新结果；无标题显示「新会话」或既有截断名 |
| 实现 | 共享 `TypewriterText`（或等价）+ 动画 token，避免 List 复用错动画 |

## Title Job Spec

### 状态（建议挂在 `ChatSession`）

| 字段 | 含义 |
|------|------|
| `titleRoundCount` | 已完成的用户轮次数（user 发出并 agent_settled 计 1） |
| `userRenamedTitle` | 用户是否手动改过名（true 后永不再自动） |
| `titleJobActive` | 是否有进行中的幽灵起名/复核 |
| `pendingTitleAnimation` | 可选：驱动打字机的 token/目标字符串 |

`AppStore.renameSession`（及侧栏改名入口）必须置 `userRenamedTitle = true`。

### 调度

1. **首轮起名**：第一条用户消息 **send 成功** 后请求调度；若忙则等 idle/settled 后执行 generate。
2. **复核**：每次 `agent_settled` 且 `titleRoundCount` 在 1…5、未手动改名、无 in-flight title job → review。
3. **停止**：`titleRoundCount >= 5` 且本轮 review 已跑完，或 `userRenamedTitle`。
4. **取消**：会话 teardown / 切换时取消 in-flight title job 过滤状态。

轮次定义：**用户消息轮**（不是幽灵 prompt 次数）。一条用户消息 + 主 agent 跑到 settled = 1 轮。

### 幽灵 prompt 要点

- **Generate**：根据迄今对话（模型已在同一 session 上下文中）产出一个短标题；只输出标题本身。
- **Review**：给定当前标题，判断主题是否变化；未变则**原样输出旧标题**；变化则输出新标题。只输出标题一行。
- 约束写入 prompt：长度约 8–16 字或等价英文、跟随用户语言、无引号/无前缀说明。
- 响应解析：trim、去包裹引号、取第一行；空/过长（可硬上限如 40 字）则视为失败并保留旧标题。
- 失败/超时：静默忽略。

### 事件过滤

- title job 期间：assistant/user/tool/thinking 等**不** append 到 UI transcript。
- 不得把幽灵往返写进用户可感知的 follow-up 队列 UI。
- 主对话的 queue / 停止按钮语义不变；title job 不抢「中止并发送队首」的用户语义（实现时 title job 应可被 session stop 取消，或 stop 只影响用户任务——优先：**用户 Stop 取消 title job + 主生成**）。

### 持久化

- 成功解析且与当前名不同 → `setSessionName`（现有 RPC）
- 侧栏通过现有 `onSessionMetaChanged` / `upsertLiveSessionMeta` 更新
- 历史会话再打开：读已有 name，**不**自动重跑 5 轮（仅内存中 `titleRoundCount` 对仍存活的 live session 有效；新进程打开旧会话：若已有非占位名则不再 generate，除非 name 为空/「新会话」且仍有轮次——v1 简化：**打开已有磁盘会话且已有 name → 不自动标题；仅无 name 的新会话走自动逻辑**）

## Data / Files

| 文件 | 变更 |
|------|------|
| `Sources/PipiUI/Views/SidebarView.swift` | 顶部 BrandMark；会话行标题支持打字机 |
| `Sources/PipiUI/Views/ChatDetailView.swift` | navigationTitle 会话标题 + 打字机；去掉 Pipi UI fallback |
| `Sources/PipiUI/App.swift` | EmptyState 使用 BrandMark |
| `Sources/PipiUI/ChatSession.swift` | title job 状态机、幽灵 prompt、事件过滤、settled/首条调度 |
| `Sources/PipiUI/AppStore.swift` | rename 置 userRenamed；必要时展示名/动画桥接 |
| 新建（可选）`Sources/PipiUI/Views/BrandMark.swift` | 品牌富文本 |
| 新建（可选）`Sources/PipiUI/Views/TypewriterText.swift` | 打字机文本 |
| 测试 | 标题解析/轮次/手动改名停止等纯逻辑单测（若可抽） |

## Acceptance

1. 侧栏顶部可见 **Pipi UI**，第二个 i 为青色；主区顶栏不再用 Pipi UI 当会话名 fallback。
2. 新会话发首条用户消息后，在不污染 transcript 的前提下出现 LLM 标题；顶栏与侧栏打字机展示。
3. 前 5 轮每轮 settled 后可复核；主题不变则标题可保持；变则更新并再打字机。
4. 第 6 轮起不再自动改标题。
5. 用户手动改名后不再自动改。
6. 聊天气泡中看不到起名 prompt 或模型起名回复。
7. 空状态品牌第二个 i 青色。
8. 现有发送、队列、停止、手动 rename、会话恢复不被回归。

## Testing

- 单测（优先纯函数）：标题解析（引号、多行、过长）、是否应调度（轮次/手动改名/已有名）。
- 手动：新会话 1–6 轮观察标题与 transcript；手动改名后确认停止；切换会话无错动画；dark mode 青色可读。
- 构建：`swift build` / 现有测试目标。

## Open implementation notes（非未决产品问题）

- pi 是否允许在 streaming 中插入第二请求：以 **idle 门闩** 为准，不假设真并行。
- 幽灵 prompt 具体 RPC 形态（`prompt` 方法等）对齐现有 `PiProcess` / `ChatSession` 发送路径，实现时读现有调用点。
- `navigationTitle` 对自定义打字机的支持若受限，可用 `toolbar` 主标题 / `principal` 放置 `TypewriterText`。
