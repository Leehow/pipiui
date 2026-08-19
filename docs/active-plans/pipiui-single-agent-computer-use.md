# PipiUI 单 Agent 自学习 Computer Use 实现

Work ID: `pipiui-single-agent-computer-use`
Status: `Source Complete / Integration Blocked`
Last updated: `2026-08-19`

## Goal

按照已批准的 2026-08-19 设计规格，把 Electron PipiUI 的普通 `computer_task` 从 Leader + 固定 Worker 层级替换为一个不可继续委派的 Computer Use Agent，并实现 guarded action block、状态恢复和项目隔离 Workflow Memory。

## Decisions

- 唯一设计来源是 `docs/superpowers/specs/2026-08-19-single-agent-computer-use-design.md`；旧 2026-08-11 多层设计已归档。
- 保留 Computer Runtime v1、Cua Driver、精确目标绑定、急停、取消和 `outcome_unknown`；替换上层模型编排。
- 普通运行时只有一个 Computer Use Agent episode；独立 verifier 只用于产品验收。
- 工作流只存于 backend 已解析的 active project Pi home，不自动导入 App-profile/global Procedure Store。
- 当前主工作区的既存并发改动不属于本实现，不得 reset、restore、stash、clean 或吸收。

## Items

| Item | Status | Note |
|---|---|---|
| M0 基线与单 episode 契约 | Partial | 单 episode/source contract 已完成；尚无 canonical App live 性能基线 |
| M1 单 Computer Use Agent 入口与完整普通工具面 | Done | `computer_task({goal})` 只启动一个不可委派 child；普通非管理工具继承，桌面能力收口为三个 Host 工具 |
| M2 Guarded Action Block 与 2/4/12 节奏 | Done | Host 执行块、JIT 语义绑定、状态屏障、receipt 与 Cold/Candidate/Practiced 限额已覆盖测试 |
| M3 Task Checkpoint、漂移和用户介入恢复 | Done | 支持跳过用户已完成效果、最短安全后缀、漂移停止、unknown effect 禁止盲重放；超时后同 grant 可恢复 |
| M4 project-local Workflow Memory v2 | Done | Candidate/Practiced/Suspended、两次独立成功晋级、top-3 recall、修复版本、损坏隔离和敏感 App 排除已实现 |
| M5 旧层级退出默认路径与文档清理 | Partial | 普通路径已不可达旧层级；旧兼容实现仍保留定义，因主 checkout 正有并发 lane 修改这些文件，尚不能物理删除 |
| Electron 自动化验证 | Done | Node 134/134；backend/UI 82/82；SubagentPanel 58/58；五个 workspace build 通过，`verify:preload OK` |
| canonical Electron App 真实验收 | Not Done | linked worktree 禁止打包；需先安全集成主 checkout，再做 TextEdit/Finder/browser/Office/cross-tool 与扰动验收 |

## Acceptance criteria

- `computer_task` 运行时只产生一个 Computer Use Agent episode，且该 agent 没有委派工具。
- 相干三动作序列可以一次提交并由 Host 在状态屏障处停止。
- 用户/应用改变界面后可以对账、跳过已完成步骤并继续；consequential unknown effect 不盲重放。
- Workflow 按 Candidate → Practiced → Suspended 演化且项目隔离。
- 旧 Leader/固定 Worker 默认路径被删除，不保留双默认编排。
- 自动测试、workspace build、perturbation eval 与 canonical App 真实验收满足 spec 第 19、22 节。

## Validation evidence

- 实现提交：`ed6c1189b6ba5b759273dd94762934b858f14c6e`。
- 鲁棒性修订：`cad2bfb69541dd6576f6edc618e832005c5f8901`。
- Node focused suite：134/134。
- pi-backend/UI contracts：82/82；SubagentPanel：58/58。
- `@pipi/host-api`、`@pipiui/ui`、`@pipi/pi-backend`、`@pipiui/server`、`@pipiui/electron` 依赖顺序构建通过；`verify:preload OK`。
- 工厂完整 handoff：task-owned worktree 的 `.tmp/team-lead/factory-final-pipiui-single-agent-computer-use.md`。
- 未运行 canonical App package / launch / TCC / real GUI acceptance，因此不得把以上证据表述为产品真实验收。

## Blockers

- 主 checkout 当前存在大量既存改动，并与本分支至少重叠 `Electron/packages/ui/src/App.tsx`、`Electron/resources/runtime/pi-ext/subagent/index.ts`、`README.md`、`Tests/Node/test-computer-agent-host-m2.mjs`；不能直接 cherry-pick、覆盖、stash 或吸收。
- 旧 coordinator / plan / prompt / test 文件也正被并发 lane 修改，因此 spec 要求的物理删除必须等所有权冲突解除。

## Next action

等待主 checkout 重叠改动的所有者完成或明确交接；随后逐文件集成 `ed6c1189` + `cad2bfb6`，处理旧兼容实体删除，再从主 checkout 按 Electron build skill 打包并完成真实 GUI / 扰动验收。
