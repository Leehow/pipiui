# 工具 / Skill 的渐进式披露

PipiUI 往每次请求的**固定前缀**里塞了多少东西，以及怎么按需披露而不毁缓存。

## 为什么要管这件事

实测（探针扩展在 `before_agent_start` dump 后 `process.exit(0)`，零 API 消耗）：

| 组成 | 裸 pi | PipiUI | 差 |
|---|---:|---:|---:|
| system prompt | 6,900 | 10,800 | +3,900 |
| 工具 schema | 2,609 | 4,404 | +1,795 |
| **每次请求固定前缀** | **≈9,500** | **≈15,800** | **+66%** |

PipiUI 注入部分的明细（token）：

```
boss-prompt.md            3,116 → 2,055（已英文化瘦身）
media/git 的 prompt 块      757
subagent + subagent_status  579
browser_* ×5                517
generate_image              433
web_search + web_fetch      477
git_status + git_diff       368
```

缓存正常时这些按 10% 计价，代价不大。真正的问题是**前缀一旦失效就要按原价整体重买**——所以「缩小前缀」和「别毁缓存」是同一件事的两面，后者优先级更高（见 `GitExtension.swift` 里 `before_agent_start` 的注释）。

## 硬约束：什么会毁缓存

发给模型的前缀 = **tools 数组 + system prompt + 历史消息**，任意一段变化，其后全部失效。

推论，按重要性排序：

1. **改 tools 数组 = 全量重发。** `pi.setActiveTools()` 存在（`glm-mcp-tools.ts` 用它按模型开关工具），但每调一次改变工具集就是一次全量重发。**披露必须单调**：只增不减，一个会话内尽量只发生一次。
2. **改 system prompt = 全量重发。** 任何 `before_agent_start` 返回 `systemPrompt` 的写法都在改前缀。要注入内容就返回 `message`（custom message，pi 会转成 user 消息落在前缀之后）。
3. **工具返回值是免费的披露通道。** tool result 落在历史末尾，天然 append-only，不影响任何已缓存内容。**这是渐进式披露唯一真正廉价的载体。**

## 别人怎么做的

| 方案 | 出处 | 做法 | 我们能不能用 |
|---|---|---|---|
| Agent Skills 三层 | Anthropic，2025-12 开源标准 | L1 name+description（~100 tok/skill）常驻 → L2 SKILL.md（~5K）触发时读 → L3 引用文件按需读 | ✅ 直接可用，pi 已有 skills 机制 |
| Tool Search + `defer_loading` | Anthropic API，2026-02 GA | 延迟工具**不进前缀**；模型搜到后 API 把 `tool_reference` **inline 追加到对话里**再展开 → 前缀不动，缓存保住。官方称省 85% | ⚠️ 是 Anthropic API 侧特性，k3/GLM 用不上；但它的**做法**可以照抄 |
| CLI 式单工具 | claude-code-router | 一个工具吃 `["--help"]` / `["<domain>", "--help"]` / `["<domain>","<cmd>","--help"]`，四层 help 逐级展开参数 | ✅ 最适合我们——工具数恒定，帮助文本走 tool result |
| MCP lazy schema / 分页 | MCP spec 2026 | 分离「知道有这个工具」与「拿到它的 schema」，工具列表分页 | ➖ 我们不是 MCP host，但思路同上 |

**关键观察**：Anthropic 的 `defer_loading` 之所以能省 85% 又不毁缓存，是因为它把展开后的定义**追加到对话里**而不是塞回前缀。我们没有那个 API，但 tool result 就是同一个位置——所以 CLI 式单工具是这套约束下的等价物。

## PipiUI 的分层

**L0 常驻**（进前缀，永不变）
判定：每个会话都会用 / 不用就等于功能不存在。
→ read/bash/edit/write/grep 等原生工具、`subagent`、`browser`（合并后的单工具）。

**L1 CLI 式代理**（一个稳定工具，参数细节走 tool result）
判定：一族相关操作、单独看每个都不常用、合起来有明确入口。
→ `browser`（5 → 1）、未来的 `git`（2 → 1）。
形态：`browser({ action, ... })`，description 一行列出 action 名；`action:"help"` 返回完整参数说明。前缀只留入口，细节按需。

**L2 Skill 文本**（完全不进前缀）
判定：是「怎么做」的指令而不是「能做什么」的能力。
→ media 扩展那段 image generation 说明、boss prompt 里的重流程 SOP。
形态：写成 skill，靠 name+description 触发，模型自己 read。

**判定顺序**：先问「不进前缀会不会导致模型根本不知道有这个能力」——会 → L0/L1；不会 → L2。再问「这一族是不是共享一个入口」——是 → L1；否 → L0。

## 落地顺序

1. ~~git 快照移出 system prompt~~（已完成，回收约 30% 总开销）
2. ~~boss prompt 英文化 + 机制细节去重到工具 description~~（已完成，-1,061 token）
3. ~~`browser_*` 5 → 1~~（已完成，517 → 201 token，本文档的第一个 L1 样例）
4. ~~Superpowers 段落改为按模型档位注入~~（已完成，见下节）
5. ~~`git_status` / `git_diff` → 单 `git` 工具~~（已完成，368 → 195 token）
6. ~~media 的 prompt 块 + `generate_image` 瘦身~~（已完成，563 → 255 token）

第 6 项没有按原计划整个降到 L2：`generate_image` 是**工具**不是指令，删掉功能就没了。实际做法是去重——它原先在前缀里出现两次（system prompt 的 image 段 + promptGuidelines），内容几乎一样；现在 system prompt 段整个删除、guidelines 压成一行，完整用法改由 `confirmed=false` 分支作为 tool result 返回（落在对话里而非前缀）。

同口径实测（探针，同一套扩展 + boss prompt）：

| | 裸 pi | 改造前 | 改造后 |
|---|---:|---:|---:|
| system prompt | 6,896 | 10,498 | **9,142** |
| 工具 schema | 2,609 | 4,404 | **3,737** |
| **固定前缀合计** | 9,505 | 14,902 | **12,879** |

PipiUI 注入部分 5,397 → **3,374 token（-37%）**。`subagent` 的 579 token 两边都未计入（探针里没加载该扩展）。

## 按模型档位分级（Superpowers 的特例）

Superpowers 不能简单降到 L2：弱模型不走 SOP 几乎不可用，而强模型被重流程拖累。所以它按**模型档位**注入两套文本，而不是一刀切：

| 档位 | 注入 | 体量 |
|---|---|---:|
| 强（默认） | 「技能库是参考，T0/T1 别进重流程，verification-before-completion 仍然有效」 | ~60 tok |
| 弱（Settings 勾选） | 完整强制 SOP：什么情况读哪个 skill、必须读文件本身而不是凭记忆、拿不准就读 | ~380 tok |

**为什么这样不毁缓存**：注入文本是「当前模型」的纯函数，同一模型下逐回合字节一致，前缀照常命中；只有切模型时才变，而切模型本身已经作废了缓存，所以这次替换是**免费搭车**。这是 `before_agent_start` 允许返回 `systemPrompt` 的唯一正当场景——判据是「这段文本会不会在同一模型下发生变化」，不是「它长不长」。

档位来源只有一个：Settings → 模型里逐个勾选，未勾 = 强。**代码里不存在任何内置强弱模型清单**，`ModelTierSettingsTests` 会断言这一点——硬编码清单必然过时，而分错档会静默改变整个会话的工作方式。

弱模型另有一道闸门：本会话没读过任何 skill 时，第一次调 `subagent` 会被 `tool_call` 钩子拦一次并要求先读 SOP，**每会话只拦一次**，误伤上限一次往返。行为用 `./scripts/check-skilltier-gate.sh` 验证（直接驱动扩展 handler，不发 API 请求）。

## 反模式

- **别用 `setActiveTools` 做动态开关。** 每次改都是一次全量重发；省下的前缀 token 远不够赔。只有「会话启动时按配置定一次，之后不动」是安全的。
- **别把披露内容塞回 system prompt。** 那是前缀，等于没披露还多毁一次缓存。
- **别为省几十 token 做多层 help。** 每层 help 是一次额外的模型往返（延迟 + output token）。两层封顶：入口 description 一行 + 一次 `help` 出全部参数。
- **别让工具集随对话内容变。** 单调只增；宁可多留一个入口工具，不要来回增删。

## 参考

- [Tool search tool — Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- [Tool use with prompt caching — Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)
- [Progressive disclosure of agent tools, CLI-tool style — claude-code-router](https://github.com/musistudio/claude-code-router/blob/main/blog/en/progressive-disclosure-of-agent-tools-from-the-perspective-of-cli-tool-style.md)
- [Agent Skills: Progressive Disclosure as a System Design Pattern — SwirlAI](https://www.newsletter.swirlai.com/p/agent-skills-progressive-disclosure)
- [MCP context bloat fix 2026: tool search, code mode, progressive disclosure](https://mcp.directory/blog/mcp-context-bloat-fix-2026-tool-search-code-mode-progressive-disclosure)
