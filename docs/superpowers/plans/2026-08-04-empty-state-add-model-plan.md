# 空页引导：添加模型 + 产品说明 + 提供商额度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强无会话时的 `EmptyStateView`：无凭据时一键打开 `AddModelSheet`，有凭据时列出提供商与额度/余额，并展示产品内置能力说明。

**Architecture:** 抽出可测的 `EmptyStateCredentialSummary`（扫描 `.env` + `auth.json`）；`quotaProvider(for:)` 与 `ModelInfo.quotaProvider` 共用同一路由；`EmptyStateView` 本地 `@State` 管 sheet 与列表，后台 observe 现有 `QuotaMonitor` / `BalanceMonitor`，失败静默显示「已配置」。

**Tech Stack:** Swift / SwiftUI macOS 14+ · SwiftPM XCTest · 现有 `EnvFileStore` / `PiAuthStore` / `QuotaMonitor` / `BalanceMonitor` / `AddModelSheet`。

**Spec:** `docs/superpowers/specs/2026-08-04-empty-state-add-model-design.md`（approved）。

## Global Constraints

- **不改 `AddModelSheet` 行为**；空页用 `.sheet` 直达。
- **不上抬状态到 `AppStore`**；sheet / 列表均为 `EmptyStateView` 本地 `@State`。
- **搜索专用 env key 不计凭据**（如 `TAVILY_API_KEY`）；只认 `ProviderEnvMap.envVarsByProvider` + `PiAuthStore.list()`。
- **额度文案对齐 InputBar**：显示 **已用** 百分比（`usedPercent`），不是剩余%；余额用 `formatBalance`。
- **quota 优先于 balance**（与 `ChatSession` 一致）：同一 provider 能查额度就不显示预充值余额。
- **验证用 `swift test` / `swift build`**；不在本计划内跑 `make-app.sh`（除非用户另要求）。
- **不主动 commit**（除非用户要求）。

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/EmptyStateCredentialSummary.swift` | **新建。** 扫描已配置 provider；纯函数 `load(...)` 可注入 env/auth URL。 |
| `Sources/PipiUI/QuotaSnapshot.swift` | 新增包级 `quotaProvider(for:)`；`ModelInfo.quotaProvider` 改为调用它。 |
| `Sources/PipiUI/ChatSession.swift` | `ModelInfo.quotaProvider` 改为委托 `PipiUI.quotaProvider(for:)`（逻辑迁出，行为不变）。 |
| `Sources/PipiUI/Views/EmptyStateView.swift` | **新建。** 从 `App.swift` 迁出并增强：说明、功能列表、提供商行、CTA、sheet。 |
| `Sources/PipiUI/App.swift` | 删除旧 `EmptyStateView` 定义（改由新文件提供）；`detail` 分支不变。 |
| `Tests/PipiUITests/EmptyStateCredentialSummaryTests.swift` | **新建。** 凭据并集、搜索 key 排除、状态文案格式化。 |

---

### Task 1: `EmptyStateCredentialSummary` + 凭据扫描测试

**Files:**
- Create: `Sources/PipiUI/EmptyStateCredentialSummary.swift`
- Create: `Tests/PipiUITests/EmptyStateCredentialSummaryTests.swift`

**Interfaces:**
- Consumes: `EnvFileStore`, `ProviderEnvMap.envVarsByProvider`, `PiAuthStore.list(authURL:)`
- Produces:
  ```swift
  struct EmptyStateConfiguredProvider: Equatable, Identifiable, Sendable {
      let providerId: String
      var id: String { providerId }
  }

  enum EmptyStateCredentialSummary {
      /// Disk I/O; call off main thread.
      static func load(
          envStore: EnvFileStore = EnvFileStore(),
          authURL: URL = PiAuthStore.defaultAuthURL()
      ) -> [EmptyStateConfiguredProvider]
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `Tests/PipiUITests/EmptyStateCredentialSummaryTests.swift`:

```swift
import XCTest
@testable import PipiUI
import Foundation

final class EmptyStateCredentialSummaryTests: XCTestCase {
    private var tmpDir: URL!
    private var envURL: URL!
    private var authURL: URL!
    private var envStore: EnvFileStore!

    override func setUpWithError() throws {
        tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("EmptyStateCred-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        envURL = tmpDir.appendingPathComponent(".env")
        authURL = tmpDir.appendingPathComponent("auth.json")
        envStore = EnvFileStore(fileURL: envURL)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tmpDir)
    }

    func testEmptyWhenNoEnvAndNoAuth() {
        let rows = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
        XCTAssertTrue(rows.isEmpty)
    }

    func testEnvModelProviderCounts() throws {
        try envStore.setSync("sk-test", forKey: "DEEPSEEK_API_KEY")
        let ids = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
            .map(\.providerId).sorted()
        XCTAssertEqual(ids, ["deepseek"])
    }

    func testSearchOnlyEnvKeyDoesNotCount() throws {
        try envStore.setSync("tvly-test", forKey: "TAVILY_API_KEY")
        let rows = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
        XCTAssertTrue(rows.isEmpty, "search keys must not count as model credentials")
    }

    func testAuthJsonOauthCounts() throws {
        // Minimal oauth-shaped entry (type != api_key residue after migration).
        let json = """
        {"anthropic":{"type":"oauth","access":"x","refresh":"y"}}
        """
        try json.write(to: authURL, atomically: true, encoding: .utf8)
        let ids = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
            .map(\.providerId)
        XCTAssertEqual(ids, ["anthropic"])
    }

    func testDedupesEnvAndAuthSameProvider() throws {
        try envStore.setSync("sk-ant", forKey: "ANTHROPIC_API_KEY")
        let json = """
        {"anthropic":{"type":"oauth","access":"x"}}
        """
        try json.write(to: authURL, atomically: true, encoding: .utf8)
        let ids = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
            .map(\.providerId)
        XCTAssertEqual(ids, ["anthropic"])
    }

    func testSortedByProviderId() throws {
        try envStore.setSync("a", forKey: "XAI_API_KEY")
        try envStore.setSync("b", forKey: "DEEPSEEK_API_KEY")
        let ids = EmptyStateCredentialSummary.load(envStore: envStore, authURL: authURL)
            .map(\.providerId)
        XCTAssertEqual(ids, ["deepseek", "xai"])
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `swift test --filter EmptyStateCredentialSummaryTests 2>&1 | tail -20`

Expected: compile failure — `EmptyStateCredentialSummary` undefined.

- [ ] **Step 3: Minimal implementation**

Create `Sources/PipiUI/EmptyStateCredentialSummary.swift`:

```swift
import Foundation

struct EmptyStateConfiguredProvider: Equatable, Identifiable, Sendable {
    let providerId: String
    var id: String { providerId }
}

/// Loads configured AI providers for the empty-state landing page.
/// Search-only env keys are ignored; see `ProviderEnvMap.searchEnvVars`.
enum EmptyStateCredentialSummary {
    static func load(
        envStore: EnvFileStore = EnvFileStore(),
        authURL: URL = PiAuthStore.defaultAuthURL()
    ) -> [EmptyStateConfiguredProvider] {
        var ids = Set<String>()

        for (providerId, envVars) in ProviderEnvMap.envVarsByProvider {
            if envVars.contains(where: { envStore.isConfigured(forKey: $0) }) {
                ids.insert(providerId)
            }
        }

        for cred in PiAuthStore.list(authURL: authURL) {
            ids.insert(cred.providerId)
        }

        return ids.sorted().map { EmptyStateConfiguredProvider(providerId: $0) }
    }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `swift test --filter EmptyStateCredentialSummaryTests 2>&1 | tail -20`

Expected: all tests in filter PASS.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add Sources/PipiUI/EmptyStateCredentialSummary.swift \
  Tests/PipiUITests/EmptyStateCredentialSummaryTests.swift
git commit -m "$(cat <<'EOF'
feat: EmptyStateCredentialSummary 扫描已配置 AI 提供商

EOF
)"
```

---

### Task 2: 共享 `quotaProvider(for:)` + 状态文案格式化

**Files:**
- Modify: `Sources/PipiUI/QuotaSnapshot.swift`（在 `enum QuotaProvider` 之前或之后加 free function）
- Modify: `Sources/PipiUI/ChatSession.swift`（`ModelInfo.quotaProvider` 委托）
- Modify: `Sources/PipiUI/EmptyStateCredentialSummary.swift`（加 `statusText` helper）
- Modify: `Tests/PipiUITests/EmptyStateCredentialSummaryTests.swift`

**Interfaces:**
- Consumes: existing `QuotaSnapshot.capsule`, `formatBalance`, `balanceProvider(for:)`
- Produces:
  ```swift
  /// Same routing rules as former `ModelInfo.quotaProvider` (relay → nil).
  func quotaProvider(for provider: String) -> QuotaProvider?

  enum EmptyStateCredentialSummary {
      /// Pure formatter for a row's trailing status.
      /// - quotaUsedPercent: 0…100 used% when known
      /// - balanceText: preformatted `formatBalance` string when known
      /// Prefer quota over balance when both non-nil.
      static func statusText(
          quotaUsedPercent: Double?,
          balanceText: String?
      ) -> String
  }
  ```

- [ ] **Step 1: Extend failing tests**

Append to `EmptyStateCredentialSummaryTests.swift`:

```swift
    func testStatusTextPrefersQuotaOverBalance() {
        XCTAssertEqual(
            EmptyStateCredentialSummary.statusText(quotaUsedPercent: 42, balanceText: "¥10.00"),
            "已用 42%"
        )
    }

    func testStatusTextBalanceWhenNoQuota() {
        XCTAssertEqual(
            EmptyStateCredentialSummary.statusText(quotaUsedPercent: nil, balanceText: "$1.25"),
            "$1.25"
        )
    }

    func testStatusTextConfiguredFallback() {
        XCTAssertEqual(
            EmptyStateCredentialSummary.statusText(quotaUsedPercent: nil, balanceText: nil),
            "已配置"
        )
    }

    func testStatusTextRoundsPercent() {
        XCTAssertEqual(
            EmptyStateCredentialSummary.statusText(quotaUsedPercent: 41.6, balanceText: nil),
            "已用 42%"
        )
    }

    func testQuotaProviderRoutingMatchesModelInfo() {
        XCTAssertEqual(quotaProvider(for: "xai"), .grok)
        XCTAssertEqual(quotaProvider(for: "kimi-coding"), .kimi)
        XCTAssertEqual(quotaProvider(for: "deepseek"), nil) // balance-only
        XCTAssertNil(quotaProvider(for: "openai-relay"))
    }
```

Also add a regression in an existing multi-provider quota test file **if** one asserts via `ModelInfo` — behavior must stay identical. Prefer asserting the free function above; then manually confirm `ModelInfo` still compiles via full filter in Step 4.

- [ ] **Step 2: Run filter — expect FAIL on new tests**

Run: `swift test --filter EmptyStateCredentialSummaryTests 2>&1 | tail -30`

Expected: failures for missing `statusText` / `quotaProvider(for:)`.

- [ ] **Step 3: Implement routing + formatter**

In `QuotaSnapshot.swift` (near `balanceProvider` counterpart — place after `QuotaProvider` enum is fine):

```swift
/// Map a pi provider id → account-quota source. Relay / unknown → nil.
/// Keep in sync with former `ModelInfo.quotaProvider` rules.
func quotaProvider(for provider: String) -> QuotaProvider? {
    let p = provider.lowercased()
    if p.contains("relay") { return nil }
    if p == "xai" || p.contains("grok") { return .grok }
    if p.contains("zai") || p.contains("zhipu") || p.contains("bigmodel") { return .glm }
    if p == "anthropic" || p.contains("claude") { return .claude }
    if p.contains("openai") || p.contains("codex") { return .codex }
    if p.contains("kimi") { return .kimi }
    if p.contains("qoder") { return .qoder }
    if p.contains("qwen-token-plan") { return .qwenTokenPlan }
    return nil
}
```

In `ChatSession.swift` replace `ModelInfo.quotaProvider` body with:

```swift
var quotaProvider: QuotaProvider? {
    PipiUI.quotaProvider(for: provider)
}
```

Note: `ModelInfo` previously used `isRelayProvider` — the free function uses `p.contains("relay")` which matches `balanceProvider(for:)` and covers the same cases. If `isRelayProvider` has extra rules, keep calling it:

```swift
var quotaProvider: QuotaProvider? {
    if isRelayProvider { return nil }
    return PipiUI.quotaProvider(for: provider)
}
```

and make the free function **not** special-case relay (or keep both — tests for `openai-relay` must pass). Prefer: free function includes relay check; `ModelInfo` keeps `if isRelayProvider { return nil }` then calls free function without double-checking if redundant. **Implementer: read `isRelayProvider` and mirror its condition in the free function OR keep the guard on `ModelInfo` only and omit relay from free-function tests that go through ModelInfo.**

Simplest approved approach:

```swift
func quotaProvider(for provider: String) -> QuotaProvider? {
    let p = provider.lowercased()
    if p.contains("relay") { return nil }
    // … same matches as current ModelInfo.quotaProvider …
}
```

```swift
// ModelInfo
var quotaProvider: QuotaProvider? {
    if isRelayProvider { return nil }
    return PipiUI.quotaProvider(for: provider)
}
```

In `EmptyStateCredentialSummary.swift` add:

```swift
static func statusText(quotaUsedPercent: Double?, balanceText: String?) -> String {
    if let q = quotaUsedPercent {
        return "已用 \(Int(q.rounded()))%"
    }
    if let b = balanceText, !b.isEmpty {
        return b
    }
    return "已配置"
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
swift test --filter EmptyStateCredentialSummaryTests 2>&1 | tail -30
swift test --filter MultiProviderQuotaTests 2>&1 | tail -20
```

Expected: PASS (or skip second filter if file absent / rename — then `swift test --filter Quota 2>&1 | tail -40`).

- [ ] **Step 5: Commit (only if user asked)**

---

### Task 3: 增强 `EmptyStateView`（说明 + CTA + AddModelSheet）

**Files:**
- Create: `Sources/PipiUI/Views/EmptyStateView.swift`
- Modify: `Sources/PipiUI/App.swift` — delete the old `struct EmptyStateView` (lines ~625–647); keep `detail` using `EmptyStateView()`

**Interfaces:**
- Consumes: `EmptyStateCredentialSummary.load`, `AddModelSheet`, `BrandMark`, `AppStore.addProjectViaPanel()`
- Produces: enhanced empty landing; `hasCredentials` from `!providers.isEmpty`

- [ ] **Step 1: Move + rewrite EmptyStateView**

Create `Sources/PipiUI/Views/EmptyStateView.swift` with this structure (full body required):

```swift
import SwiftUI

struct EmptyStateView: View {
    @EnvironmentObject var store: AppStore

    @State private var showAddModelSheet = false
    @State private var providers: [EmptyStateConfiguredProvider] = []
    /// providerId → status trailing text
    @State private var statusByProvider: [String: String] = [:]
    @State private var quotaObserverIDs: [QuotaProvider: UUID] = [:]
    @State private var balanceObserverIDs: [BalanceProvider: UUID] = [:]

    private var hasCredentials: Bool { !providers.isEmpty }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                brandBlock
                featureBlock
                if hasCredentials {
                    providerBlock
                }
                ctaBlock
            }
            .frame(maxWidth: 520)
            .padding(32)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
        .onAppear { refreshCredentials() }
        .onDisappear { tearDownMonitors() }
        .sheet(isPresented: $showAddModelSheet) {
            AddModelSheet {
                refreshCredentials()
            }
            .environmentObject(store)
            .dismissOnOutsideClick { showAddModelSheet = false }
        }
    }

    private var brandBlock: some View {
        VStack(spacing: 10) {
            Image(systemName: "terminal")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(.tertiary)
            BrandMark(size: .hero)
            Text("基于纯 Pi 的桌面界面，并内置编排与工具能力。")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var featureBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            featureRow(icon: "person.3", title: "多 Agent 编排", detail: "可并行派生子任务协作")
            featureRow(icon: "magnifyingglass", title: "内置搜索", detail: "模型无搜索时自动触发")
            featureRow(icon: "doc.text.viewfinder", title: "图片 OCR", detail: "模型不识图时自动触发")
            featureRow(icon: "desktopcomputer", title: "Computer Use", detail: "可操作本机界面完成任务")
            featureRow(icon: "antenna.radiowaves.left.and.right", title: "远程控制", detail: "可远程接入并操控会话环境")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func featureRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.medium))
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var providerBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("已配置的 AI 提供商")
                .font(.subheadline.weight(.semibold))
            ForEach(providers) { row in
                HStack {
                    Text(row.providerId)
                        .font(.body.monospaced())
                    Spacer()
                    Text(statusByProvider[row.providerId] ?? "已配置")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
    }

    @ViewBuilder
    private var ctaBlock: some View {
        if hasCredentials {
            VStack(spacing: 10) {
                Button {
                    store.addProjectViaPanel()
                } label: {
                    Label("添加项目文件夹", systemImage: "folder.badge.plus")
                }
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)

                Button("添加模型") {
                    showAddModelSheet = true
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        } else {
            VStack(spacing: 10) {
                Button {
                    showAddModelSheet = true
                } label: {
                    Label("添加模型", systemImage: "key.fill")
                }
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)

                Button("添加项目文件夹") {
                    store.addProjectViaPanel()
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
    }

    private func refreshCredentials() {
        Task.detached(priority: .userInitiated) {
            let loaded = EmptyStateCredentialSummary.load()
            await MainActor.run {
                providers = loaded
                // Seed defaults; Task 4 overwrites with live monitors.
                var seed: [String: String] = [:]
                for p in loaded { seed[p.providerId] = "已配置" }
                statusByProvider = seed
                bindMonitors(for: loaded)
            }
        }
    }

    // Stubs filled in Task 4 — must compile:
    private func bindMonitors(for providers: [EmptyStateConfiguredProvider]) {
        tearDownMonitors()
        // Task 4 implements observe + refreshIfNeeded
    }

    private func tearDownMonitors() {
        for (qp, id) in quotaObserverIDs {
            qp.monitor.removeObserver(id)
        }
        quotaObserverIDs.removeAll()
        for (bp, id) in balanceObserverIDs {
            bp.monitor.removeObserver(id)
        }
        balanceObserverIDs.removeAll()
    }
}
```

Delete the old `struct EmptyStateView` from `App.swift` entirely (no duplicate type).

- [ ] **Step 2: Build**

Run: `swift build 2>&1 | tail -40`

Expected: build succeeds. (`bindMonitors` may be empty stub.)

- [ ] **Step 3: Manual smoke checklist (document in commit message / PR notes)**

Without packaging:
1. Launch via `swift run` (primary checkout) or existing app if user has one.
2. Deselect session / empty detail → see tagline + 5 bullets + primary「添加模型」when no keys.
3. Click → `AddModelSheet` appears (same as Settings).
4. Cancel sheet → still on empty page.

- [ ] **Step 4: Commit (only if user asked)**

---

### Task 4: 绑定 Quota / Balance 监视器

**Files:**
- Modify: `Sources/PipiUI/Views/EmptyStateView.swift` — fill `bindMonitors`
- Modify: `Tests/PipiUITests/EmptyStateCredentialSummaryTests.swift` — optional mapping helper test

**Interfaces:**
- Consumes: `quotaProvider(for:)`, `balanceProvider(for:)`, `QuotaProvider.monitor`, `BalanceProvider.monitor`, `formatBalance`
- Produces: live updates to `statusByProvider`

- [ ] **Step 1: Implement `bindMonitors`**

Replace stub with:

```swift
private func bindMonitors(for providers: [EmptyStateConfiguredProvider]) {
    tearDownMonitors()
    var seenQuota = Set<QuotaProvider>()
    var seenBalance = Set<BalanceProvider>()

    for row in providers {
        if let qp = quotaProvider(for: row.providerId) {
            guard seenQuota.insert(qp).inserted else { continue }
            let pid = row.providerId
            let id = qp.monitor.observe { [weak store = Optional.some(store)] snap in
                // store unused; capture for MainActor pattern consistency
                _ = store
                let text = EmptyStateCredentialSummary.statusText(
                    quotaUsedPercent: snap?.capsule?.usedPercent,
                    balanceText: nil
                )
                // Update all provider rows that map to this QuotaProvider
                Task { @MainActor in
                    for p in self.providers where quotaProvider(for: p.providerId) == qp {
                        self.statusByProvider[p.providerId] = text
                    }
                }
            }
            quotaObserverIDs[qp] = id
            qp.monitor.refreshIfNeeded(force: false)
            continue
        }

        if let bp = balanceProvider(for: row.providerId) {
            guard seenBalance.insert(bp).inserted else { continue }
            let id = bp.monitor.observe { snap in
                let balance: String? = {
                    guard let snap else { return nil }
                    return formatBalance(amount: snap.amount, currency: snap.currency)
                }()
                let text = EmptyStateCredentialSummary.statusText(
                    quotaUsedPercent: nil,
                    balanceText: balance
                )
                Task { @MainActor in
                    for p in self.providers where balanceProvider(for: p.providerId) == bp
                        && quotaProvider(for: p.providerId) == nil {
                        self.statusByProvider[p.providerId] = text
                    }
                }
            }
            balanceObserverIDs[bp] = id
            bp.monitor.refreshIfNeeded(force: false)
        }
    }
}
```

**Important implementer notes:**

1. Read actual `BalanceMonitor` protocol (`observe` / `removeObserver` / `refreshIfNeeded`) in `BalanceSnapshot.swift` and match signatures exactly — mirror `QuotaMonitor` if identical.
2. Do **not** use the buggy `[weak store = Optional.some(store)]` pattern above if the compiler rejects it. Prefer:

```swift
let id = qp.monitor.observe { snap in
    let percent = snap?.capsule?.usedPercent
    Task { @MainActor in
        self.applyQuota(qp, usedPercent: percent)
    }
}
```

with small `@MainActor` helpers `applyQuota` / `applyBalance` on the view via a nested `@MainActor final class EmptyStateMonitorHost: ObservableObject` **if** SwiftUI struct capture of `self` in escaping closures is problematic.

**Preferred cleaner approach (use this if observe escaping causes issues):**

Create in the same file:

```swift
@MainActor
final class EmptyStateAccountStatusModel: ObservableObject {
    @Published var providers: [EmptyStateConfiguredProvider] = []
    @Published var statusByProvider: [String: String] = [:]
    private var quotaObserverIDs: [QuotaProvider: UUID] = [:]
    private var balanceObserverIDs: [BalanceProvider: UUID] = [:]

    func reload() { /* load + bindMonitors */ }
    func tearDown() { /* remove observers */ }
    // bindMonitors / applyQuota / applyBalance as methods on this class
}
```

Then `EmptyStateView` holds `@StateObject private var accountStatus = EmptyStateAccountStatusModel()` and renders from it. This avoids escaping-closure + View `self` pain. **If Task 3 already used @State, Task 4 may refactor to `@StateObject` model — that refactor is in scope for Task 4.**

3. Failures stay silent: monitors already keep last snapshot; `statusText(nil,nil)` →「已配置」.

- [ ] **Step 2: Build + unit tests still pass**

Run:
```bash
swift build 2>&1 | tail -30
swift test --filter EmptyStateCredentialSummaryTests 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 3: Manual smoke with a real key (if available)**

1. Empty page with existing `.env` key → provider row visible.
2. For deepseek/moonshot/etc. → balance string or「已配置」.
3. For xai/kimi-coding/etc. →「已用 N%」or「已配置」.
4. Add model via sheet → list refreshes; CTA flips to project-primary.

- [ ] **Step 4: Commit (only if user asked)**

---

### Task 5: 回归验证

**Files:** none new

- [ ] **Step 1: Targeted tests**

```bash
swift test --filter EmptyStateCredentialSummaryTests 2>&1 | tail -40
```

Expected: all PASS.

- [ ] **Step 2: Broader related filters**

```bash
swift test --filter EnvFileStoreTests 2>&1 | tail -20
swift test --filter BalanceProviderTests 2>&1 | tail -20
swift test --filter MultiProviderQuotaTests 2>&1 | tail -20
```

Expected: PASS (skip any filter that doesn't exist).

- [ ] **Step 3: Full build**

```bash
swift build 2>&1 | tail -20
```

Expected: success.

- [ ] **Step 4: Spec checklist**

Confirm against spec:

| Spec item | Done? |
|---|---|
| API-first CTA when no creds | |
| Direct AddModelSheet | |
| Provider list only when creds exist | |
| Tagline + 5 feature bullets | |
| Quota/balance or「已配置」 | |
| Settings Add Model path untouched | |
| No wizard / no AppStore flag | |

- [ ] **Step 5: Optional package** — only if user asks: `./make-app.sh` on primary checkout, then `stat` app vs sources.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| API-first / project-secondary CTA swap | Task 3 |
| Direct `AddModelSheet` sheet | Task 3 |
| Provider list only when credentials exist | Task 1 + 3 |
| `.env` ∪ auth.json, exclude search keys, dedupe | Task 1 |
| Product tagline + 5 bullets | Task 3 |
| Quota/balance reuse monitors; fallback「已配置」 | Task 2 + 4 |
| Enhance EmptyStateView; optional extract file | Task 3 (`Views/EmptyStateView.swift`) |
| Out of scope: wizard, AddModelSheet edits, jcode | — not in plan |
| Unit tests for summary helper | Task 1–2 |
| No make-app unless asked | Task 5 |

## Placeholder / consistency check

- No TBD steps.
- Types: `EmptyStateConfiguredProvider`, `EmptyStateCredentialSummary.load`, `statusText`, `quotaProvider(for:)` used consistently across tasks.
- InputBar shows used%; empty state copy is「已用 N%」to match snapshot semantics (spec said「consistent with InputBar」).
