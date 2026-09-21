# 自动研究 (`autoresearch`)

内置扩展：把上游 Pi 包 [`pi-autoresearch`](https://github.com/davebcn87/pi-autoresearch) 原样打包进
PipiUI，提供自主实验循环——设定指标、反复尝试、保留改进、丢弃退步。

没有界面：没有面板、没有设置项、没有渲染层入口。它的使用方式和技能一致——用户说到要研究/循环优化，
模型自己挑起来用，不需要先敲命令。

## 它给会话带来什么

- 三个工具：`init_experiment`（配置指标与方向）、`run_experiment`（跑一次、计时、抓输出、判成败）、
  `log_experiment`（记录结果与持久状态）。**默认就在工具集里**：`mount/autoresearch.ts` 在会话开始时
  把它们加进去（上游默认把它们锁在 `/autoresearch` 模式后面），所以「帮我循环优化 X」可以直接调起来。
- `/autoresearch` 命令（上游注册）：`/autoresearch <目标>` 也能手动开，`off` 关闭（关掉后本会话不再
  自动放回），`clear` 清日志。
- 四个技能：PipiUI 侧的 `autoresearch`（入口技能：把「帮我循环优化 X」这类意图接到 `init_experiment`
  与上游 playbook）加上游三个 `autoresearch-create` / `autoresearch-finalize` / `autoresearch-hooks`。
  经 `agent.skills` 交给 skill loader，因此也出现在「设置 → 技能」里，并按描述自动触发。
- 会话状态落在项目工作目录的 `.auto/`（`log.jsonl`、`config.json`、`prompt.md`、`hooks/` 等）。

## 怎么用

直接说「帮我循环优化 X」。模型先 `init_experiment` 立基线（这一步同时打开上游的 autoresearch 模式：
系统提示指导、自动续跑与看板逻辑从此刻生效），再按 `autoresearch-create` 的 playbook 循环。
也可以自己发 `/autoresearch <目标>` 手动开、`/autoresearch off` 关；显式关过之后本会话不会自动放回工具。

## 默认启用

`pipiui-extension.json` 不写 `defaultEnabled`，内置（builtin）来源的默认值就是启用；coding profile 的
`recommended` 也列了它，所以新项目直接可用。禁用后下一个会话生效（`-e` 挂载按会话组装，不做热卸载）。

## 版本与更新中心

`updateComponents[0]` 声明上游 npm 版本，这是「更新中心 → Pi 扩展」里「本机 / 最新」的比对基准；
`npm test` 会断言它和 `vendor/pi-autoresearch/package.json` 的版本一致，改一个必须改另一个。

## 目录

- `pipiui-extension.json` — 挂载与版本清单（单一来源）。
- `mount/autoresearch.ts` — PipiUI 侧挂载文件：调用上游入口（零改动），并在会话开始时把三个被门控的
  工具放进工具集；尊重 `--exclude-tools` 与上游记录的显式 `off`。
- `skills/autoresearch/SKILL.md` — PipiUI 侧入口技能（何时用、怎么开跑）。
- `vendor/pi-autoresearch/` — 上游 tarball 原样内容，字节不变；溯源与升级步骤见 `VENDORED.md`。
- `test/manifest.test.ts` — 清单形状、版本锁步、挂载锁步、同步后的运行时副本。

`npm run build` 把本包同步进 `resources/runtime/extensions/autoresearch/`（单一来源规则：不要手改运行时副本）；
`npm test` 校验清单与同步结果。
