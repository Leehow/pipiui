# PipiUI 日志系统

出问题时第一件事：**菜单栏 → 帮助 → 打开日志文件夹**（`⇧⌘L`）。

## 文件在哪

`~/Library/Logs/PipiUI/`

| 文件 | 内容 |
|------|------|
| `pipiui-YYYY-MM-DD.log` | 应用自己写的结构化日志（本文档主要讲这个） |
| `pipiui-stderr-YYYY-MM-DD.log` | 进程 stderr 原文 |

两个文件都按天切分，单个超过 5 MB 自动轮转，最多保留 10 个。

**为什么要有第二个文件：** 让 App 崩掉的信息大多数不走 `Log.*`。Swift 运行时陷阱
（`fatalError`、强解包 nil、数组越界）、`NSException` 的 reason、Auto Layout 抱怨、
WebKit 警告——全部直接写 fd 2。从 Finder 双击启动时 fd 2 指向 `/dev/null`，
证据就此消失。启动时把 fd 2 重定向到文件之后，写入由内核完成，不依赖我们的任何
代码还活着，所以**陷阱前的最后一行也能落盘**。

从终端 `swift run` 跑时检测到 tty，不重定向，控制台调试照旧。

## 行格式

```
2026-07-24T00:09:47.998-04:00 [INFO] [app] applicationDidFinishLaunching (restored windows: 1)
             时间戳             级别   分类  正文
```

级别：`DEBUG` < `INFO` < `WARN` < `ERROR` < `FAULT`
分类：`app` `ui` `session` `process` `bridge` `webview` `network` `storage` `crash` `selftest`

默认 release 构建只记 `INFO` 及以上。要开 `DEBUG`：

```bash
defaults write com.leehow.pipiui pipiui.logLevel debug
```

或临时用环境变量 `PIPIUI_LOG_LEVEL=debug`（环境变量优先）。改回来：

```bash
defaults delete com.leehow.pipiui pipiui.logLevel
```

## 复现 bug 的正确姿势

1. 出问题的瞬间按 **`⌥⌘M`**（帮助 → 在日志中打一个标记）。
2. 打开日志文件夹，从 `########## USER MARK` 那行往上读。

打标记会同时写一份当时的窗口/几何快照，所以标记本身就带现场。

## 各类问题看哪几行

**白屏**

```
[ui] ui snapshot t+1.0s: windows=1 visible=1 active=true rootLayouts=2 rootGeometry=1489x851
[ui] scroll sample after session switch t+0.15s: document=500pt visible=3200..4000 (800pt) subviews=3 overshoot=3500 — BLANK signature
```

- `windows=0` 或 `visible=0` → 窗口根本没建出来。
- `rootLayouts=0` → SwiftUI 根视图一次都没布局。
- `rootGeometry` 是 0 或 NaN → 根视图被钉在零尺寸上（会另有一条 `root layout unusable` 的 WARN）。
- `BLANK signature` → 窗口和内容都在，但可视区落在了没有实体行的地方：
  这正是「切进会话先白屏、拖一下滚动条才出字」的指纹。`overshoot` 是可视区超出
  内容底部的距离。

**卡顿 / 滚动打架**

```
[ui] scroll moved without a live-scroll notification (scroller drag or programmatic scrollTo)
```

`StickToBottomTracker` 只在 `didLiveScroll` 时解除贴底，而拖滚动条滑块不发这个
通知。这行出现在流式输出期间，就说明用户在拖滚动条、而贴底逻辑看不见，于是每个
SSE 分片都把视图拽回底部。（需要 `DEBUG` 级别才记。）

**崩溃**

```
[FAULT] [crash] AppKit reported NSException: NSInternalInconsistencyException: …
[FAULT] [crash] Fatal signal SIGTRAP (5)
```

崩溃走三条互补的路：

| 路径 | 抓什么 | 抓不到什么 |
|------|--------|-----------|
| `NSSetUncaughtExceptionHandler` | 未捕获 NSException | AppKit 内部消化掉的异常 |
| `-[NSApplication reportException:]` hook | 事件循环里的 NSException（含 reason） | 显示周期里走 `_crashOnException:` 的 |
| 信号处理（ABRT/SEGV/BUS/ILL/TRAP/FPE） | 调用栈 | 原因文本、`SIGKILL` |
| stderr 文件 | 上面三条漏掉的原因文本 | 无（内核写） |

系统自己的 `.ips` 报告在 `~/Library/Logs/DiagnosticReports/`，里面**没有** exception
reason——那正是这套 hook 存在的理由。

## 代码里怎么写日志

```swift
Log.info("session switch → \(key)", category: .session)
Log.warn("root layout unusable \(metrics.logDescription)", category: .ui)
```

`Log.*` 是异步的，不阻塞主线程。崩溃路径用 `PipiLogger.shared.logSync(...)`。

高频事件（每帧、每分片）记 `DEBUG`，否则 `INFO` 会被淹没。

## 文件一览

| 文件 | 职责 |
|------|------|
| `Log.swift` | 门面，日常只用它 |
| `PipiLogger.swift` | 级别闸门 + 双 sink + 启动头 |
| `FileLogSink.swift` / `OSLogSink.swift` | 文件（按天/轮转） / 统一日志 |
| `StderrCapture.swift` | fd 2 重定向 |
| `CrashReporting.swift` / `AppKitExceptionHook.swift` | 崩溃与异常钩子 |
| `LaunchDiagnostics.swift` | 启动后 t+1s / t+3s 的窗口快照 |
| `ScrollDiagnostics.swift` | 会话切换后的滚动状态、白屏指纹判定 |
| `UIEventLog.swift` | AppKit 窗口/应用生命周期时间线 |
| `RootLayoutMetrics.swift` | 根布局尺寸消毒（纯逻辑，可单测） |
| `LogCommands.swift` | 帮助菜单：打开日志文件夹 / 打标记 |
| `TokenLedger.swift` | per-turn token/用量流水（JSONL，见下） |

## Token 用量排查（`pipiui-token-ledger.jsonl`）

**为什么单独一个文件：** 结构化日志（`pipiui-*.log`）是给人读的，按天切、走级别闸门。
token 用量是机器可读的**事实流水**，要做排行/求和/命中率分析，所以独立成 JSONL，
不切天、不过级别闸门——只要会话跑了就记。软上限 50MB，超过把当前文件 rename 成
`.1`（只保留最近一份备份），不会无限膨胀。

**位置：** `~/Library/Logs/PipiUI/pipiui-token-ledger.jsonl`（帮助菜单 `⇧⌘L` 打开的同一个文件夹）。

**每一行长这样：**

```json
{"ts":"2026-07-24T...","session":"<会话key>","channel":"main","agentId":null,"agentName":null,"depth":0,"model":"xai/grok-4.5:high","turn":3,"input":1234,"output":567,"cacheRead":0,"cacheWrite":890,"cost":0.012,"contextTokens":12345}
```

| 字段 | 含义 |
|------|------|
| `channel` | `main`（主会话）或 `subagent`（子 agent） |
| `agentId` / `agentName` | 仅 subagent 有；main 为 null（被压缩掉不出现） |
| `depth` | subagent 嵌套深度（主会话=0） |
| `turn` | 该会话/agent 内第几个 assistant 轮 |
| `input` / `output` | 本轮输入/输出 token |
| `cacheRead` / `cacheWrite` | prompt cache 命中读 / 写入 token |
| `cost` | 本轮成本（美元） |
| `contextTokens` | 本轮结束时累计上下文 token |

**两条数据来源（互为对称，覆盖全链路）：**

- **主会话**：`ChatSession.handleEvent` 的 `message_end` 分支解析 `message.usage`（`pi`
  在该事件里带 usage，与 subagent 用的同一套）。
- **subagent**：`PiExt/subagent/index.ts` 的 `message_end` 里 `pipiuiReport({kind:"usage"})`
  → 经 bridge → `SubagentStore.handle` 的 `case "usage"` 落盘。

> ⚠️ 首次排查时如果**只看到 subagent 行、没有 main 行**：说明主会话的 `pi` 不在
> `message_end` 里发 usage。降级方案是在 `applySessionStats` 里按 settle 级写快照。
> 先看实际数据再决定要不要降级。

### 常用 jq 一行命令

```bash
cd ~/Library/Logs/PipiUI

# 按成本排行 top agent（subagent 维度）
jq -s 'map(select(.channel=="subagent"))
      | group_by(.agentName)
      | map({agent: .[0].agentName, cost: (map(.cost)|add), turns: length,
             input: (map(.input)|add), output: (map(.output)|add)})
      | sort_by(-.cost) | .[]' pipiui-token-ledger.jsonl

# 主会话 vs subagent 总成本占比
jq -s 'group_by(.channel)
      | map({channel: .[0].channel, cost: (map(.cost)|add)})
      | .[]' pipiui-token-ledger.jsonl

# cache 命中率（越低越浪费：每次都在重发未缓存的 input）
jq -s 'map(select(.channel=="subagent"))
      | {cacheRead: (map(.cacheRead)|add),
         input: (map(.input)|add),
         hitRate: ((map(.cacheRead)|add) / (((map(.cacheRead)|add) + (map(.input)|add))))}' \
   pipiui-token-ledger.jsonl

# 某个会话每轮 input 走势（看是否逐轮暴涨 → 上下文膨胀）
jq -c 'select(.channel=="main" and .session=="<会话key>") | {turn, input, contextTokens}' \
   pipiui-token-ledger.jsonl

# 哪个会话最费
jq -s 'group_by(.session)
      | map({session: .[0].session, cost: (map(.cost)|add)})
      | sort_by(-.cost) | .[]' pipiui-token-ledger.jsonl
```

### 排查思路

跑一段真实工作流后，按这个顺序看数据，**不要先猜**：

1. **main vs subagent 成本占比** —— 如果 subagent 占 80%+，问题在派发策略（Boss 模式 /
   每个 subagent 开独立上下文 / 并行 fan-out），不在主会话。
2. **按 agent 成本排行** —— 哪个 agent 最烧？是 `explore` 并行太多，还是 `general-purpose`
   单个轮数过多？
3. **cache 命中率** —— subagent 是独立 `pi` 进程，每次都冷启动上下文，cache 命中率天然低。
   如果低得离谱（<20%），说明大量 token 在重复发未缓存的 system prompt + tool schema。
4. **主会话每轮 input 走势** —— 如果逐轮线性暴涨，是上下文累积（`[subagent-done]` 消息
   不断注入主会话，之后每轮重发）。
