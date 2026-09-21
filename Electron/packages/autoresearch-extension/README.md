# 自动研究 (`autoresearch`)

内置扩展：把上游 Pi 包 [`pi-autoresearch`](https://github.com/davebcn87/pi-autoresearch) 原样打包进
PipiUI，提供自主实验循环——设定指标、反复尝试、保留改进、丢弃退步。

没有界面：没有面板、没有设置项、没有渲染层入口。它的使用方式和技能一致——需要做实验/优化时，
模型自己挑起来用。

## 它给会话带来什么

- 三个工具：`init_experiment`（配置指标与方向）、`run_experiment`（跑一次、计时、抓输出、判成败）、
  `log_experiment`（记录结果与持久状态）。**它们默认不在工具集里**：上游按模式门控，模式打开后才加入，
  在此之前没有任何系统提示开销。
- `/autoresearch` 命令（上游注册）：`/autoresearch <目标>` 打开模式并 kickoff，`off` 关闭，`clear` 清日志。
- 四个技能：PipiUI 侧的 `autoresearch`（入口技能：把「帮我循环优化 X」这类意图接到
  `/autoresearch <目标>`，并说明模式门控）加上上游三个 `autoresearch-create` / `autoresearch-finalize` /
  `autoresearch-hooks`。经 `agent.skills` 交给 skill loader，因此也出现在「设置 → 技能」里，并按描述自动触发。
- 会话状态落在项目工作目录的 `.auto/`（`log.jsonl`、`config.json`、`prompt.md`、`hooks/` 等）。

## 怎么用

第一次要由用户发送 `/autoresearch <优化目标>`（模式只能由这条命令打开，模型无法代开）；之后按
`autoresearch-create` 的 playbook 循环。项目里已有 `.auto/log.jsonl` 时，新会话会自动恢复模式。

## 默认启用

`pipiui-extension.json` 不写 `defaultEnabled`，内置（builtin）来源的默认值就是启用，所以新会话直接可用。
禁用后下一个会话生效（`-e` 挂载按会话组装，不做热卸载）。

## 版本与更新中心

`updateComponents[0]` 声明上游 npm 版本，这是「更新中心 → Pi 扩展」里「本机 / 最新」的比对基准；
`npm test` 会断言它和 `vendor/pi-autoresearch/package.json` 的版本一致，改一个必须改另一个。

## 目录

- `pipiui-extension.json` — 挂载与版本清单（单一来源）。
- `skills/autoresearch/SKILL.md` — PipiUI 侧入口技能（模式门控说明 + 如何开始）。
- `vendor/pi-autoresearch/` — 上游 tarball 原样内容，字节不变；溯源与升级步骤见 `VENDORED.md`。
- `test/manifest.test.ts` — 清单形状、版本锁步、同步后的运行时副本。

`npm run build` 把本包同步进 `resources/runtime/extensions/autoresearch/`（单一来源规则：不要手改运行时副本）；
`npm test` 校验清单与同步结果。
