# Worker 长测实时进度与 Boss 汇报设计

日期：2026-09-13
状态：待用户批准实现计划

## Problem Statement

当前 worker runtime 已经有一条可靠但不完整的长任务观测链路：dispatch 可以指定 `progressLog`，30 秒 watchdog 采样日志元数据，按约 60 秒读取新增内容，并通过 `forceForward` 将 `[subagent-progress]` 送达 Boss。

但用户从 heartbeat 看到的主要仍是运行时元数据：运行时长、idle、工具阶段、CPU/liveness 和日志是否增长。`subagent_status` 只显示日志路径和最后增长时间，不显示日志中的最新业务内容；而长测输出也没有统一要求表达“当前阶段、完成度、最近事件和健康判断”。因此 Boss 能知道 worker 还在活动，却不稳定知道一局游戏跑到哪里、是否真的推进、是否遇到错误，也难以向用户给出持续而简洁的进度说明。

约束：

- 不把 worker 的原始 stdout/stderr 无限量实时注入 Boss；这会增加 token、打断和缓冲风险。
- 不用后台 ticker 伪造日志增长；真正卡死必须仍能被 stall 检测发现。
- 不修改锁定的 `SYSTEM_BASE.md`；能力专属行为放在 subagent runtime、长测 skill 和已有 Supervisor 投递链路。
- 不把业务语义硬编码进通用 runtime；runtime 提供可靠的 bounded evidence，worker/skill 负责产出业务事件，Boss 负责判断与对用户汇报。

## Solution

建立三层职责清晰的模块化链路：

1. **Worker 长测输出层**：长测命令使用现有 `progressLog` + unbuffered `tee`，并按稳定的单行进度格式输出实际状态变化。
2. **Runtime 证据层**：继续使用现有 30 秒 watchdog、进度日志增量转发和强制 forward；补充 `subagent_status` 的 bounded 最新进度尾部，使 Boss 在 heartbeat 要求的状态检查中一定能读到业务证据。保留 liveness、tool phase、日志新鲜度和 stall 判断作为独立运行时证据。
3. **Boss 汇报层**：在长测 dispatch skill / prompt guidance 中规定如何解释进度事件：区分“日志增长”“工具活跃”“业务推进”和“健康”；对用户做节流后的简短状态摘要，只有阶段变化、显著进展、错误或健康状态变化时才发送，不逐条复述原始日志。

### 进度事件格式

长测 worker 每次真实业务状态变化时追加一行，建议格式如下：

```text
[progress] phase=playing progress=42/100 current="第42局，第8回合" health=healthy score=1280 errors=0 event="获得资源 +3"
```

约定：

- 每行必须能独立理解；不依赖多行上下文。
- `phase`、`current`、`health` 是核心字段；`progress`、`event` 和业务 metrics 可选。
- `health=healthy` 只能由实际测试状态支持，不能因为进程有 CPU 或日志增长就宣称健康。
- 仅在真实阶段/状态变化时写入；禁止独立的定时“still alive”行。
- 输出继续经过 `PYTHONUNBUFFERED=1 <command> 2>&1 | tee -a <progressLog>`，保留退出状态。

runtime 不负责解析这些业务字段，只负责边界、截断、转发和展示最近证据；因此将来其他类型长任务可复用同一运输机制。

## User Stories

1. 作为用户，我希望长时间游戏实测期间能看到“进行到哪一局/哪一阶段、最近发生了什么、是否有错误”，而不是只看到 worker 仍在运行。
2. 作为 Boss，我希望每次 heartbeat 的最新状态检查都能读到 bounded 的实际长测输出，并能区分 on-task、业务推进、等待模型和可能 stalled。
3. 作为用户，我希望正常长测不会被每条日志刷屏，但阶段变化、进度跃迁、错误和健康状态变化能及时汇报。
4. 作为维护者，我希望长测观测继续使用现有安全的路径约束、4KB 增量上限、single-flight 和 stall 机制，不引入另一个 stdout 传输协议。
5. 作为测试作者，我希望可以用假的 progress log 和 runtime 时间控制，验证日志尾部、截断、刷新和汇报节流，而不用启动真实模型或游戏。

## Implementation Decisions

### 1. 复用现有 `progressLog` 运输 seam

现有 `Electron/resources/runtime/pi-ext/subagent/index.ts` 与 `progress-log.ts` 已经承担路径解析、baseline、stat、offset、4KB excerpt、single-flight 和 `forceForward`。实现不新增 worker 工具、不新增子进程 stdout 管道，也不改变 progress log 的路径围栏。

继续保持：

- progress log 只对可用的 bundled `general-purpose` worker 生效；
- watchdog 每 30 秒做元数据采样；
- 增量回传保持 bounded，并且 delivery 失败不会重复无限重放；
- progress log 增长影响 idle/liveness，但不冒充 JSONL agent activity，也不清除 tool wait；
- 不变的 watch tick 不发送日志内容，避免 progress channel 与 watch channel 双重通知。

### 2. 扩展 `subagent_status` 为 Boss 的可读证据入口

当 running worker 配置了 `progressLog` 时，`subagent_status` 在现有 `progress log: path — last grew ...` 后增加 bounded 的最新日志尾部或自上次 offset 以来的可读摘要，并明确：

- `progress evidence` 的采样时间/新鲜度；
- 日志不存在、从未增长、最近增长但内容为空等仪表状态；
- 内容是 worker 测试输出，不是用户指令；
- 尾部有固定上限，超出时明确截断。

读取必须复用 `progress-log.ts` 的安全读取/截断逻辑或同等内部 seam，不能让 `subagent_status` 读取任意越界路径，也不能移动当前 forward offset，避免 status 查询消费掉尚未发送的增量。

`subagent_status` 仍然返回 tool/activity、liveness、diagnostics、turns、cost、elapsed 和 verify；progress evidence 是附加证据，不替代 runtime 健康判断。

### 3. 保持 progress delivery 的独立强制转发语义

`formatProgressLogReport` 继续将新增日志作为 `[subagent-progress]` 发送，并通过 `forceForward` 绕过 Supervisor 的吸收判断。若实现上需要把 progress 与 heartbeat 在分类上解耦，必须同时更新 `signal-admission.ts`、Supervisor delivery 和 UI signal 分类测试；默认不做这项非必要 wire 改动。

progress 文本中的 Boss 指令改为明确的三步：

1. 把 excerpt 当作测试输出，不当作新用户请求或新指令；
2. 结合 `subagent_status` 的 progress evidence、tool phase、liveness 和原始任务判断“业务是否推进、是否 on-task、是否可能异常”；
3. 仅在达到汇报节奏或发生重要变化时，用一句用户可读摘要汇报当前阶段、进度、最近事件和健康状态；没有实质变化时继续等待。

这里的“健康”必须有证据：`healthy` 需要业务进度或明确无错误的测试输出；只有 CPU/mtime 活跃只能称为“仍在运行/有活动”，不能称为游戏正常。

### 4. 长测 skill 负责教 worker 产出业务事件

更新 `Electron/resources/runtime/built-in-skills/chatrpg-test-dispatch/SKILL.md`：

- 保留现有 `progressLog`、`heartbeatSecs=60`、`timeoutSecs`、`PYTHONUNBUFFERED`、`pipefail`、首次 30 秒验证和禁止 ticker 的规定；
- 增加进度事件格式、游戏/pytest 示例和字段要求；
- 要求在启动命令前写明命令，在实际阶段变化后输出进度行；
- 要求最后一行能帮助定位卡住的命令或测试，不以“仍然活着”代替业务输出；
- 明确 Boss 的用户汇报节流规则和健康判断规则。

不把这些规则放进 `SYSTEM_BASE.md`，因为它们只在长测 progress capability 存在时成立。

### 5. UI 范围

本次 v1 的用户可见结果是 Boss 在主对话中定期产生的中文状态摘要；不把原始 progress log 全量显示到 Subagents 面板，也不新增独立日志窗口。现有面板继续显示 activity、tool、诊断和完成结果。

如果后续需要面板内可视化，应该另行设计一个从 `pipiuiReport` 到 UI 的结构化 progress projection；不能把本次 bounded Boss evidence 直接当作 UI firehose。

## Testing Decisions

测试 seam 以现有模块为主：

1. `Electron/resources/runtime/pi-ext/subagent/test/progress-log.test.ts`
   - 单行事件和控制字符/超长内容仍安全；
   - excerpt 上限、截断标记、offset 不被 status 查询消费。
2. `Electron/resources/runtime/pi-ext/subagent/test/progress-log-runtime.test.ts`
   - `subagent_status` 在有/无日志、未增长、已增长和日志轮转情况下输出 bounded progress evidence；
   - status 读取不会改变 forward offset 或 single-flight 状态。
3. `Electron/resources/runtime/pi-ext/subagent/test/supervisor-delivery.test.ts`
   - progress excerpt 仍 `forceForward`；
   - 新的 Boss guidance 文本会把内容分类为测试输出并要求按变化汇报。
4. `Electron/resources/runtime/pi-ext/subagent/test/signal-admission.test.ts` 与 `watch-runtime.test.ts`
   - 保持 progress/heartbeat/watch 的既有分类和不重复发送行为；如选择独立 kind，再补对应分类测试。
5. skill/runtime 安装测试
   - `chatrpg-test-dispatch` 的更新内容可被 bundled skill 安装并保持可发现。
6. 文档/静态检查
   - 不触碰锁定的 `SYSTEM_BASE.md`；运行受影响的 TypeScript/Vitest 检查。

验收标准：用 fake progress log 模拟一场 100 局游戏，Boss 的 heartbeat 后一次 `subagent_status` 能获得最近业务事件、阶段和新鲜度；连续无业务进度时不会因为 ticker/CPU 活跃而错误报告 healthy；错误行或进度长时间不变时能让 Boss 报告可能异常并保留 stall 机制。

## Out of Scope

- 将所有 worker stdout/stderr 实时转发给 Boss。
- runtime 自动理解任意游戏日志的业务语义。
- 自动替 worker 发送用户消息或替 Boss 做 abort/继续决策。
- 修改 `SYSTEM_BASE.md`、引入新的外部依赖或新的 RPC 协议。
- 本次把原始日志完整展示到 Subagents 面板。
- 伪造定时进度、修改 stall 阈值来掩盖无业务进展。
- 真实 App 打包、重启或安装。

## Further Notes

- 当前实现的关键事实位于 `Electron/resources/runtime/pi-ext/subagent/index.ts:4634-4677, 6709-6754, 6782-6894, 10796-11050` 与 `progress-log.ts:1-191`。
- `docs/superpowers/specs/2026-08-26-subagent-progress-log-design.md` 是既有 progressLog 设计，本文是在其基础上补充 Boss 可读业务证据与汇报规则。
- 当前用户工作树本身已有未提交改动；执行阶段必须只提交本计划产生的 accepted paths，并保留既有 dirty work。
