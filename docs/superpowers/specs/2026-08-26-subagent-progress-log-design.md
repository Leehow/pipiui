# Subagent progress log（Boss 指定持续日志）

日期：2026-08-26  
状态：已批准（对话确认；补充 supervisor 定期回传）

## 一句话

Bundled `general-purpose` 的 dispatch 可带 `progressLog`。Watchdog / 运行预算除 worker JSONL 外，把该文件的体积或 mtime 变化算作进展。Supervisor 按固定节奏把新增日志片段转给 Boss。chatrpgv4 的 Boss skill 教何时填、填哪、brief 怎么写。

## 行为

- 字段：`progressLog`，可选字符串。仅 bundled `general-purpose` 生效（与 `timeoutSecs` 相同门）。
- 路径：相对 `spawnCwd` 或绝对路径；解析后必须落在 `PIPIUI_MAIN_CWD`、`spawnCwd` 或该 worker worktree 内。控制字符、空串、越界一律拒绝，dispatch 失败。
- 探测：30s watchdog 对文件 `stat`。体积变化或 mtime 变新 → 更新 `lastProgressLogAt`。不读文件内容。文件不存在不算失败。
- 回传：独立于 10 分钟漂移心跳。默认每 60s（若设了 `heartbeatSecs` 则用该间隔）读取自上次偏移起的新增字节，上限 4KB，经 Supervisor 强制 `forward` 给 Boss，标记 `[subagent-progress]`。没有新字节则不打扰 Boss。不调用 `noteAgentActivity`（不清 `toolWaitSince`）。
- 空闲：`idleMs = now - max(lastActivityAt, lastProgressLogAt)`。
- 未设字段：行为与现在完全一样。
- Worker 不新增工具、不能改路径。

## Boss skill

- 提交位置：`chatrpgv4/skills/chatrpg-test-dispatch/SKILL.md`（仓库内，可发现副本在项目 `.pi/agent/skills`）。
- 给主会话 Boss：测 pytest / playtest 时 `skill_load`，再派 worker。
- 规定：`progressLog=".pi/progress/<agentId>.log"`，长测提高 `timeoutSecs`，`heartbeatSecs=60`，brief 命令 `tee -a` 到该路径。Supervisor 会定期把该文件新增片段回给 Boss；当作测试输出，不当新用户请求。
