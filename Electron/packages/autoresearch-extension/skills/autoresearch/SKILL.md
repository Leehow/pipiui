---
name: autoresearch
description: 自主实验循环（内置上游 pi-autoresearch）：设定指标，反复尝试、保留改进、丢弃退步。当用户说「帮我研究/循环优化 X」「反复实验找最优解」「自主研究这个指标」「跑 autoresearch」「optimize X in a loop」时使用——先 init_experiment 立基线，再按 autoresearch-create 循环。
---

# autoresearch（PipiUI 入口）

PipiUI 内置了上游 `pi-autoresearch`（`vendor/pi-autoresearch`，MIT），三个工具
`init_experiment` / `run_experiment` / `log_experiment` **默认就在工具集里**（PipiUI 的挂载文件
`mount/autoresearch.ts` 在会话开始时把它们加进去）。用户不需要先敲任何命令，说到要研究/循环优化就直接可用。

## 什么时候用

用户要「循环」地做一件事并看指标变化时：

- 帮我研究/优化 X（性能、耗时、通过率、loss、体积……）
- 反复试不同方案，保留有效的、丢掉没用的
- 自主跑实验，先测个基线

一次性的问题、单纯查资料、或者不需要度量指标的改动，不要用这套循环。

## 怎么做

1. **先问清（或推断）**：目标、跑什么命令、指标与方向、可改的文件范围、约束。
2. `init_experiment` 配置这次循环（名称、指标、单位、方向）——这一步同时会打开上游的 autoresearch 模式
   （此后它的系统提示指导、自动续跑与看板逻辑才生效）。
3. 按上游 `autoresearch-create` 技能的 playbook 走：建分支、写 `.auto/prompt.md` 与 `.auto/measure.sh`、
   跑基线，然后 `run_experiment` → `log_experiment` 循环（keep 自动提交，discard/crash 自动回滚代码改动）。
4. 需要更多细节时读上游另外两个技能：`autoresearch-finalize`（整理成可评审的分支）、
   `autoresearch-hooks`（迭代钩子）。

不要伪造 `log_experiment` 结果，也不要在指标没测到时假装实验跑过。用户用 `/autoresearch off` 显式关掉过
这个会话时，工具会按上游记录保持关闭，不要再自行加回来。
