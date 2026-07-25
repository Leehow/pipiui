# 审核意见：Boss 干净上下文编排（A/B/C/D/E 实施）

日期：2026-07-25
审核对象：`03cd55e..HEAD` 中 boss 编排相关改动
对照设计：[2026-07-25-boss-clean-context-orchestration-design.md](../specs/2026-07-25-boss-clean-context-orchestration-design.md)
审核方式：全量读改动 + 构建 + 定向测试

## 0. 结论

**构建通过；`PostMergeVerify|WorktreeMergeFailed|BossPrompt` 定向测试 16/16 全绿。**
设计的 A/B/C/D/E 五条全部忠实落地，并且多做了一条设计里没有的、方向正确的加强
（主仓 post-merge smoke verify + `verifyExit≠0` 阻止 auto-merge）。

**但有一个高危并发缺陷会制造"幻影失败"，恰好打在这套设计意图消灭的污染上**：
boss 会为一个根本不存在的故障派 fixer、读报告、再裁决。建议在合并前修掉。

发现汇总（**修复状态见第 7 节**）：

| 级别 | 问题 | 位置 | 状态 |
|---|---|---|---|
| 高 | 主仓 post-merge verify 与并发 merge 抢跑 → 幻影 `[post-merge-verify-failed]` | `SubagentStore.swift:806, 899, 1002` | ✅ 已修 |
| 中 | 每条 done 广告的 "Full report" 在长报告上返回错误的片段 | `index.ts:611, 630 vs 1021` | ✅ 已修 |
| 中 | merge 与 verify 共用一个去重槽 → 重复注入 boss | `SubagentStore.swift:1025` | ✅ 已修 |
| 低 | 同一条 verify 每 agent 跑两遍；无 `.build` 缓存 | `index.ts:1486` + `SubagentStore.swift:1002` | ✅ 已修（波内合并） |
| 低 | `bash -lc` 登录 shell 噪声混入 attested tail | `index.ts:399`、`SubagentStore.swift` PostMergeVerifyRunner | ⛔ 不修，见 7.5 |
| 低 | `verifyExit≠0` 阻止 auto-merge 未写进 BossPrompt | `BossPrompt.swift` Verification 段 | ✅ 已修 |
| — | 设计里的 `Files:` 行未实现（可接受，不必改） | `index.ts:1030` 附近 | ✅ 已同步设计文档 |

## 1. [高] 主仓 post-merge verify 与并发 merge 抢跑

### 事实链

1. `SubagentStore.swift:806`：每个 agent 终态各起一个独立 `Task { await mergeWorktree(...) }`，
   **没有任何串行化**。
2. `SubagentStore.swift:853` `mergeWorktree` 虽标 `@MainActor`，但内部
   `await Task.detached { GitRepo.mergeBranch(...) }`（:871）——**一 await 就释放主 actor**，
   下一个 agent 的 merge 立刻并发进入同一个主仓。
3. `SubagentStore.swift:899/913` 合并成功后调用 `runPostMergeVerifyIfNeeded`，
   :1002 里再起一个 **无锁 `Task.detached`**，在主仓目录跑 `bash -lc <verify>`。

### 三种重叠

| 组合 | 新旧 | 后果 |
|---|---|---|
| merge ∥ merge | 旧有 | `.git/index.lock` 冲突 → `[worktree-merge-failed]` |
| **merge ∥ verify** | **本次新增** | `swift build` 读到正被另一个 agent `git merge` 改写的工作树 → 伪失败 |
| **verify ∥ verify** | **本次新增** | 两个 build 抢同一个 `.build/`；120s 超时同样判失败 |

后两种都会注入 `[post-merge-verify-failed]`，而 `BossPrompt.swift` 新条款要求
"立即派 fixer 在主仓修复"。于是 boss 为幻影故障派工 → 读报告 → 裁决，
**这正是整套设计要消灭的那种污染，只是换了来源**。

以 `MAX_CONCURRENCY = 4` 加"并行优先"的默认策略，这是常见路径而非边角。

### 建议

- 给主仓操作加一条**串行队列**（`actor` 或专用 `DispatchQueue`），
  `mergeWorktree` 的 git 段与 `runPostMergeVerifyIfNeeded` 共用同一把锁——
  两者都改写/读取同一棵主工作树，本就该互斥。
- 同一波内**合并相同的 verify 命令**：8 个 agent 都填 `swift build` 时，
  波内只在最后跑一次（配合去抖窗口，例如最后一次 merge 完成后 2s）。
- 附带修好旧有的 merge ∥ merge 竞争。

### 附带风险（同一处，需产品决策）

post-merge verify 在**主仓**跑。若用户自己在主仓有未提交的破坏性 WIP，
每个 agent 合并后都会判失败并派 fixer 去"修"用户的在写代码。
建议：verify 失败时先判主仓是否 dirty，dirty 则降级为提示而非 fixer 派工。

## 2. [中] "Full report" 承诺在长报告上是坏的

### 事实链

- `index.ts:527-530` `truncateText` 是**留尾**（`text.slice(-cap)`）。
- `index.ts:611, 630` 台账存储 `resultText` 用的正是它，上限
  `JOB_RESULT_STORE_CAP = 12000`（:361）。
- `index.ts:538-541` 新增的 `truncateTextHead` 是**留头**，done 消息用它（:1021），
  上限 1500/6000。
- `index.ts:1049` 每条 done 都打印
  `Full report: subagent_status({agentId:"…", full:true})`。

### 后果

一份 20000 字的 explore 报告：

```
done 消息  → [0, 1500)          留头
full:true → [8000, 20000)      留尾
永久丢失   → [1500, 8000)
```

更糟的是 worker 模板把 `Completed / Files Changed / Verification / Notes`
全部放在报告开头，**这些恰好被 store 的留尾截掉**——boss 拉"全文"拉到的
是最没有结构的那一段。而 done 消息每条都在广告这个出口，boss 一定会信它。

### 建议

`jobFinalize` 的两处（:611、:630）改用 `truncateTextHead`，与 done 消息方向一致；
同时把 `JOB_RESULT_STORE_CAP` 提到足以容纳完整报告（或干脆不截断，
依赖 `MAX_JOB_RECORDS = 40` 的条数上限控制内存）。

## 3. [中] merge 与 verify 共用一个去重槽

`SubagentStore.swift:1025` 的 `shouldNotify(kind:agentId:detail:)` 全局只维护
一对 `lastMergeFailKey / lastMergeFailAt`。并行波里：

```
A 失败（写入 key=A）→ B 失败（key 被覆盖为 B）→ A 同样错误再次失败
→ key 不匹配 → 绕过 60s 去重 → 重复注入 boss
```

单槽是改动前就有的设计，但现在两类事件共用同一个槽，碰撞概率显著上升。
现有测试 `testMergeFailureDedupsWithinSixtySeconds` 只覆盖了单事件顺序场景。

**建议**：改成 `[key: Date]` 字典 + 过期清理，key 含 kind 与 agentId。

## 4. [低] 三条

**4.1 同一条 verify 每个 agent 跑两遍。** worktree 内一次（`index.ts:1486`）、
主仓合并后一次（`SubagentStore.swift:1002`）。各 agent worktree 之间不共享
`.build/`，`swift build` 每次都是冷构建。8 个 worker ≈ 16 次冷构建。
按第 1 节的"波内合并"改造后，主仓那次可降到每波一次。

**4.2 `bash -lc` 是登录 shell。** TS（`index.ts:399`）与 Swift
（`PostMergeVerifyRunner`，`posix_spawn("/bin/bash", "-lc", …)`）两处都是。
profile 的输出会混进 attested tail，破坏"机器证词"的干净性，且每次多 100–300ms。
除非确实依赖 profile 里的 PATH，否则建议改 `-c`。

**4.3 `verifyExit≠0` 阻止 auto-merge 是好设计，但 BossPrompt 没写。**
`SubagentStore.swift:801-802` 的门是对的——不把已知损坏的分支并进主仓，
并保留 worktree 供续作。但 boss 看到 `verified=fail` 时并不知道
"worktree 还在、应当 re-dispatch **同一个 agentId** 复用它"，可能另起一个新
worker 从零开始。建议在 BossPrompt 的 Verification 段补一句明确这条契约。

## 5. 设计偏离（可接受）

设计的 done 格式里有一行 `Files: a.swift; b.swift`，实现没有解析 worker 报告
去提取它，而是靠留头截断把模板的 `## Files Changed` 段带进来。
效果等价且不引入脆弱的报告解析，**建议保持现状**，同步修订设计文档措辞即可。

## 6. 建议的修复顺序

1. 第 1 节串行化 + 波内合并（正确性，会污染 boss 与主仓）
2. 第 2 节截断方向（一行改动，影响每条 done 的可信度）
3. 第 3 节去重字典
4. 第 4 节三条（低风险清理）
5. 第 5 节同步设计文档措辞

## 7. 修复记录（2026-07-25 落地）

### 7.1 主仓串行化 + 波内合并 ✅

新增 `MainRepoSerialQueue`（`SubagentStore.swift`）：一条串行 `DispatchQueue`，
用 `withCheckedContinuation` 桥接 async。**所有触碰主工作树的操作都走它**——
`mergeWorktree` 的 git 段、post-merge verify、以及新增的 dirty 探测。

`runPostMergeVerifyIfNeeded` 重写为 `schedulePostMergeVerify` + `flushPendingVerifies`：

- 按 **命令去重**（`pendingVerifyByCommand: [String: SubagentInfo]`），
  一波 agent 共用一条 `swift build` 时只跑一次；
- 2 秒防抖窗口（`verifyCoalesceWindow`），等整波 merge 落定后再跑；
- 幸存的那次跑在**所有 merge 之后**的树上——这正是真正该被验证的状态，
  由最后合并的 agent 作为报告人。

副作用：第 4 节的"每 agent 跑两遍"随之解决（主仓侧从 N 次降到每波每命令 1 次）。

**附带风险也一并处理**：verify 失败时先探测主仓是否 dirty
（`GitRepo.probe(workTree:).isDirty`）。dirty 时 `[post-merge-verify-failed]`
消息头带 `mainDirty=true`，正文改为"先判断归属，疑似用户 WIP 则一句话说明，
不要擅自改动用户未提交的代码"，而不是无条件派 fixer。

### 7.2 截断方向统一为留头 ✅

`index.ts`：删除只剩死代码的 `truncateText`（留尾），三个报告面
——done 消息、job store、`subagent_status` 显示——**全部改用 `truncateTextHead`**。
`JOB_RESULT_STORE_CAP` 12000 → 32000，足以容纳整份 explore 报告。

现在 `full:true` 返回的确实是报告开头的结构化段落，与 done 消息同源且连续。

### 7.3 去重字典 ✅

`lastMergeFailKey/lastMergeFailAt` 单槽 → `recentNotifications: [String: Date]`，
按 `(kind, agentId, detail)` 独立计时，顺带 60s 过期清理。

### 7.4 BossPrompt 补 verifyExit 契约 ✅

Verification 段新增：`verified=fail` 意味着 runtime 没有合并该分支、worktree 保留，
修复要 **re-dispatch 同一个 agentId** 复用它，不要另起新 worker 从零开始。

### 7.5 `bash -lc` → `-c`：评估后决定不改 ⛔

**这条是本审核自己的建议，复核后撤回。** 理由：

PipiUI 是 GUI 应用，从 Finder 启动时只继承极简 PATH。非交互非登录的 `bash -c`
不读任何 profile（只看 `$BASH_ENV`），因此改成 `-c` 会让 `swift` / `node` /
mise-asdf 之类的 shim **在真实用户环境里直接找不到**——把一个装饰性问题换成
了功能性回归。

而原问题其实已被现有机制大幅缓解：两侧都只保留输出**尾部**
（TS `tailText` 取末 20 行；Swift 取末 2000 字符），而 profile 噪声出现在**开头**，
正常会被丢弃。保留 `-lc`。

### 7.6 设计文档同步 ✅

`Files:` 行的措辞已在设计文档中改为"由留头截断带出模板的 `## Files Changed` 段"，
不引入脆弱的报告解析。

### 7.7 回归测试

新增 `Tests/PipiUITests/MainRepoSerialQueueTests.swift`（3 例）：
12 个并发操作峰值并发恒为 1；merge 与 verify 同时提交不交错；返回值穿透继续有效。

`WorktreeMergeFailedMessageTests` 新增 4 例：去重按 agent 独立（A→B→A 仍抑制 A）；
merge 与 verify 两类去重互不驱逐；dirty 主仓消息措辞；BossPrompt 的 agentId 复用条款。

**未覆盖**：第 2 节的截断方向是 TS 代码，本仓库没有 TS 测试设施，
只做了人工核对（三处调用点均已切换，`truncateText` 已无残留调用）。

验证：`swift build` 通过；
`swift test --filter "PostMergeVerify|WorktreeMergeFailed|MainRepoSerialQueue"` 21/21 通过。
