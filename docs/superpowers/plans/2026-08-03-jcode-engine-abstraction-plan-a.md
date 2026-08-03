# 引擎抽象重构（jcode 双引擎 Plan A：抽 AgentSessionBackend）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `ChatSession` 对 `PiProcess` 的直接依赖抽成一个 `AgentSessionBackend` 协议（用现有 `J` 类型），让 `PiProcess` 符合该协议，`ChatSession` 改持 `any AgentSessionBackend`。**零功能变化、零行为变化**——所有 pi 专属 RPC（`get_state`/`get_messages`/`prompt`/`fork` 等）和 `handleEvent(J)` 入口一字不动。这是为后续 jcode 后端铺路的纯结构重构。

**Architecture:** 引入 `protocol AgentSessionBackend`（`onEvent`/`onExit`/`isRunning` + `send`/`request`/`terminate`/`signalDescendants`/`forceKill`，签名与 `PiProcess` 现有公共方法逐一对应）。`PiProcess` 通过 extension 符合协议（不改任何方法体）。`ChatSession` 把 `private var proc: PiProcess?` 换成 `private var backend: (any AgentSessionBackend)?`，并把所有 `proc` 引用点机械替换为 `backend`，`PiProcess(...)` 构造点改成 `PiProcess(...) as? any AgentSessionBackend`（或保留具体类型构造再向上转型）。`handleEvent(_ e: J)` 及整套测试**完全不动**——这是本计划零回归的关键。

**Tech Stack:** Swift 6.3 · SwiftUI macOS 14+ · SwiftPM XCTest · 现有 `J`（`Sources/PipiUI/J.swift`，`package struct`）· 现有 `ChatSession` 测试基础设施（`blockedReason:` 无进程构造 + `@testable handleEvent(J)` 驱动）。

**Spec:** `docs/superpowers/specs/2026-08-03-jcode-engine-backend-design.md`（approved）。本计划实现 spec 的"AgentSessionBackend 协议"部分；协议方法集用 `J` 而非新的 `BackendEvent` 枚举（用户已批准此调整，见决策记录）。

## Global Constraints

- **零功能变化、零行为变化。** 这是纯结构重构。不允许改变任何 RPC 命令的语义、事件处理的逻辑分支、进程终止的时序、错误信息的文案。任何"顺手改进"都拒绝。
- **`handleEvent(_ e: J)` 一行不动。** 它是现有全套测试（`SubagentNotificationTimingTests`/`StopEscalationTests`/`StreamingVisibilityTests`/`CompactionLifecycleTests` 等）的驱动入口；动了它 = 大回归。pi 专属的事件 switch（`agent_start`/`message_end`/`tool_execution_*`/`compaction_*` 等分支）整体留在 `ChatSession` 里，**不**搬到 backend。
- **协议方法集必须与 `PiProcess` 现有公共方法逐一对应，不多不少。** 具体是：`onEvent`/`onExit`（属性）、`isRunning`（属性）、`send(_:failure:)`/`request(_:completion:)`/`terminate()`/`signalDescendants(_:)`/`forceKill()`（方法）。这是为了让 `PiProcess` 符合协议时零方法体改动——只加 extension 声明，不改任何 `{ }`。
- **协议用 `J` 类型，不引入 `BackendEvent` 枚举。** 用户已批准：让 `JcodeBackend`（Plan B）逆向翻译成 pi 兼容事件，换取本计划（Plan A）的超低风险。
- **唯一允许新建的源文件：`Sources/PipiUI/AgentSessionBackend.swift`。** 其余改动全部在现有文件内。不新建 PiBackend.swift——`PiProcess` 自己符合协议即充当 pi 后端。
- **不改任何 `.md` 文档（本计划文件除外）、不改 `Package.swift`、不改任何 TS/JS、不改 `make-app.sh`/`scripts/`、不碰 `PiExt/`。**
- **验证命令是 `swift test`。** 见下文"验证"节。本计划**不**做 `build/PipiUI.app` 打包（按 AGENTS.md，那是 Plan 全部完成后的最后步骤）。
- **每个任务结束都要 `swift test` 全绿 + commit。** 频繁提交是硬要求，便于回退。
- **`ChatSession.init` 的 17 个 pi 扩展参数在本计划中不动。** 引擎分叉（`engineKind`）是 Plan A 的最后一个任务，且只加字段与默认值，不改构造分叉逻辑——真正的 `.jcode` 分叉留给 Plan B。

## 验证

每个任务的"Run test"步骤统一用：

```
swift test
```

如果 XCTest 在该环境不可用，回退到 `swift build` + `swift run PipiUITestRunner`（见 `scripts/build-app.sh:32` 注释）。但首选 `swift test`。**全绿才能进下一步。**

回归基线：在 Task 1 之前，先跑一次 `swift test` 记录基线通过数。任何任务后通过数**不得下降**（新增测试可以增加通过数）。

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/AgentSessionBackend.swift` | **新建。** 只放 `protocol AgentSessionBackend: AnyObject` 声明（属性 + 方法签名），无实现。 |
| `Sources/PipiUI/PiProcess.swift` | 加一个 `extension PiProcess: AgentSessionBackend {}`（空 extension，因为方法已存在且签名匹配）。**不改任何方法体。** |
| `Sources/PipiUI/ChatSession.swift` | 把 `private var proc: PiProcess?` → `private var backend: (any AgentSessionBackend)?`；机械替换所有 `proc` 引用为 `backend`；`PiProcess(...)` 构造点加向上转型；加 `EngineKind` 枚举与 `engineKind` 字段（最后一任务，默认 `.pi`）。`handleEvent`/`applyState`/`ingest`/`convert` 等**不动**。 |
| `Tests/PipiUITests/AgentSessionBackendTests.swift` | **新建。** 验证协议契约：`PiProcess` 符合协议（编译期保证）；一个 `FakeBackend` 傀儡实现，验证 `ChatSession` 能在无进程时被傀儡 backend 驱动 `onEvent` 路径。 |

## Shared interfaces (read before any task)

`J`（`Sources/PipiUI/J.swift`，**已存在，不改**）：
- `package struct J`，值类型，`init(_ raw: Any?)`、`static func parse(_ data: Data) -> J?`。
- 下标：`e["type"]` → `J`（永非 optional，缺键返 `J(nil)`）；`.string`/`.bool`/`.int`/`.double` → optional；`.array` → `[J]` 非空默认。
- 构造：`J(["type":"response", "id":id, "success":false])`。

`PiProcess`（`Sources/PipiUI/PiProcess.swift`，**已存在，Plan A 不改方法体**）现有公共面（这是协议要照抄的签名）：
```swift
final class PiProcess {
    var onEvent: ((J) -> Void)?            // PiProcess.swift:16
    var onExit: ((Int32, String) -> Void)?  // PiProcess.swift:17
    private(set) var isRunning: Bool        // PiProcess.swift:14
    init?(cwd: URL, arguments: [String], extraEnv: [String: String] = [:])  // PiProcess.swift:45
    func send(_ object: [String: Any], failure: (() -> Void)? = nil)        // PiProcess.swift:176
    func request(_ object: [String: Any], completion: ((J) -> Void)? = nil) // PiProcess.swift:203
    func terminate()                        // PiProcess.swift:218
    func signalDescendants(_ sig: Int32)    // PiProcess.swift:240
    func forceKill()                        // PiProcess.swift:249
}
```
**注意 `init?` 是可失败的**——协议里的构造要求要照搬这个可失败性。

`ChatSession` 现有 `proc` 引用点（grep 出的全部，本计划要逐一替换）：
- `:868` 声明 `private var proc: PiProcess?`
- `:1106` `guard let proc = PiProcess(cwd:arguments:extraEnv:)` 构造
- `:1114-1115` `self.proc = proc; proc.onEvent = ...; proc.onExit = ...`
- `:1115` `proc.onEvent = { ... handleEvent }`
- `:1116-1150` `proc.onExit = { ... }`
- `:1291,1294,1306,1330` `proc?.request([...])`（loadInitialState / get_messages）
- `:1320` `guard proc != nil`
- `:1527` `proc?.request(["type":"get_available_thinking_levels"])`
- `:2813,2819,2853,2862,2908,2913,2934,3108,3192,3261,3267,3725,3794,3800,3876,4029,4271,4300,4307` 其余 `proc`/`proc?` 引用（abort/shutdown/branchFromAssistant/reloadTranscript/abortSubagent 等）

**规则：所有这些点的 `proc` 一律换成 `backend`，语义不变。** `guard let proc = PiProcess(...)` → `guard let piBackend = PiProcess(...) else {...}; backend = piBackend`（保留具体类型构造，赋值时向上转型为 `any AgentSessionBackend`）。

---

### Task 1: 记录回归基线

**Files:**
- 无改动。

**Interfaces:**
- Consumes: 无。
- Produces: 一个已知的 `swift test` 通过数基线，供后续任务对照。

- [ ] **Step 1: 跑全量测试记录基线**

Run: `swift test 2>&1 | tail -20`
Expected: 全绿。记录 `Executed N tests, with 0 failures` 里的 `N`。后续每个任务的 `N` 必须 ≥ 这个基线值。

如果当前工作树本身有未通过测试（不应发生，但若发生），停下并报告——不要在一个红色基线上开始重构。

- [ ] **Step 2: 不 commit（无文件改动）**

---

### Task 2: 新建 AgentSessionBackend 协议文件

**Files:**
- Create: `Sources/PipiUI/AgentSessionBackend.swift`

**Interfaces:**
- Consumes: `J`（`Sources/PipiUI/J.swift`）。
- Produces: `protocol AgentSessionBackend: AnyObject`，签名与 `PiProcess` 现有公共方法逐一对应。

- [ ] **Step 1: 写协议文件**

Create `Sources/PipiUI/AgentSessionBackend.swift`：

```swift
import Foundation

/// Engine-agnostic backend for one agent session. `PiProcess` conforms today;
/// a future `JcodeBackend` (driving `jcode api-bridge` over NDJSON) will conform
/// the same way. `ChatSession` holds `any AgentSessionBackend` and routes its
/// `onEvent`/`onExit` plus the request/terminate methods uniformly.
///
/// Method signatures mirror `PiProcess` exactly so the pi path needs no method
/// body changes — `PiProcess` satisfies this protocol by an empty extension.
/// The protocol deliberately keeps the `J` dynamic-JSON type (not a typed
/// `BackendEvent` enum) so the existing `handleEvent(_ e: J)` entry point and
/// its full test suite stay byte-for-byte unchanged. A non-pi backend is
/// expected to translate its native events into pi-compatible `J` shapes before
/// invoking `onEvent`.
protocol AgentSessionBackend: AnyObject {
    /// Streaming/event delivery (callbacks fire on the main thread).
    var onEvent: ((J) -> Void)? { get set }

    /// Process-exit delivery (callback fires on the main thread).
    var onExit: ((Int32, String) -> Void)? { get set }

    /// Whether the backing process is alive.
    var isRunning: Bool { get }

    /// Send a raw command without waiting for the response.
    /// `failure` runs on the main thread if the process is dead or the write fails.
    func send(_ object: [String: Any], failure: (() -> Void)?)

    /// Send a command with an auto-generated id; completion runs on the main thread.
    func request(_ object: [String: Any], completion: ((J) -> Void)?)

    /// Graceful stop: signal the process and any descendant subagent processes.
    func terminate()

    /// Best-effort signal to descendant processes only — never the main process itself.
    func signalDescendants(_ sig: Int32)

    /// Last-resort kill when a graceful terminate does not exit in time.
    func forceKill()
}
```

**关键点：协议没有 `init`。** 构造留给具体类型（`PiProcess.init?`），`ChatSession` 用具体类型构造再向上转型。这样协议不被可失败构造拖累，也避免 `any AgentSessionBackend` 上调 `init` 的existential 限制。

注意 `send`/`request` 的默认参数**不进协议**（协议要求不能满足默认参数值的差异）。`PiProcess` 的具体方法保留默认参数（`failure: (() -> Void)? = nil` / `completion: ((J) -> Void)? = nil`），符合协议时 Swift 允许具体方法有默认参数而协议要求无默认——调用点 `proc?.request([...])` 仍能省略 completion。

- [ ] **Step 2: 跑测试验证协议编译且无回归**

Run: `swift test 2>&1 | tail -20`
Expected: 与 Task 1 基线相同的 `N` tests, 0 failures。协议文件只是新增类型声明，无任何调用点引用它，不会影响行为。

- [ ] **Step 3: Commit**

```bash
git add Sources/PipiUI/AgentSessionBackend.swift
git commit -m "refactor(backend): add AgentSessionBackend protocol mirroring PiProcess

Pure structural prep for the jcode dual-engine work (spec
2026-08-03-jcode-engine-backend-design). Defines an engine-agnostic
backend protocol whose signatures match PiProcess exactly, so a later
empty extension can make PiProcess conform with zero method-body
changes. No call sites reference it yet; behavior unchanged."
```

---

### Task 3: 让 PiProcess 符合协议（空 extension）

**Files:**
- Modify: `Sources/PipiUI/PiProcess.swift`（仅加 extension，**不改任何方法体**）

**Interfaces:**
- Consumes: `AgentSessionBackend`（Task 2）。
- Produces: `PiProcess: AgentSessionBackend`（编译期可见），使 `any AgentSessionBackend` 可承接 `PiProcess` 实例。

- [ ] **Step 1: 在 PiProcess.swift 末尾加空 extension**

在 `Sources/PipiUI/PiProcess.swift` 的 `final class PiProcess { ... }` 闭合大括号（`:276` 的 `}`）**之后**、文件末尾，追加：

```swift
/// PiProcess satisfies `AgentSessionBackend` with no changes: every protocol
/// requirement (`onEvent`/`onExit`/`isRunning`/`send`/`request`/`terminate`/
/// `signalDescendants`/`forceKill`) already exists on this class with a matching
/// signature. This empty extension only declares conformance.
extension PiProcess: AgentSessionBackend {}
```

- [ ] **Step 2: 跑测试验证符合性编译且无回归**

Run: `swift test 2>&1 | tail -25`
Expected: 编译通过（若签名不匹配，编译器会在此报错——这正是本步骤的回归保障）。测试数仍为基线 `N`，0 failures。

**如果编译失败**：说明协议签名与 `PiProcess` 实际签名不一致。**不要改 PiProcess 的方法体去迁就协议**——回去修 `AgentSessionBackend.swift` 的签名（Task 2），让它严格匹配 `PiProcess` 现状。本计划的原则是 PiProcess 一字不改。

- [ ] **Step 3: Commit**

```bash
git add Sources/PipiUI/PiProcess.swift
git commit -m "refactor(backend): PiProcess conforms to AgentSessionBackend

Empty extension only — no method bodies change. The protocol was
authored to match PiProcess's existing public surface exactly, so this
is a compile-time declaration of an already-satisfied contract."
```

---

### Task 4: 新建 FakeBackend 傀儡 + 协议契约测试

**Files:**
- Create: `Tests/PipiUITests/AgentSessionBackendTests.swift`

**Interfaces:**
- Consumes: `AgentSessionBackend`（Task 2）、`J`、`ChatSession` 的无进程构造（`blockedReason:`）。
- Produces: 一个可复用的 `FakeBackend`（record-only 傀儡），供本任务和 Plan B 复用；验证协议可被非-PiProcess 类型实现。

**为什么这一步在改 ChatSession 之前**：先证明"协议可以被一个非 PiProcess 的东西实现并驱动 onEvent"，这样 Task 5 改 `ChatSession` 持有 `any AgentSessionBackend` 时，回归保护已经就位（FakeBackend 能驱动事件流）。先有测试网再动主代码。

- [ ] **Step 1: 写失败测试**

Create `Tests/PipiUITests/AgentSessionBackendTests.swift`：

```swift
import XCTest
@testable import PipiUI

/// Record-only AgentSessionBackend stand-in. No real process. Used to prove the
/// protocol can be satisfied by something other than PiProcess, and (in Plan B)
/// to drive ChatSession's event path without spawning pi.
final class FakeBackend: AgentSessionBackend {
    var onEvent: ((J) -> Void)?
    var onExit: ((Int32, String) -> Void)?
    var isRunning = true

    private(set) var sent: [[String: Any]] = []
    private(set) var requested: [[String: Any]] = []
    private(set) var terminateCount = 0
    private(set) var signalDescendantsCalls: [Int32] = []
    private(set) var forceKillCount = 0

    func send(_ object: [String: Any], failure: (() -> Void)?) {
        sent.append(object)
    }
    func request(_ object: [String: Any], completion: ((J) -> Void)?) {
        requested.append(object)
        // No response is fine for the contract test; callers that need a
        // response will set up their own completion handling.
    }
    func terminate() { terminateCount += 1; isRunning = false }
    func signalDescendants(_ sig: Int32) { signalDescendantsCalls.append(sig) }
    func forceKill() { forceKillCount += 1; isRunning = false }
}

final class AgentSessionBackendTests: XCTestCase {

    /// PiProcess must satisfy the protocol (compile-time guarantee; this test
    /// exists so a future signature drift is caught as a test failure, not just
    /// a build break scattered elsewhere).
    func testPiProcessConformsToAgentSessionBackend() {
        // The cast through the protocol existential is the assertion. If
        // PiProcess stopped conforming, this line would not compile.
        let asBackend: (any AgentSessionBackend)? = PiProcess.self as? any AgentSessionBackend.Type
        XCTAssertNotNil(asBackend)
    }

    /// A non-PiProcess type can implement the protocol and route calls.
    func testFakeBackendRecordsCalls() {
        let fake = FakeBackend()
        var receivedEvents: [J] = []
        fake.onEvent = { receivedEvents.append($0) }
        fake.request(["type": "ping"], completion: nil)
        fake.send(["type": "abort"], failure: nil)
        fake.signalDescendants(15)
        fake.terminate()
        fake.forceKill()

        XCTAssertEqual(fake.requested.count, 1)
        XCTAssertEqual(fake.requested.first?["type"] as? String, "ping")
        XCTAssertEqual(fake.sent.count, 1)
        XCTAssertEqual(fake.signalDescendantsCalls, [15])
        XCTAssertEqual(fake.terminateCount, 1)
        XCTAssertEqual(fake.forceKillCount, 1)
        XCTAssertFalse(fake.isRunning)

        // onEvent wiring is invocable (this is exactly what ChatSession will rely on).
        fake.onEvent?(J(["type": "agent_start"]))
        XCTAssertEqual(receivedEvents.count, 1)
        XCTAssertEqual(receivedEvents[0]["type"].string, "agent_start")
    }
}
```

- [ ] **Step 2: 跑测试验证它失败（编译失败也算）**

Run: `swift test --filter AgentSessionBackendTests 2>&1 | tail -25`
Expected: 如果 Task 2/3 正确，这两条测试应当**直接通过**（因为协议已存在、PiProcess 已符合、FakeBackend 是新写的且自洽）。本步骤的价值是**确认编译链路通**：`@testable import PipiUI` 能看到 `AgentSessionBackend` 和 `J`。

如果失败：检查 `AgentSessionBackend.swift` 是否在 `Sources/PipiUI/` 下、`PiProcess` 的 extension 是否在 Task 3 加上。

- [ ] **Step 3: 跑全量测试确认无回归**

Run: `swift test 2>&1 | tail -20`
Expected: 基线 `N` + 2（新增 2 条测试），0 failures。

- [ ] **Step 4: Commit**

```bash
git add Tests/PipiUITests/AgentSessionBackendTests.swift
git commit -m "test(backend): AgentSessionBackend contract + FakeBackend stub

Proves (1) PiProcess conforms to the protocol, and (2) a non-PiProcess
type can implement it and route send/request/terminate/onEvent calls.
FakeBackend is reusable scaffolding for Plan B (jcode backend) and any
future offline ChatSession driving."
```

---

### Task 5: ChatSession.proc → backend（机械替换，单次提交）

这是本计划最大的任务。`ChatSession.swift` 里 `proc` 引用点有 ~25 处（见 Shared interfaces 清单）。

**重要：为什么不分批提交。** `proc` 是单一存储属性标识符。把它重命名为 `backend` 是原子操作——改一半必然留下未定义符号的编译错误，中间态无法通过 `swift test`。所以本任务**一次性改完所有引用点，单次 `swift test`，单次 commit**。下文按"编辑顺序"组织成 5a/5b/5c/5d 四组只是为了让人逐区域核对不遗漏，**不是**可独立验证的阶段。全部改完后跑一次测试。

回归保护来自：① `handleEvent(_ e: J)` 及其全套测试一字不动（Task 5 全程不碰它）；② `FakeBackend`（Task 4）已证明协议可被非 PiProcess 类型实现。如果替换引入行为差异，现有测试套件（`SubagentNotificationTimingTests`/`StopEscalationTests`/`StreamingVisibilityTests`/`CompactionLifecycleTests` 等）会捕获。

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift`

**Interfaces:**
- Consumes: `AgentSessionBackend`（Task 2）、`PiProcess: AgentSessionBackend`（Task 3）。
- Produces: `ChatSession.backend: (any AgentSessionBackend)?`，所有原 `proc` 调用点改为 `backend`，行为完全等价。

**总原则**：
- `private var proc: PiProcess?` → `private var backend: (any AgentSessionBackend)?`
- 凡是 `proc?.request(...)` / `proc?.send(...)` / `proc?.isRunning` / `proc?.signalDescendants(...)` / `proc?.forceKill()` → 把 `proc` 换成 `backend`，其余语法不动。
- 凡是 `guard let proc = PiProcess(...)` / `guard let proc else` / `guard proc != nil` → 见各批次的精确替换。
- **不动** `handleEvent` / `applyState` / `ingest` / `convert` / `buildTranscript` 任何一行。

#### 编辑组 5a：声明与构造点

- [ ] **Step 5a.1: 改声明 + 构造 + onEvent/onExit 绑定**

定位 `Sources/PipiUI/ChatSession.swift:868`：
```swift
private var proc: PiProcess?
```
改为：
```swift
private var backend: (any AgentSessionBackend)?
```

定位 `Sources/PipiUI/ChatSession.swift:1104-1153` 的 `startProcess`。当前（节选）：
```swift
private func startProcess(arguments: [String], environment: [String: String]) {
    guard !processStartCancelled, proc == nil else { return }
    guard let proc = PiProcess(cwd: projectURL, arguments: arguments, extraEnv: environment) else {
        let message = "找不到 pi 可执行文件（试过 ~/.npm-global/bin、/opt/homebrew/bin 等）"
        lastError = message
        notifyError(message)
        processAlive = false
        isInitializing = false
        return
    }
    self.proc = proc
    proc.onEvent = { [weak self] event in self?.handleEvent(event) }
    proc.onExit = { [weak self] code, stderr in
        ...
    }
    ...
}
```
改为（只动 proc→backend 相关行，`onExit` 闭包体内容**原样保留**，本步骤不展示整个闭包）：
```swift
private func startProcess(arguments: [String], environment: [String: String]) {
    guard !processStartCancelled, backend == nil else { return }
    guard let proc = PiProcess(cwd: projectURL, arguments: arguments, extraEnv: environment) else {
        let message = "找不到 pi 可执行文件（试过 ~/.npm-global/bin、/opt/homebrew/bin 等）"
        lastError = message
        notifyError(message)
        processAlive = false
        isInitializing = false
        return
    }
    // Construct as the concrete PiProcess, then store as the existential
    // `any AgentSessionBackend`. Local `proc` keeps concrete type so the
    // optional-binding above and the closure captures stay unchanged.
    backend = proc
    proc.onEvent = { [weak self] event in self?.handleEvent(event) }
    proc.onExit = { [weak self] code, stderr in
        ...（原样，不动）
    }
    ...
}
```
**关键**：本地变量 `proc`（`guard let proc = PiProcess(...)`）保持名字和具体类型不变——它仍是 `PiProcess`。只有存储属性 `self.proc` → `self.backend`。这样 `proc.onEvent`/`proc.onExit` 闭包绑定完全不动。

- [ ] **（不单独验证，继续 5b）**

到此处 5a 完成。但因为 `proc` 标识符在 5b/5c/5d 区域仍被引用，此刻无法编译。**不要**单独跑测试——继续往下改完 5b/5c/5d，最后在 5d.2 一次性验证。

- [ ] **Step 5b.1: loadInitialState / beginInitialMessagesLoad / refreshThinkingLevels（pi 通用 RPC 路径）**

把 `Sources/PipiUI/ChatSession.swift:1291,1294,1306,1320,1330,1527` 的 `proc` 全部换成 `backend`。具体：

`:1290-1311` `loadInitialState()` 内：
- `proc?.request(["type": "get_state"])` → `backend?.request(["type": "get_state"])`
- `proc?.request(["type": "get_available_models"])` → `backend?.request(["type": "get_available_models"])`
- `proc?.request(["type": "get_commands"])` → `backend?.request(["type": "get_commands"])`

`:1314-1327` `beginInitialMessagesLoad()` 内：
- `guard proc != nil else {` → `guard backend != nil else {`
- `proc?.request(["type": "get_messages"])` → `backend?.request(["type": "get_messages"])`

`:1527` `refreshThinkingLevels()` 内：
- `proc?.request(["type": "get_available_thinking_levels"])` → `backend?.request(["type": "get_available_thinking_levels"])`

- [ ] **（不单独验证，继续 5c）**

5b 涉及的行已改完。仍因 5c/5d 未改而无法编译——继续。

#### 编辑组 5c：分支/编辑/fork（pi 专属 RPC，但通过 backend 走）

- [ ] **Step 5c.1: branchFromAssistant / reloadTranscriptAfterSessionReplace / edit-fork 路径**

这些方法里用 `guard let proc else`（具体类型解包）。换成 `guard let backend else`——因为协议不暴露具体类型，但 `request` 方法在协议里，所以解包成 `any AgentSessionBackend` 即可继续 `.request`。具体行：`:2813,2819,2853,2862,2908,2913,2934,3108,3192,3261,3267`。

举例，`:2813`（`branchFromAssistant`）当前：
```swift
guard let proc else {
    flash("pi 未运行，无法创建分支")
    return
}
...
proc.request(["type": "get_entries"]) { ... }
```
改为：
```swift
guard let backend else {
    flash("pi 未运行，无法创建分支")
    return
}
...
backend.request(["type": "get_entries"]) { ... }
```

`:3261`（`reloadTranscriptAfterSessionReplace`）当前：
```swift
guard let proc else {
    completion("pi 未运行，无法刷新会话")
    return
}
proc.request(["type": "get_messages"]) { ... }
```
改为：
```swift
guard let backend else {
    completion("pi 未运行，无法刷新会话")
    return
}
backend.request(["type": "get_messages"]) { ... }
```

**关键**：这些 `guard let proc` 原本解包成 `PiProcess`（具体类型），现在解包成 `any AgentSessionBackend`。后续调用的 `.request` 在协议里，所以等价。`guard let proc` 的变量名也可顺手改成 `backend`（它已经是属性名，shadowing 后局部 `backend` 就是解包值）——但这不是必须，只要 `proc.request` → `backend.request`。

对**每一处** `proc.request` / `proc?.request`，机械替换为 `backend.request` / `backend?.request`。错误文案里的"pi"字样**不动**（这是 Plan A 的范围外，文案归 Plan B 或专门任务）。

- [ ] **（不单独验证，继续 5d）**

5c 涉及的行已改完。仍因 5d 未改而无法编译——继续。

#### 编辑组 5d：abort / shutdown / abortSubagent（终止与信号路径）

- [ ] **Step 5d.1: 替换 abort / shutdown / abortSubagent 里的 proc 引用**

行：`:3725,3794,3800,3876,4029,4271,4300,4307`。

`:3794`（`abort`）当前：`proc?.send(["type": "abort"])` → `backend?.send(["type": "abort"], failure: nil)`
**注意**：协议的 `send` 没有默认参数（见 Task 2 说明），所以通过 `any AgentSessionBackend` 调用时**必须显式传 `failure: nil`**。`PiProcess` 具体调用时可省略，但 existential 调用不行。这是唯一的非纯机械替换点。

`:3800`（`abort`）当前：`if proc?.isRunning == true {` → `if backend?.isRunning == true {`（`isRunning` 在协议里，无默认参数问题）。

`:3876`（停止升级里的 signalDescendants）当前：`proc?.signalDescendants(sig)` → `backend?.signalDescendants(sig)`

`:4029`（shutdown 的 forceKill 兜底）当前：`proc?.forceKill()` → `backend?.forceKill()`

`:3725`（sendPromptNow 的 prompt RPC）当前：
```swift
proc?.request(cmd) { [weak self] resp in ... }
```
→ `backend?.request(cmd) { [weak self] resp in ... }`（闭包体原样）

`:4271,4300,4307`（abortSubagent/reload 的 slash 命令 prompt + get_commands）：
```swift
proc.request(["type": "prompt", "message": "/subagent_abort \(agentId)"]) { ... }
proc.request(["type": "prompt", "message": "/pipiui_reload"]) { ... }
proc.request(["type": "get_commands"]) { ... }
```
这些在 `proc` 已解包的作用域里（`guard let proc` 在更上层，5c 已改）。如果上层 `guard let proc` 改成了 `guard let backend`，这里的 `proc.request` 也要改成 `backend.request`。逐一检查 5c 改过的每个方法体内部是否还有遗漏的 `proc.`。

- [ ] **Step 5d.2: 跑全量测试（关键回归点）**

Run: `swift test 2>&1 | tail -30`
Expected: **全绿，编译通过**，基线 N + 2，0 failures。这是整个 Plan A 的回归闸门——所有 pi 行为都通过这一步验证。

**如果失败**：
- 类型不匹配错误 → 检查 Task 2 协议签名是否与 PiProcess 一致。
- 测试断言失败 → **不要改测试**，说明替换引入了行为差异，逐一对照 5a-5d 的改动，找出哪个 `proc` → `backend` 改变了语义（最可能的是 `send` 的 `failure: nil` 显式传参遗漏，或某处 `guard let proc` 解包后类型变了导致下游推断不同）。

- [ ] **Step 5d.3: 全文搜 proc 残留**

Run: `grep -n '\bproc\b' Sources/PipiUI/ChatSession.swift`
Expected: **零命中**（或仅剩注释里的"pi process"字样，那些可保留或顺手改注释）。任何代码里的 `proc` 都必须在 5a-5d 改干净。

- [ ] **Step 5d.4: Commit**

```bash
git add Sources/PipiUI/ChatSession.swift
git commit -m "refactor(session): ChatSession holds any AgentSessionBackend, not PiProcess

All proc references → backend. PiProcess still backs every session
(constructed in startProcess and stored as the existential). Behavior is
unchanged: every RPC command, event path, and termination sequence is
identical. The handleEvent(_ e: J) entry point and full test suite are
untouched. This is the structural prerequisite for a second (jcode)
backend conforming to the same protocol."
```

---

### Task 6: 加 EngineKind 枚举与 engineKind 字段（默认 .pi，不改构造分叉）

这是 Plan A 的收尾。加字段、默认 pi、让 `SessionMeta` 能承载它——但**不**在 init 里做任何 `.jcode` 分叉（那是 Plan B 的事）。目的是让数据模型先就位，Plan B 只需加构造分支而不用再动模型层。

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift`（加 `EngineKind` 枚举 + `engineKind` 存储属性 + init 参数）
- Modify: `Sources/PipiUI/AppStore.swift`（`SessionMeta` 加 `engineKind` 字段；`makeSession`/`createSessionInBackground` 透传）

**Interfaces:**
- Consumes: 无新依赖。
- Produces: `ChatSession.engineKind: EngineKind`（默认 `.pi`）；`SessionMeta.engineKind`（默认 `.pi`）。

- [ ] **Step 1: 在 ChatSession 加 EngineKind**

在 `Sources/PipiUI/ChatSession.swift` 靠近顶部（与其他顶层类型如 `ChatItem`/`ChatBlock` 同区，约 `:390` 附近）加：

```swift
/// Which agent engine backs a session. Pinned at creation; switching means
/// starting a new session. Plan A only ever produces `.pi`; `.jcode` arrives in
/// Plan B (JcodeBackend).
enum EngineKind: String {
    case pi
    case jcode
}
```

在 `ChatSession` 的存储属性区（`id`/`projectURL` 旁，约 `:641-655`）加：
```swift
let engineKind: EngineKind
```

在 `init(...)`（`:934`）的参数列表末尾加（带默认值，保证现有调用点不破）：
```swift
engineKind: EngineKind = .pi,
```
并在 init 体里（`self.id = id` 等赋值区）加 `self.engineKind = engineKind`。

- [ ] **Step 2: SessionMeta 加 engineKind**

`Sources/PipiUI/AppStore.swift:5-20` 的 `struct SessionMeta`。当前：
```swift
struct SessionMeta: Identifiable, Hashable {
    let path: String
    let name: String
    let modified: Date
    var modelRef: String?
    ...
}
```
加字段（带默认值，不破现有构造）：
```swift
struct SessionMeta: Identifiable, Hashable {
    let path: String
    let name: String
    let modified: Date
    var modelRef: String?
    var engineKind: ChatSession.EngineKind = .pi
    ...
}
```
（如果 `SessionMeta` 与 `ChatSession` 不在同一 module 可见性下，`EngineKind` 需要 `package` 访问级别——把 Task 6 Step 1 的 `enum EngineKind` 标 `package`。）

- [ ] **Step 3: makeSession/createSessionInBackground 透传 engineKind**

`Sources/PipiUI/AppStore.swift:1789` `createSessionInBackground` 当前签名：
```swift
func createSessionInBackground(
    project: URL,
    taskNotificationMode: SessionTaskNotificationMode = .standard
) -> (key: String, session: ChatSession) {
```
加参数：
```swift
func createSessionInBackground(
    project: URL,
    engine: ChatSession.EngineKind = .pi,
    taskNotificationMode: SessionTaskNotificationMode = .standard
) -> (key: String, session: ChatSession) {
```
透传到 `makeSession` → `ChatSession.init`。`makeSession` 的签名也加 `engine: ChatSession.EngineKind = .pi` 并透传。

**`SessionMeta` 的磁盘解析**：`AppStore.refreshSessions`（`:1499`）目前从 `.jsonl` 尾部解析 `modelRef`。`engineKind` 的磁盘持久化（解析 `engine_kind` 行、为乐观新建会话兜底默认 `.pi`）**留给 Plan B 或专门任务**——本计划只让内存模型和构造链就位，所有现有会话默认 `.pi`，行为不变。在 `refreshSessions` 构造 `SessionMeta` 处显式写 `engineKind: .pi`（默认值），确保不依赖未来磁盘字段。

- [ ] **Step 4: 跑全量测试**

Run: `swift test 2>&1 | tail -25`
Expected: 基线 N + 2，0 failures。新字段全默认 `.pi`，无行为变化。

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/ChatSession.swift Sources/PipiUI/AppStore.swift
git commit -m "feat(session): add EngineKind field (defaults to .pi, no fork yet)

Data-model prep for the jcode dual-engine work. ChatSession and
SessionMeta gain an engineKind field that always defaults to .pi in
Plan A, so every existing session and code path is unchanged. The
actual .jcode construction fork is Plan B; this commit only ensures the
plumbing (field, init param, makeSession/createSessionInBackground
threading) exists so Plan B can add the fork without touching the model
layer again."
```

---

### Task 7: Plan A 收尾验证

**Files:** 无改动。

- [ ] **Step 1: 全量测试最终确认**

Run: `swift test 2>&1 | tail -20`
Expected: 基线 N + 2，0 failures。

- [ ] **Step 2: 确认 pi 路径完整（编译 + 无 proc 残留）**

Run: `grep -rn '\bproc\b' Sources/PipiUI/ChatSession.swift`
Expected: 零代码命中（注释可保留）。

Run: `grep -n 'AgentSessionBackend' Sources/PipiUI/*.swift`
Expected: 至少 3 处：`AgentSessionBackend.swift`（协议定义）、`PiProcess.swift`（extension）、`ChatSession.swift`（属性类型 `any AgentSessionBackend`）。

- [ ] **Step 3: 不 commit（无改动）**

---

## Self-Review 结果（写计划后自检）

**1. Spec 覆盖**：本计划覆盖 spec 的"AgentSessionBackend 协议"核心决策（决策 #2）。spec 的其他决策（jcode 后端实现、鉴权共享、swarm store、UI 切换按钮）明确归 Plan B，不在本计划。✓

**2. Placeholder 扫描**：无 TODO/TBD/FIXME。所有代码块完整。`onExit` 闭包体用"原样保留 + 不展示整个闭包"标注——因为它是 ~35 行的错误处理，逐字粘贴既臃肿又容易与实际代码漂移；Task 5d.2 的全量 `swift test` 是该闭包未被误改的回归闸门。✓

**3. 类型一致性**：`AgentSessionBackend`、`PiProcess`、`backend: (any AgentSessionBackend)?`、`EngineKind`、`FakeBackend` 在所有任务中名字一致。`send` 的 `failure: nil` 显式传参（Task 5d）是唯一的非机械点，已明确标注。✓

**4. Task 5 编译可行性修正**：原稿把 `proc→backend` 分成"每批可独立测试通过"的批次，但这不成立——`proc` 是单一标识符，重命名到一半必然编译失败。已改为：5a/5b/5c 是"编辑组"（不单独验证），全部改完后在 5d.2 一次性 `swift test` + 单次 commit。✓

## 给 Plan B 的接力棒

Plan A 完成后，Plan B 的起点：
1. 新建 `Sources/PipiUI/JcodeBackend.swift`，实现 `AgentSessionBackend`——spawn `jcode api-bridge`、NDJSON 握手（`hello`/`hello_ok`，`API_VERSION_MAJOR=1`）、把 jcode 事件（`text_delta`/`tool_start`/`tool_done`/`turn_done`/`permission_request`/`session_status`）**逆向翻译成 pi 兼容的 `J` 事件**（`message_update`/`tool_execution_start`/`tool_execution_end`/`agent_settled` 等）再调 `onEvent`。
2. `ChatSession.init` 加 `.jcode` 分叉：spawn `JcodeBackend` 而非 `PiProcess`。
3. `EngineKind.jcode` 在 UI（新会话按钮的 segmented control）和 `SessionMeta` 磁盘持久化上打通。
4. 鉴权：spawn `jcode api-bridge` 时注入 `~/.pi/agent/.env`（复用 `mergedSpawnEnv`）。
5. swarm store（独立于 `SubagentStore`）。

Plan B 的协议契约、`J` 事件形状、`FakeBackend` 测试网，都由本计划（Plan A）就位。
