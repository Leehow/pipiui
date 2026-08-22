# 历史工具轨迹裁剪：源码级复核与 PipiUI 复用建议

日期：2026-08-22  
范围：只比较“历史 tool call / tool result 进入下一次模型请求前如何缩减”；不讨论 thinking 裁剪、工具 schema 延迟加载或完整 hard compaction。

## 结论先行

现有 PipiUI `context-fold` 不需要被另一个扩展替换。它已有候选项目里最难补齐的三项产品能力：**原文可回忆、spool/index 持久化成功后才折叠、项目/会话本地状态**。最合适的路线是保留这套存储和回忆层，只借三类已经在真实项目里出现的策略：

1. **Anthropic Context Editing**：Anthropic 路线直接复用服务端 `clear_tool_uses`；尤其是 `clear_tool_inputs`，它能在不改本地会话、不碰 signed thinking 的情况下同时缩掉旧结果和旧调用参数。
2. **Oh My Pi（OMP）**：借用“同一路径的旧 read 已被新 read 覆盖”“producer 明确标记 useless”“缓存热尾不动、冷却后批量处理”三条候选选择规则，但把原文仍写进 PipiUI 现有 spool，不采用 OMP 的持久历史覆写。
3. **cprune full**：只借“已成功、已完成、历史调用”的 tool-call 参数压缩思想；不能直接装它，也不能照搬其通用 assistant/thinking 改写。

真实样本里，`tool_result` 约 **10.1k tokens**，tool-call arguments 约 **8.9k**，其中 `subagent` arguments 约 **7.8k**。因此只处理结果的理论覆盖面约为 53%；而 cprune safe 的 12k 持久化上限、6k 发送上限在这个“40 多个中小轨迹累计”的样本上几乎不触发。这里真正缺的是**调用次数触发器**和**旧成功调用参数的安全处理**，不是再造一套摘要/spool/索引。

最小安全下一步是：**先做一个 Anthropic-only、显式开关的 `context_management` 请求策略实验**，使用 `tool_uses` 触发、保留最近 12 组、`clear_at_least=10k`，并仅对明确无副作用且参数占比异常高的工具（当前首选 `subagent`）启用 `clear_tool_inputs`；本地 session 和 context-fold spool 继续保留原文。其他 provider 暂不改写 assistant tool-call block，直到完成签名/配对兼容矩阵。

## 方法与基线

本报告以固定提交读取实现文件和测试，不以 README 的功能描述作为结论。各项目的固定版本、许可证和源码入口见文末“来源与许可证”。

PipiUI 当前用于比较的 P2 基线来自 vendored `context-fold` 0.3.2（upstream commit `4881382…`）以及本地提交 `2e4ae858…`、hook ownership 修复 `a796e362…`：

- 只把 `tool_result` 作为可折叠内容；默认绝对上限 150k，保护最近 30k tokens；阶梯阈值为窗口占用 45%，每次至少释放约 12%，因此保持一段稳定缓存前缀（[fold-ladder.ts](../../Electron/resources/runtime/pi-ext/packages/context-fold/src/fold-ladder.ts)）。
- 折叠时不删除 tool call / tool result 结构，只替换同一个 result 的文本，保留 `toolCallId`；非文本/图片结果标记为 opaque 并原样保留（[apply.ts](../../Electron/resources/runtime/pi-ext/packages/context-fold/src/apply.ts)，[block.ts](../../Electron/resources/runtime/pi-ext/packages/context-fold/src/block.ts)）。
- 原文写入 session-local spool，内容寻址、SHA 校验、临时文件 + rename；spool 与 index 两者都成功才提交折叠，失败则发送原始上下文（[spool.ts](../../Electron/resources/runtime/pi-ext/packages/context-fold/src/spool.ts)，[index-store.ts](../../Electron/resources/runtime/pi-ext/packages/context-fold/src/index-store.ts)，[store.ts](../../Electron/resources/runtime/pi-ext/packages/context-fold/src/store.ts)）。
- 因为触发器主要看 token 水位和一次可释放比例，40 多个中小结果可能在触及 150k 前长期累积；而且 P2 明确不处理 tool-call arguments。这与样本的缺口完全一致。

## 对比矩阵

| 方案 | 实际选择/替换逻辑 | 调用-结果配对 | 缓存策略 | 可逆/回忆 | 对本样本的匹配 | 结论 |
|---|---|---|---|---|---|---|
| Anthropic `clear_tool_uses` | 服务端按时间清最旧 tool use；可按 input tokens 或 tool-use 数触发；`keep`、`clear_at_least`、`exclude_tools`、`clear_tool_inputs` | API 原生维护 block 配对 | `clear_at_least` 避免为小收益打碎缓存；返回 applied edits | 请求侧不可逆；本地仍可保存原文 | **高**：既能按 40+ 次数触发，也能定点清 `subagent` inputs | **直接复用（Anthropic-only）** |
| cprune safe/full | safe：持久结果 12k、发送旧结果 6k、保护近 24 条；full 另压旧成功调用参数、旧 read/重复结果等 | 结果仍在原 message；但 full 会广泛改 assistant 内容 | 冻结已提交前缀；provider 分类含经验性假设 | 有损，无精确 recall | safe 几乎无效；full 的旧 args 策略有价值 | **借思路，拒绝直接挂载** |
| OMP result pruning | 保护最近 40k；至少节省 20k；同路径 read supersede、useless 标记；替换原 result | 通过 `toolCallId` 找配对并原位替换 | 热缓存仅改 suffix ≤8k；长缓存调用方用 90min idle flush | 持久有损，无 recall | 结果总量 10.1k 时普通门槛不触发；supersede 可提前命中 | **借候选选择与 cache-tail** |
| OMP snapcompact | request-only 把 ≥3k 的旧文本结果渲染成图片；跳过最新、错误、已有图片；需至少 10% 收益 | 克隆 outgoing message，session 不变 | oldest-first；渲染 cache；provider 图片预算 | 原 session 可恢复，但模型端无文本 recall | 对 40 个中小结果和 8.9k args 无效，且引入视觉模型成本 | **拒绝默认复用** |
| OpenCode | 两个 user turn 后倒序累计；保护近 40k，旧 completed outputs 节省 >20k 才标 compacted | 投影时保留 call id/input/output-available | 无显式热前缀保护，只用大步长降低频率 | 原 output 仍存储；无用户 recall/unfold 工具 | 10.1k 结果门槛下不触发；可借 metadata projection | **借高水位 marker，拒绝直接复用** |
| HarnessTrim | `tool_result` 到达时对 ≥400 字符文本做模式化 reducer；只接受更短输出 | 不改消息结构；非文本 chunk 原样 map-through | reducer 要求 deterministic/idempotent | active 模式有损；无 spool/recall | 可压单个测试/log/diff；不处理历史累计与 8.9k args | **仅作 producer-stage 可选预处理** |
| pi-context-prune | 把若干工具批次交给模型摘要，再从 context 直接移除已索引 `toolResult` | **删除 result、保留 assistant tool call，违反 Anthropic 配对约束** | 无稳定前缀/收益阶梯 | session custom entry 可查询文本，但非原始 block；提交非原子 | 能按批次工作，但安全边界不合格 | **拒绝** |

## 源码复核

### 1. Anthropic Context Editing：唯一可直接复用的 provider-native 路径

官方实现不是“让模型自己总结工具结果”，而是在请求进入 Claude 前由 API 服务端编辑上下文。`clear_tool_uses_20250919` 默认从最旧记录开始，用 placeholder 替换工具结果；默认触发是 100k input tokens、默认保留 3 组。它还支持：

- `trigger` 使用 `input_tokens` 或 `tool_uses`；后者正好覆盖“40 多个中小 trace，总 token 仍未达到全局 cap”的场景。
- `keep` 保留最近若干 tool uses；`clear_at_least` 规定一次至少清多少 tokens；`exclude_tools` 保护指定工具。
- `clear_tool_inputs` 可为布尔值，也可为工具名数组；因此可以只清历史 `subagent` 的大参数，不波及 edit/write/browser/auth 等高风险调用。
- 响应的 `context_management.applied_edits` 报告清掉的 tool uses、tool input tokens 和 tool result tokens，可直接纳入 PipiUI ledger 验收。

这些字段不只是文档宣称；固定版 Anthropic TypeScript SDK 的 [`BetaClearToolUses20250919Edit`](https://github.com/anthropics/anthropic-sdk-typescript/blob/bfa9197f0182084941052be9752c948638421601/src/resources/beta/messages/messages.ts#L1837-L1864)、[`BetaInputTokensClearAtLeast`](https://github.com/anthropics/anthropic-sdk-typescript/blob/bfa9197f0182084941052be9752c948638421601/src/resources/beta/messages/messages.ts#L3243-L3255) 和 tool-use trigger/keep 类型（[同一文件](https://github.com/anthropics/anthropic-sdk-typescript/blob/bfa9197f0182084941052be9752c948638421601/src/resources/beta/messages/messages.ts#L5404-L5416)）都固定了协议形状。官方 [Context Editing 文档](https://platform.claude.com/docs/en/build-with-claude/context-editing) 也明确说明清理发生在 prompt 到达模型前，并以 `context-management-2025-06-27` beta header 启用。

配对安全是采用 provider-native 路径的主要理由：Anthropic 要求每个 `tool_use` 后立即存在匹配 `tool_result`，否则请求失败（[官方 tool-call 处理规范](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)）。Context Editing 由服务端在这个协议约束内成对处理；本地通用扩展若删除独立 result message，做不到同等保证。

Pi 当前 Anthropic adapter 的 `buildParams` 没有默认写 `context_management`，但在发送前调用了 `options.onPayload` 并接受替换后的 payload（[Pi anthropic-messages.ts](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/ai/src/api/anthropic-messages.ts#L564-L575)）。所以它是一个小而明确的 provider adapter 接入点，不需要复制 Anthropic 的裁剪实现。

限制：它是 beta、只覆盖 Anthropic；服务端 placeholder 对模型不可逆。PipiUI 应继续保存本地原始 session/context-fold spool，不能把 provider 成功应用 edit 当成可以删本地证据的理由。

### 2. cprune：safe 对本样本无效，full 的旧成功参数策略值得拆取

cprune v0.4.7 在 `tool_result` hook 先做持久化前裁剪，再在 `context` hook 做发送前裁剪。固定配置把普通工具结果持久化上限定为 12k、旧结果发送上限定为 6k，并保护最近 24 条 message（[配置源码](https://github.com/amutix/cprune/blob/7e8694f7c2fddd1896ac3c087b17b2ee99153b68/src/cprune.ts#L70-L100)，[hook 源码](https://github.com/amutix/cprune/blob/7e8694f7c2fddd1896ac3c087b17b2ee99153b68/src/cprune.ts#L2413-L2502)）。对本样本的 40 多个中小结果，这两个**单项长度阈值**很可能一个都不命中；不能把它宣传的单输出压缩率套到累计 trace 上。

`full` 模式更相关：它把已完成且成功的历史 tool call 与 result 配对，才考虑缩短旧调用参数（[参数替换实现](https://github.com/amutix/cprune/blob/7e8694f7c2fddd1896ac3c087b17b2ee99153b68/src/cprune.ts#L578-L600)），同时保护 mutation/side-effect/browser/API 等调用（[保护谓词](https://github.com/amutix/cprune/blob/7e8694f7c2fddd1896ac3c087b17b2ee99153b68/src/cprune.ts#L362-L378)）。这正好指出本样本 8.9k args（7.8k 来自 `subagent`）的第二杠杆。但不能整包复用：

- 它还会裁剪 assistant thinking/其他历史内容，超出 PipiUI 的 tool-result-only 安全边界。
- 它直接改写持久化结果，没有 SHA spool 和精确 recall。
- 其文本提取只保留 text blocks，随后重建 content；一旦混合结果进入变换，图片/非文本块可能丢失。
- 它始终注册 compaction hook，且部分 cache/provider 判断来自经验性 provider 名称分类；不适合作为 PipiUI 默认策略的硬依据。

因此可借的是一个**候选谓词**：“历史 + 已成功 + 无副作用 + 已有匹配结果”才允许处理 args；实现仍应依附 PipiUI 的 spool/index/recall，并先通过 provider 签名矩阵。

### 3. Oh My Pi：supersede 与热缓存尾是最强的通用选择策略

OMP 在 [`pruning.ts`](https://github.com/can1357/oh-my-pi/blob/a7e19be81039c110ba943af1281666dc7b0810b0/packages/agent/src/compaction/pruning.ts#L18-L59) 的普通策略是保护最近 40k tool-output tokens，只有一次至少节省 20k 才动手。这个门槛会让本样本的 10.1k results 原样通过，但其两条旁路很值得移植：

- `readToolSupersedeKey` 用 path + selector 建 key，后来的整文件 read 能使更早的同文件/带 selector read 失效（[源码](https://github.com/can1357/oh-my-pi/blob/a7e19be81039c110ba943af1281666dc7b0810b0/packages/agent/src/compaction/pruning.ts#L422-L439)）。
- tool producer 可把零命中、无事件等结果标为 `useless`；错误结果明确不进入 useless 裁剪（[源码](https://github.com/can1357/oh-my-pi/blob/a7e19be81039c110ba943af1281666dc7b0810b0/packages/agent/src/compaction/pruning.ts#L215-L235)）。

它还显式考虑 prompt cache：warm prefix 中的旧结果不改，只处理后缀不超过 8k 的候选；长缓存调用方将 idle flush 配成 90 分钟，以超过 Anthropic 1 小时保留期。这个“热时不破坏深前缀、冷后一次批量收割”的思想，与 PipiUI 离散 fold ladder 相容。

但 OMP 最终直接把 `message.content` 替换为 superseded/useless placeholder 并设置 `prunedAt`（[源码](https://github.com/can1357/oh-my-pi/blob/a7e19be81039c110ba943af1281666dc7b0810b0/packages/agent/src/compaction/pruning.ts#L400-L419)），没有精确 recall，所以只能移植选择规则，不能移植提交路径。

OMP 的 snapcompact 是另一种机制：在 provider-request transform 中克隆消息，把大文本变成 PNG frame，保证 persisted session 不被污染（[源码](https://github.com/can1357/oh-my-pi/blob/a7e19be81039c110ba943af1281666dc7b0810b0/packages/coding-agent/src/session/snapcompact-inline.ts#L1-L15)）。它只处理 ≥3k token 的旧结果，跳过最新结果、错误和已有图片，并要求图片 token 至少比文本低 10%（[源码](https://github.com/can1357/oh-my-pi/blob/a7e19be81039c110ba943af1281666dc7b0810b0/packages/coding-agent/src/session/snapcompact-inline.ts#L47-L57)，[选择循环](https://github.com/can1357/oh-my-pi/blob/a7e19be81039c110ba943af1281666dc7b0810b0/packages/coding-agent/src/session/snapcompact-inline.ts#L175-L197)）。它适合超长表格/日志和 vision-capable provider，不适合本次由很多中小 trace 与大 args 组成的样本，也不应成为默认依赖。

### 4. OpenCode：简单可靠的高水位 marker，但没有回忆层

OpenCode 固定保护最近 40k tool output tokens，至少可释放 20k 才提交；倒序扫描时要求至少跨过两个 user turns，只处理 completed tool parts，遇到 compaction summary 或已 compacted part 即停止（[compaction.ts](https://github.com/sst/opencode/blob/e00890c67261a435cee6409366a68999a93393fd/packages/opencode/src/session/compaction.ts#L271-L316)）。

它不删除 tool part，而是给旧 part 写 `time.compacted`。序列化到模型请求时仍保留 tool name、call id、input 与 output-available 状态，只把 output 投影为 `[Old tool result content cleared]`，同时清附件（[message-v2.ts](https://github.com/sst/opencode/blob/e00890c67261a435cee6409366a68999a93393fd/packages/opencode/src/session/message-v2.ts#L290-L323)）。这比删除消息安全，而且原 output 仍在 session 数据里；但没有用户可调用的 recall/unfold，也没有显式 prompt-cache 热尾保护。

可借的是“持久原文 + 轻量投影 marker”的数据模型，以及 completed/two-turn 边界；PipiUI 已有更完整的 spool/index，没必要引入 OpenCode 的实现。

### 5. HarnessTrim：结果产生时的模式化 reducer，不是历史 context manager

HarnessTrim 的 Pi extension 注册 `tool_result` hook，默认 dry-run、最小 400 字符；逐个 text chunk 调 CLI，CLI 缺失/超时/失败就原样放行。它用 `map` 保留所有非 text chunk，所以这一适配器没有 cprune 的混合媒体丢失问题（[Pi extension](https://github.com/giuliastro/HarnessTrim/blob/304517e8af72256a2c8c66ef57540fe6498a822d/packages/adapter-pi/extension/index.ts#L155-L194)）。

核心 dispatcher 根据内容选择 test、git diff、JSON、file listing、cron、lint 或 long text reducer；只接受严格短于输入的结果（[dispatch.ts](https://github.com/giuliastro/HarnessTrim/blob/304517e8af72256a2c8c66ef57540fe6498a822d/packages/core/src/dispatch.ts#L10-L72)）。Reducer contract 明确要求 deterministic/idempotent，并有二次运行相同与“不允许输出变大”的测试（[types.ts](https://github.com/giuliastro/HarnessTrim/blob/304517e8af72256a2c8c66ef57540fe6498a822d/packages/core/src/reducers/types.ts#L1-L17)，[dispatch.test.ts](https://github.com/giuliastro/HarnessTrim/blob/304517e8af72256a2c8c66ef57540fe6498a822d/packages/core/src/dispatch.test.ts#L82-L104)）。

但 active 模式是在结果首次进入会话前就把原文换掉，没有 spool 或 recall；而且每个 text chunk 同步 spawn 一个 CLI，默认挂载会增加工具返回延迟。它只能减少某些单个 test/log/diff 的初始体积，不能回收已累积的历史 trace，也完全不处理 tool-call args。若以后采用，合理形态是**可选 producer-stage 预处理**：先把原结果交给现有 spool，再用其 reducer 生成短视图；不应直接安装 upstream Pi extension 作为默认折叠器。

### 6. pi-context-prune：摘要/查询思路可借，协议和提交安全不可接受

这个扩展在 assistant turn 结束时捕获工具批次，用模型生成摘要，并维护短 alias 供 query。它的 agent-message 批次边界、8–12 个工具一组的产品提示、短 ID 查询入口是可参考的交互思路。

但核心 `pruneMessages` 直接过滤已摘要的 `toolResult`，同时明确保留 assistant tool-call block（[pruner.ts](https://github.com/championswimmer/pi-context-prune/blob/374715608e77dc13ca36ce4e8b9f5e5ba0b97d08/src/pruner.ts#L3-L15)），违反 Anthropic 的 call/result 配对要求。它捕获结果时只拼 text blocks，图片和其他非文本内容不进入恢复记录（[batch-capture.ts](https://github.com/championswimmer/pi-context-prune/blob/374715608e77dc13ca36ce4e8b9f5e5ba0b97d08/src/batch-capture.ts#L23-L48)）。Indexer 先改内存 map，再 `appendEntry`，所以持久化失败时运行态已可能开始 pruning（[indexer.ts](https://github.com/championswimmer/pi-context-prune/blob/374715608e77dc13ca36ce4e8b9f5e5ba0b97d08/src/indexer.ts#L116-L138)）。此外配置固定写 `~/.pi/agent/context-prune/settings.json`（[config.ts](https://github.com/championswimmer/pi-context-prune/blob/374715608e77dc13ca36ce4e8b9f5e5ba0b97d08/src/config.ts#L1-L52)），与 PipiUI 项目隔离规则直接冲突。

所以它不能直接复用；最多借“批次摘要 + 短 alias query”的 UI 设计。现有 context-fold 的 digest + SHA spool + recall 已提供更安全的底座。

## 对 PipiUI 的具体决策

### 直接复用

仅推荐 Anthropic `clear_tool_uses`，而且限定为 provider adapter 的可观测实验：

```json
{
  "edits": [{
    "type": "clear_tool_uses_20250919",
    "trigger": { "type": "tool_uses", "value": 40 },
    "keep": { "type": "tool_uses", "value": 12 },
    "clear_at_least": { "type": "input_tokens", "value": 10000 },
    "clear_tool_inputs": ["subagent"]
  }]
}
```

这只是首个验收配置，不是未经数据的永久默认值。上线前必须确认 PipiUI 实际工具名、SDK/API beta header、applied-edits 计数、input/cache-read 变化，以及用户触发 recall 时本地原文仍可取回。mutation/browser/auth/GUI 工具不得进入 `clear_tool_inputs` allowlist。

### 只借策略，不引入新存储

按优先级：

1. OMP 的 supersede key 与 useless producer annotation；候选原文仍交给 context-fold spool。
2. 在现有 150k/30k token ladder 外增加“已完成 eligible tool uses ≥40 且预计至少释放 10k”的离散触发器；折叠后冻结新 layer，避免逐条破坏缓存。
3. cprune full 的“历史、成功、无副作用、pair 完整”args 候选谓词。通用 provider 实现必须后置：OpenAI Responses reasoning items、Anthropic signed thinking、Gemini thought signatures 等协议可能把 assistant block 视为不可任意重写的整体。
4. OpenCode 的 completed/two-turn 边界和投影 marker，可作为 current fold block 的额外防误触条件。
5. HarnessTrim reducer 仅作为以后可选的 producer-stage optimization；先 spool raw，再生成 reduced view。

### 明确拒绝

- 不直接挂 cprune：safe 对当前累计型样本几乎无效；full 改动范围、混合媒体和可逆性不符合产品策略。
- 不直接挂 pi-context-prune：破坏配对、非文本缺失、提交非原子、全局 `~/.pi` 路径。
- 不把 snapcompact 设为默认：依赖视觉 token 经济性，不能处理 args，且改变模型看到的模态。
- 不复制 OpenCode/OMP 的持久 placeholder 覆写：PipiUI 已有更强的 raw spool/recall，倒退没有收益。
- 不同时注册第二个 hard-compaction owner；所有普通裁剪只能作为 request transform/context-fold layer，默认 native compaction ownership 保持不变。

## 验收指标

下一步不能只看“压缩后字符少了多少”。至少记录：

- 每轮 tool-result tokens、tool-call-argument tokens，并按 tool name 分桶；`subagent` inputs 单独列。
- eligible/cleared/kept tool-use 数；Anthropic `applied_edits` 的 result/input token 分项。
- context before/after、cache read/write、一次 fold 后直到下个 layer 的缓存命中变化。
- recall 成功率与 SHA 校验；spool/index 任一失败时 raw passthrough 次数。
- signed thinking、图片/非文本 tool result、error result、无匹配 result、provider/model switch 的结构回归。

针对当前样本，首个实验的成功标准应是：40+ trace 会在 150k cap 之前触发；`subagent` arguments 明显下降；最近 12 组和最近 30k tail 不变；本地原文仍可 recall；缓存成本没有因高频重写反升。

## 来源、固定版本与许可证

| 项目 | 固定版本 | 许可证 | 备注 |
|---|---|---|---|
| PipiUI vendored context-fold | upstream [`Middlewatch/context-fold`](https://github.com/Middlewatch/context-fold/tree/4881382bc6a5acaaf8e346a5f36a4c62cf0d3ae3) 0.3.2, `4881382bc6a5acaaf8e346a5f36a4c62cf0d3ae3`; local P2 `2e4ae858d4be8c3bf67b30e8315bb76579fc7887`, hook fix `a796e362a7f062129796117a5cd6e8ce0b8415ce` | MIT | 当前可逆基线 |
| Anthropic Context Editing / TS SDK | SDK `bfa9197f0182084941052be9752c948638421601` (0.120.0) | MIT | API 功能为 beta；另见[官方文档](https://platform.claude.com/docs/en/build-with-claude/context-editing) |
| Pi provider adapter | [`earendil-works/pi`](https://github.com/earendil-works/pi/tree/914cf1472e715297caa30db4b9535d534a9eb718) v0.84.2, `914cf1472e715297caa30db4b9535d534a9eb718` | MIT | `onPayload` 是潜在接入点 |
| cprune | [`amutix/cprune`](https://github.com/amutix/cprune/tree/7e8694f7c2fddd1896ac3c087b17b2ee99153b68) v0.4.7, `7e8694f7c2fddd1896ac3c087b17b2ee99153b68` | MIT | safe/full 均读源码 |
| Oh My Pi / snapcompact | [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi/tree/a7e19be81039c110ba943af1281666dc7b0810b0) `a7e19be81039c110ba943af1281666dc7b0810b0` (17.4.4 bump) | MIT | result pruning 与 inline snapcompact 分开评估 |
| OpenCode | [`sst/opencode`](https://github.com/sst/opencode/tree/e00890c67261a435cee6409366a68999a93393fd) `e00890c67261a435cee6409366a68999a93393fd` | MIT | 评估 session compaction projection |
| HarnessTrim | [`giuliastro/HarnessTrim`](https://github.com/giuliastro/HarnessTrim/tree/304517e8af72256a2c8c66ef57540fe6498a822d) `304517e8af72256a2c8c66ef57540fe6498a822d` | MIT | Pi adapter 与 core reducers 均读源码 |
| pi-context-prune | [`championswimmer/pi-context-prune`](https://github.com/championswimmer/pi-context-prune/tree/374715608e77dc13ca36ce4e8b9f5e5ba0b97d08) `374715608e77dc13ca36ce4e8b9f5e5ba0b97d08` | `package.json` 声明 MIT；该固定提交未见 LICENSE 文件 | 许可证 provenance 不完整，也是不能直接 vendor 的附加原因 |

说明：本轮没有拿到可固定提交并逐函数复核的 DCP/Squeez 源码，因此未把其 README/市场描述纳入结论；这比用未验证介绍填表更保守。若后续要把它们列为候选，必须补齐 repo、commit、license 与实际 pruning 函数后再分级。
