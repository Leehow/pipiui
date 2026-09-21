---
name: autoresearch
description: 在 PipiUI 里启动或恢复自主实验循环（内置上游 pi-autoresearch）：循环跑基准、保留改进、丢弃退步。当用户说「帮我循环优化 X」「反复实验找最优解」「自主研究这个指标」「跑 autoresearch」「optimize X in a loop」时使用——本技能负责把循环正确地启动起来，而不是自己发明实验流程。
---

# 启动 autoresearch（PipiUI 入口）

PipiUI 内置了上游 `pi-autoresearch`（`vendor/pi-autoresearch`，MIT）。它默认**不激活**：三个工具
`init_experiment` / `run_experiment` / `log_experiment` 只有在 autoresearch 模式打开后才进入工具集，
在此之前系统提示里也没有它的指导。这是上游 1.8.1 的模式门控设计，不是故障；升级 vendor 后需复核本节。

## 开始或恢复循环

模式只能由用户发送这条命令打开（模型不能代替，也没有任何工具能打开它）：

```
/autoresearch <优化目标>
```

例如 `/autoresearch 把单元测试耗时降下来，同时保持正确性`。

PipiUI 把 `/autoresearch ...` 原样交给 Pi，Pi 按扩展命令执行：打开模式、把三个工具加进工具集，并把
`/skill:autoresearch-create <目标>` 作为 kickoff 发给自己。之后按 `autoresearch-create` 的 playbook 走
（写 `.auto/prompt.md` 与 `.auto/measure.sh`，先跑基线，再开始循环）。

- 项目里已有 `.auto/log.jsonl` 时，新会话会自动恢复模式（同 cwd 且没有显式 `/autoresearch off` 记录）。
- `/autoresearch off` 关闭；`/autoresearch clear` 删除 `.auto/log.jsonl` 并关闭。
- 上游还有 `export` / `dashboard` 子命令，它们面向终端 TUI，在 PipiUI 聊天里没有对应界面。

## 你要做的

1. 用户还没发过命令时：说明这是上游的模式门控，请他在聊天里发送 `/autoresearch <目标>`，并把目标写具体
   （要优化什么、用什么指标、哪个方向）。
2. 命令发过之后：按 `autoresearch-create` 执行；不要自己发明循环、不要伪造 `log_experiment` 结果、
   不要在工具不可用时假装实验跑过。
3. 需要更多细节时读上游三个技能：`autoresearch-create`（开跑）、`autoresearch-finalize`（整理成分支）、
   `autoresearch-hooks`（迭代钩子）。
