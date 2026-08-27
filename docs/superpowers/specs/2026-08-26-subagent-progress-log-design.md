# Subagent progress log（Boss 指定持续日志）

日期：2026-08-26  
状态：已批准（对话确认；补充 supervisor 定期回传）

## 一句话

Bundled `general-purpose` 的 dispatch 可带 `progressLog`。Watchdog / 运行预算除 worker JSONL 外，把该文件的体积或 mtime 变化算作进展。Supervisor 按固定节奏把新增日志片段转给 Boss。Bundled skill `chatrpg-test-dispatch` 教何时填、填哪、brief 怎么写。

## 行为

- 字段：`progressLog`，可选字符串。仅 bundled `general-purpose` 生效（与 `timeoutSecs` 相同门）。
- 路径：相对 `spawnCwd` 或绝对路径；解析后必须落在 `PIPIUI_MAIN_CWD`、`spawnCwd` 或该 worker worktree 内。控制字符、空串、越界一律拒绝，dispatch 失败。
- 探测：30s watchdog 对文件 `stat`。体积变化或 mtime 变新 → 更新 `lastProgressLogAt`。不读文件内容。文件不存在不算失败。
- 回传：独立于 10 分钟漂移心跳。默认每 60s（若设了 `heartbeatSecs` 则用该间隔）读取自上次偏移起的新增字节，上限 4KB，经 Supervisor 强制 `forward` 给 Boss，标记 `[subagent-progress]`。没有新字节则不打扰 Boss。不调用 `noteAgentActivity`（不清 `toolWaitSince`）。
- 空闲：`idleMs = now - max(lastActivityAt, lastProgressLogAt)`。
- 未设字段：行为与现在完全一样。
- Worker 不新增工具、不能改路径。

## Boss skill

- 位置：PipiUI bundled skill `Electron/resources/runtime/built-in-skills/chatrpg-test-dispatch/SKILL.md`，经 PIPIUI_BUILT_IN_SKILL_ROOT 在所有项目会话可发现，不依赖任何特定项目文件夹。
- 给主会话 Boss：测 pytest / playtest 时 `skill_load`，再派 worker。
- 规定：`progressLog=".pi/progress/<agentId>.log"`，长测提高 `timeoutSecs`，`heartbeatSecs=60`，brief 命令 `tee -a` 到该路径。Supervisor 会定期把该文件新增片段回给 Boss；当作测试输出，不当新用户请求。

## 补充（2026-08-27）：运行中改指向 `subagent_progress`

问题：dispatch 时的 `progressLog` 只是猜测——路径在 worker 存在之前就写死了。测试真正
写别处（或那次 dispatch 根本没带 `progressLog`）时，watchdog 盯着一个没人 append 的文件，
健康的长测就被判成卡死。原来唯一的补救是 abort 重派：为了修「观测」而丢掉「正在证明自己
活着的那次运行」。

- 工具：`subagent_progress({ agentId, runId, progressLog, reportSecs? })`，Boss 侧，
  与 abort/resolve 同形（内部走 `action:"progress"`）。
- 门与围栏和 dispatch 完全一致：仅 bundled `general-purpose`（handle 上记
  `progressLogEligible`）；路径相对该 run 的 `spawnCwd` 解析，必须落在 `PIPIUI_MAIN_CWD` /
  `spawnCwd` / 该 worker worktree 内；文件可以还不存在。
- `{agentId, runId}` 精确绑定：stale runId、已 finalizing、非 running 一律拒绝。
- 生效动作：offset 置为当前体积（旧字节不回放）、`lastProgressLogAt = now`（空闲时钟从这次
  决定重新起算，因为之前那次空闲测量测的是错的文件）、归还本 run 的 stall 通知预算、
  `progressLogIntervalMs` 可由 `reportSecs`（30-3600s）改。不碰 `lastActivityAt`。
- Worker 仍然没有新工具、不能改自己的指向。
- `[subagent-stalled]` 正文新增一条：output 写在 runtime 没盯的日志里时，这是测量误差不是
  wedge，用 `subagent_progress` 改指向而不是 abort；同时明说改指向会重置空闲时钟，不是给
  真卡死的 worker 续命的手段。

## 补充（2026-08-27 二）：缓冲陷阱与 stall 报告带日志尾巴

现场证据（chatrpgv4 `ev5-projection`）：改指向后 worker 仍被判卡住。查下来日志确实
06:28:55 停在 `pytest tests/test_toolbox.py` 的 `.F [ 42%]` 半行——**那次判定是对的**，
而且新机制第一次把 hang 定位到了单个测试文件。但同一份证据暴露两个真缺口：

1. **管道块缓冲会饿死这个机制。** 实测：每 0.15s 打一行的健康 Python 进程，经
   `| tee -a` 后 2.2s 内写入 **0 字节**；加 `PYTHONUNBUFFERED=1` 是 725 字节。
   `stdbuf -o L` 对 Python 无效（它自己管缓冲，macOS 上已验证）。原 skill 配方
   `cmd 2>&1 | tee -a log` 因此会把**健康**的 pytest 长跑判成日志不长。
   修：skill 强制 `set -o pipefail; PYTHONUNBUFFERED=1 <cmd> 2>&1 | tee -a <path>`，
   要求前 30s 内确认日志真的在长，并明令禁止后台 ticker 心跳（那会让真 hang 永远
   看起来健康，等于废掉 stall 检测）。
2. **`[subagent-stalled]` 只报 idle 秒数，把诊断丢了。** 现在配了 progressLog 的
   worker，stall 正文带该日志的尾巴（≤600B）与「上次增长在多久前」；从未写过则明说
   这指向仪表而非工作（路径错 / 命令没起 / 管道被缓冲），并点名 `PYTHONUNBUFFERED=1`。
   Boss 不必再自己去磁盘上翻。新增 handle 字段 `progressLogSetAt`：没写过的日志按
   「设定至今」计时，而不是按 run 开始计时。
