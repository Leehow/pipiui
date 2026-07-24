# Grok 额度多周期用量 Popover 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 逐任务实现。步骤用 checkbox（`- [ ]`）跟踪。每任务完成后 build 验证。

**Goal:** 让右下角 Grok 额度胶囊可点击，弹出 popover 展示账号多周期用量（5小时/周/月）并带进度条；popover 内可勾选默认显示周期，按账号持久化。

**Architecture:** 扩展 `GrokWebBilling` 的 protobuf 解析，从响应 `[1,7]` repeated 数组提取多周期用量（当前 `.min` 扁平化逻辑只取了一个、丢了配对）；`GrokCreditsSnapshot` 增加 `periods`；`ChatSession` 维护选中周期并派生胶囊显示值；`InputBar` 加 popover；`LayoutPersistence` 按账号持久化选择。

**Tech Stack:** Swift / SwiftUI / SwiftPM，测试 XCTest（`@testable import PipiUI`）。

**Spec:** `docs/superpowers/specs/2026-07-24-grok-quota-usage-popover-design.md`

## Global Constraints

- 平台 macOS 14+，SwiftPM，产品 `PipiUI`。
- 测试：`swift test`（XCTest）。可运行 app 打包：`./make-app.sh`，须刷新 `build/PipiUI.app` 且 mtime 新于源文件。
- 遵循既有「静默失败、保留上次好值」策略：解析失败的周期条目跳过，不抛错。
- **`Sources/PipiUI/ChatSession.swift` 当前含未提交的 toolRuns 节流 WIP（与本功能无关，约 106/198/452 行）**。本功能的 ChatSession 改动集中在额度相关区域（`quotaPercent` 字段 ~113、`bindQuotaMonitor` ~271、新增方法）。提交时用 `git add -p` 只 stage 额度相关 hunk，**不要把 toolRuns WIP 带进本功能 commit**；若难分离，本功能的 ChatSession 改动可暂不单独 commit，留待用户统一整理（仍须 build 通过）。
- 命名/文案沿用中文（周/月/5小时/额）。

## File Structure

| 文件 | 职责 | 本计划改动 |
|---|---|---|
| `Sources/PipiUI/GrokCredits.swift` | 额度 API + protobuf 解析 + 数据模型 + monitor | 新增 `PeriodUsage`；`Snapshot` 加 `periods`；`parseGRPCWebResponse` 按 message 边界解析 `[1,7]`；`GrokAuthCredentials` 加 `accountId`；`label(forDuration:)` 加 5 小时档；`fetch` 注入 periods |
| `Sources/PipiUI/ChatSession.swift` | 会话状态 + 额度数据流 | `periods`/`selectedPeriodTypeRaw` @Published；`bindQuotaMonitor` 传 periods + 派生胶囊值；`selectPeriod(typeRaw:)`；accountId 读取 |
| `Sources/PipiUI/Views/InputBar.swift` | 输入栏 + 右下角 metrics | 额度胶囊加 `.popover`；popover 渲染 periods 列表 |
| `Sources/PipiUI/LayoutPersistence.swift` | UserDefaults 持久化 | 加 `grokQuotaSelectedPeriod(accountId:)` 读写 |
| `Tests/PipiUITests/GrokCreditsTests.swift` | GrokCredits 测试 | 加 periods 解析 + label 5 小时测试 |

---

### Task 1: `PeriodUsage` 模型 + `Snapshot.periods` + 5 小时标签

**Files:**
- Modify: `Sources/PipiUI/GrokCredits.swift`（`struct GrokCreditsSnapshot` ~152、`label(forDuration:)` ~178）
- Test: `Tests/PipiUITests/GrokCreditsTests.swift`

**Interfaces:**
- Produces: `struct PeriodUsage: Equatable, Identifiable { let typeRaw: Int; let label: String; let percent: Double; let resetDate: Date?; var id: Int { typeRaw } }`；`GrokCreditsSnapshot.periods: [PeriodUsage]`（默认 `[]`）

- [ ] **Step 1: 写失败测试**（追加到 GrokCreditsTests）

```swift
func testPeriodLabelFiveHour() {
    let now = Date()
    // 周期窗口 ~5 小时 → "5小时"
    let fiveHour = GrokCreditsSnapshot.period(
        resetsAt: now.addingTimeInterval(5 * 3600),
        periodStart: now,
        now: now
    )
    XCTAssertEqual(fiveHour.label, "5小时")
    XCTAssertEqual(fiveHour.help, "5小时额度")
}

func testPeriodUsageIdentityByTypeRaw() {
    let p = PeriodUsage(typeRaw: 2, label: "周", percent: 38, resetDate: nil)
    XCTAssertEqual(p.id, 2)
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `swift test --filter GrokCreditsTests 2>&1 | tail -20`
Expected: FAIL（`PeriodUsage` 未定义；5 小时 label 返回 "额"）

- [ ] **Step 3: 实现**

在 `struct GrokCreditsSnapshot` **之前**新增：
```swift
struct PeriodUsage: Equatable, Identifiable {
    /// 周期类型 enum 原始值（来自 [1,7,1]）。持久化引用用。
    let typeRaw: Int
    /// 5小时 / 周 / 月 / 额
    let label: String
    /// 0…100
    let percent: Double
    let resetDate: Date?
    var id: Int { typeRaw }
}
```

`GrokCreditsSnapshot` 增加 `var periods: [PeriodUsage] = []`（放在 `periodHelp` 之后）。

`label(forDuration:)` 增加 5 小时档（在 `guard seconds > 3600` 之后、`days` 计算之前插入）：
```swift
private static func label(forDuration seconds: TimeInterval) -> (label: String, help: String)? {
    guard seconds > 3600 else { return nil }
    let hours = seconds / 3600
    if (4.5...5.5).contains(hours) { return ("5小时", "5小时额度") }
    let days = Int((seconds / 86400).rounded(.toNearestOrAwayFromZero))
    if (4...12).contains(days) { return ("周", "周额度") }
    if (20...45).contains(days) { return ("月", "月额度") }
    return nil
}
```
注意 `period(resetsAt:periodStart:now:)` 在同时有 periodStart+resetsAt 时用窗口长度（start→end）——5 小时窗口需确保走这条分支（测试传了 periodStart）。

- [ ] **Step 4: 跑测试确认通过**

Run: `swift test --filter GrokCreditsTests 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/GrokCredits.swift Tests/PipiUITests/GrokCreditsTests.swift
git commit -m "feat(grok-credits): add PeriodUsage model + 5-hour label"
```

---

### Task 2: protobuf 按 message 边界解析 `[1,7]` 多周期

**Files:**
- Modify: `Sources/PipiUI/GrokCredits.swift`（`struct ProtobufScan` ~400、`parseGRPCWebResponse` ~248）
- Test: `Tests/PipiUITests/GrokCreditsTests.swift`

**Interfaces:**
- Consumes: `PeriodUsage`（Task 1）
- Produces: `ParsedBilling.periods: [PeriodUsage]`；`parseGRPCWebResponse` 返回的 `ParsedBilling` 含 periods

**实现要点**（关键难点，必须按 entry 边界配对，不能扁平化）：
当前 `scanProtobuf` 对 wireType 2 在 depth<4 时递归 merge 到同一扁平 scan，丢失了 `[1,7]` 各 entry 的边界，导致 enum/varint 与 percent/fixed32 无法可靠配对（实测 enum 4 个、percent 3 个）。需新增对 length-delimited 字段的原始 bytes 记录，再对每个 `[1,7]` entry 单独 scan。

- [ ] **Step 1: 写失败测试**（构造一个含两个 `[1,7]` entry 的 protobuf 响应）

```swift
func testParsePeriodsFromRepeatedField() {
    // 构造 gRPC-web frame: 5-byte header + protobuf payload
    // payload = field1(message){ field1=f32(75), field7(msg){ field1=varint(2), field2=f32(38) },
    //                              field7(msg){ field1=varint(1), field2=f32(33) } }
    var payload = Data()
    func tag(_ fn: Int, _ wt: Int) -> UInt8 { UInt8((fn << 3) | wt) }
    func varint(_ v: UInt64) -> Data {
        var v = v; var out = Data()
        while v >= 0x80 { out.append(UInt8((v & 0x7f) | 0x80)); v >>= 7 }
        out.append(UInt8(v)); return out
    }
    func f32(_ f: Float) -> Data {
        var f = f; return Data(bytes: &f, count: 4) // little-endian on arm64
    }
    // inner entry1: field1(varint)=2, field2(f32)=38
    var entry1 = Data()
    entry1.append(tag(1, 0)); entry1.append(varint(2))
    entry1.append(tag(2, 5)); entry1.append(f32(38))
    // inner entry2: field1(varint)=1, field2(f32)=33
    var entry2 = Data()
    entry2.append(tag(1, 0)); entry2.append(varint(1))
    entry2.append(tag(2, 5)); entry2.append(f32(33))
    // config = field1(f32)=75, field7(msg)=entry1, field7(msg)=entry2
    var cfg = Data()
    cfg.append(tag(1, 5)); cfg.append(f32(75))
    cfg.append(tag(7, 2)); cfg.append(varint(UInt64(entry1.count))); cfg.append(entry1)
    cfg.append(tag(7, 2)); cfg.append(varint(UInt64(entry2.count))); cfg.append(entry2)
    var payload = Data()
    payload.append(tag(1, 2)); payload.append(varint(UInt64(cfg.count))); payload.append(cfg)
    // gRPC-web frame
    var frame = Data([0x00, 0x00, 0x00, 0x00, 0x00])
    frame.append(payload)

    let parsed = try! GrokWebBilling.parseGRPCWebResponse(frame)
    XCTAssertEqual(parsed.usedPercent, 75, accuracy: 0.01)
    XCTAssertEqual(parsed.periods.count, 2)
    XCTAssertEqual(parsed.periods[0].typeRaw, 2)
    XCTAssertEqual(parsed.periods[0].percent, 38, accuracy: 0.01)
    XCTAssertEqual(parsed.periods[1].typeRaw, 1)
    XCTAssertEqual(parsed.periods[1].percent, 33, accuracy: 0.01)
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `swift test --filter GrokCreditsTests.testParsePeriodsFromRepeatedField 2>&1 | tail -25`
Expected: FAIL（`ParsedBilling` 无 `periods` 字段 / 解析返回空）

- [ ] **Step 3: 实现**

(a) `ParsedBilling` 加字段：
```swift
struct ParsedBilling: Equatable {
    var usedPercent: Double
    var resetsAt: Date?
    var periodStart: Date?
    var periods: [PeriodUsage] = []   // 新增
}
```

(b) `ProtobufScan` 增加 length-delimited 字节记录。在 `struct ProtobufScan` 内增加：
```swift
struct LenDelimited { var path: [UInt64]; var bytes: Data; var order: Int }
var lenDelimitedFields: [LenDelimited] = []
```
`scanProtobuf` 的 wireType 2 分支：在递归 merge **之外/同时**，记录该 field 的 bytes（无论是否 depth<4 都记录）：
```swift
case 2:
    guard let length = readVarint(bytes, index: &index),
          length <= UInt64(bytes.count - index)
    else { index = fieldStart + 1; continue }
    let start = index; let end = index + Int(length)
    scan.lenDelimitedFields.append(.init(path: fieldPath, bytes: Data(bytes[start..<end]), order: nextOrder))
    if depth < 4 {
        let nested = scanProtobuf(Data(bytes[start..<end]), depth: depth + 1, path: fieldPath, order: nextOrder)
        scan.merge(nested.scan); nextOrder = nested.order
    }
    index = end
```
（注意：现有 merge 只合并 fixed32/varint；需同时合并 lenDelimitedFields —— 在 `merge(_ other:)` 里加 `lenDelimitedFields.append(contentsOf: other.lenDelimitedFields)`。）

(c) `parseGRPCWebResponse` 末尾、`return ParsedBilling(...)` 之前，提取 periods：
```swift
let periodEntries = scan.lenDelimitedFields.filter { $0.path == [1, 7] }
var periods: [PeriodUsage] = []
for entry in periodEntries {
    let es = scanProtobuf(entry.bytes, depth: 0, path: [])  // 相对 entry：field1=enum, field2=percent
    let typeRaw = es.scan.varintFields.first { $0.path == [1] }?.value
    let percent = es.scan.fixed32Fields
        .filter { $0.path == [2] && $0.value.isFinite && ($0.value >= 0 && $0.value <= 100) }
        .map { Double($0.value) }
        .first
    guard let typeRaw, let percent else { continue }   // 配对失败跳过
    // reset 时间：entry 内若有 [3]/[4] varint 时间戳则用，否则 nil（标签兜底）
    let reset = es.scan.varintFields
        .compactMap { f -> Date? in
            guard (1_700_000_000...2_100_000_000).contains(f.value), f.path == [3] || f.path == [4] else { return nil }
            return Date(timeIntervalSince1970: TimeInterval(f.value))
        }.first
    let labelInfo: (label: String, help: String)
    if let reset, let start = es.scan.varintFields.first(where: { $0.path == [4] }).map({ Date(timeIntervalSince1970: TimeInterval($0.value)) }) {
        labelInfo = GrokCreditsSnapshot.period(resetsAt: reset, periodStart: start, now: now)
    } else {
        labelInfo = GrokCreditsSnapshot.period(resetsAt: reset, now: now)
    }
    // typeRaw 已知映射兜底（2→周）；label 若为兜底"额"且 typeRaw 已知则覆盖
    var label = labelInfo.label
    if label == "额" {
        if typeRaw == 2 { label = "周" }
        else if typeRaw == 1 { label = "月" }
        // 其它未知 typeRaw 保留"额"
    }
    periods.append(PeriodUsage(typeRaw: Int(typeRaw), label: label, percent: percent, resetDate: reset))
}
```
然后 `return ParsedBilling(usedPercent: percent, resetsAt: reset, periodStart: periodStart, periods: periods)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `swift test --filter GrokCreditsTests 2>&1 | tail -25`
Expected: PASS（含 testParsePeriodsFromRepeatedField）

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/GrokCredits.swift Tests/PipiUITests/GrokCreditsTests.swift
git commit -m "feat(grok-credits): parse multi-period usage from [1,7] by message boundary"
```

---

### Task 3: `GrokAuthCredentials.accountId` + `fetch` 注入 periods

**Files:**
- Modify: `Sources/PipiUI/GrokCredits.swift`（`struct GrokAuthCredentials` ~53、`parse(data:)` ~103、`fetch` ~217）

**Interfaces:**
- Produces: `GrokAuthCredentials.accountId: String`；`GrokCreditsSnapshot` 经 `fetch` 后 `periods` 已填充

- [ ] **Step 1: 写失败测试**

```swift
func testAccountIdFromPrincipalId() {
    let json = """
    {"https://auth.x.ai::abc-123": {"key":"k","principal_id":"pid-9","user_id":"uid-1","principal_type":"personal"}}
    """.data(using: .utf8)!
    let creds = GrokAuthCredentials.parse(data: json)
    XCTAssertEqual(creds?.accountId, "pid-9")
}

func testAccountIdFallbackToUserIdThenScope() {
    let json = """
    {"https://auth.x.ai::scope-uuid": {"key":"k","user_id":"uid-7","principal_type":"personal"}}
    """.data(using: .utf8)!
    XCTAssertEqual(GrokAuthCredentials.parse(data: json)?.accountId, "uid-7")
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `swift test --filter GrokCreditsTests 2>&1 | tail -20`
Expected: FAIL（`accountId` 不存在）

- [ ] **Step 3: 实现**

`GrokAuthCredentials` 加 `let accountId: String`。`parse(data:)` 的 entry 读取处加：
```swift
let accountId = (entry["principal_id"] as? String)?.nilIfEmpty
    ?? (entry["user_id"] as? String)?.nilIfEmpty
    ?? scope.split(separator: "::").last.map(String.init)   // oidc scope UUID 兜底
    ?? ""
```
（`scope` 是 `selectPreferredEntry` 返回的 key；需让它一并返回或在此处可访问。若 `parse` 内拿不到 scope，则让 `selectPreferredEntry` 已返回的 `(scope, entry)` 元组在此使用 —— 当前 `parse` 已有 `(_, entry)`，改为 `(scope, entry)`。）
构造 `GrokAuthCredentials(..., accountId: accountId)`。

`fetch`（~233）return 处加 `periods: parsed.periods`：
```swift
return GrokCreditsSnapshot(
    usedPercent: parsed.usedPercent,
    resetsAt: parsed.resetsAt,
    periodLabel: period.label,
    periodHelp: period.help,
    periods: parsed.periods
)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `swift test --filter GrokCreditsTests 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/GrokCredits.swift Tests/PipiUITests/GrokCreditsTests.swift
git commit -m "feat(grok-credits): add accountId + propagate periods via fetch"
```

---

### Task 4: `LayoutPersistence` 按账号持久化选中周期

**Files:**
- Modify: `Sources/PipiUI/LayoutPersistence.swift`（`enum Key`）

**Interfaces:**
- Produces: `LayoutPersistence.grokQuotaSelectedPeriod(accountId:) -> Int?`、`setGrokQuotaSelectedPeriod(_:accountId:)`

- [ ] **Step 1: 写失败测试**（新建或追加；LayoutPersistence 暂无测试文件，可加到 `Tests/PipiUITests/GrokCreditsTests.swift` 或新建 `LayoutPersistenceTests.swift`。建议新建 `LayoutPersistenceTests.swift`）

```swift
// Tests/PipiUITests/LayoutPersistenceTests.swift
import XCTest
@testable import PipiUI

final class LayoutPersistenceTests: XCTestCase {
    func testQuotaSelectedPeriodRoundTrip() {
        let suite = UserDefaults(suiteName: "pipiui.test.\(UUID().uuidString)")!
        defer { suite.removePersistentDomain(forName: suite.dictionaryRepresentation().keys.first ?? "") }
        let aid = "acct-xyz"
        XCTAssertNil(LayoutPersistence.grokQuotaSelectedPeriod(accountId: aid, defaults: suite))
        LayoutPersistence.setGrokQuotaSelectedPeriod(2, accountId: aid, defaults: suite)
        XCTAssertEqual(LayoutPersistence.grokQuotaSelectedPeriod(accountId: aid, defaults: suite), 2)
        // 不同账号隔离
        XCTAssertNil(LayoutPersistence.grokQuotaSelectedPeriod(accountId: "other", defaults: suite))
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `swift test --filter LayoutPersistenceTests 2>&1 | tail -20`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现**（`LayoutPersistence`）

`Key` 加：
```swift
static func grokQuotaSelectedPeriod(accountId: String) -> String {
    "pipiui.grokQuotaSelectedPeriod.\(accountId)"
}
```
enum 内加静态方法：
```swift
static func grokQuotaSelectedPeriod(accountId: String, defaults: UserDefaults = .standard) -> Int? {
    guard defaults.object(forKey: Key.grokQuotaSelectedPeriod(accountId: accountId)) != nil else { return nil }
    let v = defaults.integer(forKey: Key.grokQuotaSelectedPeriod(accountId: accountId))
    return v >= 0 ? v : nil
}

static func setGrokQuotaSelectedPeriod(_ typeRaw: Int, accountId: String, defaults: UserDefaults = .standard) {
    defaults.set(typeRaw, forKey: Key.grokQuotaSelectedPeriod(accountId: accountId))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `swift test --filter LayoutPersistenceTests 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/LayoutPersistence.swift Tests/PipiUITests/LayoutPersistenceTests.swift
git commit -m "feat(persistence): persist selected Grok quota period per account"
```

---

### Task 5: `ChatSession` 额度数据流（periods + 选中 + 派生胶囊）

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift`（`@Published` 额度字段 ~113、`bindQuotaMonitor` ~271）

**Interfaces:**
- Consumes: `GrokCreditsSnapshot.periods`（Task 1-3）、`LayoutPersistence`（Task 4）、`GrokAuthStore.load()?.accountId`
- Produces: `ChatSession.periods: [PeriodUsage]`、`ChatSession.selectedPeriodTypeRaw: Int?`、`ChatSession.selectPeriod(typeRaw:)`；`quotaPercent`/`quotaPeriodLabel` 语义变为「选中周期派生」

**约束**：ChatSession.swift 含 toolRuns WIP，本任务只改额度区域 + 新增方法；提交用 `git add -p` 仅 stage 额度 hunk，或暂不 commit（见 Global Constraints）。

- [ ] **Step 1: 写失败测试**（ChatSession 状态逻辑可单测：派生胶囊值）。若 ChatSession 难实例化，把派生逻辑抽成纯函数 `GrokQuotaDisplay.resolve(periods:selected:usedPercent:fallbackLabel:)` 单测。

抽纯函数方案（推荐，便于测试）—— 在 GrokCredits.swift 加：
```swift
enum GrokQuotaDisplay {
    /// 返回胶囊应显示的 (percent, label)。
    static func resolve(periods: [PeriodUsage], selected typeRaw: Int?, fallbackPercent: Double, fallbackLabel: String) -> (percent: Double, label: String) {
        if let typeRaw, let p = periods.first(where: { $0.typeRaw == typeRaw }) {
            return (p.percent, p.label)
        }
        if let top = periods.max(by: { $0.percent < $1.percent }) {
            return (top.percent, top.label)
        }
        return (fallbackPercent, fallbackLabel)
    }
}
```
测试：
```swift
func testQuotaDisplayResolvesSelected() {
    let periods = [PeriodUsage(typeRaw: 2, label: "周", percent: 38, resetDate: nil),
                   PeriodUsage(typeRaw: 1, label: "月", percent: 33, resetDate: nil)]
    let r = GrokQuotaDisplay.resolve(periods: periods, selected: 2, fallbackPercent: 75, fallbackLabel: "额")
    XCTAssertEqual(r.percent, 38); XCTAssertEqual(r.label, "周")
}

func testQuotaDisplayFallsBackToMaxWhenNoSelection() {
    let periods = [PeriodUsage(typeRaw: 2, label: "周", percent: 38, resetDate: nil),
                   PeriodUsage(typeRaw: 1, label: "月", percent: 60, resetDate: nil)]
    let r = GrokQuotaDisplay.resolve(periods: periods, selected: nil, fallbackPercent: 75, fallbackLabel: "额")
    XCTAssertEqual(r.percent, 60); XCTAssertEqual(r.label, "月")  // max
}

func testQuotaDisplayFallsBackToTopWhenPeriodsEmpty() {
    let r = GrokQuotaDisplay.resolve(periods: [], selected: nil, fallbackPercent: 75, fallbackLabel: "额")
    XCTAssertEqual(r.percent, 75); XCTAssertEqual(r.label, "额")
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `swift test --filter GrokCreditsTests.testQuotaDisplay 2>&1 | tail -20`
Expected: FAIL（`GrokQuotaDisplay` 未定义）

- [ ] **Step 3: 实现**

(a) GrokCredits.swift 加 `enum GrokQuotaDisplay`（上面代码）。

(b) ChatSession.swift：
- 新增 `@Published var periods: [PeriodUsage] = []`、`@Published private(set) var selectedPeriodTypeRaw: Int?`（额度字段区，~113 附近）
- `bindQuotaMonitor` 回调内（~271）扩展：
```swift
private func bindQuotaMonitor() {
    quotaObserverID = GrokQuotaMonitor.shared.observe { [weak self] snap in
        guard let self else { return }
        self.periods = snap?.periods ?? []
        self.recomputeQuotaDisplay(fallbackPercent: snap?.usedPercent, fallbackLabel: snap?.periodLabel ?? "额")
    }
}
```
- 新增方法：
```swift
private func recomputeQuotaDisplay(fallbackPercent: Double?, fallbackLabel: String) {
    // 首次或切账号时从持久化读 selectedPeriodTypeRaw
    if selectedPeriodTypeRaw == nil, let aid = GrokAuthStore.load()?.accountId, !aid.isEmpty {
        selectedPeriodTypeRaw = LayoutPersistence.grokQuotaSelectedPeriod(accountId: aid)
    }
    let sel = selectedPeriodTypeRaw
    let r = GrokQuotaDisplay.resolve(periods: periods, selected: sel,
                                     fallbackPercent: fallbackPercent ?? 0, fallbackLabel: fallbackLabel)
    self.quotaPercent = periods.isEmpty ? fallbackPercent : r.percent
    self.quotaPeriodLabel = r.label
    // quotaPeriodHelp 可保留旧值或同步；非关键
}

func selectPeriod(typeRaw: Int) {
    selectedPeriodTypeRaw = typeRaw
    if let aid = GrokAuthStore.load()?.accountId, !aid.isEmpty {
        LayoutPersistence.setGrokQuotaSelectedPeriod(typeRaw, accountId: aid)
    }
    let snap = GrokQuotaMonitor.shared.snapshot
    recomputeQuotaDisplay(fallbackPercent: snap?.usedPercent, fallbackLabel: snap?.periodLabel ?? "额")
}
```
（`quotaPercent` 在 periods 非空时 = 选中派生；为空时 = 顶层 usedPercent。`quotaPeriodLabel` = 派生 label。）

- [ ] **Step 4: 跑测试确认通过 + 全量 build**

Run: `swift test 2>&1 | tail -25 && swift build 2>&1 | tail -10`
Expected: 测试 PASS；build 无 error

- [ ] **Step 5: 提交**（注意 WIP 边界）

```bash
# 只 stage 额度相关 hunk（GrokCredits 的 GrokQuotaDisplay + ChatSession 额度区域）
git add Sources/PipiUI/GrokCredits.swift Tests/PipiUITests/GrokCreditsTests.swift
git add -p Sources/PipiUI/ChatSession.swift   # 仅选额度 hunk，跳过 toolRuns WIP
git commit -m "feat(quota): derive capsule display from selected period + persist"
```
若 `git add -p` 难分离 toolRuns hunk，则 ChatSession 改动暂不 commit，仅 commit GrokCredits 部分，记录待用户整理。

---

### Task 6: `InputBar` 额度胶囊 popover UI

**Files:**
- Modify: `Sources/PipiUI/Views/InputBar.swift`（`metricsStatus` ~704、额度胶囊 Text ~716）

**Interfaces:**
- Consumes: `ChatSession.periods`、`ChatSession.selectedPeriodTypeRaw`、`ChatSession.selectPeriod(typeRaw:)`

**说明**：UI 改动以手动验证为主（SwiftUI popover 难单测）。

- [ ] **Step 1: 实现胶囊点击 + popover**

在 `metricsStatus` 的额度 `Text(...)` 胶囊上加 `.popover`（用 `@State private var showQuotaPopover = false`）：
```swift
if let quota = session.quotaPercent, session.model?.isGrokProvider == true {
    let label = session.quotaPeriodLabel ?? "额"
    let help = session.quotaPeriodHelp ?? "额度"
    Text("\(label) \(Int(quota.rounded()))%")
        .font(.caption.monospacedDigit())
        .foregroundStyle(quota > 80 ? .orange : .secondary)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(Capsule().fill(Color.primary.opacity(0.06)))
        .help(help)
        .onTapGesture { showQuotaPopover.toggle() }
        .popover(isPresented: $showQuotaPopover, arrowEdge: .bottom) {
            quotaPopover
                .frame(width: 260)
                .padding(8)
        }
}
```
视图级加 `@State private var showQuotaPopover = false`（InputBar struct 内）。

新增 popover 内容 view：
```swift
private var quotaPopover: some View {
    VStack(alignment: .leading, spacing: 6) {
        Text("Grok 账号用量").font(.caption.bold()).foregroundStyle(.secondary)
        if session.periods.isEmpty {
            Text("暂无多周期用量数据").font(.caption).foregroundStyle(.secondary).padding(.vertical, 8)
        } else {
            ForEach(session.periods) { p in
                periodRow(p)
            }
        }
    }
}

private func periodRow(_ p: PeriodUsage) -> some View {
    let selected = session.selectedPeriodTypeRaw == p.typeRaw
    return HStack(spacing: 8) {
        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
            .foregroundStyle(selected ? .accentColor : .secondary)
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(p.label).font(.caption.bold())
                Spacer()
                Text("\(Int(p.percent.rounded()))%").font(.caption.monospacedDigit())
                    .foregroundStyle(p.percent > 80 ? .orange : .secondary)
            }
            ProgressView(value: p.percent, total: 100)
                .tint(p.percent > 80 ? .orange : .accentColor)
            if let reset = p.resetDate {
                Text("重置于 \(reset, formatter: Self.dateFmt)").font(.system(size: 9)).foregroundStyle(.tertiary)
            }
        }
    }
    .contentShape(Rectangle())
    .onTapGesture { session.selectPeriod(typeRaw: p.typeRaw) }
}

private static let dateFmt: DateFormatter = {
    let f = DateFormatter(); f.dateFormat = "MM-dd HH:mm"; return f
}()
```
（`Color.tertiary` 若不可用用 `.secondary.opacity(0.7)`。`ProgressView(value:total:)` 是 SwiftUI 标准用法。）

- [ ] **Step 2: build 验证**

Run: `swift build 2>&1 | tail -15`
Expected: 无 error

- [ ] **Step 3: 打包刷新 .app**

Run: `./make-app.sh 2>&1 | tail -10`
Expected: `Build complete` + `Built build/PipiUI.app`

- [ ] **Step 4: 新鲜度校验**

Run: `stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' build/PipiUI.app/Contents/MacOS/PipiUI Sources/PipiUI/Views/InputBar.swift Sources/PipiUI/ChatSession.swift Sources/PipiUI/GrokCredits.swift`
Expected: `.app` mtime 晚于所有源文件

- [ ] **Step 5: Commit**

```bash
git add Sources/PipiUI/Views/InputBar.swift
git commit -m "feat(ui): quota capsule popover with per-period bars and selection"
```

---

## Self-Review（计划作者已完成）

- **Spec 覆盖**：解析(Task2)✓ 模型(Task1)✓ accountId(Task3)✓ 持久化(Task4)✓ 胶囊派生(Task5)✓ popover+勾选(Task6)✓ 非Grok隐藏(保留既有)✓ 默认用量最高(Task5 resolve)✓ periods空兜底(Task5)✓
- **类型一致**：`PeriodUsage.typeRaw:Int` / `selectedPeriodTypeRaw:Int?` / `LayoutPersistence` Int / `selectPeriod(typeRaw:Int)` 全链路一致。
- **placeholder**：无 TBD；关键难点（message 边界解析）给了完整代码。
- **风险**：Task2 的 protobuf bytes 记录需同步改 `merge`（已注明）；Task5 `git add -p` 分离 WIP 可能困难，给了降级方案。
