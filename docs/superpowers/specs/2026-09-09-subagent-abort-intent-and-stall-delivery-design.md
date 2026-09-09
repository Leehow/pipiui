# Subagent 终态：谁已经知道、谁必须知道

日期：2026-09-09

状态：已实现（本文即落地记录）

适用产品：Electron PipiUI，`pi-ext/subagent` 扩展

## 1. 症状

用户报告两件事，方向相反，根子相同：

1. worker 卡死了，Boss 不知道。
2. Boss 自己 abort 了一个 worker，之后被反复提醒（alarm 6 次、interrupted reminder 2 次、Supervisor 升级信封 1 次）。

两件事都是「通知系统没有建模谁已经知道这件事」：卡死的信号在到 Boss 之前被吃掉；Boss 自己做的决定又被当成 Boss 不知情的事故来催。

## 2. 诊断（代码事实，非猜测）

### 2.1 卡死不报

- stall 通知不直达 Boss，先经隐藏 Supervisor（一个无工具的 LLM 会话）。对 `stall` 事件只有 `escalate` 决定会到 Boss；Supervisor 提示词又写着「只有反复 stall 才 escalate，否则优先 forward / status」，而 `forward` 对 stall 没有投递分支（completion 和 watch 有）。被吃掉后 `deliverStallWake` 返回 true，算「已通知」，3 个通知名额烧完就自动 abort，Boss 全程没见过一个字。
- 工具内 CPU 还在转（死循环、跑飞的测试）被 `isQuietToolStalled` 永久豁免，任何角色都没有上限提醒。
- 安全阀与投递耦合：只有确认送达才计数，被 hold 时次数不涨，自动 abort 永不触发。

### 2.2 abort 后疯狂提醒

- 任何 abort 都走 `deliverConfirmedDoneToBossAsync` 且 `armAlarm` 默认 true → 布防 alarm（1m/2m/5m×4）。armed row 的状态最多到 `observed`，文字回复、`subagent_status`、`subagent_resolve` 都停不了它，只有 `subagent_alarm_ack`。
- `isInterruptedReminderState` 把 `aborted` 也算进「待处理中断」→ 20 分钟、60 分钟各催一次，只有 `subagent_resolve` 能停。
- Supervisor 把 aborted 映射成 interrupted，视作异常终态强制升级。
- 没有任何地方记录「谁 abort 的」；唯一的遥测字段极性还反了（Boss 用工具 abort 被标成 `"stall"`）。`subagent_abort` 的描述和回执写着「aborted jobs do not push a follow-up」，与事实相反。

## 3. 决定

**终态带意图。** `abortedBy: "boss" | "runtime"` 是 `abortRunningAgent` 的必填项：

| 来源 | 意图 | 之后发生什么 |
|---|---|---|
| `subagent_abort` 工具、`/subagent_abort`、面板、stop sweep、Boss 回合被用户停掉（工具自身 signal） | `boss` | 进程退出时一条 `[subagent-aborted]` 回执（不布 alarm），episode 在 `jobFinalize` 里直接标 `cleaned`（原因「aborted at the Boss's request」），不排 reminder，不进 Supervisor 的异常终态，worktree/分支照旧保留可续跑 |
| stall 看门狗、`timeoutSecs`、`usage_budget`、Supervisor 自己的 abort | `runtime` | 现状：回执 + alarm，直到 Boss 确认 |

**两套确认合一。** `subagent_resolve` 同时 ack 该 run 的 alarm；`subagent_alarm_ack` 同时把 episode 标 handled。Supervisor 的 wave 计数把 Boss 已 handled 的 episode 排除在 `failed` 之外，免得兄弟 worker 的正常完成被读成异常 wave。工具描述改成真话。

**stall 必达。** 
- `supervisor/delivery.ts`：`stall` 事件的 `forward` 与 `status` 决定和 completion 一样走 `boss_direct`，Boss 拿到的是带处理指引的原文。
- `host-seam.ts` 新增 admission `absorbed`（Supervisor 处理了但没叫醒 Boss：wait、bounded abort、duplicate）。stall 路径把 absorbed 视为「未送达」，不计通知；heartbeat 路径把它视为「已处理」，不重试。
- 自动 abort 的阀门改按尝试次数（`stallAttemptCount`）而非确认次数：被 hold 或被吸收的信号也会在 3 次后 abort，不再无限挂着。Supervisor 请求的 `sequence` 同样按尝试次数，避免被去重成静默。
- abort 后的 `[subagent-blocked]` 作为终态回执直达 Boss，不再经 Supervisor。
- 工具内可测量忙碌超过 10 分钟：发一条 `[subagent-long-tool]` 提示（一次一调用，直达 Boss），不改变豁免本身。
- Supervisor 提示词补一句：首次 stall 转发给 Boss；有测得的活性才 wait；只有 Boss 已收过同一 run 的 stall 且仍安静才 bounded abort。

## 4. 没改的

- 任意字节重置 stall 计时与次数：有输出就不是被卡住的进程，保留。
- `finalizing` 阶段没有看门狗：closeout 自身有超时，另议。
- 前台同步派工 120 秒静默直接 abort、不发文字：Boss 阻塞在工具里本来就收不到，保留。

## 5. 验证

- 新增 `test/abort-intent.test.ts`（5 例）：每个 abort 入口都带意图、意图进 result 与 job 记录、Boss abort 不布 alarm 且自动 handled、resolve/ack 互通、wave 排除 handled。
- `test/tool-stall-watchdog.test.ts` 新增 3 例：尝试次数阀门、absorbed 分类与源码接线、长工具提示。
- `test/supervisor-delivery.test.ts` 新增 1 例：stall 的 forward/status 直达、wait 与 duplicate 为 absorbed。
- 全套通过；仅剩已知的两条环境/并行 flake（`dispatch-model` 缺 placement provider、`nested-background-lifecycle` 并行超时）。
