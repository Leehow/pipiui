# Boss 干净上下文编排设计（Clean-Context Orchestration）

日期：2026-07-25
状态：已实施（2026-07-25，含评审修订）
涉及：`Sources/PipiUI/BossPrompt.swift`、`Sources/PipiUI/PiExt/subagent/index.ts`、`Sources/PipiUI/PiExt/agents/*.md`

## 0. 一句话

Boss 模式的低效不在"派工太多"，而在派工把大量原始信息灌回 boss 上下文。
本设计不改执行面（并行度、worktree 机制不动），只改**信息面**：让流回 boss 的
每一字节都是裁决级信息，其余全部落盘、按需拉取。

## 1. 产品公理（所有取舍的依据）

1. **Boss = 真实老板**：只做项目管理——分解、派工、裁决、整合、对用户汇报。
   不写代码、不读代码细节、不亲自查案。
2. **Boss 上下文是全系统唯一不可再生资源**。worker 的 token、API 费用、
   wall-clock 都可再生；boss 会话里进过的东西在压缩前永久占位。
3. **派工永远优先**（无 T0.5"自己干"档）。小任务的优化方向不是 boss 亲自做，
   而是把派工对 boss 的成本压到趋近于零。
4. **信任来自机器证词，不来自 LLM 转述**。worker 自称 DONE、reviewer 转述
   PASS 都是"一个 LLM 的话"；exit code 是事实。
5. 压缩比框架仍然成立，但优化变量换了：不再用它决定"何时自己干"，
   而是用设计把分母（boss 为了信任必须读的量）压到最小。

> LLM boss 比人类 boss 更需要这套教义：真人瞥一眼代码没有永久成本，
> LLM 每看一眼都占据上下文直到压缩。

## 2. 现状与问题（已核实）

| # | 现状 | 证据 | 问题 |
|---|------|------|------|
| P1 | done 消息回显完整 brief + 最多 8000 字符 worker 散文 | `index.ts:841-859`（`Task: ${result.task}`、`DONE_RESULT_CAP=8000`） | 一波 8 worker 最坏 6.4 万字符注入 boss；brief 是 boss 自己写的，回显纯重复 |
| P2 | 验证 = worker 自报 + boss 亲自 spot-check | `BossPrompt.swift:116-117`；general-purpose.md `## Verification` 自述 | boss 读文件的污染与写代码同级；worker 报告可编造，只有纪律约束（121-122） |
| P3 | merge 失败叫 boss 亲自查冲突 | `BossPrompt.swift:103-108`（inspect dirty files, stash or commit） | 冲突 diff 是最大块原始代码，全 prompt 里最违反公理 1 的路径 |
| P4 | lead 触发挂在"任务复杂度"（T3） | `BossPrompt.swift:56-58` | lead 的真实价值是上下文防火墙，应按扇出宽度触发 |
| P5 | boss 状态只活在会话上下文里 | 无持久化 | 压缩即丢，丢的恰是全系统只有 boss 才有的东西（目标/决策/在飞任务） |
| P6 | 多 implementer 各自重新 explore | brief 惯例未约束 | 多 worker 场景最大的隐性 token 泄漏 |

执行面参数（`MAX_PARALLEL_TASKS=8`、`MAX_CONCURRENCY=4`、worktree 隔离、
并行优先规则）**均不改动**——并行从来不是问题。

## 3. 目标信息流

```
现在（push 模型）:
  worker ──(自称 DONE + 8k 散文 + brief 回显)──▶ boss 上下文
  boss ──(亲自 read/grep 抽检)──▶ boss 上下文再进一遍代码
  merge 失败 ──(原始 git 冲突)──▶ boss 亲自查

目标（pull + 证词模型）:
  worker 结束 ─▶ TS 运行时跑 verify 命令（系统证词）
             ─▶ 全文报告落 job registry（落盘，不进聊天）
             ─▶ 聊天只进 ≤15 行裁决块（title/verdict/files/attested verify）
  boss 起疑  ─▶ subagent_status 主动拉全文 / 派 reviewer（判断题专用）
  merge 失败 ─▶ 默认派 fixer worker；boss 只裁决保留/丢弃/问用户
  boss 状态  ─▶ .pi/boss/ledger.md 持久化，压缩后可重建
```

## 4. 变更设计

### A. done 报告协议（改 `index.ts`，P1）

`formatSubagentDoneMessage` 重构为裁决块：

```
[subagent-done] agentId=ab12 name=general-purpose ok=true verified=pass cost=0.1234 turns=12
Title: Top-bar git branch menu
Files: Sources/PipiUI/TopBar.swift; Sources/PipiUI/GitMenu.swift
Verify: $ swift build 2>&1 | tail -5 → exit 0 (attested)
  Build complete! (12.3s)
Notes:
  <worker Notes 段，≤5 行>
Full report: subagent_status({agentId:"ab12", full:true})
```

- **去掉 `Task:` 全文回显**，只留 `Title:`（job 已存 title，`index.ts:419`，零成本）。
- 上面示意里的 `Files:` 行**实现时未单独解析**：worker 模板已把 `## Files Changed`
  放在报告开头，留头截断天然会把它带进来。这样避免了对 worker 散文做脆弱的结构解析，
  效果等价。（2026-07-25 评审确认保持现状。）
- **cap 按 agent 类型分档**，新增两个常量替换单一 `DONE_RESULT_CAP`：
  - `VERDICT_DONE_CAP = 1500`：general-purpose / reviewer / lead——代码/审查结论
    是产物，报告只是证据；
  - `REPORT_DONE_CAP = 6000`：explore / plan——**报告本身就是交付物**，压到
    1500 会杀掉派它出去的意义（boss 要亲自分析研究报告，见 BossPrompt 59-61）。
- 全文永远进 job registry；`subagent_status` 的 `JOB_RESULT_DISPLAY_CAP=8000`
  通道（`index.ts:546`）保留为 pull 路径，增加 `full: true` 参数返回不截断全文。
- worker 侧模板（general-purpose.md 已有 Completed/Files Changed/Verification/Notes）
  收紧措辞：Files Changed 一行一个路径；Notes ≤5 行；其余细节写进正文
  （正文只落 registry）。

预期收益：一波 8 worker 的注入从最坏 ~64k 字符降到 ~8k，约 8-10 倍。

### B. 系统证词 attested verify（改 `index.ts`，P2 的根治）

- `TaskItem` / `ChainItem` / 单任务参数新增可选字段：

  ```ts
  verify: Type.Optional(Type.String({
    description: "Shell command run by the runtime in the agent's cwd after it ends; exit code and tail output are attested into the done message. Boss must fill this for implementation tasks."
  }))
  ```

- 执行时序：agent 进程结束 → **在 worktree 被 Swift 合并/移除之前**，TS 在
  agent cwd 跑 `verify`（超时 120s，截取尾部 20 行 / 2000 字符）→ 结果写进
  done 消息与 job registry → 再走原有 end 通知。
- done 头部新增 `verified=pass|fail|none`（不复用 `ok`，`ok` 语义保持进程级）：
  - `pass`：exit 0；boss 可直接接受，无需任何亲自抽检；
  - `fail`：附真实报错尾部；boss 按失败恢复流程处理（打回/换路线）；
  - `none`：brief 没给 verify；done 消息显式标注
    `verification: worker-claimed only`，提醒 boss 这只是自称。
- BossPrompt brief 规则同步：**implementation 任务的 brief 必须填 `verify`**
  （现有 88-90 行已要求写验证命令，这里只是从"写在 brief 文本里"升级为
  "结构化字段 + 运行时代跑"）。
- 效果：`BossPrompt.swift:121-122` 的"禁止编造结果"从纪律约束变成物理不可能；
  T1 不加 reviewer 的现有设计（50-53 行）依然成立——有系统证词后 T1 本来就
  不需要 reviewer。

**reviewer 的新定位**：只管机器判不了的判断题——设计质量、是否偏题、安全隐患、
多 worker 结论矛盾时的仲裁。不再承担"命令到底过没过"的核验。reviewer 的 brief
必须附 implementer 报告的 Files 清单，免探索冷启动。

### C. lead 按扇出宽度触发（改 `BossPrompt.swift`，P4）

- 现有 T3 规则保留；在 Parallel 章节新增触发条款（**实施阈值，评审修订后**）：
  **同一波 ≥6 个 worker（实现或研究皆算）必须经由一个 lead 收口，boss 只读
  lead 的整合报告。** 例外：explore/research 波 ≥4 个仍需 lead（报告本身是交付物，
  单个体量大）；implementation 波若**每个任务都带 attested verify**，则 6 个以下
  免除 lead（裁决块已足够小，防火墙不再必要）。
  lead 的真实作用是吸收一整层 done 报告（上下文防火墙），不是复杂度的奖励。
- 阈值从原设计的 ≥4 上调至 ≥6（原 ≥4 已废止）：A+B 落地后单条 done 注入从
  ~8k 降到 ~1.5-4k 字符，lead 作为防火墙的必要性低于原 ≥4 的假设；而 lead
  层的延迟与转述失真是真实成本。
- 两跳失真的缓解：boss 给 lead 的 brief 中，各子任务的 brief 以**原文块**
  内嵌（标注"逐字转发给 worker，不得改写"），lead 只做调度与整合，不做转述。
- lead.md 输出模板（Result / Delegation Log / Unresolved）已符合裁决形状，
  不需大改；其 done cap 归入 `VERDICT_DONE_CAP`。

### D. Boss 台账（新增 `.pi/boss/ledger.md`，P5）

唯一让 boss 上下文"可再生"的变更——前三条减少流入，这条让已流入的敢被丢弃。

- 位置：`<project>/.pi/boss/ledger.md`（`.pi/` 已是运行时目录，随 worktree
  机制存在；确认在 .gitignore 内）。
- 结构（固定五节，boss 用 edit 工具维护）：

  ```markdown
  # Ledger: <目标一句话>
  ## Decisions      # 已定架构/取舍，一条一行，含日期
  ## In-flight      # wave 编号 → agentId/title/状态
  ## Done           # title → verdict + 关键证据一行
  ## Explore digest # 已建立的事实（供后续 brief 复用，治 P6）
  ## Risks / Open   # 未决问题
  ```

- BossPrompt 新增条款：
  - Identity 例外：**写 `.pi/boss/**` 永远允许**——这是管理工件不是代码，
    与 37-38 行"可以亲自做"清单并列；
  - 每波派工后、每次收到 done 后更新台账；
  - 会话开始或感知压缩后，**先读台账再行动**；
  - 派 implementation 任务前，先查 `Explore digest`，已建立的事实直接粘进
    brief，**禁止让 worker 重新 explore 已知结论**（治 P6）。

### E. merge 失败去 boss 化（改 `BossPrompt.swift:103-108`，P3）

重写为：

- boss **永不打开冲突 diff**。`[worktree-merge-failed]` 的默认动作是派一个
  general-purpose fixer，brief 附消息里的分支名与冲突文件清单，verify 填
  合并后的构建/测试命令；
- boss 只做三选一裁决：接受 fixer 结果 / 丢弃无价值 worktree / 当两边都有
  真实工作且取舍属于用户时问用户（保留现有"一句话、一个具体选项"的措辞）；
- 保留"不许把原始 git 报错转发给用户"。

## 5. BossPrompt 条款级修改清单

| 行（现状） | 动作 |
|---|---|
| 37-38 亲自可做清单 | read/grep 收窄为"triage 与用户答疑所需的定位性阅读"；例行验证阅读删除（由 B 取代）；新增"写 `.pi/boss/**` 永远允许" |
| 56-58 T3/lead | 保留；Parallel 章节加 lead 触发条款（C；实施阈值：同波 ≥6 worker，explore/research ≥4，全 attested verify 的实现波 6 以下免） |
| 88-90 brief 要素 | "verification command" 升级为"必须填结构化 `verify` 字段"（B） |
| 103-108 merge 失败 | 按 E 重写：默认派 fixer，boss 只裁决 |
| 116-117 spot-check | 重写为："接受的依据是 `verified=pass` 与裁决块；起疑或矛盾 → 拉全文或派 reviewer；**永不亲自打开 diff**" |
| 120 不贴 worker 全文 | 保留 |
| 新增 Ledger 章节 | 按 D |

## 6. 实施顺序与验收

| 阶段 | 内容 | 改动面 | 验收 |
|---|---|---|---|
| 1 | A 报告协议 + B 系统证词 | 仅 TS（index.ts + agents/*.md 模板措辞） | 派一个带 `verify` 的任务：done 消息 ≤15 行、无 brief 回显、含真实 exit code；`subagent_status full:true` 能拉全文 |
| 2 | E merge 条款 + C lead 触发 + 116-117 重写 | 仅 BossPrompt 字符串 | 构造 merge 冲突：boss 派 fixer 而非亲自查；同波 6 任务（或 4 个 explore/research）走 lead |
| 3 | D 台账 | BossPrompt 字符串 + 确认 .gitignore | 跑一个多波任务后 ledger 五节齐全；人工压缩会话后 boss 能从台账续作 |

阶段间无依赖倒置：1 独立可上；2、3 依赖 1 的消息格式定稿。

**落地状态**：阶段 1-3 已全部落地，提交范围 `03cd55e..HEAD`（另含评审修订的
review-fix 提交）；发布步骤为 `./make-app.sh`。

## 7. 风险与开放问题

1. **attest 与 Swift merge 的时序**：verify 必须在 worktree 被移除前跑完。
   实现时 attestation 放在 TS end-handler 内、通知 Swift 之前；需确认
   SubagentStore 的 auto-merge 触发点不会抢跑（`index.ts:672-675` 注释表明
   lifecycle 归 Swift，需要一个"TS 已完成 attest"的先后约定）。
2. **verify 命令的安全边界**：与 worker 自己跑 bash 同权，无新增特权面；
   但需超时（120s）与输出截断，防挂死与刷屏。
3. **cap 数值**（1500/6000）是首版拍脑袋值，跑两周真实任务后按 done 消息
   实际分布调。
4. **lead 模型成本**（已修订）：原 ≥4 触发已废止，实施阈值为 **≥6**（实现或
   研究皆算）；explore/research 波 ≥4 仍需 lead；implementation 波若每任务都带
   attested verify 则 6 个以下免 lead。理由：A+B 落地后单条 done 注入从 ~8k 降到
   ~1.5-4k 字符，防火墙需求小于原 ≥4 假设；lead 层的延迟与转述失真是真实成本。
   3-5 个 worker 的实现波是否值得 lead，继续观察 boss 会话实际膨胀再调。
5. **台账写入频率**：每 done 一写会多消耗 boss 轮次；可放宽为每波收口一写。
6. 转述保真依赖 lead 服从"逐字转发"；如仍失真，升级为 brief 落文件、
   worker 直接读文件（本版不做）。

## 8. 评审修订与已知限制（Review amendments & known limitations）

以下为实施落地相对原设计的评审修订，以及已接受的已知限制：

### 评审修订

1. **done 消息 Result 保留头部而非尾部**：按 worker 模板，关键段（Completed /
   Files Changed / Verification / Notes）在最前，截断保 HEAD。评审发现原实现
   把保头写反成保尾，已修复。
2. **`[worktree-merge-failed]` 注入消息重写为 fixer 派工纪律**：默认动作是派
   fixer worker（原措辞是 boss 亲自解决），与 §E 对齐。
3. **auto-merge 门消费 `verifyExit`**：`verifyExit` 存在且 ≠ 0 → 保持
   pendingReview，跳过 auto-merge；worktree 保留，供重新派工。
4. **verify runner（TS + Swift 两侧）**：滚动尾部缓冲 ~64KB；超时按进程组
   kill，孙进程无法继续持有管道导致挂死。
5. **合并后 smoke verify 同样在 `.removeFailed` 合并分支上运行**（不只成功
   分支）。
6. **前台任务（background:false）**：单个与并行结果现在同样带 verified 头部与
   Verify 行。

### 已知限制（已接受，非 bug）

- (a) `subagent_status full:true` 返回的 registry 文本本身受
  `JOB_RESULT_STORE_CAP=12000` 截断——"full" 指比 8000 的展示 cap 更全，
  不是无上限。
- (b) 单条 done 消息最坏可达 ~3.5-4k 字符：attested Verify 尾部在
  `VERDICT_DONE_CAP` 之外，作为独立预算被接受。因此 8 worker 一波最坏 ~30k，
  而非 §A 预期的 ~8k——仍比改前好约 2 倍，且典型波远低于此。
- (c) 120s 超时 kill 路径经过代码评审，未做端到端实跑验证。
