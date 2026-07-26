# PipiUI Constitution / 项目宪章

Binding rules for humans and coding agents. Short and enforceable.
人类与 coding agent 均须遵守。短、可执行、无例外（除非用户明确豁免）。

---

## 1. 两条隔离工作流（强制）

### 外部 IDE：Codex / Claude Code / Cursor

每个实现任务必须使用独立 branch + linked worktree。不得让多个工具在同一工作
目录里切分支或并行写代码。

```bash
./scripts/new-ai-worktree.sh \
  --tool codex --work-id settings --topic sidebar --base codex/settings
```

- Worker 分支：`ai/<tool>/<work-id>-<topic>`。
- Worker 从明确的 committed base ref 创建；调用者工作区可有未提交内容，但绝不会复制过去。
- IDE 必须打开新 worktree 根目录。Worker 只提交自己的范围，不合并别人的分支。
- 会修改同一核心文件的任务应串行；集成负责人从同一 integration branch 逐个 merge。

### PipiUI Boss：native lifecycle 优先

- Boss 主会话必须打开在专用、clean 的 integration worktree/branch
  （`codex/*` 或 `integration/*`）；active development 不直接使用 shared dirty
  primary checkout，也不直接使用 Git `main`。
- PipiUI native extension 独占 child worktree 的创建/复用、`.pi/worktrees/*`、
  `pipiui/*` 分支命名、attested structured verify、串行 auto-merge、成功后移除及
  失败 worktree 保留/恢复。这里的 merge target 是 Boss session project root，
  不必是 Git `main`。每份 implementation brief 的 structured verify 必须包含
  真实编译和相关测试，不能降为 lint/diff-only；成功移除 worktree 时其 `.build`
  也随之回收。
- Boss 与其 native workers 不调用 `new-ai-worktree.sh`，也不手工 merge。通过
  verified pass 后的 runtime auto-merge 明确允许；“worker 不得 merge”只约束
  leaf worker，不约束 Boss runtime。
- Merge/verify 失败服从 `BossPrompt.swift` 的 same-agent/fixer recovery，不用
  通用手工冲突规则覆盖。若本宪章的外部 IDE 通用语言与 BossPrompt/native
  runtime 冲突，后者优先。
- Boss ledger/work terminal 且 integration clean 后，才执行一次
  `ship-app.sh`。

## 2. 四层构建与唯一安装入口（强制）

| 层级 | 命令 | 产物 / 权限 |
|------|------|-------------|
| Worker 默认验证 | `./scripts/verify-worker.sh` | `swift test`：真实 debug 编译 + 测试；不做 release package |
| Worker 显式本地预览 | `./scripts/verify-worker.sh --package-preview` | test + 当前 worktree 的 `build/PipiUI.app`；不安装 |
| 本地打包底层入口 | `./make-app.sh` / `./scripts/build-app.sh` | release local package；不安装 |
| Integration canonical ship | `./scripts/ship-app.sh` | 测试 + 本地打包 + 独占安装 `/Applications/PipiUI.app` |

`./make-app.sh` 与 `./scripts/build-app.sh` 永远只生成当前 worktree 的
`build/PipiUI.app`，不得写 `/Applications`。`./scripts/ship-app.sh` 是唯一
canonical installer；它只接受 `main`、`codex/*`、`integration/*`，要求完全
clean，并持有全局原子锁。

`verify-worker.sh` 同时验证 worker 分支和 linked-worktree 身份；即使手动切到
`ai/*` 或 `pipiui/agent-*`，primary checkout 也会被拒绝。

## 3. Worker 验证不等于交付

Worker 完成前应运行：

```bash
./scripts/verify-worker.sh                   # 默认：swift test / debug
./scripts/verify-worker.sh --package-preview # 需要本地 .app 时才 release
```

普通 worker 不应每次生成 release App。Worker 必须报告 branch、base/head SHA、
改动文件、验证命令与结果。即使显式本地 `build/PipiUI.app` 可运行，也只能声称
「worker verification passed」，不得声称已交付、已安装或用户可通过 Launchpad
打开最新版。

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
PipiUI Boss 流程必须等 ledger/work terminal 后再执行，且只执行一次。

## 5. 外部 IDE 的冲突与清理

- 只允许集成负责人解决 merge 冲突；业务语义冲突应基于最新 integration head
  新建修复 worktree，不让两个 AI 同时抢修。
- 未确认 merge 成功前不得删除 worker branch/worktree。
- 禁止用 `git reset --hard`、`git clean`、`git restore` 或 stash 处理别人的改动。
- 遇到意外 dirty files、分支或同文件并行编辑时，停止并报告，不得自行清理。

本节不覆盖 PipiUI Boss native auto-merge/recovery；该流程按第 1 节的
BossPrompt/native runtime 优先规则处理。

## 6. 构建经济性

- Git branch 本身不会构建任何东西；只有在 active worktree 执行命令才会构建。
- 每个 linked worktree 拥有独立 `.build/` 与 `build/`，避免互相破坏，但执行
  构建时也会重复编译；PipiUI native worker 成功移除后会同时回收其 `.build`。
- 每个任务只做聚焦验证；普通 worker 默认不做 release package。对 build-heavy
  validation 做串行或限并发，最终 integration 只做一次 `ship-app.sh`。
- 所有代码改动仍必须在自己的 worktree 真实编译并跑相关测试，不得用
  lint/diff-only 代替。
- 不共享或拼接 SwiftPM scratch path 来省编译时间。

## 7. 其它质量底线（简）

- 改动业务逻辑 / 解析 / 状态机时运行 `swift test`；环境无 XCTest 时记录并使用
  `swift run PipiUITestRunner`。
- 构建脚本保持 `set -e` / `set -euo pipefail` 与可执行位。
- 声称完成前必须有命令级证据，禁止口头「应该好了」。

---

**Worker 产物：** 每个 worktree 自己的 `build/PipiUI.app`

**权威用户产物：** `/Applications/PipiUI.app`（仅 `ship-app.sh` 可更新）

**外部 IDE 入口：** `new-ai-worktree.sh` · `verify-worker.sh`

**PipiUI Boss 入口：** native extension / `BossPrompt.swift`

**交付入口：** `ship-app.sh`

**Agent 入口：** 见根目录 `AGENTS.md`
