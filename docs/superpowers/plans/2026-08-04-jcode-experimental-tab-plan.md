# jcode 实验性 tab（全局开关 + 终端 login）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置里加一个「实验」tab，含「启用 jcode 模式」全局开关 + 「在终端配置 jcode 凭证」按钮 + 已配置 provider 状态行；撤销之前的聊天面板中间切换器（EngineSwitcherOverlay）。

**Architecture:** 新建 `JcodeSettings`（UserDefaults 开关 + provider 探测）和 `JcodeLoginLauncher`（osascript 弹 Terminal）；`SettingsTab` 加 `.experimental` case 并在两个 switch 补分发；`AppStore.newSession` 默认 engine 读 `JcodeSettings.isEnabled`。撤销 commit 118cecd 的 overlay 三处（EngineSwitcherOverlay.swift、ChatDetailView overlay、AppStore.switchEngine），保留 23c3854 的模型 RPC 修复和 Plan B 引擎基础。

**Tech Stack:** Swift 6.3 · SwiftUI macOS 14+ · SwiftPM XCTest · UserDefaults · NSAppleScript/osascript · Process（jcode auth status --json 探测）。

**Spec:** `docs/superpowers/specs/2026-08-04-jcode-experimental-tab-design.md`（approved）。

## Global Constraints

- **pi 路径零回归。** 1537 测试必须继续全绿。`newSession` 默认 engine 改动只在 `isEnabled` 为 true 时变 `.jcode`，false 时仍是 `.pi`（行为等价）。
- **不碰 jcode 引擎基础。** `EngineKind`/`.jcode` 分叉/`EngineBadge`/`JcodeBackend`/`JcodeBridge`/commit 23c3854 的 RPC 修复全部保留。本计划只加设置 tab + 撤销 overlay。
- **只 shell out，不内嵌凭证。** 凭证靠 `jcode login`（终端交互），PipiUI 不写任何 jcode 配置文件。`detectConfiguredProviders` 只**读** `jcode auth status --json`，不写。
- **验证用 `swift test` + 手动 App smoke。** 本计划不做 `make-app.sh` 打包（那是全部完成后的最后一步），但最后一个任务要跑一次 make-app 让用户手动验证 UI。
- **外部 WIP 隔离。** 当前分支有外部 agent 的 commit `cf1be47`（volc-engine-add）。实施前先确认它和本计划改的文件不冲突；若冲突，stash 它。

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/JcodeSettings.swift` | **新建。** `JcodeSettings.isEnabled`（UserDefaults）+ `detectConfiguredProviders()`（异步，shell out jcode auth status --json）。 |
| `Sources/PipiUI/JcodeLoginLauncher.swift` | **新建。** `JcodeLoginLauncher.openLoginInTerminal()`（osascript 弹 Terminal 跑 jcode login）。 |
| `Sources/PipiUI/Views/SettingsSheet.swift` | `SettingsTab` 加 `.experimental`（enum + accessibilityName + systemImage 两个 switch）；`activeNonModelSection`（:193）加分发；新增 `experimentalSection` 视图。 |
| `Sources/PipiUI/AppStore.swift` | `newSession(project:engine:)`（:1803）默认 engine 改读 `JcodeSettings.isEnabled`；删除 `switchEngine(for:to:)`（~:1936，撤销 118cecd）。 |
| `Sources/PipiUI/Views/ChatDetailView.swift` | 删除 `.overlay { EngineSwitcherOverlay(session:) }` + 注释（~:688-694，撤销 118cecd）。 |
| `Sources/PipiUI/Views/EngineSwitcherOverlay.swift` | **删除整个文件**（撤销 118cecd）。 |
| `Tests/PipiUITests/JcodeSettingsTests.swift` | **新建。** `isEnabled` UserDefaults 往返；`detectConfiguredProviders` JSON 解析（fixture，不需真 jcode）。 |

---

### Task 1: JcodeSettings（开关 + provider 探测）

**Files:**
- Create: `Sources/PipiUI/JcodeSettings.swift`
- Test: `Tests/PipiUITests/JcodeSettingsTests.swift`

**Interfaces:**
- Consumes: 无。
- Produces: `JcodeSettings.isEnabled`（static Bool get/set，UserDefaults `"pipiui.jcode.enabled"`）；`JcodeSettings.detectConfiguredProviders(completion:)`（async，completion 在主线程返 `[String]`）。

- [ ] **Step 1: 写失败测试**

Create `Tests/PipiUITests/JcodeSettingsTests.swift`：
```swift
import XCTest
@testable import PipiUI

final class JcodeSettingsTests: XCTestCase {
    private let defaults = UserDefaults.standard
    private let key = "pipiui.jcode.enabled"

    override func tearDown() {
        defaults.removeObject(forKey: key)
        super.tearDown()
    }

    func testIsEnabledDefaultsFalse() {
        defaults.removeObject(forKey: key)
        XCTAssertFalse(JcodeSettings.isEnabled)
    }

    func testIsEnabledRoundTrip() {
        JcodeSettings.isEnabled = true
        XCTAssertTrue(defaults.bool(forKey: key))
        XCTAssertTrue(JcodeSettings.isEnabled)

        JcodeSettings.isEnabled = false
        // stored as false = removed-or-false; reads back false
        XCTAssertFalse(JcodeSettings.isEnabled)
    }

    /// Parsing fixture: only providers with status != "not_configured" are returned.
    func testParseConfiguredProvidersFromFixture() {
        let fixture = """
        {"providers":[
          {"id":"claude","status":"not_configured"},
          {"id":"deepseek","status":"available"},
          {"id":"kimi","status":"available"},
          {"id":"cursor","status":"configured"}
        ]}
        """
        let ids = JcodeSettings.parseProviders(from: Data(fixture.utf8))
        XCTAssertEqual(ids.sorted(), ["cursor", "deepseek", "kimi"])
    }

    func testParseMalformedJSONReturnsEmpty() {
        let ids = JcodeSettings.parseProviders(from: Data("not json".utf8))
        XCTAssertEqual(ids, [])
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `swift test --filter JcodeSettingsTests 2>&1 | tail -10`
Expected: 编译失败，`JcodeSettings` 未定义。

- [ ] **Step 3: 实现 JcodeSettings**

Create `Sources/PipiUI/JcodeSettings.swift`：
```swift
import Foundation

/// UserDefaults-backed global toggle + jcode credential probe for the
/// Experimental settings tab. No credential writes — jcode owns its login.
enum JcodeSettings {
    private static let key = "pipiui.jcode.enabled"

    static var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// Parse `jcode auth status --json` output → ids of providers whose status
    /// is not "not_configured". Pure (testable with fixtures); the live shell-out
    /// wrapper is `detectConfiguredProviders(completion:)`.
    static func parseProviders(from data: Data) -> [String] {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let providers = obj["providers"] as? [[String: Any]] else { return [] }
        return providers.compactMap { p in
            ((p["status"] as? String) ?? "not_configured") != "not_configured"
                ? (p["id"] as? String)
                : nil
        }
    }

    /// Async: shell out to `jcode auth status --json`, return configured provider
    /// ids on the main thread. Empty if jcode is missing or parsing fails.
    static func detectConfiguredProviders(completion: @escaping ([String]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let p = Process()
            // Reuse the same resolver as JcodeBridge to locate the binary.
            if let bin = JcodeBridge.findJcodeExecutable() {
                p.executableURL = URL(fileURLWithPath: bin)
            } else {
                DispatchQueue.main.async { completion([]) }
                return
            }
            p.arguments = ["auth", "status", "--json"]
            let out = Pipe()
            p.standardOutput = out
            p.standardError = Pipe()
            do { try p.run(); p.waitUntilExit() } catch {
                DispatchQueue.main.async { completion([]) }; return
            }
            let data = out.fileHandleForReading.readDataToEndOfFile()
            let ids = parseProviders(from: data)
            DispatchQueue.main.async { completion(ids) }
        }
    }
}
```

**注意**：`JcodeBridge.findJcodeExecutable()` 是已有的 static 方法（`Sources/PipiUI/JcodeBridge.swift`），返回 `String?`。这里复用它定位 jcode，避免重复 PATH 查找逻辑。

- [ ] **Step 4: 跑测试确认通过**

Run: `swift test --filter JcodeSettingsTests 2>&1 | tail -10`
Expected: 4 个测试通过。

- [ ] **Step 5: 全量测试无回归**

Run: `swift test 2>&1 | grep -E 'Executed [0-9]+ tests' | tail -1`
Expected: 1537 + 4 = **1541 passed, 0 failures**。

- [ ] **Step 6: Commit**

```bash
git add Sources/PipiUI/JcodeSettings.swift Tests/PipiUITests/JcodeSettingsTests.swift
git commit -m "feat(jcode): JcodeSettings — global toggle + provider probe

UserDefaults-backed 'pipiui.jcode.enabled' toggle, plus detectConfiguredProviders
shelling out to 'jcode auth status --json' (pure parser unit-tested with fixtures).
No credential writes — jcode owns its login."
```

---

### Task 2: JcodeLoginLauncher（osascript 弹终端）

**Files:**
- Create: `Sources/PipiUI/JcodeLoginLauncher.swift`

**Interfaces:**
- Consumes: `JcodeBridge.findJcodeExecutable()`（Task 1 已用，定位 jcode）。
- Produces: `JcodeLoginLauncher.openLoginInTerminal()`（static，无参无返回，osascript 弹 Terminal）。

- [ ] **Step 1: 实现 JcodeLoginLauncher**

Create `Sources/PipiUI/JcodeLoginLauncher.swift`：
```swift
import Foundation

/// Opens macOS Terminal running `jcode login` so the user can complete jcode's
/// interactive provider login (OAuth browser flow / API key entry). PipiUI does
/// not embed a terminal or capture the result — the user finishes in Terminal.
enum JcodeLoginLauncher {
    /// Run `jcode login` in a new Terminal window via AppleScript. Brings
    /// Terminal to front. Best-effort: if AppleScript fails, no-op (the user can
    /// still run jcode login manually).
    static func openLoginInTerminal() {
        // Prefer bare `jcode login` (installer writes ~/.local/bin to .zshenv, so
        // a fresh Terminal resolves it). Fall back to the absolute path.
        let cmd: String
        if let bin = JcodeBridge.findJcodeExecutable() {
            // Quote the path in case it contains spaces; jcode is the binary itself.
            cmd = "'\(bin)' login"
        } else {
            cmd = "jcode login"
        }
        // osascript: tell Terminal to run the command in a new window and activate.
        let script = """
        tell application "Terminal"
            activate
            do script "\(cmd.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))"
        end tell
        """
        // NSAppleScript runs on main; for a fire-and-forget UI action that's fine.
        DispatchQueue.global(qos: .userInitiated).async {
            let appleScript = NSAppleScript(source: script)
            var errorInfo: NSDictionary?
            appleScript?.executeAndReturnError(&errorInfo)
            if let errorInfo {
                Log.warn("jcode login AppleScript failed: \(errorInfo)", category: .session)
            }
        }
    }
}
```

**注意**：
- 用 `NSAppleScript`（Foundation 原生），不 shell out 到 `osascript` 二进制——更轻、无 PATH 依赖。
- `cmd.replacingOccurrences` 转义反斜杠和引号，避免 AppleScript 注入（虽然 `bin` 路径通常安全）。
- `Log.warn` 是项目已有的日志工具（`Sources/PipiUI/Log.swift`，`category: .session` 是已有枚举值）。
- 无单测（osascript 弹真终端无法单测）；Task 6 手动 App 验证。

- [ ] **Step 2: 全量测试确认编译 + 无回归**

Run: `swift test 2>&1 | grep -E 'Executed [0-9]+ tests' | tail -1`
Expected: **1541 passed, 0 failures**（新文件不影响现有路径，无新增测试）。

- [ ] **Step 3: Commit**

```bash
git add Sources/PipiUI/JcodeLoginLauncher.swift
git commit -m "feat(jcode): JcodeLoginLauncher — open Terminal at 'jcode login'

NSAppleScript tells Terminal to run 'jcode login' (interactive provider
login). Fire-and-forget; user completes OAuth/key entry in Terminal. No
result capture — PipiUI never embeds credentials."
```

---

### Task 3: 撤销 EngineSwitcherOverlay（commit 118cecd）

**Files:**
- Delete: `Sources/PipiUI/Views/EngineSwitcherOverlay.swift`
- Modify: `Sources/PipiUI/Views/ChatDetailView.swift`（删 overlay + 注释，~:688-694）
- Modify: `Sources/PipiUI/AppStore.swift`（删 `switchEngine`，~:1936-1950）

**Interfaces:**
- Consumes: 无。
- Produces: EngineSwitcherOverlay 完全移除；`switchEngine(for:to:)` 移除。后续 task 不再引用它们。

- [ ] **Step 1: 删除 EngineSwitcherOverlay.swift**

```bash
rm Sources/PipiUI/Views/EngineSwitcherOverlay.swift
```

- [ ] **Step 2: ChatDetailView 删 overlay**

读 `Sources/PipiUI/Views/ChatDetailView.swift` ~:685-695，删除这一段（连同注释）：
```swift
            // Empty-session engine picker, centered over the transcript. Only
            // renders when the session is empty+idle (EngineSwitcherOverlay
            // returns EmptyView otherwise), and only after the loading overlay
            // above has dismissed (isInitializing flips the empty-state guard).
            .overlay {
                EngineSwitcherOverlay(session: session)
            }
```
保留它前面的 `.overlay { TranscriptLoadingOverlay(...) }`。

- [ ] **Step 3: AppStore 删 switchEngine**

读 `Sources/PipiUI/AppStore.swift` ~:1936-1950，删除整个方法（连同注释）：
```swift
    /// Switch the engine of an empty session by closing it and creating a fresh
    /// empty session with the chosen engine. No-op (returns) if the session has
    /// any real (non-local-only) message — the EngineSwitcherOverlay only shows
    /// on empty sessions, and this guard makes that contract robust. Preserves
    /// project and selection: the new session becomes the selected one.
    func switchEngine(for session: ChatSession, to engine: EngineKind) {
        // Safety: never discard a session that has real history.
        guard !session.transcript.contains(where: { !$0.isLocalOnly }) else { return }
        guard engine != session.engineKind else { return }
        guard let key = openSessions.first(where: { $0.value === session })?.key else { return }
        let project = session.projectURL
        closeSession(key: key)
        let (newKey, _) = createSessionInBackground(project: project, engine: engine)
        selectedSessionKey = newKey
    }
```

- [ ] **Step 4: 全量测试**

Run: `swift test 2>&1 | grep -E 'Executed [0-9]+ tests' | tail -1`
Expected: **1541 passed, 0 failures**（EngineSwitcherOverlay 无单测，删除后编译应通过——确认无残留引用）。

如果编译失败报 "EngineSwitcherOverlay" 未定义 → 说明还有残留引用，grep 全库找并删除。

- [ ] **Step 5: Commit**

```bash
git add -A Sources/PipiUI/Views/EngineSwitcherOverlay.swift Sources/PipiUI/Views/ChatDetailView.swift Sources/PipiUI/AppStore.swift
git commit -m "revert(ui): remove EngineSwitcherOverlay + switchEngine

The in-chat engine switcher is superseded by the Experimental settings tab
(global toggle). Reverts the overlay + AppStore.switchEngine from commit
118cecd; the sidebar '+' plain-button revert (also in 118cecd) stays.
Plan B engine foundation (EngineKind/.jcode fork/EngineBadge) and the
23c3854 model-RPC fixes are retained."
```

---

### Task 4: SettingsTab 加 .experimental + experimentalSection

**Files:**
- Modify: `Sources/PipiUI/Views/SettingsSheet.swift`

**Interfaces:**
- Consumes: `JcodeSettings`（Task 1）、`JcodeLoginLauncher`（Task 2）、`JcodeBridge.findJcodeExecutable()`（已有）。
- Produces: 「实验」tab UI（勾选框 + 终端 login 按钮 + 状态行）。

- [ ] **Step 1: SettingsTab enum 加 case**

`SettingsSheet.swift:4-12`，在 `case memory = "记忆"` 后加：
```swift
    case experimental = "实验"
```

- [ ] **Step 2: accessibilityName + systemImage 补分发**

`accessibilityName` switch（:17-24）：`default` 已覆盖新 case（返回 rawValue "实验"），无需改。

`systemImage` switch（:26-34）：在 `case .memory: return "brain.head.profile"` 后加：
```swift
        case .experimental: return "flask"
```

- [ ] **Step 3: activeNonModelSection 加分发**

读 `SettingsSheet.swift:193-209`（`switch tab`）。在最后一个非 `.models` case 后（即 `.memory` 分支后）加：
```swift
        case .experimental:
            experimentalSection
```

- [ ] **Step 4: 实现 experimentalSection 视图**

在 `SettingsSheet` 里（其他 section 方法附近，如 `builtInSection` 之后）加：
```swift
    // MARK: - Experimental (jcode)

    @State private var jcodeConfiguredProviders: [String] = []
    @State private var jcodeProbing = false
    @State private var showJcodeEnableConfirm = false

    private var experimentalSection: some View {
        GroupBox("jcode 引擎（实验性）") {
            VStack(alignment: .leading, spacing: 12) {
                let jcodeInstalled = JcodeBridge.findJcodeExecutable() != nil

                Toggle("启用 jcode 模式", isOn: Binding(
                    get: { JcodeSettings.isEnabled },
                    set: { newValue in
                        if newValue { showJcodeEnableConfirm = true }
                        else { JcodeSettings.isEnabled = false }
                    }
                ))
                .disabled(!jcodeInstalled)

                Text("勾选后，新建会话将使用 jcode 引擎（独立凭证体系，需先在下方配置）。jcode 自带 swarm 编排。")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if !jcodeInstalled {
                    Label("未检测到 jcode，请先安装：curl -fsSL https://jcode.sh/install | bash", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }

                Divider()

                Text("凭证配置").font(.headline)
                Text("jcode 使用独立的凭证体系，不与 pi 共享。点击下方按钮在终端完成 provider 登录。")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Button("在终端配置 jcode 凭证…") {
                    JcodeLoginLauncher.openLoginInTerminal()
                }

                HStack {
                    if jcodeProbing {
                        ProgressView().controlSize(.mini)
                        Text("正在检测…").font(.caption).foregroundStyle(.secondary)
                    } else if jcodeConfiguredProviders.isEmpty {
                        Label("未检测到已配置的 provider", systemImage: "exclamationmark.triangle")
                            .font(.caption).foregroundStyle(.orange)
                    } else {
                        Label("检测到 \(jcodeConfiguredProviders.count) 个 provider：\(jcodeConfiguredProviders.joined(separator: ", "))", systemImage: "checkmark.circle")
                            .font(.caption).foregroundStyle(.green)
                    }
                    Spacer()
                    Button("刷新") { refreshJcodeProviders() }
                        .buttonStyle(.borderless)
                        .font(.caption)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { refreshJcodeProviders() }
        .confirmationDialog(
            "切换到 jcode 模式？",
            isPresented: $showJcodeEnableConfirm
        ) {
            Button("切换到 jcode") { JcodeSettings.isEnabled = true }
            Button("取消", role: .cancel) {}
        } message: {
            Text("之后新建的会话将使用 jcode 引擎。jcode 使用独立凭证体系，需先配置 provider。已存在的 pi 会话不受影响。")
        }
    }

    private func refreshJcodeProviders() {
        jcodeProbing = true
        JcodeSettings.detectConfiguredProviders { ids in
            jcodeConfiguredProviders = ids
            jcodeProbing = false
        }
    }
```

**注意**：
- `@State` 放在 `SettingsSheet` 结构体里（和其他 `@State` 如 `showAddSheet` 同区，约 :81）。
- 勾选框用自定义 Binding：点开时弹 confirmationDialog（:showJcodeEnableConfirm），确认后才真开；点关直接关（无需确认）。
- 状态行 onAppear 自动刷新 + 手动「刷新」按钮（spec 说的"无 live polling，靠 onAppear + 手动刷新"）。
- `JcodeBridge.findJcodeExecutable()` 是 static（`Sources/PipiUI/JcodeBridge.swift:62`），SwiftUI view 里直接调（它只是文件系统检查，开销小）。

- [ ] **Step 5: 全量测试**

Run: `swift test 2>&1 | grep -E 'Executed [0-9]+ tests' | tail -1`
Expected: **1541 passed, 0 failures**（UI 改动无单测，靠编译 + Task 6 手动验证）。

- [ ] **Step 6: Commit**

```bash
git add Sources/PipiUI/Views/SettingsSheet.swift
git commit -m "feat(settings): 实验 tab — jcode global toggle + terminal login + status

New .experimental settings tab (8th segment) with a GroupBox containing:
global '启用 jcode 模式' toggle (UserDefaults, confirmation dialog on enable),
'在终端配置 jcode 凭证' button (JcodeLoginLauncher → Terminal jcode login),
and a status row detecting configured providers via jcode auth status --json.
Disables the toggle + shows install hint when jcode binary is missing."
```

---

### Task 5: AppStore.newSession 默认 engine 读开关

**Files:**
- Modify: `Sources/PipiUI/AppStore.swift`（`newSession` :1803）

**Interfaces:**
- Consumes: `JcodeSettings.isEnabled`（Task 1）。
- Produces: 勾选 jcode 后，新建会话默认走 jcode 引擎。

- [ ] **Step 1: 改 newSession 默认 engine**

`AppStore.swift:1803-1806`，当前：
```swift
    func newSession(project: URL, engine: EngineKind = .pi) {
        let (key, _) = createSessionInBackground(project: project, engine: engine)
        selectedSessionKey = key
    }
```
改为（保留 `engine:` 参数，但无参调用时读开关）：
```swift
    func newSession(project: URL, engine: EngineKind? = nil) {
        let resolved = engine ?? (JcodeSettings.isEnabled ? .jcode : .pi)
        let (key, _) = createSessionInBackground(project: project, engine: resolved)
        selectedSessionKey = key
    }
```
**关键**：参数从 `EngineKind = .pi` 改成 `EngineKind? = nil`，这样无参调用（侧边栏 `+` 按钮，`SidebarView.swift:417` 的 `store.newSession(project: project)`）走 `nil` 分支 → 读开关。**显式传 engine 的调用不受影响**（仍是那个 engine）。默认参数从 `.pi` 变 `nil` 不破坏现有调用（无参仍合法）。

- [ ] **Step 2: 全量测试**

Run: `swift test 2>&1 | grep -E 'Executed [0-9]+ tests' | tail -1`
Expected: **1541 passed, 0 failures**。

- [ ] **Step 3: Commit**

```bash
git add Sources/PipiUI/AppStore.swift
git commit -m "feat(appstore): newSession defaults engine from JcodeSettings.isEnabled

newSession's engine param becomes optional (nil default); when nil, it reads
the global jcode toggle so checked = new sessions use jcode. Explicit engine
callers are unaffected. Existing sessions keep their pinned engine."
```

---

### Task 6: 打包 + 手动 App 验证

**Files:** 无代码改动。

- [ ] **Step 1: 全量测试最终确认**

Run: `swift test 2>&1 | grep -E 'Executed [0-9]+ tests' | tail -1`
Expected: **1541 passed, 0 failures**。

- [ ] **Step 2: 打包**

Run: `./make-app.sh`
Expected: `Built build/PipiUI.app`，签名通过。

- [ ] **Step 3: 启动 App + 手动验证**

Run: `pkill -f "PipiUI.app/Contents/MacOS/PipiUI" 2>/dev/null; sleep 1; open build/PipiUI.app`

手动验证清单（在 App 里操作）：
1. 打开设置 → 看到「实验」tab（第 8 段）。
2. 进实验 tab → 看到「启用 jcode 模式」勾选框 + 「在终端配置 jcode 凭证」按钮 + 状态行（应显示"检测到 1 个 provider: cursor"或类似，因为你之前 cursor available）。
3. 点「在终端配置 jcode 凭证」→ Terminal 弹出，跑 `jcode login` → 用户在终端交互（这一步交给用户，不强制完成）。
4. 勾选「启用 jcode 模式」→ 弹确认对话框「切换到 jcode 模式？」→ 点「切换到 jcode」。
5. 关设置 → 侧边栏点某项目「+」→ 新建会话 → 应该是 jcode 会话（侧边栏有 `jc` 标记）。
6. 在 jcode 会话发消息 → 收到回复（依赖 provider 可用，deepseek 应能跑）。
7. 取消勾选 → 再新建会话 → 应是 pi 会话（无 jc 标记）。

验证结果记录到 `.superpowers/sdd/task-6-report.md`。

- [ ] **Step 4: 不 commit（手动验证无代码改动；若发现问题回相应 task 修）**

---

## Self-Review 结果

**1. Spec 覆盖**：
- 决策 1（全局开关）→ Task 1 (isEnabled) + Task 5 (newSession 读开关) ✓
- 决策 2（不做模型选择器）→ 无相关 task（明确不做）✓
- 决策 3（终端 login）→ Task 2 (JcodeLoginLauncher) + Task 4 (按钮) ✓
- 决策 4（撤销 overlay）→ Task 3 ✓
- 决策 5（确认提示）→ Task 4 (confirmationDialog) ✓
- 决策 6（状态检测行）→ Task 1 (detectConfiguredProviders) + Task 4 (status row) ✓

**2. Placeholder 扫描**：无 TODO/TBD。所有代码块完整。`experimentalSection` 的 `@State` 位置有明确说明（:81 同区）。✓

**3. 类型一致性**：`JcodeSettings.isEnabled`（Bool）、`JcodeSettings.detectConfiguredProviders(completion: ([String]) -> Void)`、`JcodeSettings.parseProviders(from: Data) -> [String]`、`JcodeLoginLauncher.openLoginInTerminal()` 在所有 task 一致。`newSession` 的 `engine: EngineKind? = nil` 在 Task 5 定义、Task 6 验证用。✓
