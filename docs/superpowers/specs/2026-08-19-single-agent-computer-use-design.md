# PipiUI 单 Agent 自学习 Computer Use 设计规格

日期：2026-08-19

状态：已批准进入实现

适用产品：Electron PipiUI

关联运行时：[`docs/computer-use.md`](../../computer-use.md)、[`docs/computer-runtime-v1.md`](../../computer-runtime-v1.md)

取代：[`2026-08-11-intelligent-computer-use-agent-design.md`](2026-08-11-intelligent-computer-use-agent-design.md) 中的 Leader、固定 Worker 分层、独立 Verifier 和全局 Procedure Store 设计

## 1. 一句话决策

`computer_task` 每次只启动或继续**一个 Computer Use Agent**。它获得当前 Pi 会话中完成任务所需的普通工具和一个受 Host 约束的桌面执行 Interface，自主选择 GUI、浏览器、终端或文件路径；它不能继续委派。

桌面执行从“每次 mutation 后强制模型重新思考”改为“模型提交语义动作块，Host 连续执行到状态屏障”。Agent 从保守的短动作块开始；经真实结果验证后，Host 将轨迹提炼为项目内工作流，使同类任务逐步从探索变成稳定重放。界面被用户或应用改变后，Agent 重新理解当前状态、跳过已经完成的步骤并继续，而不是把漂移当成终止条件。

## 2. 产品结果

用户只描述结果：

> 打开 TextEdit，把桌面的会议记录标题改成“周会记录”，保存后确认文件内容正确。

主 Pi 只调用：

```ts
computer_task({ goal })
```

随后一个 Computer Use Agent 完整负责：

1. 理解目标、约束和可验证成功条件；
2. 观察当前电脑状态；
3. 选择 GUI、浏览器、终端或文件工具；
4. 用与熟练度相符的动作块推进任务；
5. 在状态变化后重新定位、恢复和继续；
6. 用新鲜证据验证最终结果；
7. 返回短结论；
8. 让 Host 从已验证轨迹更新项目内工作流。

用户不会看到 Leader、Operator、Verifier、Plan admission 或 recovery subagent。工具卡可以显示“正在观察 / 操作 / 恢复 / 验证”，但这些是同一个 Agent 的阶段，不是新的 agent 实体。

## 3. 设计原则

### 3.1 一个模型循环

一次 Computer Task 只有一个持久模型上下文和一条 episode。规划、操作、恢复、工具选择与最终验证都在这个上下文中完成。

Host 可以有多个确定性内部模块，但不能把它们表现为模型角色，也不能为一次普通任务启动额外 Pi child。

### 3.2 动作块，而非盲脚本

Agent 可以一次提交多个相干动作。Host 在块内完成定位、等待、轻量观察和结果记录；出现状态屏障即停止剩余动作并把新状态交回 Agent。

动作块不是任意 Python、JavaScript、shell 或 Cua Driver 直通。它是关闭 schema 的桌面 DSL。

### 3.3 状态优先于历史步骤

恢复时以当前可观察状态和任务成功条件为准，不假设历史计划仍然准确。已满足的步骤被跳过；不确定的 consequential mutation 不会被盲目重放。

### 3.4 经验必须被压缩

长期记忆保存参数化流程、恢复规律和证据统计，不保存原始聊天、截图、Accessibility 树或坐标轨迹。工作流库必须能合并、降权、暂停和淘汰，不能只增不减。

### 3.5 安全留在 Host

精确目标绑定、进程级互斥、TCC、急停、取消、输入清理、技术限额、capability 和 `outcome_unknown` 继续由 Host Runtime 判定。Prompt 或 Agent 自报不能放宽这些约束。

## 4. 目标与非目标

### 4.1 目标

- 删除普通 Computer Task 的多层 Pi 调度和 Leader stall 故障面。
- 让一个 Computer Use Agent 拥有完成任务所需的完整普通工具面。
- 支持一次模型决策执行多个相干 GUI 动作。
- 对应用重绘、窗口移动、焦点变化、弹窗和用户小幅介入自动恢复。
- 从成功、失败和人工修正中形成项目隔离的工作流记忆。
- 同类任务随证据积累减少模型轮次、观察次数和总耗时。
- 保留现有 Computer Runtime 的技术正确性与紧急停止能力。

### 4.2 非目标

- 不引入第二套桌面驱动、PyAutoGUI、AppleScript、NutJS 或浏览器 RPA runtime。
- 不让 Computer Use Agent 调用 `subagent`、创建 worker、管理 worktree 或派发其他 agent。
- 不把任意代码执行器作为桌面动作语言。
- 不让模型读取 Host capability、broker token、Driver socket、session secret 或原始凭据。
- 不把“使用终端直接改文件”冒充明确要求的真实 GUI 操作验收。
- 不在首版训练 GUI grounding 模型、做强化学习或跨用户共享工作流。
- 不自动导入 App profile、旧全局 Procedure Store 或 `~/.pi` 中的历史。
- 不为普通任务保留独立模型 Verifier；独立验证只属于测试 harness 或用户明确要求的高风险工作流。

## 5. 领域模型

实现、测试和文档统一使用以下术语。

| 术语 | 定义 |
|---|---|
| **Computer Task** | 主 Pi 提交的一次目标。Host 生成 `taskId`，模型不能指定运行时身份。 |
| **Computer Use Agent** | 唯一完成 Computer Task 的 Pi child；持有任务上下文和普通任务工具，不能委派。 |
| **Task Checkpoint** | Host 保存的结构化短状态：目标、约束、成功条件、已验证事实、未决 effect、当前应用和工作流引用。 |
| **Observation** | 新鲜屏幕、窗口、Accessibility、文件或浏览器事实；不等于成功。 |
| **Effect** | mutation 可能造成的外部变化。动作请求已发送不代表 Effect 已确认。 |
| **State Barrier** | 剩余动作不再能安全沿用当前假设的事件。 |
| **Action Block** | Agent 一次提交、Host 连续执行到屏障的一组相干桌面动作。 |
| **Semantic Locator** | 通过应用、窗口、role、name、value 或稳定关系描述目标，不依赖短命 token。 |
| **Workflow** | 针对任务族的参数化动作块、前后条件、恢复分支和证据统计。 |
| **Candidate Workflow** | 一次已验证成功后生成、只能保守辅助的工作流。 |
| **Practiced Workflow** | 至少两次独立自主成功后晋升、允许较长动作块的工作流。 |
| **Suspended Workflow** | 因连续漂移、错误匹配或不确定 consequential effect 被停止自动执行的工作流。 |
| **Recovery Lesson** | 从失败或人工修正中提炼的局部条件与替代路线，不等于完整 Workflow。 |
| **Execution Receipt** | Host 根据真实执行与新鲜验证生成的不可伪造证据。 |

### 5.1 必须保持的区分

- `action_sent` 与 `effect_verified` 是两个状态。
- `failed` 与 `outcome_unknown` 是两个状态；后者禁止重复 consequential mutation。
- `external_change` 描述状态偏离，不要求 Host 证明变化来自用户还是应用。
- Workflow 是可执行数据；Skill 是 Agent 的方法说明。
- 同一个 Agent 的“规划 / 执行 / 验证”阶段不是多个 agent。

## 6. 总体架构

```text
Main Pi
  |
  | computer_task({ goal })
  v
Computer Use Agent (one Pi child, no delegation)
  |
  +-- normal task tools inherited from the active Pi session
  |     browser / web / bounded terminal / files / document tools ...
  |
  +-- Desktop Agent Interface
  |     observe / open_application / run_action_block
  |
  +-- task-local workflow recall
  v
Computer Execution Runtime (Host-owned deep module)
  |
  +-- exact target binding and semantic re-grounding
  +-- guarded action-block executor
  +-- state barrier detection and execution receipts
  +-- task checkpoint and artifact references
  +-- workflow compiler / retrieval / lifecycle
  v
PipiUI Computer Runtime v1 -> Cua Driver
```

### 6.1 两个外部 seam

系统只保留两个产品级 seam：

1. 主 Pi → Computer Use Agent：`computer_task({ goal })`。
2. Computer Use Agent → Host：Desktop Agent Interface。

规划器、恢复器、脚本解释器、工作流编译器和检索器是 Host 模块的内部 seam。调用方不学习它们，UI 也不把它们显示成独立任务。

## 7. 主 Pi Interface

模型可见请求保持最小：

```ts
type ComputerTaskRequest = {
  goal: string;
};

type ComputerTaskResult = {
  outcome: "succeeded" | "blocked" | "failed" | "cancelled";
  summary: string;
  verification: {
    status: "verified" | "not_verified" | "unknown";
    claims: Array<{
      description: string;
      outcome: "verified" | "not_verified" | "unknown";
      evidenceRef?: string;
    }>;
  };
  handoff?: {
    reason: "authentication" | "captcha" | "protected_prompt" | "missing_fact" | "human_judgement" | "ambiguous_consequential_effect";
    requestedUserAction: string;
  };
};
```

`taskId`、agent identity、recovery policy、workflow qualification、display、target 和 capability 都由 Host 决定，不进入模型可写 schema。

一次 task 默认创建一个新 Computer Use Agent。只有同一 task 因主 Pi provider continuation 被打断时，Host 才继续同一 episode；主 Pi不能通过公开参数任意复用历史 Agent ID。

## 8. Computer Use Agent 工具面

### 8.1 工具继承

Computer Use Agent 继承当前主 Pi 会话中与完成任务有关的普通非管理工具，包括实际可用的浏览器、Web、终端、文件、PDF/文档和其他产品工具。工具是否存在以当前 session 配置为准，不在 Computer Agent 包内复制实现。

Host 必须移除：

- agent 管理和委派工具；
- worktree/worker orchestration 工具；
- raw Driver、Runtime capability 和私有 broker 工具；
- 与当前任务项目范围不相容的路径或 secret 管理工具。

这形成“能力完整、调度单层”的工具面，而不是 GUI-only 叶子角色。

### 8.2 Desktop Agent Interface

模型只学习三个桌面操作：

```ts
type DesktopAgent = {
  observe(input?: ObserveRequest): Promise<DesktopObservation>;
  openApplication(input: OpenApplicationRequest): Promise<DesktopObservation>;
  runActionBlock(input: ActionBlockRequest): Promise<ActionBlockResult>;
};
```

取消由任务生命周期与急停触发，不要求模型主动调用第四个工具。

#### `observe`

返回固定目标或当前前台状态的压缩视觉与语义观察。默认只向模型保留最近三张截图；更早截图通过 artifact reference 留存，不继续注入模型上下文。

#### `openApplication`

沿用 Runtime v1 的精确 bundle/app identity、PID、primary window 和目标固定语义。

#### `runActionBlock`

执行关闭 schema 的动作块。Host 在每一步即时解析 Semantic Locator，记录 effect，并在 State Barrier 处停止。

## 9. Action Block 协议

### 9.1 请求

```ts
type ActionBlockRequest = {
  intent: string;
  actions: DesktopAction[];       // 1...64，熟练度另有更小动态上限
  expectedEffects?: Condition[];
};

type DesktopAction =
  | { id: string; kind: "click" | "double_click" | "right_click"; target: Target }
  | { id: string; kind: "type"; target?: Target; text: string }
  | { id: string; kind: "key"; keys: string[] }
  | { id: string; kind: "invoke_menu"; path: string[] }
  | { id: string; kind: "scroll"; target?: Target; direction: "up" | "down" | "left" | "right"; amount: number }
  | { id: string; kind: "wait_until"; condition: Condition; timeoutMs: number };

type Target =
  | { by: "accessibility"; role: string; name?: string; value?: string; relation?: StableRelation }
  | { by: "visual"; description: string; region?: NormalizedRegion }
  | { by: "coordinate"; x: number; y: number; observationId: string };
```

首版复用现有 desktop action 类型；新增部分集中在动作 ID、Semantic Locator、条件和块级执行结果。视觉 locator 可以在首版回落为“Agent 基于最新截图生成绑定坐标”，但坐标必须绑定 Observation ID。

### 9.2 Host 执行纪律

Host 对每个动作执行：

1. 验证 task、target、generation、取消状态和技术预算；
2. 在最新可用状态上即时解析 target；
3. 目标缺失或多义时停止，不猜测；
4. 提交动作并记录 `action_sent`；
5. 对 consequential mutation 取得足够的新鲜 evidence；
6. 检查 State Barrier；
7. 无屏障才继续下一动作。

Host 内部观察不产生新的模型轮次。等待 UI settle、重新解析 Accessibility token 和确认窗口 revision 都可以在块内完成。

### 9.3 State Barrier

以下任一事件立即终止剩余动作：

- 目标应用、PID 或 primary window 丢失；
- 页面、sheet、dialog、window 集合发生未声明的拓扑变化；
- 新弹窗遮挡下一目标；
- Semantic Locator 缺失或匹配多个元素；
- token、snapshot 或坐标绑定过期；
- 外部状态变化使前置条件不再成立；
- mutation 返回 `outcome_unknown`；
- 认证、CAPTCHA、系统保护提示或必须的人类判断；
- 动作技术失败、超时、取消、全局 OFF 或急停；
- 任务成功条件已经提前满足。

正常的焦点变化、文本出现、列表刷新或预期页面切换可以由 `expectedEffects` / `wait_until` 声明。声明后的变化不是错误；Host 取得新状态后可以结束当前块并让 Agent开始下一块。

### 9.4 结果

```ts
type ActionBlockResult = {
  outcome: "completed" | "stopped" | "outcome_unknown" | "cancelled";
  completedActionIds: string[];
  skippedActionIds: string[];
  stopReason?: StateBarrierReason;
  effects: Array<{
    actionId: string;
    status: "verified" | "not_verified" | "unknown";
    evidenceRef?: string;
  }>;
  observation: DesktopObservation;
  receiptRef: string;
};
```

Agent 不需要从错误字符串猜测执行到哪里。`completedActionIds` 与 unknown effect 是恢复的权威输入。

## 10. 自适应节奏

动作块长度由匹配工作流的成熟度控制；等待和只读检查不计入 mutation 数。

| 模式 | 进入条件 | 每块 mutation 上限 | 行为 |
|---|---|---:|---|
| **Cold** | 无可信工作流或发生漂移 | 2 | 快速试探，每块后由 Agent重新理解状态。 |
| **Candidate** | 命中一次已验证工作流 | 4 | 允许一个局部相干操作段，关键节点必须检查。 |
| **Practiced** | 命中 Practiced Workflow 且前置条件成立 | 12 | 可执行多个已验证步骤，仍受 State Barrier 控制。 |

这些是模型提交上限，不取代 Runtime v1 的 64 动作技术上限。Agent 可以主动提交更短块。任何 `outcome_unknown`、错误匹配或恢复失败都会立即降为 Cold。

## 11. Task Checkpoint 与上下文控制

Host 在每个 Action Block、非桌面副作用工具调用和恢复决策后更新：

```ts
type TaskCheckpoint = {
  taskId: string;
  goal: string;
  constraints: string[];
  successConditions: Condition[];
  verifiedFacts: Fact[];
  pendingUnknownEffects: PendingEffect[];
  activeApplication?: ApplicationIdentity;
  activeWorkflow?: { id: string; version: number; state: WorkflowState };
  lastObservationRef?: string;
  lastReceiptRef?: string;
  updatedAt: string;
};
```

Checkpoint 是任务恢复与上下文压缩的锚点。它不取代 Agent 推理，也不保存模型长思考。

上下文策略：

- 只注入最近三张模型截图；
- 工具结果优先返回状态差异、已完成动作、屏障和 evidence reference；
- 长 AX、截图和终端输出保存在 task-local artifact store；
- compaction 后必须重新注入 Goal、约束、成功条件、verified facts 与 pending unknown effects；
- 不因 compaction 创建新 agent。

## 12. 状态漂移与用户介入恢复

Host 不需要可靠区分“用户点击”与“应用自己变化”。只要当前状态偏离 Action Block 假设，就返回 `external_change` 或更具体屏障，并附新 Observation。

Computer Use Agent 按以下固定算法恢复：

1. 读取最新 Task Checkpoint 与 Observation；
2. 先判断整个任务是否已经完成；
3. 对计划中的 effect 按 `verified / not_verified / unknown` 重新分类；
4. 跳过已经满足的步骤；
5. 对幂等步骤可在新状态下重新定位；
6. 对 consequential unknown effect 先寻找旁证，不能直接重放；
7. 选择能完成剩余目标的最短后缀或替代路线；
8. 降为 Cold，执行一到两个 mutation；
9. 只有旁证穷尽后仍无法判断 consequential effect，才请求用户。

典型行为：

| 变化 | 正确恢复 |
|---|---|
| 用户移动窗口 | 新坐标/新 token 重新定位，继续。 |
| 用户替 Agent 点开目标面板 | 标记对应 effect 已满足，跳过该动作。 |
| 用户已经填了一部分表单 | 保留已有正确值，只补缺项。 |
| 应用重绘导致 token stale | Host 获取新观察并重新绑定语义 locator。 |
| 弹出无害提示 | Agent 判断关闭、接受或绕过后继续。 |
| 焦点切到其他应用 | 按精确目标 identity 恢复目标，不沿用旧坐标。 |
| 保存请求 outcome unknown | 检查文件、标题、内容或 modified 状态；未判定前不再次保存。 |

人工介入可以产生 Recovery Lesson，但含人工完成 consequential step 的运行不计入“独立自主成功”。

## 13. Workflow Memory

### 13.1 存储位置与隔离

Workflow、索引、evidence stats 和 Recovery Lesson 只写入当前活动项目的 Pi home：

```text
{activeProjectPiHome}/computer-use/
  workflows/
  lessons/
  catalog.json
```

普通项目的 `activeProjectPiHome` 是 `{projectRoot}/.pi/agent`；`chatrpgv4` 选择 `pi-coc` 时是 `{projectRoot}/.pi/coc-agent`。实际实现使用 Pi backend 已经解析出的活动 project home，不自行拼接路径，也不从 `~/.pi`、App profile 或固定 macOS `Application Support` 推导。

App profile 只可保留不可用于跨项目学习的 Host bookkeeping/telemetry。旧的 `PIPIUI_COMPUTER_PROCEDURE_STORE` 不自动导入新库。

Host 的 canonical sensitive-application policy 在编译、检索、重放、修复和晋升时都必须执行。密码管理器、认证界面及其他被该 policy 判为敏感的应用仍可由 Agent 在用户授权的 Computer Task 中操作，但不生成或复用长期 Workflow。

### 13.2 Workflow schema v2

```ts
type Workflow = {
  schemaVersion: 2;
  id: string;
  lineageId: string;
  version: number;
  application: {
    bundleId: string;
    appName: string;
    versionRange?: string;
  };
  taskFamily: string;
  intentExamples: string[];       // 去除真实内容后的短例子
  parameters: WorkflowParameter[];
  preconditions: Condition[];
  blocks: WorkflowBlock[];
  postconditions: Condition[];
  recoveryLessons: string[];      // lesson IDs
  state: "candidate" | "practiced" | "suspended";
  evidence: {
    explorationReceipt: string;
    autonomousSuccessReceipts: string[];
    correctedSuccessReceipts: string[];
    consecutiveDrifts: number;
    consecutiveFailures: number;
    lastUsedAt?: string;
    lastSucceededAt?: string;
  };
};
```

不得保存：

- 截图、Accessibility 原文、坐标、element token/index、PID/window ID；
- capability、session key、broker URL/token；
- 密码、认证信息、剪贴板、真实用户正文或敏感文件内容；
- 完整 prompt、完整模型思考或原始 terminal transcript；
- 未经 Host receipt 证明实际执行的 planner 草案。

### 13.3 生成与晋升

1. **探索成功**：任务成功条件经同一 Agent 的新鲜观察确认，Host 再校验 receipt，生成 Candidate Workflow。
2. **候选复用**：Candidate 只能提供建议与短局部块，仍按 Candidate 节奏运行。
3. **独立成功**：不同 `taskId + runId`、无人工 consequential 修正、所有 postcondition 新鲜验证，计一次 autonomous success。
4. **晋升**：累计两次独立自主成功后成为 Practiced Workflow。
5. **修复**：漂移后成功的替代路线产生新版本；不原地覆盖旧 verified evidence。
6. **暂停**：两个连续 drift/failure，或一次 consequential `outcome_unknown` 与错误重放风险，进入 Suspended。
7. **恢复**：Suspended Workflow 只能作为 lesson 被 Agent 阅读；一次新的 Cold 成功生成修复 candidate，不能直接恢复 practiced。

### 13.4 检索与容量纪律

检索分两阶段：

1. 先按 exact application identity、task family、环境版本和可满足前置条件过滤；
2. 再按成功证据、最近成功时间、漂移记录和 intent 相似度排序。

一次任务最多向 Agent 提供三个条目：一个最佳 Workflow、最多两个 Recovery Lesson。候选相近时优先不自动执行，避免错误匹配。

Catalog 必须支持：

- 同 task family 的重复 Workflow 合并；
- 旧版本 supersede；
- 长期未命中或持续失败的条目归档；
- 每应用/任务族的活跃条目上限；
- 读取损坏或未知 schema 时隔离单条记录，而不是使 Computer Use 整体不可用。

## 14. 验证归属

普通任务由同一个 Computer Use Agent 完成最终验证，但验证必须满足：

- mutation 后的新鲜 Observation；
- success condition 逐项判定；
- Host receipt 绑定 task、run、target、action completion 和 evidence；
- Agent 的自然语言自报不能单独构成成功。

Host 对可确定判断使用结构化验证；视觉/语义判断由当前 Agent 在新鲜 Observation 上完成。最终返回前不得只依赖动作“没有报错”。

测试和产品验收可以使用上下文隔离的独立 verifier，但它不进入用户任务运行时，也不出现在产品架构中。

## 15. 故障与降级

| 故障 | 处理 |
|---|---|
| Workflow store 不可用 | Cold agent 路径继续；报告学习功能不可用，不阻塞任务。 |
| 找不到可靠 Workflow | Cold 模式。 |
| Locator 多义/消失 | 停块、新观察、Agent 重定位。 |
| 外部变化 | 对账当前状态、跳过已完成步骤、Cold 恢复。 |
| `outcome_unknown` | 记录 pending effect，取旁证，禁止相同 consequential mutation 重放。 |
| Agent 长时间无模型输出 | 任务级 watchdog 取消该唯一 episode，保留 Checkpoint；主 Pi收到具体阻塞，不要求检查子层级。 |
| 普通工具不可用 | Agent 换用仍合规的替代路径；没有替代路径再报告 blocked。 |
| 认证/CAPTCHA/保护提示 | 明确用户 handoff，完成后继续同一 task。 |
| 全局 OFF/急停 | Host 立即取消、清理输入并关闭 episode。 |

失败结果必须说明：已经完成什么、缺少哪类证据、是否存在 unknown effect、用户下一步是什么。不得返回“Leader stalled，请检查它的孩子”。

## 16. 保留的 Runtime 不变量

本规格不改变：

- Electron 为默认产品与唯一实现目标；
- `build/PipiUI Electron.app` 为 canonical Electron App；
- Computer Use 全局 ON/OFF 与 `⌥⇧Esc` 急停；
- PipiUI stable signing / TCC ownership；
- process-global single in-flight desktop operation；
- exact application/PID/primary-window binding；
- screenshot transform、letterbox 与 finite numeric checks；
- stale token fail-closed；
- cancellation generation、子进程清理与输入释放；
- 最终观察失败时传播 `outcome_unknown`；
- Cua Driver 只能由 Host Runtime 持有和启动。

## 17. 替换方案而非叠加方案

实现必须逐步把旧多层路径替换掉，不能长期保留两套默认编排。

### 17.1 保留并改造

| 当前模块 | 处理 |
|---|---|
| `computer_task` 对外入口 | 保留名称，缩回只有 `goal` 的 schema。 |
| Runtime v1 / Cua bridge | 保留。 |
| `desktop-actions.ts` | 保留原子动作验证，扩展 Action Block/Condition。 |
| `worker-broker.ts` | 改造成单 Agent 的 Computer Execution Runtime；去掉 role grant 和一 mutation 限制。 |
| artifact references / cancellation / task root lifecycle | 保留并改为单 episode。 |
| `procedures.ts` | 迁移为 project-local Workflow schema v2 与生命周期。 |

### 17.2 最终删除或退出默认路径

- `computer-use-leader` Agent 与 leader stall/final-summary 模型调用；
- GUI Operator、Terminal Worker、Verifier 的固定角色分发；
- `ComputerAgentCoordinator` 的 Plan DAG、replan 和 worker admission；
- `computer-verifier`、`computer-terminal` 私有 agent；
- role-based desktop grant、worker episode tree 和用户可见层级；
- `agentId`、`recoveryPolicy`、`procedureContext` 等主 Pi 可写参数；
- App-profile 固定 `PIPIUI_COMPUTER_PROCEDURE_STORE`；
- `one_state_mutation_per_observation` 规则；
- “失败后查看 Leader 及其孩子再继续”的恢复文案。

兼容代码只允许存在于有明确删除里程碑的迁移阶段。新路径稳定后，旧默认路径与无调用测试一起删除。

## 18. 实现里程碑

### M0 — 特征基线与契约测试

- 固定当前多层实现的任务成功率、模型轮次、动作数、观察数和 wall time 基线。
- 添加单 Agent 架构静态契约：一次 task 只允许一个 private child，child 无委派工具。
- 建立本规格中的 perturbation fixtures。

完成条件：基线可重复运行；测试能在旧实现上明确显示层级和一动作限制。

### M1 — 单 Agent episode

- `computer_task({goal})` 只创建一个 `computer-use` child。
- 继承普通非管理工具，挂载 Desktop Agent Interface。
- 用 Task Checkpoint 取代 Leader Plan/Worker ledger。
- 同一 Agent 完成最终验证和报告。

完成条件：Cold 模式可端到端完成至少 TextEdit、Finder 和浏览器各一个真实任务；episode tree 中没有下级 agent。

### M2 — Guarded Action Block

- 扩展关闭 schema；实现 semantic just-in-time binding。
- 删除一 mutation 强制重新观察，加入动态 2/4/12 上限。
- 实现 State Barrier、逐动作 receipt 和结构化块结果。

完成条件：一个稳定的点击→输入→提交操作能在一个模型轮次内执行；中途弹窗或 target drift 会停止剩余动作。

### M3 — 状态恢复

- 实现 Checkpoint 对账、已完成步骤跳过和 pending unknown effect。
- 对窗口移动、token stale、焦点变化、用户完成一步、长加载进行恢复。
- compaction 后从 Checkpoint 继续同一 episode。

完成条件：所有必测 perturbation 场景不误重放 consequential mutation，且至少 90% 能在无用户提示下继续。

### M4 — Workflow Memory v2

- project-local store、catalog、candidate/practiced/suspended 生命周期；
- 从 Host receipt 编译 Workflow 与 Recovery Lesson；
- top-3 检索、去重、归档和版本修复；
- 旧全局 Procedure 不自动导入。

完成条件：同任务族两次独立成功后晋升；第三次使用 Practiced 模式；项目 A 的 Workflow 在项目 B 完全不可见。

### M5 — 切换与清理

- 新路径成为唯一默认；
- 删除 Leader/固定 Worker/Verifier 编排及其过时 schema、prompt、UI 文案和测试；
- 更新 `docs/computer-use.md`、README 和 Electron platform capability 文档；
- 完成 canonical Electron App 的真实验收。

完成条件：不存在普通 `computer_task` 能进入旧层级的路径；全部自动测试与真实验收通过。

## 19. 验收矩阵

### 19.1 功能任务

至少覆盖：

- TextEdit：打开、编辑、保存并验证；
- Finder：精确目录导航与文件操作；
- 浏览器：表单填写、提交与结果验证；
- Office 类应用：多字段编辑与导出；
- 跨工具任务：浏览器取信息后写入文件或 GUI 应用。

### 19.2 Perturbation

每类任务至少注入以下变化：

1. 窗口被移动或缩放；
2. 用户完成下一步；
3. 用户填入部分正确内容；
4. 页面/AX token 重绘；
5. 突然出现 sheet/dialog；
6. 焦点暂时切换；
7. UI 延迟超过普通 settle 时间；
8. mutation transport 在结果前断开。

### 19.3 指标

| 指标 | MVP 门槛 |
|---|---:|
| 普通任务出现嵌套 Computer agent | 0 |
| benign perturbation 直接导致永久 blocked | 0 |
| consequential unknown effect 的盲重放 | 0 |
| Practiced Workflow 错误跨项目命中 | 0 |
| 稳定三动作序列的模型轮次 | 1 |
| Practiced 相比 Cold 的模型轮次下降 | ≥ 40% |
| Perturbation 无人恢复率 | ≥ 90% |
| 最终成功但无新鲜验证证据 | 0 |

成功率、P50/P95 wall time、模型轮次、Host 内部观察数、mutation 数、恢复次数和 workflow 命中状态都写入本地评估报告。不能只报告单次演示成功。

### 19.4 真实产品验收

自动测试不能替代以下证据：

- stable-signed canonical `build/PipiUI Electron.app`；
- 真实 Screen Recording 与 Accessibility 权限；
- 同一真实 task 的完整可见 operator workflow；
- 用户在执行中改变界面后 Agent 自动继续；
- 第二个上下文隔离 verifier 对最终 GUI/文件持久化结果的验收；
- 失败记录保留，并用新的 task 获得成功证据。

这里的验收 verifier 属于产品测试，不是运行时架构的一层。

## 20. 方案比较

### 方案 A：保留 Leader + 固定 Worker

优点是角色隔离直观；缺点是上下文交接、stall、重复总结、工具分割和恢复状态分散。当前产品问题正集中在这些 seam，拒绝。

### 方案 B：单 Agent，但仍一动作一观察

结构简单但模型轮次与延迟不降，且短期 token/坐标在每轮之间持续漂移。拒绝。

### 方案 C：单 Agent + 任意代码脚本

组合能力强，但把桌面 capability、循环、文件与网络能力混进不可审计代码，无法保留 Host 的 target/outcome 语义。拒绝。

### 方案 D：单 Agent + Guarded Action Block + Workflow Memory

一个上下文负责理解与恢复；Host 用关闭 DSL 保证执行正确；经验通过证据逐步晋升。它同时解决层级故障、速度、漂移和重复任务学习，选择此方案。

## 21. 外部依据

- [Agent Workflow Memory](https://arxiv.org/abs/2409.07429)：从轨迹诱导可复用 workflow，并减少成功任务步骤数。
- [Executable Code Actions Elicit Better LLM Agents](https://arxiv.org/abs/2402.01030)：可组合的可执行 action 优于碎片化文本/JSON action；本设计将任意代码收敛为关闭桌面 DSL。
- [Browser Use agent settings](https://github.com/browser-use/browser-use/blob/main/AGENTS.md)：一次模型输出多个 action，执行到页面变化。
- [AppAgent](https://arxiv.org/abs/2312.13771)：从自主探索与人类示范形成应用知识。
- [Agent S](https://arxiv.org/abs/2410.08164)：高层经验与逐步经验有不同用途；本设计采用两种粒度但不采用运行时多 agent 层级。
- [Trace2Skill](https://arxiv.org/abs/2603.25158)：把失败与 workaround 压缩为可迁移 SOP。
- [Demystifying Agent Skills](https://arxiv.org/abs/2608.14036)：技能通过 procedural anchoring 稳定执行，但大技能池会造成严重检索退化，因此本设计限制 top-3 并要求生命周期治理。
- [OSWorld 2.0](https://arxiv.org/abs/2606.29537)：长任务的关键失败包括约束丢失、中途状态变化、隐藏状态恢复和跳过验证；Task Checkpoint 与 perturbation matrix 直接覆盖这些问题。

## 22. 完成定义

只有同时满足以下条件，才能声称该架构实现完成：

1. `computer_task` 的产品运行时只有一个 Computer Use Agent episode；
2. 稳定相干动作可在一个模型轮次内按块执行；
3. State Barrier 能终止剩余动作并返回结构化进度；
4. 用户或应用改变界面后能基于当前状态继续；
5. Workflow 在项目 Pi home 中从 Candidate 晋升、漂移后暂停或修复；
6. `outcome_unknown`、急停、目标固定与项目隔离没有回归；
7. 旧 Leader/固定 Worker 默认路径已删除；
8. 自动测试、perturbation eval 和 canonical Electron App 真实验收全部通过。
