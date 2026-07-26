# PipiUI Constitution / 项目宪章

Binding rules for humans and coding agents. Short and enforceable.
人类与 coding agent 均须遵守。短、可执行、无例外（除非用户明确豁免）。

---

## 1. 一任务一分支一 worktree（强制）

Codex、Claude Code、Cursor 与 PipiUI agent 的每个实现任务都必须使用独立
branch + linked worktree。不得让多个工具在同一工作目录里切分支或并行写代码。

```bash
./scripts/new-ai-worktree.sh \
  --tool codex --work-id settings --topic sidebar --base codex/settings
```

- Worker 分支：`ai/<tool>/<work-id>-<topic>`；PipiUI：`pipiui/agent-<work-id>-<topic>`。
- Worker 从明确的 committed base ref 创建；调用者工作区可有未提交内容，但绝不会复制过去。
- IDE 必须打开新 worktree 根目录。Worker 只提交自己的范围，不合并别人的分支。
- 会修改同一核心文件的任务应串行；集成负责人从同一 integration branch 逐个 merge。

## 2. 三层构建与唯一安装入口（强制）

| 层级 | 命令 | 产物 / 权限 |
|------|------|-------------|
| Worker 快速调试 | `swift run` / `swift build -c debug` / `swift test` | 当前 worktree 的 `.build/`；不安装 |
| Worker 本地可运行预览 | `./scripts/verify-worker.sh` | 当前 worktree 的 `build/PipiUI.app`；不安装 |
| Integration canonical ship | `./scripts/ship-app.sh` | 测试 + 本地打包 + 独占安装 `/Applications/PipiUI.app` |

`./make-app.sh` 与 `./scripts/build-app.sh` 永远只生成当前 worktree 的
`build/PipiUI.app`，不得写 `/Applications`。`./scripts/ship-app.sh` 是唯一
canonical installer；它只接受 `main`、`codex/*`、`integration/*`，要求完全
clean，并持有全局原子锁。

## 3. Worker 验证不等于交付

Worker 完成前应运行：

```bash
./scripts/verify-worker.sh              # test + release local package
./scripts/verify-worker.sh --skip-tests # 仅在 handoff 明确解释原因时
```

Worker 必须报告 branch、base/head SHA、改动文件、验证命令与结果。即使本地
`build/PipiUI.app` 可运行，也只能声称「worker verification passed」，不得声称
已交付、已安装或用户可通过 Launchpad 打开最新版。

## 4. Integration ship 验收（强制）

集成负责人串行 merge；每次 merge 后运行相关测试。全部通过后，在 clean 的
integration worktree 中执行：

```bash
./scripts/ship-app.sh
```

脚本会拒绝 worker/detached 分支、tracked 或 untracked 脏状态、已有锁与模糊
安装路径；随后运行测试与本地打包、安装 canonical App，并验证 build 与
Applications 二进制 SHA-256 相同及打印时间戳。不得静默删除 stale/foreign lock。

只有成功的 `ship-app.sh` 输出才支持「已交付 / 可以打开 App」的结论。

## 5. 冲突与清理

- 只允许集成负责人解决 merge 冲突；业务语义冲突应基于最新 integration head
  新建修复 worktree，不让两个 AI 同时抢修。
- 未确认 merge 成功前不得删除 worker branch/worktree。
- 禁止用 `git reset --hard`、`git clean`、`git restore` 或 stash 处理别人的改动。
- 遇到意外 dirty files、分支或同文件并行编辑时，停止并报告，不得自行清理。

## 6. 其它质量底线（简）

- 改动业务逻辑 / 解析 / 状态机时运行 `swift test`；环境无 XCTest 时记录并使用
  `swift run PipiUITestRunner`。
- 构建脚本保持 `set -e` / `set -euo pipefail` 与可执行位。
- 声称完成前必须有命令级证据，禁止口头「应该好了」。

---

**Worker 产物：** 每个 worktree 自己的 `build/PipiUI.app`

**权威用户产物：** `/Applications/PipiUI.app`（仅 `ship-app.sh` 可更新）

**入口脚本：** `new-ai-worktree.sh` · `verify-worker.sh` · `ship-app.sh`

**Agent 入口：** 见根目录 `AGENTS.md`
