# pipiui-code-retrieval 扩展规范 v1

**状态:** 已冻结，未实现

本文档冻结 PipiUI 代码检索扩展（`id="code-retrieval"`）的合约。实现须遵守本合约与 [`extension-architecture-v1.md`](./extension-architecture-v1.md)，不得另起平行通道、不得另加平行机制。规则只在其规范节陈述一次，他处仅引用。决策内容以 Shared context 已拍板集为准，本文件只组织成规范文体，不改写决策。

---

## Problem Statement

pipiui（Electron 桌面 agent harness，内嵌 pi runtime）的代码检索仍停在「grep → read」循环，没有热的结构化检索层，也没有会话内已读区间去重。从使用者视角，痛点是：

1. **`read` 只挡住了整文件爆上下文，没有减少轮数。** `read` 上限 2000 行或 50KB，截断后提示模型回 grep——解决了单次读爆仓，但 grep→read 的往返次数依旧。
2. **explore 子代理只转移了成本，没有消灭成本。** 报告级 handoff（`.pi/findings/`）控制了主上下文污染，底层 grep/read 总成本没消失，只是转移给子代理。
3. **没有任何热的结构化检索层。** 全仓搜不到 zoekt / tree-sitter / LSP / embedding / repomap / trigram 实现。模型每次都从零扫文本。
4. **「已读区间去重」完全不存在。** 同一 `(path, startLine, endLine)` 可被不同 agent、同一会话的后续轮次重复读入全文。

外部对标结论（已逐条网络核查）：各家不是同一种索引——Claude Code / OpenCode = rg + LSP + 子代理隔离；Codex CLI = rg + 模糊文件名 + 并行；Grok Build = rg + tree-sitter 增量符号图；Cursor = 本地 sparse n-gram 精确索引 + 服务端语义索引 + 动态上下文压缩；Aider = 固定 token 预算 repo map。语义向量检索放最后，精确索引与上下文协议先行。Cursor 博客数据（12.5% 问答提升、46.9% token 降低）是其自测口径，非独立基准。

---

## Solution

对用户而言：本扩展是一份默认启用的内置双半包。agent 半注册四个模型可见工具（`code_search` / `code_nav` / `repo_map` / `read_spans`），并由项目级 sidecar 提供索引查询；app 半提供索引状态面板、工具富卡片与项目设置。索引未 ready、sidecar 崩溃或扩展被禁用时，agent 流程完全不受影响，工具明确告知降级并走现有 grep。

- **一包一功能。** 目录同时交付 agent 半（工具 + sidecar 生命周期）与 app 半（面板 / 富卡片 / 设置）。身份是 `id="code-retrieval"`。
- **项目级 sidecar，跨会话复用。** 端口文件发现 + 引用计数；索引磁盘持久化 + content-hash 增量。有意偏离 memory-broker 的每会话一个 server。
- **结果先压缩、再按需展开。** 模型先看到短引用；完整结果落盘；会话内已读区间不重复返回全文。
- **provider 可换，接口稳定。** v1 精确层是 rg 包装；符号层是 tree-sitter WASM（Python + TS/JS + Rust）；语义层不做。升级路径见 D6。
- **worker 可见性走通用升级，不为本扩展写死。** 见 D3。
- **默认启用，可按项目关掉。** 索引是基础设施；降级路径已保证无害。禁用语义服从扩展合约 D9 / D10。

---

## User Stories

1. 作为扩展用户，我希望打开项目后检索扩展默认可用，以便不必先装包、先配对、先填密钥才能搜代码。
2. 作为扩展用户，我希望本项目可以关掉全 App 已开的检索扩展，以便按扩展合约 D10 覆盖启用状态，项目级禁用优先。
3. 作为扩展用户，我希望禁用后四个工具与索引面板整组消失且无残留，以便界面可逆（扩展合约 D9）。
4. 作为扩展用户，我希望禁用或 sidecar 不可用时，正在进行的对话不被打断，以便 agent 流程完全不受影响。
5. 作为扩展用户，我希望在右侧工具区看到「索引」页签，以便知道 sidecar 是否 ready、正在建什么、是否降级。
6. 作为扩展用户，我希望 `code_search` / `repo_map` 的工具结果以富卡片呈现，以便一眼看到路径、行号、符号与分数，而不只是散文。
7. 作为扩展用户，我希望斜杠命令 `/reindex` 能触发本项目重索引，以便改完大量文件后不必等闲时增量。
8. 作为扩展用户，我希望设置落在本项目 `{project}/.pi/agent/ext-settings/code-retrieval.json`，以便换机器只带项目家就能带走排除规则与预算。
9. 作为扩展用户，我希望设置键强制 `ext.code-retrieval.*` 前缀，以便不与其他扩展或核心设置冲突。
10. 作为扩展用户，我希望 `exactProvider` 可选 `auto` / `rg` / `zoekt` / `tantivy`（默认 `auto`），以便阶段 2 之后能换精确索引实现而不改工具名。
11. 作为扩展用户，我希望 `tokenBudget` 默认为 4000 且可改，以便 `repo_map` 与 `read_spans` 的默认预算跟我的上下文窗口匹配。
12. 作为扩展用户，我希望 `excludeGlobs` 可配，以便 `node_modules`、构建产物、大生成文件不进索引。
13. 作为扩展用户，我希望语义 API Key（若将来启用）走 secret vault、永不落盘，以便分享项目家时不泄露凭证。
14. 作为扩展用户，我希望同一项目的多个会话共用一个索引 sidecar，以便不必为每个短命 worker 重建索引。
15. 作为扩展用户，我希望关掉最后一个会话后 sidecar 能空闲超时自退，以便项目家不常驻无用进程。
16. 作为扩展用户，我希望索引落在本项目磁盘上，sidecar 重启只打开已有索引并补 dirty set，以便重启廉价。
17. 作为扩展用户，我希望密钥与设置都不写入全局 `~/.pi`，以便遵守项目隔离。
18. 作为项目维护者，我希望本包落在 Bundled runtime 的 `Electron/resources/runtime/extensions/` 树，并登记进 `BUNDLED_MANIFEST_EXTENSIONS`，以便 Canonical App 开箱即有检索。
19. 作为项目维护者，我希望附加资产（tree-sitter `.wasm`、将来的 Zoekt / Tantivy 二进制、将来的 embedding 模型）随扩展包走 per-arch 切片，以便不把全架构资产打进单 arch 包。
20. 作为项目维护者，我希望单 arch App 体积继续受 ~610MB 预算约束，超标即回归，以便检索资产不能把打包 slimming 默默打回去。
21. 作为项目维护者，我希望 worker 可见性升级是通用机制（能力表 + spawn-assembly 挂载），以便 `memory_query` 等只读检索工具一并放行，而不是给本扩展开后门。
22. 作为项目维护者，我希望 explore / reviewer 只拿到只读检索工具，可写工具不进这两类角色，以便子代理不能借检索扩展获得写盘能力。
23. 作为项目维护者，我希望不删除现有 `grep` / `read`，以便它们继续充当 fallback、宽泛 regex 兜底与索引正确性基准。
24. 作为项目维护者，我希望符号提取 v1 只打包 Python + TS/JS + Rust 的 tree-sitter WASM，以便用户主战场（Python）先可用，且避开 Electron 原生模块 rebuild。
25. 作为项目维护者，我希望诚实声明 tree-sitter 符号图不是完整类型系统，以便 `code_nav` 的 definition / references 不被误当成 LSP 级跳转。
26. 作为项目维护者，我希望并发写用锁文件单写者、其余会话读旧快照，以便不把索引写成分布式共识；精确层有 dirty overlay 兜底，读不到刚写入可接受。
27. 作为项目维护者，我希望不打包包级 language server，LSP 只在用户项目已装 server 时探测增强，以便体积与安装仪式都不膨胀。
28. 作为项目维护者，我希望评测集以 Python 项目为主、不以 pipiui 自身当主要测试仓，以便验收指标反映真实用户战场。
29. 作为项目维护者，我希望阶段 1 不实现语义向量检索，以便精确索引与上下文协议先落地、先可测。
30. 作为项目维护者，我希望不改 Boss / Worker 编排机制，worker 可见性升级仅限工具挂载通道，以便编排运行时与检索扩展解耦。
31. 作为 agent 自身，我希望用 `code_search` 作为唯一检索入口，并按 `mode` 或查询形态路由到 exact / symbol / semantic，以便不必在三个工具之间猜该调哪个。
32. 作为 agent 自身，我希望用 `code_nav` 按 definition / references / implementations / workspace_symbols / callers / callees 导航符号，以便「谁定义 / 谁引用」不必再靠宽泛 grep。
33. 作为 agent 自身，我希望 `callers` / `callees` 在阶段 3 才完整，阶段 1 不假装已经能画调用图。
34. 作为 agent 自身，我希望用 `repo_map` 在 token 预算内拿到签名 / 导入 / 调用边、不含函数体，以便先建立仓库地图再决定读哪一段。
35. 作为 agent 自身，我希望用 `read_spans` 按稳定 ID 取代码区间，合并相邻区间，并在会话内对已读区间只回引用，以便同一段代码不进上下文两次。
36. 作为 agent 自身，我希望工具 `content` 是压缩文本引用（top 12 内联），完整结果在需要时再查落盘文件，以便检索 tokens 受控。
37. 作为 agent 自身，我希望索引未 ready 时工具明确告知降级并走 grep，而不是抛未捕获错误或空结果装成功。
38. 作为 agent 自身，我希望 explore / general-purpose / reviewer worker 会话里也能看到这四个只读工具（以及 `memory_query` 等只读检索工具），以便子代理不必退回纯 grep。
39. 作为 agent 自身，我希望跨 agent 的已读知识复用现有 `.pi/findings` 机制，不另起通道，以便 handoff 协议只有一条。
40. 作为 agent 自身，我希望截断继续走 pi 的 `truncateHead` / `truncateTail` / `truncateLine`（默认 50KB / 2000 行），以便超长 span 的行为与现有 `read` 一致。

---

## Implementation Decisions

下列形状编码合约（本规范允许的内联例外）；实现须按形状校验，不得另起字段名、工具名、通道名或平行生命周期。扩展合约（双半包、能力注入、生命周期 D9、三位置与启用覆盖 D10、工具 `details` D5）一律引用 [`extension-architecture-v1.md`](./extension-architecture-v1.md)，此处不复述。

**D1. 双半包形态与 manifest 形状。** 本包是扩展合约 v1 双半包，默认启用的 bundled 内置包。两半分处两个运行时：agent 半在 `pi --mode rpc` 子进程（工具注册 + sidecar 生命周期），app 半在渲染进程（toolPanel 索引状态面板 + 工具富卡片 + 设置）。共享 `id="code-retrieval"`、设置命名空间 `ext.code-retrieval.*`、桥通道 `ext.code-retrieval`。落位 `Electron/resources/runtime/extensions/` 树，登记进 `Electron/packages/pi-backend/src/runtime-install.ts` 的 `BUNDLED_MANIFEST_EXTENSIONS`（现有判例：grok-build-oauth）；由 runtime-install 同步。项目可按扩展合约 D10 覆盖启用状态（项目级禁用优先）。内置包不能卸载、只能禁用。

包布局合约：

```
code-retrieval/
├── pipiui-extension.json   # id="code-retrieval"
├── agent/                  # L1：pi extension，工具注册 + sidecar 生命周期
│   ├── index.ts → dist/
│   └── sidecar/            # 索引服务进程资产（含 tree-sitter WASM）
└── app/                    # L0/L1：toolPanel 索引状态面板 + 工具富卡片 + 设置
    └── panel.tsx → dist/
```

manifest 要点：`capabilities` 为 `["settings.read", "bridge.emit", "invoke.agent", "stream.render"]`；`app.settings.scope` 为 `"project"`（落入 `{project}/.pi/agent/ext-settings/code-retrieval.json`）；设置键强制 `ext.code-retrieval.*` 前缀；`settingsVersion` 为 1，`migrations` 为 `[]`。设置键：

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `ext.code-retrieval.exactProvider` | enum `["auto","rg","zoekt","tantivy"]` | `"auto"` | 精确文本层 provider |
| `ext.code-retrieval.tokenBudget` | number | `4000` | `repo_map` / `read_spans` 默认预算 |
| `ext.code-retrieval.excludeGlobs` | string[] | `[]` | 索引排除 |
| `ext.code-retrieval.semanticApiKey` | `{ type:"string", format:"secret" }` | （无） | → secret vault，永不落盘 |

`app.ui`：`panels=[{slot:"toolPanel", id:"retrieval", title:"索引"}]`；`toolRenderers` 按工具名 `code_search` / `repo_map`；`slashCommands=[{name:"reindex"}]`。

下列 JSONC 即合约：

```jsonc
{
  "id": "code-retrieval",
  "name": "Code Retrieval",
  "version": "1.0.0",
  "agent": {
    "extension": "agent/dist/index.js"
  },
  "app": {
    "settings": {
      "scope": "project",
      "schema": {
        "type": "object",
        "properties": {
          "ext.code-retrieval.exactProvider": {
            "type": "string",
            "enum": ["auto", "rg", "zoekt", "tantivy"],
            "default": "auto",
            "title": "精确索引"
          },
          "ext.code-retrieval.tokenBudget": {
            "type": "number",
            "default": 4000,
            "title": "默认 token 预算"
          },
          "ext.code-retrieval.excludeGlobs": {
            "type": "array",
            "items": { "type": "string" },
            "default": [],
            "title": "排除 glob"
          },
          "ext.code-retrieval.semanticApiKey": {
            "type": "string",
            "format": "secret",
            "title": "语义检索 API Key"
          }
        }
      }
    },
    "ui": {
      "panels": [{ "slot": "toolPanel", "id": "retrieval", "title": "索引", "entry": "app/dist/panel.js" }],
      "toolRenderers": [
        { "tool": "code_search", "entry": "app/dist/search-card.js" },
        { "tool": "repo_map", "entry": "app/dist/map-card.js" }
      ],
      "slashCommands": [{ "name": "reindex", "description": "重建本项目代码索引" }]
    }
  },
  "capabilities": ["settings.read", "bridge.emit", "invoke.agent", "stream.render"],
  "settingsVersion": 1,
  "migrations": []
}
```

**D2. sidecar 拓扑：端口文件发现 + 引用计数复用。** 有意偏离 memory-broker 的每会话一个 server。理由：索引构建成本高、worker 会话短命且多，每会话起索引进程不可接受；查询进程可无状态。判例（可参考但偏离）：session 级 server `memory-broker`；项目级数据 `{projectRoot}/.pi/pipiui-memory`。

- sidecar 写 `{project}/.pi/agent/code-retrieval/sidecar.json`（`pid` / `port` / `token`）。
- 新会话先探测存活实例直接连，没有才自己起。
- 索引磁盘持久化 + content-hash 增量；sidecar 重启廉价（开磁盘索引 + 补 dirty set）。
- 并发写：锁文件单写者，其余会话读旧快照——精确层有 dirty overlay 兜底，**读不到刚写入可接受**（诚实限制：并发快照读，不是线性一致）。
- 空闲超时自退；`session_shutdown` 只做引用计数，不杀别人在用的进程。

时序（合约，非实现草图）：

```
  会话 A (agent 半)          项目家磁盘                     sidecar 进程              会话 B (agent 半)
  -----------------          ----------                     -------------              -----------------
  读 sidecar.json     -----> 无 / 陈旧
  抢锁并 spawn        -----> lockfile 单写者
  写 sidecar.json     <----- pid/port/token          <----- listen
  refcount += 1
  查询                 ------------------------------------> 读索引 / 写索引(持锁)

                             sidecar.json 仍有效
  探测存活            <----- 被 B 读取                                              读 sidecar.json
                                                                                     ping pid/port/token
                                                                                     复用，refcount += 1
                                                                                     查询 ──────────────> 读旧快照
                                                                                                          （A 若正在写，
                                                                                                           B 不阻塞等写完）

  session_shutdown    -----> refcount -= 1
  （不杀进程）
                                                                                     session_shutdown
                                                                                     refcount -= 1 → 0
                                                      空闲超时自退
                                                      删/作废 sidecar.json
```

**D3. worker 可见性：通用机制升级（runtime 升级点）。** 不为本扩展写死。缺口（已侦察确认）：worker 不继承主会话扩展工具；工具集 = `Electron/resources/runtime/pi-ext/subagent/agents.ts` 的 `capabilityToolNames` 能力派生表 + spawn `-e` 挂载；`validateExplicitTools` 只能收窄不能加；spawn 组装在 `Electron/packages/pi-backend/src/spawn-assembly.ts`（`SpawnFeatures` / `SpawnRegisteredExtension`）。连 `memory_query` 对 worker 都不可见。

修法（两处一起改，缺一不可）：

1. **spawn-assembly 挂载。** worker spawn 时挂载项目已启用扩展，复用 spawn-assembly 注册扩展通道（与主会话同一 `-e` 来源，由 registry 生成，不扫裸文件）。
2. **agents.ts 能力表按角色放行。** explore / general-purpose / reviewer 放行 `code_search` / `code_nav` / `repo_map` / `read_spans` / `memory_query` 等只读检索工具；可写工具不进 explore / reviewer。

本决策是 **pi-ext + pi-backend 的 runtime 升级点**，不是 `code-retrieval` 包内私货。升级服务所有只读检索类扩展，禁止为本包单独开第二条 worker 工具通道。不改 Boss / Worker 编排机制。

**D4. 工具面契约。** agent 半注册四个模型可见工具。`grep` / `read` 不删除，降级为：索引未 ready 的 fallback、宽泛 regex 兜底、索引正确性基准。

| 工具 | 签名 | 语义 |
|---|---|---|
| `code_search` | `(query, mode?: "auto"\|"exact"\|"symbol"\|"semantic", path?, glob?, topK?)` | 唯一检索入口 |
| `code_nav` | `(operation: definition\|references\|implementations\|workspace_symbols\|callers\|callees, symbol?, path?, line?, column?)` | tree-sitter 符号图 → exact 兜底。`callers` / `callees` 阶段 3 才完整 |
| `repo_map` | `(tokenBudget?)` | tree-sitter 符号提取 + 图排序（PageRank 类），只出签名 / 导入 / 调用边，不含函数体；预算可配（默认见 `tokenBudget` 设置） |
| `read_spans` | `(refs: string[])` | 按稳定 ID 取代码区间；合并相邻区间；content-hash 去重；**会话内已读区间 `(path, startLine, endLine, contentHash)` 不重复返回**，只回引用；总 token 预算；可取 symbol body 而非整文件 |

`code_search` 内部路由（`mode` 缺省或 `"auto"` 时）：

| 查询形态 | 路由 |
|---|---|
| 路径 / 错误串 / regex | `exact` |
| 「谁定义 / 谁引用」 | `symbol` |
| 开放式问题 | `semantic`（**阶段 4 才启用**；阶段 1–3 不得静默走向量检索） |
| 不确定 | 混合（阶段 1 = exact + symbol；semantic 参与混合仅阶段 4） |

`code_nav` 不是完整类型系统：tree-sitter query 提取函数 / 类 / 方法 / 导入 / 调用（参考 Aider repomap 先例），没有跨文件类型推断、没有 overload resolution。跳转失败时回退 exact，并在结果里标明降级。

**D5. 结果协议。** token 节省的核心。规则只在本节陈述。

- `content` = 压缩文本引用，形如 `R17 src/auth/session.ts:81-126 validateSession() · score 0.94`，top 12 内联。
- `details` = 结构化 payload（pi `registerTool` execute 返回 `{ content, details }`，扩展合约 D5）；app 半 `toolRenderer` 画富卡片；解析失败退默认卡。
- 完整结果落盘 `{project}/.pi/agent/code-retrieval/results/<hash>.jsonl`，模型需要更多再查。
- 截断用 pi 的 `truncateHead` / `truncateTail` / `truncateLine`（默认 50KB / 2000 行）。
- seen-range ledger **会话内**记账；跨 agent 复用现有 `.pi/findings` 机制，不另起通道。

`content` 示例（合约形状）：

```
R17 src/auth/session.ts:81-126 validateSession() · score 0.94
R18 src/auth/token.ts:12-40 signToken() · score 0.81
…（至多 12 条内联；其余见 results/<hash>.jsonl）
```

`details` 示例（合约形状，字段可增不可改名）：

```json
{
  "schemaVersion": 1,
  "kind": "code-retrieval.search",
  "hits": [
    {
      "ref": "R17",
      "path": "src/auth/session.ts",
      "startLine": 81,
      "endLine": 126,
      "symbol": "validateSession",
      "score": 0.94
    }
  ],
  "resultsPath": ".pi/agent/code-retrieval/results/<hash>.jsonl",
  "degraded": false
}
```

**D6. 索引分层与 provider 接口。** provider 可换，接口稳定。实现不得把某一层的内部文件布局升格为合约。

| 层 | v1 | 升级路径 |
|---|---|---|
| 精确文本 | rg 包装 + 查询结果缓存（零原生依赖，先跑通协议） | 阶段 2：Zoekt vs Tantivy spike（含 per-arch 打包验证）→ Git HEAD baseline + dirty overlay + watcher |
| 符号 | tree-sitter WASM：Python / TS / JS / Rust | 阶段 3：调用图（callers / callees）+ LSP 探测增强（只在用户项目已装 server 时启用，**不打包包级 language server**）+ 更多 grammar |
| 语义 | 不做 | 阶段 4：AST / symbol 分块 + embedding，provider 可配，key 走 secret vault；只对开放式查询启用 |

符号提取：v1 内置 tree-sitter WASM，首发语言 = Python + TS / JS + Rust。用 web-tree-sitter（纯 WASM，无原生编译，避开 Electron 原生模块 rebuild）。grammars：`tree-sitter-python` / `tree-sitter-typescript` / `tree-sitter-javascript` / `tree-sitter-rust`（`.wasm` 随包，见 D7）。用户主战场是 Python——TS 编译器 API 打底方案已废弃。符号 query（函数 / 类 / 方法 / 导入 / 调用）参考 Aider repomap 先例。**tree-sitter 不等于完整类型系统**（见 D4）。

**D7. 打包红线：附加资产随扩展包走 per-arch 切片。** sidecar 二进制同意进包。tree-sitter grammars（`.wasm`）、Zoekt / Tantivy 二进制、（将来）embedding 模型都随扩展包分发。复用 `PIPIUI_EMBEDDED_RUNTIME_TARGET` per-arch 切片机制（`scripts/fetch-cua-driver.mjs` 是判例）；受 ~610MB 单 arch 体积预算约束，超标 = 回归。

**D8. 降级语义（宪法可用性优先 → 验收条款）。** 索引未 ready / sidecar 崩溃 / 扩展禁用 → agent 流程完全不受影响，工具明确告知降级并走 grep；禁用 = 四工具 + 面板整组消失无残留（扩展合约 D9 语义）。降级不得抛未捕获错误、不得让会话卡死、不得假装检索成功而返回空命中。`code_search` 在 sidecar 不可达时必须走出 fallback 路径（现有 `grep`），并在 `content` / `details.degraded` 上可观察。

---

## Testing Decisions

**好测试钉外部行为，不钉内部文件布局。** 断言应能从宿主 API、spawn 参数、工具返回的 `{ content, details }`、sidecar 端口文件与进程存活上观察，换实现仍绿。不在渲染像素、不在 sidecar 内部对象图、不在索引目录的内部文件名上做一等断言。

**缝（尽可能高、尽可能少）——选定四条：**

1. **spawn 挂载缝。** 项目已启用本扩展时，**新** worker 会话的 spawn 参数出现该扩展的 `-e`，且 explore / general-purpose / reviewer 的工具集出现 `code_search` / `code_nav` / `repo_map` / `read_spans`（以及能力表放行的 `memory_query` 等只读检索工具）。未启用 / 已禁用时，新 worker 会话不出现上述 `-e` 与工具。已运行会话的 spawn 参数不因中途 enable 而变（扩展合约 D9）。
2. **sidecar 发现缝。** 同一项目：第一会话在无存活实例时拉起 sidecar 并写出可探测的 `sidecar.json`；第二会话复用同一 `pid` / `port`，不拉起第二个写者。最后一个会话 `session_shutdown` 后引用计数归零，空闲超时进程退出，后续会话不再连上已死实例。不钉锁文件内部布局。
3. **结果协议缝。** 对同一 `(path, startLine, endLine, contentHash)` 连续两次 `read_spans`：第一次返回区间全文（受总 token 预算与截断约束）；第二次不返回已读区间全文，只回引用。跨会话不要求共享 seen-range ledger（跨 agent 走 `.pi/findings`，不在本缝断言）。
4. **降级缝。** sidecar 进程被杀掉后，`code_search` 走 fallback（现有 grep）且会话流程不炸：工具返回可观察的降级告知（`details.degraded` 或等价 `content` 声明），不抛未捕获错误，后续 `grep` / `read` 仍可用。扩展禁用后四工具与面板对**新**会话不可见。

四条缝覆盖 D3 挂载、D2 复用与自退、D5 去重、D8 无害降级；其余实现细节不得升格为一等测试。

**对标。** 镜像扩展合约的测试语气：钉宿主可观察的协议与安装结果，而不是 import 实现模块的私有函数。评测集与阶段验收指标见 Further Notes，它们是产品验收，不是本文件的单元测试清单。

---

## Out of Scope

下列为冻结的非目标，实现不得借「顺手」做进去：

- 不做语义向量检索进阶段1；不动 pi 核心工具实现；不做全局 ~/.pi 任何写入；不把扩展装进 App profile；不做扩展市场；不改 Boss/Worker 编排机制（worker 可见性升级仅限工具挂载通道）；不打包包级 language server。

本仓库无 issue tracker；本规范的发布面就是 `docs/` 下本文件，不定义 triage 标签。

实现任务由 Boss 拆成 Brief/Wave，验收以 Attestation 为准。本文件只冻结合约，不代替 Ledger 或 Shared context。

---

## Further Notes

**阶段与验收。**

| 阶段 | 内容 | 验收 |
|---|---|---|
| **阶段 0 评测** | 从 `.pi/findings/` 历史报告 + 会话转写挖 20–30 个真实任务，标注正确文件 / symbol；**评测集必须 Python 项目为主**（pipiui 自身不当主要测试仓） | 指标就位：time-to-first-relevant-span、search/read 调用次数、unique/duplicate bytes read、retrieval tokens、Recall@5 / @20 |
| **阶段 1 协议层** | 四工具 + 结果协议 + seen-range ledger + worker 可见性通用升级 + tree-sitter WASM 进包（Python / TS / JS / Rust）+ `repo_map` / `code_nav` v1 | 同评测集 read 调用数 / 重复字节显著下降；Python 项目 `repo_map` 可用；禁用扩展流程无损 |
| **阶段 2 精确索引** | Zoekt vs Tantivy spike → 实现 + overlay + watcher | 大目录 time-to-first-result 可测下降；改文件后索引立即可见 |
| **阶段 3 符号增强** | 调用图 + LSP 增强 + 更多 grammar | `code_nav` callers / callees 可用 |
| **阶段 4 语义（可选）** | hybrid 检索只对开放式查询 | 开放式 Recall@5 提升，精确查询不受影响 |

**里程碑依赖。** 阶段 1 依赖扩展合约已落地的双半包加载、`-e` 挂载、`details` / toolRenderer、项目级 settings（含 `format: secret`）。D3 的 runtime 升级与本包 agent 半可并行，但 worker 会话出现扩展工具是阶段 1 验收的外部行为，缺一不可。阶段 2 的二进制进包必须先过 D7 体积预算，超标不得合并。

**诚实限制（只点一次）。** sidecar 并发写是锁文件单写者 + 旧快照读，不是线性一致（D2）。tree-sitter 符号图不是完整类型系统（D4 / D6）。Cursor 博客数字是其自测口径，不作本扩展的对外承诺。

**证据锚点（Findings，名称级）。** 本冻结设计的 recon 写在：

- `.pi/findings/agent-0094fc1f135cf99a.md` — 检索现状侦察
- `.pi/findings/agent-e7d19bae062eddda.md` — 扩展 API 可行性
- `.pi/findings/agent-b8a7c78d9828326a.md` — 外部对标核查
- `.pi/findings/agent-f8df0f195d6fd627.md` — 集成点核实（sidecar 所有权、worker 可见性、bundled 落位、`details` / 截断）

关键存量机制（只点名、不引代码）：扩展合约 D3 `-e` 挂载、D5 `details`、D9 生命周期、D10 三位置与启用覆盖；`agents.ts` 能力派生表；spawn-assembly 注册扩展通道；`BUNDLED_MANIFEST_EXTENSIONS` / runtime-install 同步；`PIPIUI_EMBEDDED_RUNTIME_TARGET` per-arch 切片；memory-broker 的 session 级 server（本包有意偏离）；项目家 `.pi/agent` 与 `.pi/findings`。
