# Kimi Code 账号额度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在选中 `kimi-coding` 等 Kimi Code 模型时，输入框右下角显示 5h / 周 /（可选）月额度胶囊，对齐 CodexBar 方案 A。

**Architecture:** 新增 `KimiCredits.swift`（凭据 → Code/Web usages → 可选 GetSubscriptionStats → `QuotaSnapshot`），挂到 `QuotaProvider.kimi`；Desktop Cookies 只读 SQLite，无 SweetCookieKit。

**Tech Stack:** Swift / SwiftUI / XCTest；系统 SQLite3；URLSession。

## Global Constraints

- 不做浏览器 cookie 导入 / SweetCookieKit
- 不做 Moonshot 开放平台 balance
- `ratelimitCode7d` 跳过（与 weekly 重复）
- 失败静默，保留上次快照
- 测试先红后绿；不主动 commit（除非用户要求）

---

### Task 1: Routing + accountLabel

**Files:**
- Modify: `Sources/PipiUI/ChatSession.swift` (`ModelInfo.quotaProvider`)
- Modify: `Sources/PipiUI/QuotaSnapshot.swift` (`QuotaProvider`)
- Modify: `Tests/PipiUITests/MultiProviderQuotaTests.swift`

- [x] 扩展测试：`kimi-coding` → `.kimi`；`kimi-relay` → nil；label `"Kimi 账号额度"`
- [x] 实现 enum case + routing + monitor stub（先编译）

### Task 2: Parse Code API + SubscriptionStats → QuotaSnapshot

**Files:**
- Create: `Sources/PipiUI/KimiCredits.swift`（parse + snapshot）
- Create: `Tests/PipiUITests/KimiCreditsTests.swift`

- [x] Fixture 测试：usages JSON → fiveHour + weekly 百分比
- [x] Fixture 测试：subscriptionBalance → monthly
- [x] 实现解析与 `snapshot(...)`

### Task 3: Auth resolution + fetch + monitor

**Files:**
- Modify: `Sources/PipiUI/KimiCredits.swift`
- Modify: `Tests/PipiUITests/KimiCreditsTests.swift`

- [x] 测试：pi auth.json api_key 优先；env 回退；CLI credential 读取
- [x] 实现 AuthStore、Code/Web fetch、Desktop cookie、`KimiQuotaMonitor`
- [x] 接上 `QuotaProvider.kimi.monitor`

### Task 4: Verify package + app

- [x] `swift test --filter KimiCreditsTests` / `MultiProviderQuotaTests`
- [x] 成功后 `./make-app.sh`（CONSTITUTION），核对 `build/PipiUI.app` 时间戳
