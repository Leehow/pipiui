# PipiUI Constitution / 项目宪章

Binding rules for humans and coding agents. Short and enforceable.
人类与 coding agent 均须遵守。短、可执行、无例外（除非用户明确豁免）。

---

## 0. 易用性优先，先走通再加固（强制）

**The first milestone is a real, end-to-end usable product flow. Optional security hardening must not block that milestone.**

- MVP 首先保证普通用户无需理解基础设施即可完成核心任务；默认流程不得额外要求账号、邮箱验证码、手工填写凭据或服务器知识，除非这些步骤是核心功能不可替代的必要条件。
- 产品验收优先看真实用户步骤是否最短、是否真的能用。能用随机链接直接完成的流程，不得改成多层登录、授权和配对仪式。
- 首版只保留避免明显凭据泄露、破坏性操作和越权访问所必需的最小边界；纵深防御、复杂密钥治理、额外身份层和高级安全策略放到核心流程跑通之后。
- 任何会增加用户步骤的安全设计，必须先给出具体威胁和不可替代性；否则默认延后，不得以“更安全”为由阻塞可用版本。
- **错误必须可关闭**：所有持续显示的用户可见错误必须提供明确的关闭控制（如 × 按钮）；临时 toast 可自动消失，但仍须可手动关闭；错误不得永久占据 Composer 或阻塞后续操作，关闭后应能继续使用界面。

## 1. 唯一可运行包与唯一打包地点（强制）

**The only permitted runnable App is `/Users/haoli/leehow/code/pipiui/build/PipiUI.app`. Only this primary checkout may package it.**

凡成功编译、功能完成、或声称「构建通过 / 可运行」且意图更新可双击运行的 App 时，**只能**在主工作区 `/Users/haoli/leehow/code/pipiui` 随后打包。不得只停在 Electron 工作区的 `dist` / `out` 产物。

所有 linked worktree、临时 worktree 与 `pipiui-wt/*` 目录只可运行 Electron workspace build/test 作验证；**严禁**运行会创建 `build/PipiUI.app` 的打包命令。不得保留、打开、分发或在 Launchpad 中依赖这些目录里的 `.app`。若发现历史遗留副本，应删除该副本，主工作区的唯一包不受影响。

Canonical commands:

```bash
cd /Users/haoli/leehow/code/pipiui
# Electron release → build/PipiUI.app（一律经 pipiui-electron-build skill）
~/.codex/skills/pipiui-electron-build/scripts/pipiui-electron-build fast-app
```

Agents 不直接调用 `build-electron-app.sh`，一律经 `pipiui-electron-build` skill 打包（见 `AGENTS.md` → Electron packaging adapter）；该 skill 的 `release` 模式内部才调用本脚本。本条约束的是打包**地点**，skill 约束的是打包**方式**，两者并行生效。

## 1A. PipiUI 宿主进程生命周期由用户授权（强制）

本项目对精确 canonical App 提供持续的用户生命周期授权：当用户要求构建、打包、安装、打开、重启或继续真实验收时，Agents/workers 可温和退出对应 App、使用 `--overwrite-running` 覆盖安装、重新打开并继续测试，**不得再次索要单独或逐轮授权**。

该授权仅限 `/Users/haoli/leehow/code/pipiui/build/PipiUI.app`。禁止终止其他 App，禁止用模糊进程名批量匹配。优先发送正常退出请求并有界等待；若其失败且阻塞用户已经要求的生命周期/验收操作，只能终止经过路径核验的精确 canonical-App PID，强制终止仅作为再次有界等待后的最后手段，并须报告终止对象与原因。

仅分析、仅源码修改或仅单元测试不自动触发生命周期操作；不得在真实验收并非必要时凭空重启。

## 2. 时间戳验收（强制）

仅在主工作区打包后，验证 App 二进制新于改动源码：

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  <本次实际改动的源文件>
```

`build/PipiUI.app` 的对应二进制必须新于本次变更的 sources，否则不算完成。

## 3. 禁止「半完成」话术

- **Do not** tell the user "done / ready to open app" if only the Electron workspace build succeeded and `build/PipiUI.app` is older than sources.
- 仅 Electron 工作区 build/test 成功而 `.app` 仍旧时，**不得**说「完成 / 可以打开 App 了」。

## 4. 开发 vs 交付

| 用途 | 命令 |
|------|------|
| 任意 worktree 的快速调试/验证 | `Electron/` 下的 workspace build / `npm test` |
| 主工作区的可双击 Electron App | `pipiui-electron-build` skill 的 `fast-app` / `release`（仅主工作区，打包到 `build/PipiUI.app`；勿手调 electron-builder） |

## 5. 其它质量底线（简）

- 改动业务逻辑 / 解析 / 状态机时：在 `Electron/` 跑 `npm test`（vitest 工作区）。
- 声称完成前：有命令级证据（构建/打包输出 + `build/PipiUI.app` 时间戳），禁止口头「应该好了」。

## 6. Pi 按项目完全隔离（强制）

Pi 配置家是当前打开项目自己的目录，不是全局 `~/.pi`，也不是把整个 Application Support `pi-agent` 当项目家。

- 项目隔离：每个打开项目的 sessions、skills、memory、resources、settings.json、trust.json、models-store.json 只存在于 `{projectRoot}/.pi/agent`，禁止跨写其他项目
- 明确例外（App-profile canonical）：所有打开项目共享 Electron profile `pi-agent` 同一份 `.env`、`auth.json`、`models.json`；禁止再按项目复制 OAuth 或模型目录
- 明确例外（host bookkeeping）：project list、调度队列、telemetry、agent-worktree projection 可留在 App profile
- 明确例外（扩展共享安装，窄）：核心能力扩展的**不可变、内容寻址代码包与版本元数据**（含 active/previous slot 与 receipt）可存放于 App-profile 共享存储，所有打开项目共用同一份只读代码；启用状态、授权、扩展设置、memory 数据、browser session、trust 仍严格按项目隔离，禁止共享或跨项目读写
- 新项目不得从 App profile 复制 `trust.json`；已有项目的 trust 决定不得删除或改写
- chatrpgv4 `pi-coc`：`{chatrpgv4}/.pi/coc-agent`
- 禁止使用或写入全局 `~/.pi`。禁止从 `~/.pi` 导入 packages。

## 7. 模型可操作稳定 ID 必须是语义 slug（强制）

**Any stable identifier an LLM must read, repeat, resume, or reference across tool calls must be a short, unique, human-readable semantic slug — never a UUID, random hex, or `agent-<random>`. Opaque randomness is reserved for machine-internal ids no model ever names.**

按来源分三类，要求不同：

- **A. Caller-chosen 身份（模型显式提供）**：worker `agentId`、`plan.id` 及其 task id、`computer_task` `sessionId` 等由模型命名并按名续接的身份。必须由模型显式提供短、唯一、可读、可复制的 slug（如 `quota-pill`）；运行时不得为这类身份静默回退到随机生成。
- **B. Runtime-allocated 模型可见身份**：如 pi-goal 的 `goal_id`（`<slug>.<generation>`）。可由运行时生成，但必须同样短、可读、语义化且唯一（如 `fix-login-race.2`），永不以 UUID / 随机 hex / opaque randomness 代替。
- **C. 机器内部一次性 ID（模型无需命名）**：单次 runId/eventId/waveId/requestId、安全/capability token、浏览器 snapshot/element token、临时文件与锁 —— 随机/不透明是正确选择。

A 与 B 都禁止 opaque randomness，区别只在提供方；暴露 A/B 类 ID 的工具契约（schema 与 description）必须写明对应要求。bundled philosophy 的 orchestration 层同步承载该规则，并由 philosophy runtime 测试钉住。


## 8. 基础系统提示词已锁定（强制）

**The base system prompt is closed. Change the extension, not the base.**

架构已经完全扩展化：常驻核心只剩 pi 运行时、宿主进程，以及唯一一份基础提示词
`Electron/resources/runtime/pi-core-prompt/SYSTEM_BASE.md`。其余一切能力，连同**工作方法
本身**，都是可按项目开关的扩展，且**随产品包变化**——`profiles/base` 只 required
`skill-loader-extension`，git / 终端 / 计划 / 目标 / Web / 浏览器 / 代码检索乃至哲学扩展
（`coding-method`）都只在 `profiles/coding` 里。

- 该文件无条件下发，没有 feature flag，任何扩展都无法移除。它是所有扩展关闭后唯一还在
  的提示词。两条投送路径（PipiUI 有两个 spawn 组装器）：主会话由 `assemblePiSpawn` 以第一个
  `--append-system-prompt` 传入；派工 worker 由 `PIPIUI_CORE_PROMPT` 传路径、subagent 在
  agent 自身提示词**之前**追加同一份文件。worker 在另一个进程里自己拼参数，两边靠这个 env
  名字对齐且无编译期保护——有测试钉住双方。
- 会话最终 prompt 的构成可查：`pipiui_runtime_info` 的 `systemPrompt` 字段给出总大小、
  digest 和按贡献者分段（`pi-frame` / `pipiui-base` / `philosophy` / `project-context` /
  `skills`），同一份写进 session 旁的 runtime debug sidecar。只记 provenance 不落全文。
  worker 不能挂 runtime-info（它注册工具，而 worker 工具集是收窄白名单），改挂 tool-free 的
  `pipiui-prompt-observer`，同一份 provenance 形状，每次派工写
  `{project}/.pi/agent-prompts/<agentId>.<runId>.json`（原子写、仅变化时写、保留最新 200）。
- 基础提示词**只承载三样东西**：身份（运行在 PipiUI 里，底下是 pi）、扩展化架构的**形状**
  （能力随扩展进出；工具清单即全部事实；缺能力要如实报告而非模拟），以及在所有扩展
  关闭时仍必须成立的少数不变量（用户语言即回复语言；提问不是工单；授权由请求确立；
  没执行的断言不是结果；宿主进程属于用户）。
- **禁止在基础提示词里枚举具体扩展或能力清单。** 清单随产品包变，写死就等于在别的包里
  说假话；而且它会是最长的一段。只写形状，内容交给工具清单自己说。有测试按
  `profiles/*` 的 id 钉住这条。
- 基础提示词用**英语**书写，并保持**尽可能小**（当前 ~630 tokens，预算 800）。它是每个
  会话都要付、且谁都关不掉的那份开销。
- **禁止**往基础提示词里加规则。加在这里的规则关不掉、不能按模型/按 agent 收窄、
  不改代码就换不掉——哲学层的存在就是为了让这些都不必要。
- 改动去处：工作方法 → `pi-philosophy/layers/` 或项目内 `philosophy-user/`；只在某能力
  挂载时成立的规则 → 该扩展自己的 layer 目录；只对某模型族 → `requires-models` /
  `excludes-models`；挂在单个工具上 → 该工具的 `promptGuidelines`；单个派工 agent →
  其自身 system prompt；项目专属 → 项目的 `AGENTS.md`。
- 与 philosophy `foundation` 层的重叠（语言、宿主生命周期）是**故意的**：philosophy 可以
  被用户关掉，基础层不能。不要以「去重」为由删掉任一侧。
- 确需修订：改文件 → 跑 `packages/pi-backend/test/core-prompt-lock.test.ts` → 把新 digest
  写回 `EXPECTED_DIGEST` → 在 commit message 里说明改了哪条不变量、以及为什么没有任何
  扩展能承载它。这一步的噪音是设计目的：让评审看见有人动了关不掉的提示词。

细则见 `Electron/resources/runtime/pi-core-prompt/README.md`。

---

**权威产物路径：** `/Users/haoli/leehow/code/pipiui/build/PipiUI.app`（唯一可运行包）
**入口：** Electron 打包一律走 `pipiui-electron-build` skill（其 `release` 内部调 `./scripts/build-electron-app.sh`）
**Agent 入口：** 见根目录 `AGENTS.md`
