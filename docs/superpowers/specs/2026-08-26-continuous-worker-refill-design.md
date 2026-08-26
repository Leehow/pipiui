# Boss 持续并发补位设计（Continuous Worker Refill）

日期：2026-08-26
状态：设计提案（仅 spec，未实现）
范围：Boss/lead 的 fan-out 哲学、worker 终态唤醒文案与对应测试

## 0. 一句话决策

Boss 不只在首轮扇出；每个会改变可调度工作的事件都是一次调度 tick。
Boss 在 wait 或 final closeout 前必须执行一次 **refill scan**：若当前目标未终结且
**productive width** 低于软下限 3，立即派出当下已知、独立、可验收的工作。

`3` 是补位触发线，不是并发上限。若当下有 8 个独立任务，仍应同轮全部交给 runtime；
runtime 用已有容量上限和 `blockedBy` 队列决定何时真正启动。

## 1. 问题与当前证据

当前首轮 fan-out 的指令很强，后续唤醒的指令却偏向等待：

| 位置 | 当前契约 | 结果 |
|---|---|---|
| `pi-philosophy/layers/40-fanout.md` | 默认并行；首轮同时派出所有独立工作；每次派工后 `look ahead` | 首轮宽度通常足够 |
| `subagent/done-message.ts::formatWaveLine` | 有 sibling 运行时，要求 Boss `continue orchestration and wait` | 一名 worker 结束后容易直接等剩余 worker |
| `subagent/done-message.ts::formatSubagentDoneMessage` | 允许 `dispatch follow-up work`，但不要求补位 | “可以继续派工”弱于“然后等待” |
| `subagent/dispatch-queue.ts` | 已交出的 ready / `blockedBy` 任务会在容量释放或依赖成功后自动 `pump()` | runtime 不缺机械调度；缺的是 Boss 把后续意图及时交出 |

因此本问题不是“需要另一个 worker pool”，而是一条语义调度链在首轮后断了：

```text
首轮拆解 -> 宽扇出 -> worker 结束 -> Boss 被唤醒 -> 直接 wait
                                                   ^
                                                   缺 refill scan
```

## 2. 目标

1. 一个多步目标在整个生命周期中保持有用并发，而不只是首轮并发。
2. worker 结束、中断或依赖被 hold 后，Boss 在同一唤醒回合补上新的 ready work。
3. 复用已有 `subagent_status` 快照、`scope`、`blockedBy` 和 dispatch queue，不建第二套 scheduler。
4. 补位不扩大用户已批准的范围，不为占满数字制造无意义任务。
5. 同文件不同 region 可并行；同 region 的可分离职责先纯提取，再并行。
6. 不增加额外轮询、completion wake 或每事件用户消息。

## 3. 非目标

- 不保证任何时刻都真实运行 3 个 worker。真实依赖、不可分的写冲突、用户门、资源上限都可以让宽度低于 3。
- 不让 runtime 自己发明任务。任务是否属于当前目标、是否可独立验收，仍由 Boss 做语义判断。
- 不把 reviewer、explore 或重复验证当成凑数 worker。它们只在本来就有独立交付或判断价值时才计入。
- 不修改 runtime 的并发容量上限，不新增 UI 设置或环境变量。
- 不为 v1 新增调度工具、任务数据库、定时器或中间编排 agent。
- 不改变“用户直接提问时应简短如实回答”和“整个目标只有一次 final closeout”的现有契约。

## 4. 术语与状态

### 4.1 Scheduling tick

以下事件都是 scheduling tick：

1. 首轮 dispatch 被 runtime 接受；
2. worker 成功、失败或中断；
3. 已交出任务被 `[subagent-blocked]` hold；
4. 用户在未终结目标中增加或调整工作；
5. Boss 准备 wait 或 final closeout。

heartbeat 本身不轮询触发新一轮 refill；只有当 heartbeat/stall 处理导致 worker
终止、重派或任务状态改变时，才由那个状态变化触发 scheduling tick。

### 4.2 Productive width

`productive width` 只统计与当前用户目标相关、已经在做或可以立即做的工作。

| worker/task 状态 | 计入 productive width | 理由 |
|---|---:|---|
| 正在生成、调用工具或执行有用验证 | 是 | 正在推进目标 |
| 已交出、依赖已满足、仅等 runtime slot | 是 | 已脱离 Boss 上下文，slot 释放后会自动开始 |
| 等待 `blockedBy` 依赖 | 否 | 现在不能执行，不能填充当前宽度 |
| held / 未知依赖 / 失败依赖 | 否 | 需要决策，不会自动开始 |
| stalled / vanished | 否 | 不是有效生产能力，但仍保留其写集所有权 |
| finalizing / merging / cleanup | 否 | 仍影响 final closeout，但不应占用开发补位名额 |
| 已终结 | 否 | 已无在飞工作 |

productive width 是语义调度指标，不取代 runtime 的进程计数、容量上限或 final closeout 计数。

### 4.3 Eligible slice

一个工作切片只在同时满足以下条件时才可在当前 tick 派出：

1. 属于用户已批准目标，不是相邻清理或新功能；
2. 有独立验收标准，可以写成一个自足 brief；
3. 所需信息已知，或者可以作为一个独立 read-only recon 立即派出；
4. 依赖已满足，或者依赖任务与它可以在同一 dispatch 中用 `blockedBy` 整体交出；
5. 不与在飞 worker 共享同一小代码 region 的写所有权，或者已按第 7 节安排纯提取。

### 4.4 Refill scan

`refill scan` 是一个有界、同回合的 Boss 决策：

- 每个 scheduling tick 最多获取一次无 `agentId` 的 `subagent_status`；本回合已有快照时复用它。
- 只看当前目标的已交出工作和剩余验收项。
- productive width 低于 3 时，找出当下所有 eligible slices，在同一 assistant turn 派出。
- 若没有 eligible slice，以一个真实等待原因结束 scan，然后才可 wait。
- 若目标已终结，结束 scan 并进入唯一 final closeout。

## 5. 核心不变式

1. **软下限，不是上限。** productive width `< 3` 只强制 Boss 重新找工作。一旦找到，仍派出所有已知独立工作，不只派到刚好 3 个。
2. **自检，不问用户。** “是否还能并发”是 Boss 的调度职责。只有真实的用户门才询问用户。
3. **先交出，后等待。** 已知任务及其依赖图应一次交给 runtime，依赖项用 `blockedBy`；不留在 Boss 脑内等下一轮。
4. **当前目标所有权。** 其他目标、历史 worker 或不相关任务不能用来填充宽度。
5. **不重复派工。** 已 running、queued、held 或可恢复的语义 `agentId` 先从 status 识别；同一切片继续时复用原 `agentId`。
6. **所有权先于宽度。** 同一共享 interface/facade/barrel 在同一 wave 中只有一个 writer；真实同-region 冲突未解决时可以低于 3。
7. **一次快照。** refill scan 复用 completion handling 本来就要求的 unfiltered status，不因“补位”多调一次。
8. **无新 wake。** 补位只在现有 scheduling tick 中发生，不增加定时器、polling 或单独 model turn。
9. **终结门保留。** 存在 running/stalled/finalizing 或已交出未终结工作时，仍不得 final closeout。

## 6. 调度循环

```text
on scheduling tick:
    snapshot = reuse this turn's unfiltered status
               or fetch exactly one unfiltered status

    related = workers and queued tasks belonging to the current user goal

    if goal acceptance is already terminal:
        if every related episode is terminal:
            return CLOSEOUT
        return WAIT(goal work done; lifecycle still settling)

    productive = count(
        useful running workers
        + dependency-ready tasks waiting only for runtime capacity
    )

    if productive >= 3:
        return WAIT(enough useful work is already in flight)

    candidates = every remaining eligible slice in approved scope

    if candidates is empty:
        return WAIT(one truthful reason)

    dispatch all candidates whose arguments are already known in this same turn
    encode known dependencies with blockedBy
    declare scope for every writable candidate
    return DISPATCHED
```

允许的等待原因分类如下：

| reason | 含义 | Boss 动作 |
|---|---|---|
| `goal_terminal` | 验收项已全部完成 | 等 lifecycle 终态或 final closeout |
| `no_ready_slice` | 剩余工作不能再分成当下可执行切片 | 等待当前工作产生新信息 |
| `dependency_blocked` | 所有剩余切片都有真实未满足依赖 | 若依赖已交出则等；未交出则立即派依赖 |
| `write_conflict` | 剩余工作与在飞 worker 共享不可分的同-region 所有权 | 交给单一 owner 或串行 |
| `awaiting_user` | 需要新权限、scope expansion 或产品取舍 | 一句话问一个具体问题 |
| `runtime_capacity` | 工作已交出，只在等 runtime slot | 不重派，runtime 会自动启动 |

普通 `no_ready_slice` / `dependency_blocked` 不要求 Boss 每次向用户报告，也不要求每次
写 ledger。只有用户直接问状态、决策改变或真实 blocker 时才向外呈现。

## 7. 写集冲突与逻辑拆分

refill scan 找到多个候选切片后，按以下顺序处理写集：

1. **同文件不同 region**：不是真实冲突；brief 明确各自 region 和 `scope`，直接并行。
2. **同一小 region，两个可分离职责**：在同一 dispatch 中派出一个纯提取 worker 作为头节点，后续 worker 用 `blockedBy` 等它。
3. **共享 interface / facade / barrel**：指定单一 writer；其他 worker 在该 wave 只 import/use。
4. **同一小 region，共享状态、控制流和单一变更理由**：真实耦合；交给一个 worker，允许 productive width 低于 3。
5. **提取成本大于它解锁的并发收益**：不拆，串行并继续主目标。

纯提取只允许行为不变的移动：导出名不变、调用者 import 更新、无顺手重设计。
提取后新模块必须只出现在一个后续 worker 的写 `scope` 中；若两个后续 worker 仍需同时修改它，则拆分失败。

## 8. 调度 seam 与信息分层

### 8.1 单一语义来源

`Electron/resources/runtime/pi-philosophy/layers/40-fanout.md` 是 `refill scan` 的单一语义来源：

- 定义 productive width、软下限 3、eligible slice 和 wait 条件；
- 定义补位与同-region 提取的关系；
- 定义“3 是下限不是上限”。

其他事件文案不复制整套规则，只携带一条带触发条件的 context pointer：

```text
Before any wait or final closeout after this event, run the fan-out refill scan.
```

这条 pointer 的 leading words 固定为 `refill scan`，不在 done / interrupted / blocked 文案中换同义说法。

### 8.2 现有 runtime 继续拥有机械调度

`DispatchQueueV1` 继续是已交出任务的唯一机械 scheduler：

- 容量空出后启动 ready item；
- 依赖成功后启动 `blockedBy` item；
- 依赖失败或未知时 hold 并通知 Boss；
- 防止 head-of-line blocking。

refill scan 不取代这些行为；它只决定还有哪些用户意图应立即交给该队列。

### 8.3 提示成本

- 不新增 completion wake。
- 不新增 unfiltered status 调用；复用现有 done handling 要求的每 tick 最多一次快照。
- 用 `refill scan` 这一 context pointer 替换现有“continue orchestration and wait”的弱路由，不在消息末尾追加大段重复规则。
- `done-message.ts` 的总文案长度不应因本变更显著增长；实现应优先删除被 refill scan 取代的 wait 重复句。

## 9. 具体文案契约

### 9.1 `40-fanout.md`

在 `Parallel by default` 之后、写集分区规则附近增加 `Keep useful width after the first wave`。
该节必须包含以下可被测试钉住的语义：

```text
refill scan
productive width
preferred floor of 3, not a ceiling
before any wait or final closeout
dispatch every eligible slice in the same turn
ask the user only for a real user gate
```

### 9.2 `done-message.ts`

`formatWaveLine` 不再把“有 sibling 运行”直接路由成 wait：

```text
Wave: <n> other worker(s) still running (...).
Before any wait or final closeout after this event, run the fan-out refill scan.
```

`n == 0` 也不直接等价于可 closeout：

```text
Wave: 0 other workers still running — every dispatched worker is terminal.
Run the fan-out refill scan; close out only if the current goal itself is terminal.
```

`formatSubagentDoneMessage` 的 `Handling:` 保留以下现有安全契约：

- 当前回合最多一次 unfiltered status；
- 任何相关 worker 或已交出工作未终结时不 final closeout；
- 用户直接问进度时简短如实回答，不空消息；
- 只在全目标终结后给一次 final closeout；
- 精确 `{agentId, runId}` 中止/解决契约保持不变。

在这些契约之间，把“continue orchestration/internal ledger work or dispatch follow-up work, then wait”
改成“status 后先 run refill scan，scan 无 dispatch 时才 wait”。

### 9.3 interrupted / blocked

- `formatSubagentInterruptedMessage` 在选择续跑、换路线或 resolve 后，执行同一 refill scan；
- `DispatchQueueV1` 的 `[subagent-blocked]` 文案在要求处理依赖/abort 后，携带同一 context pointer；
- 不为 heartbeat 单独增加 refill wake。

## 10. 实现落点

| 文件 | 动作 | 所有权 |
|---|---|---|
| `Electron/resources/runtime/pi-philosophy/layers/40-fanout.md` | 定义 refill scan 与持续 productive width | 语义单一来源 |
| `Electron/resources/runtime/pi-ext/subagent/done-message.ts` | done/interrupted scheduling tick 的 context pointer；替换直接 wait 路由 | 终态事件适配器 |
| `Electron/resources/runtime/pi-ext/subagent/dispatch-queue.ts` | blocked scheduling tick 的 context pointer；不改 queue 行为 | 机械 scheduler 保持不变 |
| `Electron/packages/pi-backend/test/philosophy-runtime.test.ts` | 钉住 refill scan 定义、3 是 floor 不是 ceiling、same-turn 派工 | 哲学组装契约 |
| `Electron/resources/runtime/pi-ext/subagent/test/done-message-wave.test.ts` | 钉住 n>0/n=0 都先 refill 再 wait/closeout | done 文案契约 |
| `Electron/resources/runtime/pi-ext/subagent/test/interrupted-receipt.test.ts` | 钉住 interruption 不遗失 refill 与原有 closeout 门 | interruption 契约 |
| `Electron/resources/runtime/pi-ext/subagent/test/dispatch-queue-runid.test.ts` | 保证 blocked pointer 不改 auto-pump / hold 语义 | queue 回归 |

v1 不新增 production TypeScript 模块。调度 seam 已存在于 fan-out 哲学与终态唤醒的交界；
再包一层 pass-through 模块不会增加行为或可测性。

## 11. 验收场景

| # | 给定状态 | 必须行为 |
|---|---|---|
| A | 首轮 3 worker；1 个结束；还有 1 个独立 ready slice | 同一 completion turn 派出该 slice，不直接 wait |
| B | 只剩 1 个 productive worker；有 4 个 eligible slices | 同轮派出全部 4 个，证明 3 不是 ceiling |
| C | productive width=2；其余切片都真实依赖当前 worker | 不造假任务；以 `dependency_blocked` wait |
| D | Wave=0；仍有未完成验收项 | 先 refill，不 final closeout |
| E | Wave=0；所有验收项完成；所有 episode 终态 | 给唯一 final closeout，不再派工 |
| F | 一个 ready task 已交出，只等 runtime slot | 计入 productive width，不重复派发 |
| G | 两任务改同文件不同 region | brief 声明 region/scope，并行派出 |
| H | 两任务改同 region 但职责可分 | 纯提取 + 两个 `blockedBy` dependent 在同一 dispatch 交出 |
| I | 两任务共享不可分状态/控制流 | 单一 owner 或串行，不为填 3 而强拆 |
| J | worker 中断且存在原语义 `agentId` 上下文 | 先决定续跑/换路线/resolve，再 refill；不打开同切片重复 worker |
| K | 用户直接问进度，仍有 worker 在跑 | 简短如实回答；不空消息，不虚构结果，不 final closeout |

## 12. 测试与验收证据

### 12.1 静态契约测试

1. `philosophy-runtime.test.ts`：
   - main/lead 的 fanout layer 必须含 `refill scan`、`productive width` 和 floor-not-ceiling 措辞；
   - worker role 仍不加载 fanout；
   - 同-region 提取、`blockedBy` 与 same-turn 契约保持。
2. `done-message-wave.test.ts`：
   - n=2 的 Wave 文案不再直接要求 wait；
   - n=0 不再把“dispatched workers terminal”等同于“goal terminal”；
   - done handling 仍限制每 tick 最多一次 unfiltered status；
   - 仍允许回答用户直接进度问题，不产生空消息。
3. `interrupted-receipt.test.ts`：
   - 最后一个 worker 中断仍能触达 Boss；
   - resume/replace/resolve 与 refill 都在同一 handling 契约中；
   - 原有精确 `{agentId, runId}` 不变。
4. `dispatch-queue-runid.test.ts`：
   - blocked pointer 添加后，ready item 仍在 slot 释放后自动开始；
   - dependency success 仍自动 pump，dependency failure 仍 hold；
   - 不产生 head-of-line blocking。

### 12.2 真实 Boss 行为验收

字符串测试只能证明规则被注入，不能证明模型真正补位。实现必须再跑一个真实
Electron Boss 场景，从 session JSONL 取证：

1. 准备至少 5 个同目标、可独立验收且 scope 不冲突的切片；
2. 先让 3 个 worker 运行，保留至少 2 个在第一个 completion 后才可由 Boss 确认的 ready slices；
3. 第一个 `[subagent-done]` 唤醒后，Boss 在同一 assistant turn 派出新 worker，不先回等待文本；
4. 该 tick 的 unfiltered `subagent_status` 调用不超过 1 次；
5. 新 worker 使用新的语义 `agentId`，继续原切片则复用原 `agentId`；
6. 没有新用户授权问题，没有为凑数派出范围外工作，没有新的同-region 双 writer；
7. runtime 终态后整个目标只有一次 final closeout。

补位延迟以事件顺序验收，不用脱离上下文的绝对毫秒门限：

```text
[subagent-done] persisted
  -> at most one unfiltered status
  -> refill dispatch tool call(s) in that same Boss turn
  -> only then wait
```

## 13. 分期

### Phase 1：哲学与事件路由

- 实现第 10 节的文件改动；
- 跑第 12.1 节的 focused tests；
- 跑 `@pipi/pi-backend` build 验证哲学包与 runtime 类型契约；
- 不打包 App，不改变正在运行的 canonical App。

### Phase 2：真实行为验收

- 在用户明确要求真实 App 验收时，按 Electron 打包/lifecycle 契约更新 canonical App；
- 跑第 12.2 节的真实多步目标；
- 保留 session JSONL 的 dispatch / completion 顺序证据；
- 若模型仍在 underfilled tick 直接 wait，先修订 context pointer 强度，不立即新建 scheduler 或轮询器。

## 14. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 模型把软下限 3 误读成硬目标 | 同一节并排“floor, not ceiling”与真实 wait reason；测试 B/C/I |
| 为凑数制造无意义 worker | eligible slice 必须有独立验收标准；范围与所有权不变式优先 |
| completion wake 重放上下文的 token 成本上升 | 复用已有 wake/status；用短 context pointer 替换重复 wait 文案，不追加大段指令 |
| 快照过时导致重复派工 | 同 tick 最多一次新快照；派工门仍用 active semantic `agentId` 和 runtime reservation 拒绝重复 |
| finalizing worker 不计宽度后产生更多合并压力 | runtime 容量和串行 finalization 仍是硬门；写集 scope/single-owner 限制不变 |
| 同文件多 worker 导致 merge conflict | 用 region 判定真实冲突；同-region 可分时先纯提取，不可分时单一 owner |
| prompt 规则被注入但模型仍不执行 | Phase 2 用真实 JSONL 验收；先调整触发 pointer，只在反复失败后再评估结构化硬门 |

## 15. 被拒绝的替代方案

### 15.1 “永远保持至少 3 个 worker”

拒绝。这会在真实依赖、不可分写集或目标已终结时制造假工作。

### 15.2 “少于 3 时问用户是否并发”

拒绝。调度路由不是产品决策；Boss 已拥有 scope、依赖和验收信息时应直接补位。

### 15.3 “每 N 秒轮询宽度”

拒绝。现有 completion/interruption/blocked 事件已是正确的状态变化驱动；定时轮询增加
Boss wake、上下文重放和重复派工风险。

### 15.4 “新建一个第二 scheduler 或中间编排 agent”

拒绝 v1。`DispatchQueueV1` 已能机械地填充 slot 和解锁依赖；新模块只会复制它。
当前缺口是 Boss 的语义分解没有在每个 tick 重新调和。

### 15.5 “首版就做可配置并发 floor”

拒绝。先固定 3 验证语义和实际收益；没有生产证据前增加配置面只会扩大 interface。

## 16. 外部先例

本设计借鉴的是调和模式，不是复制具体实现：

- Kubernetes controller 持续比较 desired state 与 current state，在状态变化后创建必要工作使两者靠拢：
  <https://kubernetes.io/docs/concepts/architecture/controller/>
- Airflow scheduler 在每个 scheduling loop 重新选择依赖已满足的任务，并同时遵守 pool/并发限制：
  <https://airflow.apache.org/docs/apache-airflow/2.2.3/concepts/scheduler.html>

PipiUI 的对应关系是：

```text
desired state  = 未终结目标 + 当下可独立推进的验收项
current state  = status 中的 productive workers + 已交出 ready queue
reconcile      = refill scan
executor/pool  = DispatchQueueV1 + runtime concurrency limit
```

## 17. 完成定义

本设计只在同时满足以下条件时算实现完成：

1. 第 10 节列出的现有文件契约已更新，没有新建 production scheduler 模块；
2. 第 12.1 节 focused tests 全绿，且 backend build 通过；
3. 真实 Boss 在至少一个后续 underfilled scheduling tick 里同轮补位；
4. 同 tick 最多一次 unfiltered status，无新 polling/wake；
5. 无范围外派工、无语义 `agentId` 重复、无同-region 双 writer；
6. `productive width < 3` 但没有 eligible slice 的场景能正确 wait，不为凑数造任务；
7. 原有用户进度答复、精确 abort/resolve、wave 终结门与唯一 final closeout 契约保持。
