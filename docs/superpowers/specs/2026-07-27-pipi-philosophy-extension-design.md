# Pipi 哲学扩展设计（Pipi Philosophy Package）

日期：2026-07-27
状态：**Phase 1 已实施**（2026-07-27，仓库 `/Users/haoli/leehow/code/pipi-philosophy`，commit `6df53db`）；
Phase 2-4 未实施。v2 —— 从「UI 绑定」改为「pi 常驻」
涉及：新仓库 `pipi-philosophy`；PipiUI 侧
`Sources/PipiUI/BossPrompt.swift`、`PiPlugin.swift`、`ChatSession.swift`、
`AppStore.swift`、`Views/SettingsSheet.swift`、`PiExt/subagent/index.ts`

## 0. 一句话

哲学不该住在 UI 里，该住在 pi 里：做成一个**独立的 pi package**，
四层可独立开关，PipiUI 退化成它的控制面板 —— 于是裸 TUI、别的 UI、
派出去的 worker，吃到的是同一套哲学。

---

## 1. v1 的错误与本次修正

v1 把哲学放在 `Application Support/PipiUI/` 并由 `ChatSession` spawn 时注入。
**缺陷：哲学与前端绑定。** 换 UI、偶尔用 TUI 裸跑 `pi`，哲学就消失了——
而哲学恰恰是这个项目里唯一「离开 PipiUI 仍然成立」的东西。

修正的分界线：

| 组件 | 归属 | 理由 |
|---|---|---|
| bridge / webview / media / computer-use / subagent 补丁 | **App 私有**，坚持不进 `~/.pi` | 依赖 App 进程与桥接端口，换前端毫无意义 |
| **哲学** | **pi-land（package）** | 与前端无关；换前端、换机器、给别人用，都还要它 |

`PiPlugin.swift:5-7` 那条「完全独立于 `~/.pi`」的原则**依然正确**——它是为 UI 管道
定的。哲学是唯一的例外，因为它的价值主张正好相反。

---

## 2. 先回答上一轮的问题：Boss 模式现在是什么

**既不是扩展，也不是 skill。** 是一段编译进二进制的 Swift 字符串，落盘后用一个
CLI flag 注入：正文 `BossPrompt.swift:21-365`；落盘 `PiPlugin.swift:197`；
注入 `ChatSession.swift:774-776`；开关 `AppStore.swift:146-147`、`:407`；
UI `SettingsSheet.swift:185`。

它的问题（v1 已列，v2 补第 5 条）：

1. **全有或全无** —— 关掉 Boss 连带关掉「别问废话确认」「失败不是终点」
   「流程重量匹配工作量」，这些跟派不派工无关。*基础哲学不该是编排哲学的人质。*
2. **worker 拿不到** —— worker 只有 agent `.md` + brief（`index.ts:1628-1632`）。
3. **不可分项、不可覆盖、不可观测**。
4. **正文与代码混住**，366 行里 345 行是字符串。
5. **前端绑定** —— 本轮的核心问题。

---

## 3. 实测：pi 提供了哪些与前端无关的常驻挂载点

（均在本机 pi 0.81.1 的 `dist/` 上核实）

| 机制 | 位置 | 是否与前端无关 | 能否分层/带逻辑 |
|---|---|---|---|
| `APPEND_SYSTEM.md` 自动发现 | `~/.pi/agent/APPEND_SYSTEM.md`（全局）；`<proj>/.pi/APPEND_SYSTEM.md`（项目受信任时） | ✅ | ❌ 单文件、无逻辑 |
| `settings.json` → `extensions[]` | 绝对路径列表，支持 `-`/`+`/`!` 前缀过滤 | ✅ | ✅ |
| `~/.pi/agent/extensions/<dir>/index.ts` 自动发现 | 目录约定 | ✅ | ✅ |
| **`settings.json` → `packages[]`** | `npm:<name>` / `git:<host>/<path>` / **本地路径** | ✅ | ✅ |

**package 的形态**（对照已装的 `pi-review`）就是一个普通 npm 包，
靠 `package.json` 里一个 `pi` 字段声明贡献物：

```json
{ "name": "pipi-philosophy",
  "pi": { "extensions": ["./philosophy.ts"] } }
```

`parseSource` 支持三种来源：`npm:`、git URL、**本地路径**。
本地路径这条尤其关键——PipiUI 可以把随包发布的副本落盘后注册为本地 package，
**离线、随 App 更新、TUI 同样吃到**。

### 三个必须写进设计的实测坑

1. **`--append-system-prompt` 会完全抑制 `APPEND_SYSTEM.md` 自动发现。**
   `core/resource-loader.js` 里是 `appendSources = CLI ?? (discovered ? [discovered] : [])`
   —— `??` 意味着只要 CLI 传了，全局文件一个字都不会加载。
   所以今天 PipiUI 开 Boss 时，用户自己写的 `~/.pi/agent/APPEND_SYSTEM.md` 是**静默失效**的。
   哲学改成 package 后 PipiUI 停传这个 flag，顺手修掉这个 bug，**净减一个耦合**。

2. **worker 会加载自动发现/package 的扩展。** 派工只传 `--no-skills`，不传
   `--no-extensions`（`index.ts:1435` 有注释解释原因：那会砍掉 worker 依赖的
   provider server-tools）。
   → **哲学 package 会自动进入每个 worker。** 这既是好事（§6.3 的作用域分发几乎白送），
   也是风险：不做作用域过滤的话，每个 worker 白吃编排层的 ~1.8k tokens，
   而且会被教着去扇出——与 `PIPIUI_AGENT_MAX_DEPTH` 的意图直接冲突。
   **`scope` 从「加分项」变成「必须项」。**

3. **同名工具是硬失败。** 已被 `PiExtensionConflicts.swift` 处理过一次
   （官方 subagent vs 补丁版）。哲学 package **不注册任何工具**，只注册一个
   `/philosophy` 命令，从根上避开这条。

---

## 4. 架构

```
pipi-philosophy/                     ← 独立 repo，可 npm 发布 / git 安装 / 本地路径安装
  package.json                       # "pi": { "extensions": ["./philosophy.ts"] }
  philosophy.ts                      # 唯一扩展入口（~200 行）
  capabilities.json                  # 唯一一处 pi 工具名映射
  layers/
    10-foundation.md                 # 基础哲学
    20-method.md                     # 工作方式哲学
    30-orchestration.md              # 编排哲学
    40-fanout.md                     # 瀑布流哲学
  README.md                          # 给下游用户的安装说明
```

三条安装路径，**同一份产物**：

| 场景 | 命令 / 行为 |
|---|---|
| 你自己、下游用户（推荐） | `pi package install git:github.com/<you>/pipi-philosophy` |
| 发布后 | `pi package install npm:pipi-philosophy` |
| PipiUI 用户（离线、随 App 更新） | App 把 bundled 副本落到 `Application Support/PipiUI/pi-philosophy`，把该路径写进 `~/.pi/agent/settings.json` 的 `packages[]` |

三条路径装完，**裸 TUI、PipiUI、任何 spawn pi 的前端、以及所有 worker 进程，
加载的是同一个扩展、同一份配置。**

### 4.1 配置住在 pi-land

`~/.pi/agent/philosophy.json`（**不是** App Support）：

```json
{
  "version": 1,
  "enabled": true,
  "layers": { "foundation": true, "method": true, "orchestration": true, "fanout": true },
  "scopes": { "worker": false },
  "userDir": "~/.pi/agent/philosophy-user"
}
```

- 扩展每轮 `before_agent_start` 热读 → 改开关立刻生效，不用重启会话。
- TUI 用户：`/philosophy` 看状态，手改 JSON 或用 `/philosophy toggle <layer>`。
- PipiUI 用户：设置面板是这个文件的 GUI，写的是同一个文件。

### 4.2 PipiUI 的新角色：控制面板 + 安装器

不再拥有哲学，只负责让它好用：

- 检测 package 是否安装、来源（git/npm/local）、版本；未装时给「一键安装（本地）」
- 分层开关 GUI → 写 `philosophy.json`
- 「查看合成结果」：直接展示要进 system prompt 的那份文本 + token 估算
- 停止传 `--append-system-prompt`（Boss 路径删除），并把 `BossPrompt.swift` 删掉
- **安全网**：检测到 package 缺失/损坏时，回落到旧的单文件 `--append-system-prompt`
  注入（用 bundled 副本合成）。App 永远能工作，只是此时 TUI 吃不到。

---

## 5. 四层模型

| id | 中文名 | 内容（从 `BossPrompt.swift` 迁移） | 依赖 | scope | 约 |
|---|---|---|---|---|---|
| `foundation` | 基础哲学 | 47-74 自主推进与最小确认门、88-109 流程重量匹配工作量、294-307 反早停失败恢复、309-329 计划是列表不是文档、331-359 外部技能只是建议、361-364 每轮形状、语言跟随 | — | main+lead+worker | ~110 行 |
| `method` | 工作方式哲学 | 111-130 先自己想再查外面（设计后交叉验证）、证据位阶 | — | main+lead+worker | ~25 行 |
| `orchestration` | 编排哲学 | 22-45 身份与派工路由、76-86 身份保持、132-140 规划、169-178 brief、180-208 派工纪律、210-228 验收监工、230-266 ledger、268-292 完成权 | — | main+lead | ~150 行 |
| `fanout` | 瀑布流哲学 | 142-167 默认并行、lead 扇出阈值、异步信号（stalled / merge-failed / post-merge-verify）处置 | `orchestration` | main+lead | ~50 行 |

- **拆开 `foundation` 与 `orchestration` 是主要收益**：今天关 Boss 会连坐关掉
  反早停和最小确认门，拆开后单人会话也能拿到。
- **`fanout` 依赖 `orchestration`**：UI 上是缩进子项，父项关闭时置灰并视为关闭。
- **英文 id 用 `fanout` 不用 `waterfall`**：正文是英文（延续 `BossPrompt.swift:5-8`
  的理由——同等指令密度英文约省一半 token），而 `waterfall` 在英文语境指瀑布式
  开发模型，语义正好相反。中文 UI 仍叫「瀑布流」。

层文件带 frontmatter：

```markdown
---
id: fanout
name: 瀑布流哲学
summary: 无依赖的活一次全派出去；扇出宽了先过 lead；异步信号自己收。
order: 40
requires: [orchestration]
requires-capabilities: [delegate]
scope: [main, lead]
---
（英文正文，工具名一律写 {{delegate}} / {{delegate_status}}）
```

---

## 6. 三个机制

### 6.1 能力映射：pi 升级时只改这一张表

`capabilities.json`：

```json
{ "delegate":        { "tool": "subagent",        "required": true  },
  "delegate_status": { "tool": "subagent_status", "required": true  },
  "search":          { "tool": "web_search",      "required": false },
  "fetch":           { "tool": "fetch_content",   "required": false },
  "locate":          { "tool": "grep",            "required": false } }
```

正文写 `{{delegate}}`、`{{search}}`，注入时用 `pi.getActiveTools()` 解析：

| 情况 | 行为 |
|---|---|
| 解析成功 | 替换为真实工具名 |
| 层 `requires-capabilities` 缺失 | **整层跳过**，`/philosophy` 与设置里显示原因 |
| 非必需能力缺失 | 该句降级为中性表述（映射里给 `absent` 文案），不留悬空工具名 |

具体收益：pi 把 `subagent` 改名 `delegate`、`web_search` 并进 `search`
→ 你改 `capabilities.json` 两行，四篇正文一个字不动。
pi 把 subagent 整个拿掉 → 编排/瀑布流自动下线，基础/工作方式继续工作。
**优雅降级，而不是提示词继续教模型调一个不存在的工具。**

这张表也是耦合的物理边界：**正文里出现裸工具名 = 违反设计**，可用测试机械卡住（§8）。

### 6.2 角色识别（作用域过滤的前提）

因为 package 扩展会自动进 worker（§3 坑 2），扩展启动时必须知道自己是谁：

1. 读 `PIPI_PHILOSOPHY_ROLE`（`main` | `lead` | `worker`）—— 派工方显式设置，最权威；
2. 否则读 `PIPIUI_AGENT_DEPTH`：`>0` 视为 worker（PipiUI 补丁版 subagent 已在设置，
   `index.ts:1641-1642`，顺手加一行设 role 即可）；
3. 都没有 → 当 `main`。

第 3 条是给「用官方 subagent 扩展的非 PipiUI 用户」的降级：他们的 worker 会
多吃编排层的 token，但不会出错。README 里说明如何在自己的派工链路上设 role env。
**这是本设计目前最弱的一环，见 §10。**

### 6.3 作用域分发

- `orchestration` / `fanout` 的 scope **不含 worker** —— 普通 worker 不该扇出，
  深度护栏的意图必须在提示词层面一致。
- `foundation` / `method` 含 worker：反早停、两次同方案上限、BLOCKED 白名单，
  今天只活在 Boss 脑子里，worker 靠 agent `.md` 各自重述；统一后 agent `.md` 可瘦身。
- 成本：每个 worker 前缀 +~1.6k tokens。因此 `scopes.worker` **默认 false**，
  实测一波真实 worker 的成本后再决定是否默认开。

---

## 7. 设置面板

`SettingsTab` 新增「哲学」（四层 + 说明 + 预算 + 安装状态，通用 tab 放不下）：

```
哲学                                          [总开关 ●]
来源：本地 package（随 App 更新） · v1.2.0        [ 检查更新 ]
估算占用 ≈ 4.2k tokens（上下文的 2.1%）

  ● 基础哲学        判断准则：怎么想、什么时候停、什么算证据      ~1.3k
  ● 工作方式哲学    先自己出设计，再上网交叉验证                 ~0.3k
  ● 编排哲学        不下基层：拆解、派工、验收、整合             ~1.8k
    ● 瀑布流哲学    无依赖的活一次派完，扇出宽了先过 lead        ~0.8k
      └ 依赖「编排哲学」

  ○ 也发给 subagent（基础 + 工作方式）    每个 worker +~1.6k tokens

  ⓘ 哲学装在 pi 里，不在本 App 里 —— 终端裸跑 pi 也生效。
  [ 查看合成结果 ]  [ 导出为可编辑副本 ]
```

- token 估算 `chars / 4`，与 `MessageViews.swift:746` 现有口径一致。
- 「查看合成结果」= 展示真正要发出去的文本。哲学不该是黑箱。
- **迁移**：`pipiui.bossMode == false` → `orchestration` + `fanout` 关；
  `foundation` + `method` **一律默认开**。这是有意的行为变更（这两层本就不该被
  Boss 开关连坐），迁移后首次进设置给一次性说明。

---

## 8. 可测性：pi 升级后怎么知道碎没碎

package 侧（`npm test`，不依赖 pi 运行）：

1. **无裸工具名**：正文出现 `capabilities.json` 任一 `tool` 值 → 失败。
2. **占位符闭合**：合成结果不得残留 `{{`；每个占位符要么解析、要么整层被跳过。
3. **依赖/作用域自洽**：`fanout` 开而 `orchestration` 关 → 合成器必须自动关 `fanout`；
   scope 不含当前角色的层不得出现在输出里。

运行时侧：`/philosophy` 输出把 `capabilities.json` 与 `getActiveTools()` 求差集。
**pi 升级后跑一次 `/philosophy`，缺什么一目了然。**

PipiUI 侧（`swift test` / `PIPIUI_SELF_TEST=1`）：package 未装/损坏时安全网生效、
设置面板正确显示未安装态。

---

## 9. 边界：什么该是哲学，什么该是 skill

| | 哲学 | Skill |
|---|---|---|
| 位置 | 常驻 system prompt 前缀 | 按需加载（`skill_search` / `skill_load`） |
| 形态 | 「遇到 X 时倾向 Y」 | 「步骤 1/2/3 + 产出物」 |
| 改变的是 | 怎么**想** | 这次怎么**做** |
| 成本 | 每轮都付（所以必须短） | 用到才付 |

实操判据：**有编号步骤和交付物 → skill；是取舍倾向 → 哲学。**
现有 331-359 节（技能翻译规则）本身是哲学——它讲「外部建议不高于我自己的判断」，
归 `foundation`。

---

## 10. 分期

| Phase | 内容 | 交付后谁吃到哲学 |
|---|---|---|
| 1 ✅ | 建 `pipi-philosophy` repo：四层 md + `capabilities.json` + `philosophy.ts` + `/philosophy` + 16 项测试。本地路径安装即可用 | **TUI + 任何前端**（手工装） |
| 2 | PipiUI：删 `BossPrompt.swift` 注入路径、停传 `--append-system-prompt`、bundled 副本 + 一键安装、「哲学」设置 tab、`bossMode` 迁移、安全网 | + PipiUI 用户零配置 |
| 3 | 作用域分发：`philosophy.ts` 角色识别、`index.ts` 设 role env、agent `.md` 去重瘦身 | + worker |
| 4 | `philosophy-user/` 覆盖与自定义层；发布 npm/git | + 下游用户可改可装 |

**Phase 1 独立可交付**，而且它一个人就解决了你这轮提的问题：装完之后终端裸跑
`pi` 就有哲学，跟 PipiUI 装没装无关。Phase 2 只是把体验补上。

### Phase 1 实施记录（2026-07-27）

实测验收（pi 0.81.1，用 `-e` 临时加载，未改用户 `settings.json`）：

| 场景 | 结果 |
|---|---|
| 无派工工具（`getActiveTools` = read,bash,edit,write） | 只注入 foundation + method；orchestration/fanout 按 `requires-capabilities` 跳过；`{{search}}`/`{{fetch}}` 替换为 absent 文案 |
| 有派工工具（+ pi 官方 subagent 扩展） | 四层全注入；`{{delegate}}` → `subagent` |
| 两种场景的合成结果 | 未解析占位符 = 0 |
| `/philosophy` | 正常输出激活层、跳过原因、token 预算、能力差集 |

token 预算：foundation 1323 + method 493 + orchestration 2378 + fanout 975
= **5173**，与原 `BossPrompt.swift` 正文的 5166 基本持平（拆层没有引入膨胀）。

**实测改掉的一处设计**：原设计把 `delegate_status` 定为 `required: true`，
于是 orchestration 在「只有 `subagent`、没有 `subagent_status`」的运行时被整层跳过——
而 pi 官方 subagent 扩展恰好就是这种（`subagent_status` 是 PipiUI 补丁加的）。
状态查询对编排哲学不是存亡攸关（身份、brief、ledger、完成权都不依赖它），
已改为 `required: false` + absent 文案，并补了一条回归测试。
**这是「先自己出设计再对外验证」这条哲学自己抓到的第一个 bug。**

其余与设计一致。`compose.ts` 不 import 任何 pi 东西，16 项测试用裸 node 跑完，
不需要 API 调用。所有文件均 < 400 行。

---

## 11. 降级矩阵

| 故障 | 行为 |
|---|---|
| package 未安装 | PipiUI 回落单文件 `--append-system-prompt`（TUI 无哲学，设置里明示） |
| `layers/` 读失败 | 不注入，pi 裸提示词运行；`/philosophy` 报错 |
| 单层 frontmatter 损坏 | 跳过该层，其余正常，设置里标红 |
| `requires` 的层被关 | 依赖层自动关，UI 置灰说明 |
| `requires-capabilities` 缺失 | 整层跳过 + 原因可见（§6.1） |
| pi 移除 `before_agent_start` | 扩展失效 → 回落 `~/.pi/agent/APPEND_SYSTEM.md`（写合成产物），有损但不断 |
| 用户自定义层与内置层 `id` 冲突 | 用户层覆盖，UI 标「已覆盖内置」 |

---

## 12. 待定

1. **非 PipiUI 用户的 worker 角色识别**（§6.2 第 3 条）—— 本设计最弱的一环。
   备选：向 pi 提一个「当前是否 subagent 进程」的通用信号；或先接受 worker 当 main。
2. **`scopes.worker` 默认值** —— 需实测一波真实 worker 的 token 成本。
3. **命名** —— 文中用「哲学」，备选「心法」（中文 UI 更短）。
   package 名建议 `pipi-philosophy`，扩展入口 `philosophy.ts`。
4. **`foundation` 迁移默认值** —— 本设计取「一律默认开」。若更保守可沿用旧
   `bossMode`，但那会把主要收益推迟一整个版本。
