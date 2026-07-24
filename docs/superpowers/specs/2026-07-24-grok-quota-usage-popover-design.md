# Grok 额度多周期用量 Popover — 设计文档

- **日期**：2026-07-24
- **状态**：已批准（brainstorming），待 spec 审阅 → writing-plans

## 1. 背景与问题

PipiUI 右下角状态栏 `InputBar.metricsStatus` 显示一个 Grok 账号额度百分比。实测发现：

- 额度数据来自全局 `GrokQuotaMonitor` → `GrokWebBilling.fetch`（grok.com `GetGrokCreditsConfig`，gRPC-web+proto）。
- 解析 `parseGRPCWebResponse` 用 `.min` 只取了响应里**最浅的一个** fixed32 percent（顶层 `[1,1]`），**丢弃了 `[1,7]` 这个 repeated 多周期用量数组**。
- 上一轮已修复「切非 Grok 模型仍显示 Grok 额度」的问题（`InputBar` 额度块加 `isGrokProvider` 守卫，非 Grok 模型隐藏额度）。

用户需求：**点击右下角额度区，弹出 popover 展示当前 Grok 账号的各类用量周期（5小时 / 周 / 月），每个带进度条；并在 popover 内勾选「默认显示哪个周期」，按账号持久化**（下次打开仍是该选择）。

## 2. 数据可行性（已抓包验证）

对 `GetGrokCreditsConfig` 实测抓包（Bearer 取自 `~/.grok/auth.json`，空 gRPC-web frame）。响应 protobuf 结构：

| protobuf path | 含义 | 实测值 |
|---|---|---|
| `[1,1]` | 顶层主配额 percent（当前 app 就显示它） | `75.0` |
| `[1,4,1]` | 周期起始时间戳 | `2026-07-18` |
| `[1,5,1]` | 周期重置时间戳 | `2026-07-25`（7 天 = 周） |
| `[1,7]` | **repeated 多周期用量数组** | 多项，每项含 `[1,7,1]`=周期类型 enum + `[1,7,2]`=percent |
| `[1,8]` | repeated 周期窗口 | 每项含 enum + start + reset |

实测 `[1,7]` 出现周期类型 enum `2 / 1 / 4 / 6`，对应 percent `38% / 33% / 4%`（含 enum=`2` 对应 7 天窗口 = 周）。

**结论**：API 已返回多个周期的用量，数据现成，仅需扩展解析 + 加 popover UI，无需更换数据源、无需其它 API。

**限制**：API 只返回**百分比**（0–100），不返回绝对额度数值（如已用/总量 credits）。故 popover 内容以「标签 + 进度条 + percent + 重置时间」为限。

## 3. 目标 / 非目标

**目标**
- 解析 `[1,7]` 数组，暴露全部周期用量。
- 额度胶囊可点击 → popover 列出各周期（标签 + 进度条 + percent + 重置时间）。
- popover 内单选某周期为「默认显示」，按账号持久化，胶囊即时反映选择。
- 兼容现有缓存机制（`GrokQuotaMonitor` 定时/`/session` force 刷新不变）。

**非目标**
- 不为非 Grok 模型（GLM/Claude 等）提供额度（无数据源，胶囊保持隐藏）。
- 不显示绝对额度数值（API 不提供）。
- 不改 `[1,1]` 顶层主配额的语义（仍可作为兜底，但不进 popover 可选项，避免与周期概念混淆）。

## 4. 设计

### 4.1 数据模型

新增 `PeriodUsage`（GrokCredits.swift）：

```swift
struct PeriodUsage: Equatable, Identifiable {
    /// 稳定标识：周期类型 enum 的原始值（来自 [1,7,1]）。用于持久化引用。
    let typeRaw: Int
    /// 显示标签：5小时 / 周 / 月（由周期时间窗口长度判定，见 4.2）。
    let label: String
    /// 0…100 用量百分比（来自 [1,7,2]）。
    let percent: Double
    /// 该周期重置时间（若有）。
    let resetDate: Date?

    var id: Int { typeRaw }
}
```

扩展 `GrokCreditsSnapshot`：

```swift
struct GrokCreditsSnapshot: Equatable {
    var usedPercent: Double          // 保留（顶层 [1,1]，兜底）
    var resetsAt: Date?
    var periodLabel: String
    var periodHelp: String
    var periods: [PeriodUsage] = []  // 新增：[1,7] 多周期（可能为空）
    // ...
}
```

### 4.2 解析扩展（`GrokCredits.swift` `parseGRPCWebResponse`）

- 在递归 `ProtobufScan` 已捕获全部字段的基础上，**按 message 边界**提取 `[1,7]` 的每个 repeated entry：
  - `[1,7,i]`（wiretype 2）作为独立 sub-message 解析其字段：
    - `[1,7,i,1]` → 周期类型 enum（varint）→ `typeRaw`
    - `[1,7,i,2]` → percent（fixed32, 0–100）→ `percent`
    - （若 entry 内含时间窗口字段，一并提取用于标签判定与 reset；若无，则复用顶层 `[1,4,1]/[1,5,1]` 或留 nil）
- 实现时需正确按 message 边界配对（当前 `.min` 扁平化取法会丢失配对，必须改为逐 entry 解析 `[1,7]` 子 message）。
- **标签判定**：扩展 `GrokCreditsSnapshot.label(forDuration:)`，增加 5 小时档：
  - ≈ 4.5–5.5 小时 → `("5小时", "5小时额度")`
  - 4–12 天 → `("周", "周额度")`（已有）
  - 20–45 天 → `("月", "月额度")`（已有）
  - 其它/未知 → `("额", "额度")`（兜底）
- 标签优先用周期自身的窗口长度；窗口缺失时用 typeRaw 的已知映射（`2→周`），再兜底 `"额"`。
- 解析失败的周期条目跳过（不抛错，保持现有「静默失败、保留上次好值」策略）。

### 4.3 账号标识（`GrokAuthCredentials`）

扩展 `GrokAuthCredentials` 增加稳定账号标识：

```swift
struct GrokAuthCredentials {
    let accessToken: String
    let expiresAt: Date?
    let principalType: String?
    let accountId: String   // 新增：principal_id（fallback user_id，再 fallback oidc scope UUID）
}
```

`parse(data:)` 中从 entry 读 `principal_id`（首选）/`user_id`；两者皆空时从 oidc scope（`https://auth.x.ai::<uuid>`）截取 UUID 作兜底。`accountId` 仅用于持久化 key，不含敏感 token。

### 4.4 持久化（`LayoutPersistence.swift`，沿用 UserDefaults 模式）

新增：

```swift
enum LayoutPersistence {
    enum Key {
        // 既有...
        static func grokQuotaSelectedPeriod(accountId: String) -> String {
            "pipiui.grokQuotaSelectedPeriod.\(accountId)"
        }
    }
    /// 读取该账号选中的周期 typeRaw；无记录返回 nil。
    static func grokQuotaSelectedPeriod(accountId: String, defaults: UserDefaults = .standard) -> Int?
    /// 写入选中的周期 typeRaw。
    static func setGrokQuotaSelectedPeriod(_ typeRaw: Int, accountId: String, defaults: UserDefaults = .standard)
}
```

### 4.5 胶囊显示逻辑（`ChatSession`）

- `bindQuotaMonitor` 的 observer 回调拿到 snapshot 后，除现有 `quotaPercent/periodLabel/periodHelp` 外，保存 `periods: [PeriodUsage]` 到新 `@Published var periods: [PeriodUsage] = []`。
- 新增 `@Published var selectedPeriodTypeRaw: Int?`（从持久化按当前账号 accountId 读；切账号/启动时刷新）。
- 胶囊显示值派生：若 `selectedPeriodTypeRaw` 命中 `periods`，显示该周期的 `percent` + `label`；否则（无选择 / 命中失败）显示**用量最高的周期**（`periods.max(by: percent)`）；`periods` 为空时回退到现有 `usedPercent`（顶层 `[1,1]`）+ 旧 `periodLabel`。
- 选择变更（来自 popover）→ 更新 `selectedPeriodTypeRaw` + 写持久化（`setGrokQuotaSelectedPeriod`）→ 胶囊即时刷新。
- `quotaPercent` / `quotaPeriodLabel` 字段语义变更：**不再直接等于 `snapshot.usedPercent`**，而由上述派生逻辑赋值（命中选中周期 → 该周期 percent+label；兜底 → 用量最高周期 / 顶层 usedPercent）。`InputBar.metricsStatus` 继续读这两个字段，UI 层无需重算。

### 4.6 Popover UI（`InputBar`）

- 额度胶囊（现有 `Text("\(label) \(Int(quota))%")` 胶囊）外加 `.onTapGesture` / `.popover` 触发。
- popover 内容（`@ViewBuilder`，宽度自适应，紧凑）：
  - 标题：`Grok 账号用量`。
  - 逐行 `ForEach(session.periods)`：
    - 左：单选指示（`Image` checkmark，选中态）。
    - 中：`label` + `ProgressView(value: percent, total: 100)`（带颜色：>80 橙）+ `Int(percent)%`。
    - 右/下：重置时间（相对，如「重置于 07-25」，可用 `Text(resetDate, style: .relative)`）。
  - 整行可点 → `session.selectPeriod(typeRaw:)` → 触发 4.5 的选中 + 持久化 + 胶囊即时刷新。**点选不主动关闭 popover**（用户可继续查看各周期；点 popover 外部由 SwiftUI 自动关闭）。
- `periods` 为空时 popover 显示「暂无多周期用量数据」占位。

### 4.7 非 Grok 模型

保持上一轮修复：`metricsStatus` 额度块的 `if let quota, session.model?.isGrokProvider == true` 守卫不变 → 非 Grok 模型胶囊整块隐藏，无 popover。`setModel` 成功后 `refreshIfNeeded(force: true)` 保留。

## 5. 边界情况

- **periods 为空**：胶囊回退顶层 `usedPercent`；popover 占位提示。
- **API 请求失败**：沿用现有「保留上次好值」；periods 也保留上次快照的（随 snapshot 一起缓存）。
- **选中的周期在新的 periods 里消失**（API 结构变化）：命中失败 → 自动回退「用量最高」；不崩。
- **切 Grok 账号**（多账号）：accountId 变 → 读对应持久化；无记录则用默认（用量最高）。
- **enum typeRaw 未知**：label 兜底 `"额"`，仍可显示 percent 与参与选择（不丢数据）。
- **首次无选择**：默认「用量最高周期」。

## 6. 验收标准

1. Grok 模型下，点击右下角额度胶囊弹出 popover，列出实测的多个周期（5小时/周/月等），每个含进度条 + percent + 重置时间。
2. 在 popover 勾选某周期 → 胶囊立即改为该周期的 percent+label；重启 App 仍显示该选择（持久化生效）。
3. 切到非 Grok 模型 → 胶囊隐藏、无 popover（回归上一轮修复）。
4. 切回 Grok 模型 → 胶囊恢复、显示持久化选择的周期。
5. `swift build` 通过；`./make-app.sh` 成功刷新 `build/PipiUI.app` 且 mtime 新于源文件。
6. `/session` 仍能 force 刷新（既有行为不回归）。

## 7. 文件改动清单

| 文件 | 改动 |
|---|---|
| `Sources/PipiUI/GrokCredits.swift` | 新增 `PeriodUsage`；`GrokCreditsSnapshot` 加 `periods`；`parseGRPCWebResponse` 按 message 边界解析 `[1,7]`；`GrokAuthCredentials` 加 `accountId`；`label(forDuration:)` 加 5 小时档 |
| `Sources/PipiUI/ChatSession.swift` | `bindQuotaMonitor` 传 `periods`；新增 `periods` / `selectedPeriodTypeRaw` @Published；选中派生胶囊值 + `selectPeriod(typeRaw:)`；accountId 读取 |
| `Sources/PipiUI/Views/InputBar.swift` | 额度胶囊加点击 + popover；popover 渲染 periods 列表（radio + 进度条 + 重置时间） |
| `Sources/PipiUI/LayoutPersistence.swift` | 加 `grokQuotaSelectedPeriod(accountId:)` key + 读写函数 |

## 8. 风险与备注

- **enum→标签映射**：实测 enum `2=周`。`1/4/6` 的确切含义需在实现解析时按各 entry 的窗口长度二次确认（5小时/月等）。spec 已用「时间窗口优先，typeRaw 已知映射兜底」规避对未知 enum 的硬依赖。
- **protobuf 解析稳健性**：必须从当前扁平化 `.min` 改为逐 `[1,7]` entry 的 message 边界解析，否则 enum 与 percent 配对会错乱。实现时建议加 debug 选项（环境变量）dump 原始扫描结果便于核对。
- **message 边界**：抓包用的临时 Python 探测脚本（`/tmp/grok_probe*.py`）二次版本顶层 framing 解析有偏差，仅第一次扁平化结果可信；实现以 Swift `ProtobufScan` 逐 entry 解析为准。
