# Boss 任务台账与书记员设计（Ledger & Clerk）

日期：2026-07-25
状态：设计评审中
前置：[Boss 干净上下文编排](2026-07-25-boss-clean-context-orchestration-design.md)（A/B/C/D/E 已实施）
涉及：`Sources/PipiUI/PiExt/subagent/index.ts`、`Sources/PipiUI/SubagentStore.swift`、
`Sources/PipiUI/BossPrompt.swift`、新增 `Sources/PipiUI/PiExt/agents/clerk.md`（可选）

## 0. 一句话

前置设计解决了「每条 worker 报告有多大」，本设计解决「有多少条报告打断 boss」
以及「用户改主意时在飞的工作怎么办」。**核心结论：书记员的真正价值不是记账，
是合流；而当前最紧急的缺口不是书记员，是取消。**

## 1. 问题陈述

Boss 模式是异步多任务的：一波派 8 个 worker，它们在随机时刻各自回来。
同时用户会中途改主意、加任务、砍任务。由此产生三类混乱：

- **P-A 打断频次**：每个 worker 完成都单独打断 boss 一次。
- **P-B 无权威状态**：boss 要回答"现在在跑什么"，只能翻会话历史。
  压缩之后连历史都没有了。
- **P-C 过时工作不可阻止**：用户改需求后，为旧需求派出的 worker 仍在跑，
  跑完还会自动并进主仓。

前置设计的台账（D）只处理了 P-B 的一半（有地方记了），没解决谁来记、
何时记；P-A 和 P-C 完全没碰。

## 2. 关键发现：一条 done 的真实成本是「一个回合」

前置设计把 done 消息的成本记为字符数（1500/6000），**这个记法漏了主要项**。

事实链：
- `index.ts:1082` `notifySubagentDone` → `index.ts:1072` `deliverSubagentDone`
  → `pi.sendUserMessage(text, { deliverAs: "followUp" })`。
- done 是以**用户消息**身份投递的。boss 空闲时，每条投递驱动一个完整回合。

所以 8 个 worker 的真实代价不是 8×1500 字符，而是
**8 个回合**——每个回合重新处理整段上下文并追加新的输出，
上下文因此单调增长 8 次。

> 这个乘数大于 A/B/C/D/E 五条改动之和。压缩单条报告的收益是线性的，
> 削减回合数的收益是乘性的。

**推论**：书记员方案的评价标准应该是「它能不能把 N 个回合变成 1 个」，
而不是「它能不能替 boss 写台账」。写台账每波不过 5–10 行 edit，本来就便宜。

## 3. 对原始构想的评估

原始构想：**每个 boss 配一个持续运行的书记员 subagent，轮询检查任务、
更新台账；subagent 完成时也通知书记员一份。**

诊断正确，机制有三个结构性问题。

### 3.1 书记员省不了 boss 的「读」

台账的价值在 boss **读**它的时候兑现。书记员替 boss 写，省的是写。
而真正贵的 done 注入，书记员**拦不住**——它由 runtime 直接投递进 boss 会话
（`index.ts:1072`），不经过任何 subagent。除非改投递路径，否则书记员
是在成本结构之外空转。

### 3.2 「持续运行 + 轮询」是错的执行模型

subagent 在本架构里是一次性进程：spawn → run → exit → report。常驻轮询会

- 无事发生时空转烧 token；
- 整场占用一个进程与并发额度（`MAX_CONCURRENCY = 4` 里的一格）；
- **最致命：它自己的上下文无界增长**。三小时后书记员会有和 boss 一模一样的
  "我到底记过没有"问题——污染没有消失，只是下移了一层。

### 3.3 「worker 通知书记员」没有可用通道

worker 是独立进程，够不到兄弟进程；让它多发一次通知既不可靠又多一次工具调用。
通知只能由 runtime 发起，而 runtime 已经有现成挂点（`notifySubagentDone`）。

### 3.4 结论

保留构想的**意图**（台账是权威、完成事件要被系统性记录），
替换其**机制**（不要常驻、不要轮询、不要让 worker 通知）。
下面第 4 节给出替代形态。

## 4. 设计

### 4.1 拆开两件被混为一谈的事

原始构想把「记账」当成一件事。它其实是两件，成本与正确性要求完全不同：

| | 机械段 | 语义段 |
|---|---|---|
| 内容 | In-flight、Done（agentId / title / verified / cost / 波次） | Decisions、Explore digest、Risks |
| 数据来源 | 结构化事件，runtime 已全部持有 | 用户意图、跨 worker 的判断 |
| 谁来写 | **runtime 直接写，不经 LLM** | boss 自己（它才有用户意图） |
| 代价 | 零 token、零幻觉、永远准确 | 已在前置设计 D 中，且便宜 |

**这意味着 80% 的记账工作根本不需要书记员**。用 LLM 去转录它已经拥有的
结构化数据，是纯亏：多一次派工、多一份上下文、还引入幻觉风险。

机械段由 runtime 以确定性代码维护（见 4.3）。语义段留给 boss。
书记员（若采用）只在波边界做一次**语义压缩**，属于可选增强（见 4.6）。

### 4.2 引入「波（wave）」作为一等概念

现状：`index.ts:1923` 的 `void mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, …)`
已经天然构成一个批次，`agentIds` 数组就是成员名单——但这个批次没有身份，
完成后也没有汇合点。

新增：

- `generateWaveId()`（形如 `wave-<base36>`，仿 `index.ts:753` 的 agentId 生成）；
- 每次 `subagent({tasks:[…]})` 后台派工分配一个 waveId，写入每个 job 记录；
- 单任务后台派工 = 成员数为 1 的波，统一处理，不做特例。

波是后面合流、台账、取消三件事共同的锚点。

### 4.3 runtime 维护机械段

在 `notifySubagentDone` 与派工点各挂一次确定性写盘，目标文件
`<project>/.pi/boss/ledger.md`：

- 派工时：把该波成员追加进 `## In-flight`（waveId / agentId / title / 派出时刻）。
- 完成时：把该行移入 `## Done`，附 `verified` 与一行证据
  （verify 命令 + exit code，全部来自已有结构化字段）。

实现要点：

- **只重写这两节**，用显式段落标记界定，绝不触碰语义段——
  boss 与 runtime 并发写同一个文件，必须分区所有权。
- 写盘串行化（单写队列），避免同波多个 worker 同时收尾时互相覆盖。
- 文件不存在时用固定五节骨架创建。

收益：`## In-flight` 成为**权威**的在飞清单。boss 回答"现在在跑什么"
从"翻历史"变成"读一节"，压缩后依然成立——P-B 由此闭合。

### 4.4 波级合流：N 个回合 → 1 个（本设计的主收益）

改 `index.ts:1923` 那段的通知策略：

- **失败立即穿透**：`verified=fail`、进程失败、abort ——保持现状逐条投递。
  失败要快，boss 需要立刻进入失败恢复流程。
- **成功合流到波边界**：`verified=pass` 的 done **不再单独投递**，
  只写台账；等该波全部成员落定后，投递**一条**汇总：

```
[subagent-wave-done] waveId=wave-x7k2 total=8 pass=6 fail=2 cost=1.8420
Pass: 顶栏分支菜单 / 会话置顶 / 用量表 / …（6 项，均 verified=pass）
Fail: 见上方已投递的 2 条 done
Ledger: .pi/boss/ledger.md（In-flight 已清空，Done 已更新）
```

一波 8 个全 pass 时，boss 从 **8 个回合降到 1 个回合**，且这一个回合的
输入是高度压缩的裁决摘要。P-A 由此闭合。

**必须讲清的代价**：牺牲即时性——boss 不再第一时间知道某个成功的 worker
已经完成。这在"并行优先、互不依赖"的前提下影响很小（依赖场景本来就该用
`chain`）。失败穿透保证了坏消息仍然即时。

**开关**：波成员数 = 1 时退化为直接投递（无合流收益，徒增延迟）。

### 4.5 取消 / 取代原语（P-C，正确性缺口，优先级最高）

**这是当前最紧急的缺口，而书记员完全解决不了它。**

事实链：
- 工具面只有两个：`subagent`（`index.ts:1636`）与 `subagent_status`（`index.ts:1607`）。
  **没有任何取消能力。**
- 后台派工刻意不绑父 abort：`index.ts:1933` 注释
  `// no parent abort binding`（避免主会话中断误杀后台 worker，本身是对的）。

后果：用户一改主意，为旧需求派出的 worker 会跑完。

**已验证的好消息：合并侧已经 fail-safe。** TS 的
`endOk = exitCode === 0 && !errorMessage && !wasAborted`，
Swift `SubagentStore.swift:774` 据此置
`state = ok ? .ok : .failed`，而自动合并的门是
`SubagentStore.swift:800` 的 `state == .ok`。
**因此被取消的 agent 永远不会自动并进主仓，worktree 保留为 pendingReview 待审。**
安全属性已经成立，缺的只是扳机。

设计：

```ts
subagent_cancel({
  agentIds: string[],           // 或 waveId: string
  reason: string,               // 写入台账，供续作时读取
  disposition?: "keep" | "discard"   // 默认 keep：保留 worktree 待审
})
```

- TS 维护 `agentId → AbortController` 注册表；后台派工时登记，终态时注销。
- 复用现成的杀进程逻辑（`index.ts:1468-1477`：SIGTERM → 5s → SIGKILL）——
  只需把后台派工的 `signal` 从 `undefined` 换成注册表里的 signal，
  **保留"主会话中断不杀后台"的原意**（父 abort 仍不绑定，只接受显式取消）。
- `disposition: "discard"` 时向 Swift 发信号删除 worktree；默认 `keep`。
- 台账：被取消的行从 `## In-flight` 移入 `## Done`，标 `cancelled` + reason。

BossPrompt 配套条款：

> 用户改变需求时，先读 `## In-flight` → 判断哪些在飞任务已过时 →
> `subagent_cancel` 它们（reason 写明被什么取代）→ 再派新工作。
> 绝不放任已过时的 worker 跑完。

**UI 注意**：当前 abort 会让 agent 显示为 `.failed`（`SubagentStore.swift:774`
只有 ok/failed 两态）。取消上线后建议区分 `.cancelled`，否则用户会把
主动取消误读成失败。

### 4.6 可选：无状态书记员（语义压缩）

**不常驻、不轮询。** 若语义段确实需要自动维护，形态是：

- 波边界触发一次，起一个全新的短命 `clerk`；
- 它的上下文只有「当前台账全文 + 本波裁决摘要」，读盘 → 写 delta → 退出；
- **台账就是它的记忆**，所以它的上下文永不增长——3.2 的病根被移除；
- 模型选便宜档（机械压缩任务，不需要强推理）；
- 工具面收窄到 read + edit，且提示词明确只准写 `.pi/boss/**` 的语义段。

**建议先不做。** 机械段由 runtime 写（4.3）之后，语义段的增量很小，
而 boss 自己写语义段有一个书记员无法替代的优势：**它才知道用户的意图**。
等 4.2–4.5 上线跑一段时间，若 `Decisions` / `Explore digest` 确实出现
"boss 懒得写"的实测问题，再补这一环。

**已知开放问题**：`AgentDefinition`（`AgentCatalog.swift`）的 `tools` 字段
没有路径级权限机制，"只准写 `.pi/boss/**`"目前只能靠提示词纪律，
不能靠系统强制。

## 5. 台账最终形态

```markdown
# Ledger: <一句话目标>

## Decisions        <!-- boss 维护 -->
- 2026-07-25 报告协议改为裁决块 + 全文落盘

## In-flight        <!-- runtime 维护，勿手改 -->
| wave | agentId | title | 派出 |
|------|---------|-------|------|
| wave-x7k2 | agent-ms0a-1 | 顶栏分支菜单 | 14:02 |

## Done             <!-- runtime 维护，勿手改 -->
| wave | title | verdict | 证据 |
|------|-------|---------|------|
| wave-x7k2 | 会话置顶 | pass | `swift test` exit 0 |
| wave-x7k1 | 旧版用量表 | cancelled | 被 wave-x7k2 取代 |

## Explore digest   <!-- boss 维护 -->
- SubagentStore 的 auto-merge 门是 state == .ok

## Risks / Open     <!-- boss 维护 -->
```

所有权分区是硬约束：runtime 只重写中间两节，boss 只写另外三节。

## 6. 实施顺序

| 阶段 | 内容 | 面 | 理由 |
|---|---|---|---|
| 1 | 4.5 取消原语（含 UI 的 `.cancelled` 态） | TS + Swift + BossPrompt | **正确性**：过时工作目前不可阻止 |
| 2 | 4.2 波身份 + 4.3 runtime 写机械段 | TS | 台账变权威，为合流铺路 |
| 3 | 4.4 波级合流 | TS + BossPrompt | **主收益**：回合数 N → 1 |
| 4 | 4.6 无状态书记员 | 新 agent md | 仅在实测证明需要时 |

阶段 1 与 2 无依赖，可并行；3 依赖 2 的波身份。

**先决条件**：先修掉审核意见中的
[高危并发问题](../reviews/2026-07-25-boss-clean-context-orchestration-review.md)——
幻影 `[post-merge-verify-failed]` 会绕过合流直接打断 boss，
不修的话本设计的主收益会被它抵消。

## 7. 风险与开放问题

1. **合流的即时性代价**：全 pass 的波，boss 要等最慢的成员。若某 worker
   长时间挂住，整波汇总被拖住。缓解：波级超时（例如 10 分钟）后先投递
   已落定部分并标注仍在跑的成员。
2. **台账并发写**：runtime 与 boss 同时写同一文件。分区所有权 + 单写队列
   是最小方案；若仍冲突，退化为 runtime 写独立的 `in-flight.md`，
   boss 的 `ledger.md` 只留语义段。
3. **取消的竞态**：worker 可能在 SIGTERM 到达前刚好写完并进入合并流程。
   需在取消路径上先置一个"已取消"标记，合并门额外检查该标记。
4. **`.pi/` 的 gitignore**：前置设计假定已忽略，落地前需实测确认，
   否则台账会进版本库。
5. **波身份与 chain 的关系**：`chain` 是串行依赖，天然只有一个汇合点，
   暂按"整条 chain = 一个波"处理，待实测。
6. **`.cancelled` 状态的持久化兼容**：`SubagentInfo` 的 Codable 需容忍
   旧数据里没有该状态（参照 `verifyExit` 的 `decodeIfPresent` 写法）。
