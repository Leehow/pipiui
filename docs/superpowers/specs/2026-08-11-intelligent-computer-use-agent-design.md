# PipiUI 智能 Computer Use Agent 设计规格

> **已取代：禁止按本文继续实现。** 2026-08-19 起，Computer Use 的智能编排与学习以
> [`2026-08-19-single-agent-computer-use-design.md`](2026-08-19-single-agent-computer-use-design.md)
> 为唯一设计来源。本文仅保留为现有 Leader + 固定 Worker 架构的历史记录；底层 Runtime
> 不变量仍以 [`docs/computer-use.md`](../../computer-use.md) 和
> [`docs/computer-runtime-v1.md`](../../computer-runtime-v1.md) 为准。

日期：2026-08-11  
状态：已归档，由 2026-08-19 单 Agent 规格取代

适用宿主：Swift PipiUI、Electron PipiUI、未来实现 Computer Runtime 的其他 UI  
关联文档：[`docs/computer-runtime-v1.md`](../../computer-runtime-v1.md)、[`docs/computer-use.md`](../../computer-use.md)、[`docs/superpowers/specs/2026-07-25-computer-use-design.md`](2026-07-25-computer-use-design.md)

## 1. 一句话决策

新增一个 UI 无关的 **Computer Agent 模块**。主 Pi 只向它提交自然语言目标；模块内部由不持有副作用工具的 Leader 规划和重规划，由 GUI Operator、Terminal Worker、Verifier 等隔离角色执行，并把验证成功的探索轨迹逐步编译为可重放的 Procedure。

现有 Cua Driver 与 PipiUI Computer Runtime 继续作为唯一桌面执行路径。不得引入第二套 PyAutoGUI、NutJS、AppleScript、Swift helper 或直接 Cua daemon 调用。

## 2. 背景与问题

当前 Computer Use 已经具备可靠的底层执行链：

```text
Pi strategy -> PipiUI Computer Runtime v1 -> signed host -> Cua Driver
```

但当前智能层仍然较浅：

1. 主 agent 需要显式选择 `operator` 并组织 brief，而不是只表达目标。
2. `operator` 是不允许嵌套委派的叶子角色；它同时承担观察、定位、动作选择、失败恢复和结果判断。
3. 子 agent 默认以 `--no-skills` 启动。虽然 Pi 允许显式 extension 贡献私有 `skillPaths`，当前没有正式的 agent-package 私有 skill allowlist，也没有把 Cua Driver 官方 skill 作为 operator 私有技能接入。
4. 模型只看到兼容性的 `computer` / `open_application`，底层 Cua 的观察、定位、动作、验证语义没有形成角色专属的深接口。
5. 当前 `computer_recipe` memory 只保留应用身份、粗粒度动作类别、结果和错误类别；它可用于检索提示，但不是可执行、可验证、可修复的 Procedure。
6. 截图、AX 树、失败尝试和终端输出容易全部堆积在一个上下文里，长任务会持续稀释目标和成功条件。

结果是：系统能够操作桌面，但还不能稳定地做到“接收目标 → 调查 → 选择最短方案 → 分工执行 → 验证 → 失败后修改方案 → 复用已验证方案”。

## 3. 目标

### 3.1 用户目标

用户只需向主 agent 表达自然语言目标，例如：

> 用 TextEdit 打开桌面上的会议记录，把标题改成“周会记录”，确认内容已经显示。

主 agent 不需要知道应截几次图、使用哪个 GUI 工具、是否需要终端辅助或怎样验证。Computer Agent 自主完成：

1. 判断目标与成功条件；
2. 选择简单快速路径或复杂计划；
3. 调用正确的隔离 Worker；
4. 观察真实结果并在失败后调整；
5. 向主 agent 返回短结论和可检查证据；
6. 对适合复用的成功路径生成 Procedure candidate。

### 3.2 产品目标

- 一个自然语言入口，Swift/Electron 行为一致。
- Leader 只规划，不直接操作 GUI 或终端。
- GUI、终端、浏览器、验证上下文彼此隔离。
- GUI 只能经 PipiUI Runtime v1 与 Cua Driver 执行。
- 简单任务不被多层 agent 拖慢；复杂任务才使用 DAG、重规划和多 Worker。
- 成功经验可转化为语义化、参数化、可验证的最短路径。
- 主 agent 上下文只接收任务状态和最终证据，不接收原始截图、完整 AX、base64 或 Worker 长轨迹。
- 核心模块不依赖 SwiftUI、Electron、AppKit 或 React，可挂到未来 UI。

## 4. 非目标

- 不替换 Pi 的模型/provider/session/history runtime。
- 不把 `cua-agent`、Agent-S、UFO、Understudy 或其他完整 agent runtime 嵌入产品。
- 不引入新的键鼠执行器、屏幕捕获器或 TCC 身份。
- 不让 Leader 获得 `computer`、任意 shell 或任意 MCP。
- 不让 Worker 自行扩大任务范围、桌面授权、递归深度或工具集合。
- MVP 不打包 OmniParser、本地 GUI grounding 模型或 GPU runtime。
- MVP 不要求用户管理 recipe、确认每次学习或理解 agent 基础设施。
- 不把截图、AX 原文、坐标、element token、用户输入文本、剪贴板、凭据或 capability 写入长期记忆。
- 不改变现有全局 Computer Use ON/OFF、TCC、紧急停止和唯一执行 mutex 语义。

## 5. 领域模型与术语

本规格使用以下唯一术语；实现、UI、测试和文档不得为同一概念另造名称。

| 术语 | 定义 |
|---|---|
| **Computer Task** | 主 Pi 提交的一次自然语言桌面目标，包含目标、成功条件和运行时授权；是对外唯一工作对象。 |
| **Computer Agent** | 接受 Computer Task 并隐藏规划、执行、验证、恢复和学习复杂度的深模块。 |
| **Leader** | Computer Agent 内部的规划角色；只管理计划、Worker、预算、状态和 Procedure，不持有 GUI 或终端副作用工具。 |
| **Worker** | 在隔离上下文内完成一个有界 Plan Step 的角色。首版固定为 GUI Operator、Terminal Worker 和 Verifier。 |
| **GUI Operator** | 唯一可请求桌面 mutation grant 的 Worker；通过 Cua 专属工具观察并操作精确目标窗口。现有 bundled `operator` 承担此角色。 |
| **Terminal Worker** | 只使用文件/终端工具的 Worker；不能获得 GUI 工具，不能用 AppleScript、PyAutoGUI、`open` 等替代 GUI 操作。 |
| **Verifier** | 只观察并判断 Postcondition 的 Worker；不能执行 GUI mutation 或终端 mutation。 |
| **Plan** | Leader 维护的可修订任务图；由 Plan Step 和依赖关系组成，不是给用户看的自然语言散文。 |
| **Plan Step** | 一个 Worker 可独立完成和报告的最小有界工作项，具有明确输入、成功条件、预算和状态。 |
| **Blackboard** | 一次 Computer Task 的结构化短期状态：事实、假设、目标身份、Plan、证据引用、失败与预算。任务结束后不继续增长。 |
| **Observation** | 对当前桌面/文件/浏览器状态的一次只读采样。Observation 是事实，不等于成功。 |
| **Effect** | 一个 mutation 实际可能造成的变化。发送动作不等于确认 Effect 已发生。 |
| **Postcondition** | 可在新 Observation 上判断的成功谓词。只有 Postcondition 被验证，Plan Step 才能成功。 |
| **Procedure** | 已参数化、带前置条件、语义 Locator、动作、Postcondition 和恢复策略的可重放最短路径。 |
| **Procedure Candidate** | 从成功轨迹提炼但尚未获得独立重放证据的 Procedure；不会自动优先于 agent 路径。 |
| **Grant** | 宿主为一次 Task/Step 签发的运行时能力。Grant 不能由 agent frontmatter、prompt 或子 agent 自行制造。 |
| **Artifact Reference** | 指向截图、AX、日志或完整轨迹的短引用；跨上下文只传引用和摘要，不复制原始内容。 |

### 5.1 必须保持的区分

- `read-only agent` 指文件/工具能力，不表示其观察的外部应用不可被其他 Worker 修改。
- `action_sent` 只表示请求已发出，不表示 Effect 成功。
- `outcome_unknown` 不是普通失败；必须重新观察后才能决定是否重试。
- `Procedure` 不是 prompt 技巧或一段历史摘要；它必须能被结构化验证和重放。
- `Skill` 是 agent 的方法说明；`Procedure` 是针对一类任务的可执行数据。两者不能混为同一个文件。

## 6. 方案比较与选择

### 方案 A：把现有 operator 扩成万能 agent

让 operator 同时拥有规划、GUI、shell、skills、memory 和 subagent。

拒绝原因：

- 规划上下文与高噪声截图/AX/终端上下文无法隔离；
- 一个角色同时拥有全部副作用能力，运行时无法证明最小权限；
- operator 的错误判断会同时污染计划与验证；
- 对外仍然是浅层工具集合，主 agent 需要理解内部细节。

### 方案 B：嵌入现成完整 Computer Use agent runtime

候选包括 Agent-S、UFO、UI-TARS GUIAgent、Understudy gateway 或 `cua-agent`。

拒绝原因：

- 会形成第二套模型循环、provider、history、tool loop 和取消语义；
- 多数附带 Python/PyAutoGUI/NutJS/AppleScript 执行链，绕开 Runtime v1；
- TCC、目标窗口、输入清理、互斥和错误证据将出现两个权威来源；
- Swift/Electron 打包与升级成本显著增加。

### 方案 C：Pi 原生 Coordinator + 固定叶子 Worker + Runtime Adapter

主 Pi 调用一个高层工具，Pi extension 内部用现有 subagent runtime 派发固定角色；GUI 仍通过 Runtime v1/Cua。

选择此方案，因为它形成三个清晰的 seam：

1. 主 Pi 与 Computer Agent：一个高层 `computer_task` Interface；
2. Computer Agent 与宿主：稳定的 Computer Runtime Interface；
3. Computer Agent 与长期经验：结构化 Procedure Store Interface。

该方案在不复制 Pi 和 Cua 的前提下，增加需要的智能层，并能让 Swift/Electron 复用同一实现。

## 7. 总体架构

```text
Main Pi
  |
  | computer_task({ goal })
  v
Computer Agent module (UI-neutral Pi package)
  |
  +-- Task Ledger / Blackboard / budgets
  +-- Leader (plan, delegate, replan, summarize)
  |     |
  |     +-- GUI Operator ------ scoped mutate grant --+
  |     +-- Terminal Worker --- terminal tools        |
  |     +-- Verifier ---------- scoped observe grant -|
  |     +-- Browser Worker ---- optional, later     |
  |                                                v
  +-- Worker Tool Broker (one-run attenuated capabilities)
  +-- Procedure Store / compiler / replay          |
                                                   v
                                      Computer Runtime v1
                                                   |
                              +--------------------+------------------+
                              |                                       |
                    Swift Runtime Adapter                  Electron Runtime Adapter
                              |                                       |
                              +--------------- Cua Driver ------------+
```

### 7.1 深模块 Interface

主 Pi 只学习一个工具：

```ts
type ComputerTaskRequest = {
  goal: string;
};

type ComputerTaskResult = {
  outcome: "succeeded" | "blocked" | "failed" | "cancelled";
  summary: string;
  verification: {
    status: "verified" | "not_verified" | "unknown";
    claims: string[];
  };
  handoff?: {
    reason: string;
    requestedUserAction: string;
  };
};
```

`goal` 是唯一必填的模型可见参数。成功条件、目标应用、允许的交互和参数可由 Leader 从自然语言解析；运行时 Grant、capability、session、display 和 target identity 永不出现在模型可写 schema 中。

首版不向主 Pi 暴露 `plan`、`worker`、`screenshot`、`coordinate`、`recipe` 等内部参数。这样未来改变规划器、Worker 数量或 Procedure 引擎时，调用方无需修改。

### 7.2 宿主 Interface

继续使用现有 Computer Runtime v1：

- `computer_runtime_capabilities`
- `computer_batch`
- `computer_open_application`
- `computer_cancel`

Computer Agent 不直接启动 Cua helper。丰富工具先在 Pi extension 内由 Runtime v1 的 observation、AX metadata 和 batch 组合实现；只有当两个宿主都确实需要新的原子能力时，才提议 Runtime v2。

### 7.3 Worker Tool Broker

现有 Runtime v1 capability 能调用完整 batch；仅从模型工具列表隐藏 mutation 不能形成真正的 observe-only 权限。因此 Computer Agent 新路径必须增加一个进程内/loopback 私有 Worker Tool Broker：

- Computer Agent 主 extension 是 Computer Agent 架构中唯一被授权消费宿主 Runtime v1 capability 的实现；同一主 Pi 进程内的其他扩展仍按 Runtime v1 现有契约视为 trusted，这不是进程内代码隔离；
- 每个 Worker 只获得与 `taskId + stepId + role + runId` 绑定的一次性 broker capability；
- broker capability 明确包含 `observe`、`mutate`、`openApplication` 中的最小集合；
- Verifier capability 只允许 `observe`，GUI Operator 才允许 `observe + mutate + openApplication`；
- broker 根据 role 注册对应工具，且服务端再次检查操作种类，不能只依赖 `--tools`；
- capability 在 Step terminal、Task cancel、全局 OFF、紧急停止或 owning Pi session 结束时立即失效；
- capability 不写入 Plan、prompt、日志、artifact 或 Procedure。

新 `computer_task` 路径不再把 `PIPIUI_COMPUTER_CAPABILITY`、`PIPIUI_COMPUTER_EXT` 或完整宿主策略直接传给 Worker。兼容性的旧 `subagent(... desktop: ...)` 路径可暂时保留，迁移完成后再单独决定是否收口；本规格不要求破坏它。

## 8. 角色与能力

### 8.1 Leader

Leader 是 bundled、不可被项目同名 agent 冒充的运行时角色。

允许：

- 读取/更新 Task Ledger；
- 查询 Procedure；
- 创建和修订 Plan；
- 只向固定角色派发 Plan Step；
- 查询 Worker 状态、取消 Worker；
- 比较 Worker 报告与 Postcondition；
- 生成最终短报告和 Procedure Candidate 草案。

禁止：

- `computer`、Cua mutation、shell、任意 MCP；
- 任意 agent 名称派发；
- 将 desktop grant 传给 Terminal Worker 或 Verifier；
- 修改自身工具集合、递归深度或 capability ceiling；
- 读取原始 base64、完整 AX 或 Worker 全历史。

Leader 最大派发深度为一层。Worker 均不可继续委派。未来若允许专门的子协调器，必须通过新的显式角色和深度预算引入，不能把 `delegation: true` 泛化给 operator。

### 8.2 GUI Operator

沿用现有 bundled `operator` 身份和桌面 Grant gate，但在 `computer_task` 路径中只给它 Worker Tool Broker 的 scoped mutation grant，并替换其模型可见操作面：

| 工具 | 语义 |
|---|---|
| `desktop_observe` | 获取目标窗口的新截图、压缩 AX、窗口/应用身份和 observation ID；无 mutation。 |
| `desktop_locate` | 在最近 Observation 中按 role/name/value/state 等语义查询候选；返回稳定 locator 或歧义。 |
| `desktop_open_application` | 解析并激活一个明确应用，建立精确 PID/window target。 |
| `desktop_act` | 对 locator 或明确坐标执行一个连贯动作 batch；返回 `action_sent`、新 Observation 和错误语义。 |
| `desktop_verify` | 在新 Observation 上判断结构化 Postcondition；不能复用动作前 Observation。 |

兼容性的 `computer` / `open_application` 在迁移期保留给外部策略，但 bundled GUI Operator 默认只看到上述专属工具。所有专属工具经 Worker Tool Broker 调用 Runtime v1，不增加执行权威，也不把宿主 capability 暴露给 Worker。

GUI Operator 不拥有 shell、web、任意 MCP 或 delegation。轻量文件读取仅用于解析用户明确给出的本地路径；不得用 `open`、AppleScript、osascript、PyAutoGUI、NutJS 或进程信号代替桌面工具。

### 8.3 Terminal Worker

Terminal Worker 用于 GUI 不擅长且用户目标允许的辅助工作，例如：

- 查找用户明确提到的文件；
- 读取文件格式或生成待 GUI 打开的临时/目标内容；
- 运行用户目标要求的终端命令；
- 检查输出文件是否存在、格式是否成立。

它没有 desktop grant、截图或 GUI 工具。禁止通过 AppleScript、`open`、`cliclick`、PyAutoGUI、浏览器自动化或 Accessibility API 操作 UI。

Terminal Worker 的 cwd、文件写范围和命令预算必须来自 Plan Step；不能默认继承主仓的实现权限。Computer Agent 任务不是代码开发任务时，不得修改 PipiUI 仓库。

### 8.4 Verifier

Verifier 获得 Worker Tool Broker 签发的 observe-only capability：

- `desktop_observe`
- `desktop_locate`
- `desktop_verify`
- 必要时只读文件状态工具

Verifier 不获得 `desktop_act`、`desktop_open_application` 或 shell mutation。若验证需要重新打开/聚焦应用，返回 `verification_blocked`，由 Leader 再派 GUI Operator；Verifier 自己不修复被验证对象。

Verifier 必须基于动作后的新 Observation。GUI Operator 的“已完成”只能作为待验证 claim，不能成为任务成功证据。若 Postcondition 能由 broker 的确定性 evaluator 直接判断，Coordinator 可以采用该机器证据而不额外启动 Verifier；只有主观视觉判断、矛盾证据或复杂组合条件才需要独立 Verifier 模型。

### 8.5 Browser Worker（后续）

用户明确要求内置浏览器或网页语义操作时，可派 browser-only Worker，优先使用现有 PipiUI Browser DOM/CDP 能力。用户点名 Chrome、Safari 或外部浏览器时，仍走 GUI Operator，不得静默替换浏览器。

Browser Use 可以作为未来可选 adapter，但不是 MVP 依赖。

## 9. Agent 私有 Skills

`--no-skills` 继续阻止全局/项目 skills 自动进入子 agent。Computer Agent package 通过显式 `skillPaths` 只加载与角色绑定的私有 skills。

首版 skills：

| Skill | 可见角色 | 内容 |
|---|---|---|
| `computer-task-planning` | Leader | 目标解析、成功条件、简单/复杂路径判断、Plan 与预算。 |
| `computer-task-recovery` | Leader | stall、目标丢失、未知结果、替代路线和用户 handoff。 |
| `cua-driver-operation` | GUI Operator | 版本匹配的 Cua 官方 snapshot-action-verify、窗口 targeting、批处理和错误纪律。 |
| `desktop-investigation` | GUI Operator | AX 优先、视觉次之、歧义定位、最小观察路径。 |
| `desktop-verification` | Verifier | Postcondition、反证、新鲜 Observation 和证据摘要。 |
| `procedure-learning` | Leader | 参数化、敏感信息剔除、candidate 生成、重放证据和 suspension。 |

规则：

- Skill 只能由 bundled package manifest 列出；frontmatter 不能声明任意路径。
- Skill 路径解析后必须位于已验证的 package root 内，拒绝 symlink escape 和 traversal。
- 角色只能读取分配给自己的 skill；不能列出其他角色 skill catalog。
- Cua skill 与 driver 版本绑定。版本不匹配时禁用该 skill 并返回可操作诊断，不静默使用旧说明。
- Skills 只提供方法，不授予工具。实际能力仍由工具 allowlist、Grant 和 runtime policy 决定。

## 10. Plan、Blackboard 与调度

### 10.1 Plan 数据

```ts
type ComputerPlan = {
  taskId: string;
  goal: string;
  successConditions: Postcondition[];
  facts: Fact[];
  assumptions: Assumption[];
  steps: PlanStep[];
  revision: number;
  budgets: {
    maxModelTurns: number;
    maxGuiBatches: number;
    maxReplans: number;
  };
};

type PlanStep = {
  id: string;
  role: "gui-operator" | "terminal-worker" | "verifier" | "browser-worker";
  objective: string;
  dependsOn: string[];
  postconditions: Postcondition[];
  state: "pending" | "ready" | "running" | "verifying" |
         "succeeded" | "failed" | "blocked" | "cancelled";
  attempts: number;
};
```

Plan 存在 Task-local artifact store；聊天上下文只携带当前 ready step、必要事实和最近失败摘要。完整 Worker 轨迹、截图和 AX 通过 Artifact Reference 拉取。

### 10.2 简单任务快速路径

Leader 在首轮将任务分类为：

- **direct**：单应用、目标明确、预计一个连贯 GUI batch 加一次验证；
- **planned**：多应用、依赖文件/终端、成功条件不明确、存在可并行调查或预计需要恢复。

`direct` 由 Leader 派一个 GUI Operator；`desktop_act` 返回动作后的新 Observation，Coordinator 用确定性 Postcondition evaluator 验证。只有条件无法确定、证据矛盾或需要主观视觉判断时才补派 Verifier。direct 路径不生成多节点 DAG，也不额外派调查 Worker，从而避免每次点击都经历多层模型推理。

### 10.3 调度约束

- 同一时刻最多一个 GUI mutation step，服从现有 process-global Computer mutex。
- Observation-only Verifier 不与正在进行的 GUI batch 并发读取同一目标。
- Terminal/Browser Step 只有在不读写同一外部状态时才可并行。
- Leader 不根据语言描述推断并发安全；Plan Step 必须声明依赖。
- Worker 结束后只返回结构化 verdict、evidence references 和最多一个下一步建议。

## 11. 状态机

```text
created
  -> planning
  -> executing
  -> verifying
  -> succeeded

executing/verifying
  -> replanning -> executing
  -> waiting_for_user -> executing
  -> blocked
  -> failed
  -> cancelled
```

### 11.1 重规划触发

- locator 歧义或目标元素不存在；
- target lost / focus drift；
- mutation outcome unknown；
- Postcondition 不成立；
- Worker 报告与新 Observation 矛盾；
- Procedure replay 发生 drift；
- 连续两次 Observation 没有可解释进展。

### 11.2 重试纪律

- mutation 返回 `outcome_unknown`、`computer_cancelled` 或 `cua_driver_error` 时，必须先取得新 Observation，禁止原样重试。
- 同一 locator/action 失败不得只是换说法重复；替代尝试必须改变 locator、交互路线或前置状态。
- 一个 Step 默认最多三条实质不同路线；整个 Task 默认最多两次 Plan revision。预算可按任务复杂度调整，但必须有硬上限。
- 只有系统保护提示、缺失用户事实、外部认证或不可替代的人类判断才能进入 `waiting_for_user`。
- 预算耗尽返回 `blocked` 及最小 unblock 请求，不伪装为成功。

## 12. Observation、Locator、Action 与 Postcondition

### 12.1 Observation

每个 Observation 至少包含：

- `observationId`
- 精确 target identity 的不可伪造宿主引用
- 应用 bundle/name 与窗口标题摘要
- screenshot artifact reference
- bounded AX element projection
- display/window geometry version
- capture timestamp 与 source

模型上下文不持有 base64。最多保留最近三张模型可见截图；更旧内容只保留 Artifact Reference 和文本摘要。

### 12.2 Locator

优先级固定为：

1. 精确应用与窗口身份；
2. AX/语义 role + accessible name/value/state；
3. 菜单路径或已验证的结构关系；
4. 局部模板/OCR/视觉 grounding；
5. 相对几何；
6. 绝对坐标仅限一次性 fallback，不得进入 Procedure。

Locator 必须说明其来源 Observation。跨 Observation 复用 element index/token 前必须由 Runtime 明确保证仍有效，否则重新定位。

### 12.3 Action result

统一结果词汇：

- `observed`
- `resolved`
- `ambiguous`
- `not_found`
- `action_sent`
- `condition_met`
- `condition_not_met`
- `outcome_unknown`
- `target_lost`
- `cancelled`
- `user_handoff_required`

模型不得根据自由文本错误猜测可重试性；使用 Runtime `code/retryable/requiresObservation` 和以上稳定结果。

### 12.4 Postcondition

首版支持：

- 应用/窗口处于目标身份；
- element 存在/不存在；
- element 的 name/value/state 满足谓词；
- 可见文本包含/不包含非敏感短字符串；
- 文件存在、类型或校验摘要满足条件；
- screenshot/AX 相对上一个 Observation 发生预期类别变化。

纯视觉主观判断由 Verifier 模型给出 `verified/unknown` 与短理由；不能自动编译为确定性 Procedure 的唯一 Postcondition。

## 13. Procedure 学习与最短路径复用

### 13.1 Procedure schema

```ts
type Procedure = {
  id: string;
  version: number;
  intent: string;
  application: { bundleId: string; appName: string };
  parameters: ProcedureParameter[];
  preconditions: Postcondition[];
  steps: ProcedureStep[];
  postconditions: Postcondition[];
  recovery: RecoveryRule[];
  state: "candidate" | "verified" | "suspended";
  evidence: ProcedureEvidence;
};
```

Procedure Step 只保存语义 locator、参数引用、动作类别和验证条件。不得保存：

- screenshot/AX 原文；
- element token/index；
- PID/window ID；
- 绝对坐标；
- capability/session key；
- 用户真实输入、剪贴板或凭据；
- URL、文档内容或其他可识别私密数据，除非被安全地参数化且不落默认值。

### 13.2 生命周期

1. **Explore**：无匹配 Procedure 时由 Leader/Worker 正常完成任务。
2. **Compile candidate**：从成功且已验证的轨迹提取语义步骤、参数和 Postcondition。
3. **Lint**：拒绝敏感字段、一次性 token、坐标依赖、缺失 Postcondition、跨应用身份不明确的 candidate。
4. **Independent replay**：在后续匹配任务中先检查 Preconditions，再按确定性步骤执行并逐步验证。
5. **Promote**：至少两次独立成功、无人工修正、Postcondition 稳定后变为 `verified`。
6. **Repair candidate**：界面漂移时由 agent 生成版本化修复候选；不得静默覆盖 verified Procedure。
7. **Suspend**：连续失败、身份变化或安全分类变化时暂停自动重放，回退 agent 路径。

首版不增加用户确认步骤。敏感应用和现有 ComputerPolicy 排除项不产生候选；普通本地 Procedure 按上述证据自动晋升。后续可增加管理 UI，但不阻塞可用闭环。

### 13.3 与 Memory Broker 的关系

- Memory Broker 继续负责跨任务检索和安全投影。
- 当前粗粒度 `computer_recipe` claim 保留为兼容索引，但不能直接执行。
- Procedure Store 保存结构化 workflow；向模型检索时只返回适用条件、成功率、步骤摘要和参数 schema。
- Procedure 完整内容只在 replay/repair 内部按 ID 加载，不注入主 agent 上下文。

## 14. Package 与跨 UI 组织

建立单一源代码真相：

```text
Sources/PipiUI/PiExt/packages/computer-agent/
  package.json
  src/
    extension.ts           # computer_task 外部 Interface
    coordinator.ts         # Task state machine
    plan.ts                # Plan/Blackboard types and validation
    workers.ts             # fixed-role dispatch adapter
    worker-broker.ts       # one-run attenuated Worker tools
    desktop-tools.ts       # typed Cua tool facade over Runtime v1
    procedures.ts          # store/compiler/replay
    errors.ts
  skills/
    computer-task-planning/SKILL.md
    computer-task-recovery/SKILL.md
    cua-driver-operation/SKILL.md
    desktop-investigation/SKILL.md
    desktop-verification/SKILL.md
    procedure-learning/SKILL.md
```

Swift 与 Electron 都从该 package 构建/复制运行时资源，不维护两份手工分叉源码。打包测试必须验证源 package、Swift resource 与 Electron resource 的入口和 skill 清单一致。

宿主 adapter 只负责：

- 暴露 Runtime v1 endpoint 与 capability；
- 签发/撤销 Task/Step Grant；
- 发送状态事件到 UI；
- 持有 Cua daemon、TCC、target、mutex、cancel 和 cleanup；
- 存取 artifact/procedure 文件。

模型、Plan、Worker prompt、Skill 和 Procedure 编译均不得进入 SwiftUI/Electron main/renderer。

## 15. UI 与事件

主聊天只显示一个 `computer_task` 工具卡：

- 当前阶段：规划 / 操作 / 验证 / 调整 / 等待用户 / 完成；
- 当前应用与 Worker 类型；
- Plan Step 完成数；
- 可取消；
- 最终验证结论或最小 handoff 请求。

详细 Worker 树和日志复用现有 Subagents 面板。事件最小集合：

```ts
type ComputerTaskEvent =
  | { type: "task_started"; taskId: string; summary: string }
  | { type: "plan_revised"; taskId: string; revision: number; stepSummaries: string[] }
  | { type: "worker_started"; taskId: string; stepId: string; role: string }
  | { type: "worker_finished"; taskId: string; stepId: string; outcome: string }
  | { type: "verification"; taskId: string; status: string; claims: string[] }
  | { type: "waiting_for_user"; taskId: string; request: string }
  | { type: "task_finished"; taskId: string; outcome: string };
```

事件不得包含 base64、完整 AX、capability、坐标、用户输入内容或完整 Worker prompt。持续错误必须可关闭；关闭错误不取消仍可继续的 Task。

## 16. 取消、权限与安全不变量

- 全局 Computer Use OFF、紧急停止和用户取消立即阻止新 Step，并调用现有 Runtime cancel/held-input cleanup。
- Task Grant 只对一个 Task 有效；GUI mutation Grant 进一步只对一个 GUI Step 有效。
- descendant capability 是单调递减集合：Leader 没有 mutation，不能向自己补发；只有 runtime 可给固定 GUI Operator 签发 Step Grant。
- Worker 环境中不存在原始 `PIPIUI_COMPUTER_CAPABILITY`；所有 GUI/Verifier 请求都需通过 scoped Worker Tool Broker。
- Worker 名称、prompt 或 frontmatter 不能改变 bundled role 身份。
- capability 永不进入 Plan、Blackboard、Artifact、Procedure、日志或模型结果。
- runtime/extension/skill 版本不兼容时 fail closed，并给出可操作错误。
- Computer Agent 的权限不扩展用户目标。它可以自主选择实现方案，但不能自主扩大结果范围。

## 17. 实施阶段

### Milestone 1：自然语言 GUI 闭环

必须先交付真实可用闭环：

- `computer_task({goal})`；
- Leader + 现有 GUI Operator + 按需 Verifier；
- direct/planned 两条路径；
- typed `desktop_observe/locate/open/act/verify`；
- bundled private skills 与 Cua 官方 skill；
- Task Ledger、预算、取消、未知结果后先观察；
- Swift/Electron 同一 package；
- 主聊天短状态 + Subagents 详细状态。

Milestone 1 不依赖 Procedure learning、Browser Use 或 OmniParser。

### Milestone 2：Terminal Worker 与 Procedure

- 受限 Terminal Worker；
- Procedure schema/store/compiler/linter；
- candidate、独立 replay、verified、repair candidate、suspend；
- Memory Broker 只读检索适配；
- context/artifact 引用和轨迹压缩。

### Milestone 3：浏览器与视觉兜底

- browser-only Worker；
- canvas/无 AX 场景的可选 perception adapter；
- OSWorld 风格长任务回归集；
- Procedure 管理与诊断 UI（如真实使用证明需要）。

## 18. 测试与验收

### 18.1 模块契约测试

1. 主 Pi 只需 `goal` 即可启动 Computer Task。
2. Leader 工具集中不存在 GUI、shell 和任意 MCP。
3. Leader 只能派发固定角色，深度超过一层被拒绝。
4. GUI Operator 在无 Task/Step Grant 时拿不到桌面工具。
5. Worker 环境不含宿主 Runtime capability 或策略路径，只含一次性 broker capability。
6. GUI Operator 只加载显式 private skills；全局/项目 skill 不可见。
7. Cua skill 版本与 driver 不匹配时 fail closed。
8. Terminal Worker 永远拿不到 desktop capability/env/tool。
9. Verifier 即使伪造 mutation broker 请求也会被服务端拒绝。
10. bundled role 不能被同名项目 agent 冒充。
11. `outcome_unknown` 后原动作不能直接重试，必须先产生新 Observation。
12. 预算耗尽稳定结束为 blocked，不无限循环。
13. 取消会撤销 broker capability、终止 Worker、清空 target/session state 并走 held-input cleanup。

### 18.2 Plan 与上下文测试

1. direct 任务只生成最小 GUI Step，不构造多节点 DAG；确定性 Postcondition 成立时不启动 Verifier 模型。
2. 多应用/终端依赖任务生成有依赖的 Plan。
3. 连续无进展触发 replan；超过 revision budget 后 blocked。
4. 主 Pi 结果不包含截图、完整 AX、base64、坐标或 Worker 长报告。
5. Worker 只收到完成其 Step 所需的 Blackboard slice。
6. 老截图超过窗口后只剩 Artifact Reference。

### 18.3 Procedure 测试

1. 首次成功只生成 candidate，不立即当成 verified replay。
2. candidate 含坐标、element token、PID、真实输入或 capability 时 lint 拒绝。
3. 两次独立成功后才能晋升 verified。
4. Preconditions 不满足时不执行 mutation，回退 agent 路径。
5. replay 每个 consequential step 后验证 Postcondition。
6. drift 只生成 repair candidate，不覆盖旧版本。
7. 连续失败会 suspend。
8. 敏感应用不产生 Procedure candidate。

### 18.4 跨 UI 与打包测试

1. Swift/Electron 加载同一 computer-agent 版本、skill manifest 和 Procedure schema。
2. 两个 Runtime adapter 通过同一行为契约套件。
3. Electron packaged resource 与 canonical package checksum/manifest 一致。
4. 只有主 checkout 可以打包 runnable Apps。
5. macOS 实机验收必须使用稳定签名；ad-hoc 或裸 build 不能证明 TCC/Computer Use 正确。
6. 构建后不由 agent 自动终止、启动或重启 PipiUI；用户手动退出并重新打开。

### 18.5 实机验收场景

Milestone 1 至少完成：

1. **简单 direct**：自然语言要求打开 TextEdit、输入唯一短句并验证可见内容；主 Pi 不提供动作步骤。
2. **定位恢复**：目标控件位置变化后仍通过语义 locator 完成，不使用历史绝对坐标。
3. **未知结果恢复**：在测试 adapter 注入 `outcome_unknown`，证明先观察再决定，不发生重复输入。
4. **失败重规划**：第一条 UI 路径不可用后选择实质不同路线并成功。
5. **取消**：执行中取消后无继续动作、无残留按键/鼠标状态。
6. **上下文隔离**：主 transcript 只有短任务卡；截图和 AX 只在 Worker/Artifact 层。

Milestone 2 另增加：

7. **GUI + Terminal**：Terminal Worker 生成一个非敏感测试文件，GUI Operator 用 TextEdit 打开，Verifier 同时验证文件与可见内容。
8. **Procedure replay**：同类任务首次探索、第二/第三次重放；verified 路径的模型轮次和 GUI batch 数显著低于首次探索。
9. **Procedure drift**：改变窗口/控件布局后不盲点旧坐标，回退 agent 并产生 repair candidate。

## 19. 可观测指标

不记录用户内容，只记录聚合运行指标：

- Task outcome、总耗时、模型轮次、GUI batch 数；
- direct/planned/procedure 路径；
- replan 次数和稳定错误类别；
- verification status；
- Procedure hit/success/drift/suspend；
- 用户 handoff 次数；
- 主上下文注入字符数与图片数。

Milestone 1 的目标不是预设绝对成功率，而是建立可比较基线。Milestone 2 应证明 verified Procedure 相比首次探索减少模型轮次和 GUI batch，且不降低 Postcondition 成功率。

## 20. 开源复用决策

| 项目 | 决策 |
|---|---|
| Cua Driver 官方 skill/contract/recording | 版本匹配后直接使用或随包引用，保留许可证与来源。 |
| `nicobailon/pi-subagents` | 不并装第二个 `subagent` 工具；选择性移植 private skills、child-only extensions、nested guard、capability ceiling 和 per-agent memory 机制。 |
| Understudy | 参考/移植 Worker-Skill-Playbook、typed GUI result 与 workflow crystallization；不采用其 gateway 或原生 GUI executor。 |
| OpenAdapt Flow | 以其 Workflow/Anchor/Postcondition/replay/repair 语义为 Procedure 设计依据；首版 TypeScript 实现，不打包 Python/OpenCV runtime。 |
| Agent-S2/S3 | 参考 Plan/DAG/replan、reflection、轨迹裁剪和自适应层级；不采用 Python/PyAutoGUI executor。 |
| UFO2/UFO3 | 参考 Host/App 分层、Blackboard、动态 DAG 和 typed task events；不嵌入 Python/Windows runtime。 |
| UI-TARS SDK | 参考 Operator、abort/retry 和事件流；不采用 NutJS executor 或第二套模型 loop。 |
| Browser Use | 后续可选 browser Worker adapter；不作为主 Computer Agent。 |
| OmniParser | 仅作为后续隔离 perception adapter，需单独许可证和体积评审。 |

任何第三方代码复制必须保留许可证和 ThirdPartyNotices；优先移植接口思想和最小实现，不复制产品层或执行器。

## 21. 完成定义

本设计只有在以下全部成立时才算完成，而不是“代码已写”：

1. 主 Pi 用一个自然语言 `computer_task` 完成 direct 和 planned 实机任务；
2. Leader/GUI Operator/Verifier 的能力隔离由运行时测试证明，不只靠 prompt；
3. Cua 私有 skill 真正进入 GUI Operator，且全局 skills 仍被隔离；
4. Swift 与 Electron 使用同一 Computer Agent package 和行为契约；
5. 取消、unknown outcome、target lost 和 verification failure 均有真实恢复证据；
6. 主上下文没有原始截图/AX/长轨迹污染；
7. Milestone 2 的 Procedure 能通过“候选 → 独立重放 → verified → drift repair/suspend”闭环；
8. canonical App 由主 checkout 稳定签名打包，用户手动重新打开后完成真实 TCC/GUI 验收。

在 Milestone 1 满足前，不以 Procedure UI、OmniParser、远端设备协议或更多 Worker 扩展范围。
