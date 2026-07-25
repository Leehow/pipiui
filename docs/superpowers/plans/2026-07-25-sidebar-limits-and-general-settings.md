# Sidebar Limits + General Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap sidebar projects/pinned/sessions with in-place 更多/收起, and move Boss + web search into a new Settings「通用」tab while removing the sidebar Boss toggle.

**Architecture:** Extract pure `SidebarListLimits.visiblePrefix` for TDD. Wire three `@State` expand flags in `SidebarView` and a trailing「更多/收起」control. Fold Boss toggle + existing `webSearchSection` into `SettingsTab.general`; delete standalone `webSearch` tab and sidebar footer Boss UI.

**Tech Stack:** Swift / SwiftUI macOS 14+, XCTest in `Tests/PipiUITests`, package via `swift test` / `./make-app.sh` for shippable `.app`.

**Spec:** `docs/superpowers/specs/2026-07-25-sidebar-limits-and-general-settings-design.md`

## Global Constraints

- Default caps: projects **6**, pinned **10**, sessions **20**.
- 「更多」= expand in place to full list; 「收起」= back to cap. No sheet / separate route.
- Expand state is **in-memory only** (`@State`); not UserDefaults.
- Sessions count = `new:*` rows + active metas (existing order); both count toward 20.
- Switching `selectedProject` resets **sessions** expand to collapsed.
- Settings: new first tab「通用」(`slider.horizontal.3`); contains Boss + web search; remove「网络搜索」tab.
- Sidebar footer: settings gear only — **no** Boss `Toggle`.
- Do not change pin/archive/sort semantics, web search storage, or Boss prompt injection logic (only relocate the control).
- Commit steps: only if the user explicitly asks to commit; otherwise skip `git commit`.

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/SidebarListLimits.swift` | **Create** — caps + `visiblePrefix` |
| `Tests/PipiUITests/SidebarListLimitsTests.swift` | **Create** — unit tests |
| `Sources/PipiUI/Views/SidebarView.swift` | Truncate three sections; 更多/收起; remove Boss footer |
| `Sources/PipiUI/Views/SettingsSheet.swift` | Add `general` tab; Boss + web search; drop `webSearch` case |

---

### Task 1: Pure `SidebarListLimits` + tests

**Files:**
- Create: `Sources/PipiUI/SidebarListLimits.swift`
- Create: `Tests/PipiUITests/SidebarListLimitsTests.swift`
- Test: `swift test --filter SidebarListLimitsTests`

**Interfaces:**
- Produces:
  - `enum SidebarListLimits` with:
    - `static let projects = 6`
    - `static let pinned = 10`
    - `static let sessions = 20`
    - `static func visiblePrefix<T>(of items: [T], limit: Int, expanded: Bool) -> (items: [T], showsToggle: Bool)`
  - Rules:
    - If `expanded` OR `items.count <= limit` → return all items; `showsToggle = items.count > limit`
    - Else → return `Array(items.prefix(limit))`; `showsToggle = true`

- [ ] **Step 1: Write failing tests**

```swift
import XCTest
@testable import PipiUI

final class SidebarListLimitsTests: XCTestCase {
    func testConstants() {
        XCTAssertEqual(SidebarListLimits.projects, 6)
        XCTAssertEqual(SidebarListLimits.pinned, 10)
        XCTAssertEqual(SidebarListLimits.sessions, 20)
    }

    func testCollapsedTruncatesAndShowsToggle() {
        let items = Array(0..<25)
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 20, expanded: false)
        XCTAssertEqual(out.items, Array(0..<20))
        XCTAssertTrue(out.showsToggle)
    }

    func testExpandedShowsAllAndStillShowsToggle() {
        let items = Array(0..<25)
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 20, expanded: true)
        XCTAssertEqual(out.items, items)
        XCTAssertTrue(out.showsToggle)
    }

    func testAtOrUnderLimitNoToggle() {
        let items = Array(0..<6)
        let out = SidebarListLimits.visiblePrefix(of: items, limit: 6, expanded: false)
        XCTAssertEqual(out.items, items)
        XCTAssertFalse(out.showsToggle)
    }

    func testEmpty() {
        let out = SidebarListLimits.visiblePrefix(of: [Int](), limit: 6, expanded: false)
        XCTAssertTrue(out.items.isEmpty)
        XCTAssertFalse(out.showsToggle)
    }
}
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `swift test --filter SidebarListLimitsTests`
Expected: compile/link failure — `SidebarListLimits` not found.

- [ ] **Step 3: Implement helper**

```swift
import Foundation

enum SidebarListLimits {
    static let projects = 6
    static let pinned = 10
    static let sessions = 20

    /// When collapsed and over `limit`, return prefix; `showsToggle` when `items.count > limit`.
    static func visiblePrefix<T>(of items: [T], limit: Int, expanded: Bool) -> (items: [T], showsToggle: Bool) {
        let showsToggle = items.count > limit
        if expanded || !showsToggle {
            return (items, showsToggle)
        }
        return (Array(items.prefix(limit)), true)
    }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `swift test --filter SidebarListLimitsTests`
Expected: all PASS.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add Sources/PipiUI/SidebarListLimits.swift Tests/PipiUITests/SidebarListLimitsTests.swift
git commit -m "$(cat <<'EOF'
Add SidebarListLimits helper for sidebar section caps.

EOF
)"
```

---

### Task 2: Sidebar truncate + 更多/收起; remove Boss footer

**Files:**
- Modify: `Sources/PipiUI/Views/SidebarView.swift`
- Consumes: `SidebarListLimits.visiblePrefix`, `SidebarListLimits.projects|pinned|sessions`

**Interfaces:**
- Produces UI state on `SidebarView`:
  - `@State private var projectsExpanded = false`
  - `@State private var pinnedExpanded = false`
  - `@State private var sessionsExpanded = false`
- Reset: `.onChange(of: store.selectedProjectPath) { _, _ in sessionsExpanded = false }`
- Helper view (private on `SidebarView`):

```swift
@ViewBuilder
private func moreToggle(expanded: Binding<Bool>) -> some View {
    Button(expanded.wrappedValue ? "收起" : "更多") {
        expanded.wrappedValue.toggle()
    }
    .buttonStyle(.plain)
    .font(.caption)
    .foregroundStyle(.secondary)
    .padding(.horizontal, 6)
    .padding(.vertical, 6)
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
}
```

- [ ] **Step 1: Add expand state + onChange + moreToggle**

Near existing `@State` props (after `archivedExpandedByProject`), add the three bools. On the root `VStack`/`ScrollView` chain (same level as other modifiers on the sidebar content view that already has `.sheet`), add:

```swift
.onChange(of: store.selectedProjectPath) { _, _ in
    sessionsExpanded = false
}
```

Add `moreToggle` as a private method on `SidebarView`.

- [ ] **Step 2: Cap projects section**

Replace `ForEach(store.projects, id: \.path)` body with:

```swift
let capped = SidebarListLimits.visiblePrefix(
    of: store.projects,
    limit: SidebarListLimits.projects,
    expanded: projectsExpanded
)
ForEach(capped.items, id: \.path) { project in
    // existing project row unchanged
}
if capped.showsToggle {
    moreToggle(expanded: $projectsExpanded)
}
```

Because `projectsSection` is a computed `var` returning `sidebarSection`, use a local `let` inside the `rows:` trailing closure (Swift allows `let` in `@ViewBuilder` in recent Swift) or wrap in `Group` / explicit `VStack`. Prefer:

```swift
} rows: {
    let capped = SidebarListLimits.visiblePrefix(
        of: store.projects,
        limit: SidebarListLimits.projects,
        expanded: projectsExpanded
    )
    ForEach(capped.items, id: \.path) { project in
        // ... existing SessionRowContainer for project ...
    }
    if capped.showsToggle {
        moreToggle(expanded: $projectsExpanded)
    }
}
```

- [ ] **Step 3: Cap pinned section**

Inside `pinnedSection` `rows:`, after building `pinned` array:

```swift
let capped = SidebarListLimits.visiblePrefix(
    of: pinned,
    limit: SidebarListLimits.pinned,
    expanded: pinnedExpanded
)
ForEach(capped.items, id: \.0.path) { meta, project in
    // existing pinned sessionRow
}
if capped.showsToggle {
    moreToggle(expanded: $pinnedExpanded)
}
```

- [ ] **Step 4: Cap sessions section**

In `sessionsSection(project:)`, build a combined ordered list then truncate. Pattern:

```swift
private func sessionsSection(project: URL) -> some View {
    let metas = SessionPinLogic.activeMetas(
        from: store.sessionsByProject[project.path] ?? [],
        excludingPinned: store.userPinnedSessionPaths
    )
    let news = newSessionEntries(project: project) // [(String, ChatSession)]
    // Build display rows as an enum or two-phase ForEach with index math.

    // Preferred approach without rewriting row types:
    // 1) Compute totalCount = news.count + metas.count
    // 2) visibleNewCount / visibleMetaCount from limit when collapsed

    let total = news.count + metas.count
    let showsToggle = total > SidebarListLimits.sessions
    let limit = SidebarListLimits.sessions
    let visibleNew: [(String, ChatSession)]
    let visibleMetas: [SessionMeta]
    if sessionsExpanded || !showsToggle {
        visibleNew = news
        visibleMetas = metas
    } else {
        visibleNew = Array(news.prefix(limit))
        let remaining = max(0, limit - visibleNew.count)
        visibleMetas = Array(metas.prefix(remaining))
    }

    return sidebarSection("会话") {
        // existing + button
    } rows: {
        ForEach(visibleNew, id: \.0) { key, session in
            // existing new sessionRow
        }
        ForEach(visibleMetas) { meta in
            // existing meta sessionRow
        }
        if showsToggle {
            moreToggle(expanded: $sessionsExpanded)
        }
    }
}
```

Do **not** call `visiblePrefix` on a heterogeneous array unless you introduce a small private enum; the split-prefix logic above matches the helper’s semantics for the combined sequence.

Optional DRY: add to `SidebarListLimits`:

```swift
static func splitVisibleCounts(
    leadingCount: Int,
    trailingCount: Int,
    limit: Int,
    expanded: Bool
) -> (leading: Int, trailing: Int, showsToggle: Bool) {
    let total = leadingCount + trailingCount
    let showsToggle = total > limit
    if expanded || !showsToggle {
        return (leadingCount, trailingCount, showsToggle)
    }
    let leading = min(leadingCount, limit)
    let trailing = min(trailingCount, max(0, limit - leading))
    return (leading, trailing, true)
}
```

If added, cover with one extra unit test in Task 1 file (or extend Task 1 before finishing Task 2):

```swift
func testSplitVisibleCounts() {
    let out = SidebarListLimits.splitVisibleCounts(
        leadingCount: 3, trailingCount: 20, limit: 20, expanded: false
    )
    XCTAssertEqual(out.leading, 3)
    XCTAssertEqual(out.trailing, 17)
    XCTAssertTrue(out.showsToggle)
}
```

- [ ] **Step 5: Remove Boss from footer**

Replace `safeAreaInset(edge: .bottom)` content with gear-only:

```swift
.safeAreaInset(edge: .bottom) {
    HStack {
        Button {
            showSettings = true
        } label: {
            Image(systemName: "gearshape")
                .font(.body)
                .frame(width: 22, height: 22)
        }
        .buttonStyle(HoverButtonStyle())
        .help("设置")
        .accessibilityLabel("设置")
        Spacer(minLength: 0)
    }
    .padding(.horizontal, Self.sidebarGutter + 2)
    .padding(.vertical, 12)
    .background(.bar)
}
```

Delete the `Toggle(isOn: $store.bossModeEnabled)` block entirely from this file.

- [ ] **Step 6: Build check**

Run: `swift build`
Expected: success.

- [ ] **Step 7: Commit (only if user asked)**

```bash
git add Sources/PipiUI/Views/SidebarView.swift Sources/PipiUI/SidebarListLimits.swift Tests/PipiUITests/SidebarListLimitsTests.swift
git commit -m "$(cat <<'EOF'
Cap sidebar lists with expand/collapse and remove Boss footer toggle.

EOF
)"
```

---

### Task 3: Settings「通用」tab — Boss + web search

**Files:**
- Modify: `Sources/PipiUI/Views/SettingsSheet.swift`

**Interfaces:**
- Change `SettingsTab`:

```swift
private enum SettingsTab: String, CaseIterable, Identifiable {
    case general = "通用"
    case models = "模型"
    case usage = "用量"
    case toolsSkills = "工具与 Skills"
    case subagentModels = "Subagent 模型"
    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .general: return "slider.horizontal.3"
        case .models: return "cpu"
        case .usage: return "chart.bar.fill"
        case .toolsSkills: return "wrench.and.screwdriver"
        case .subagentModels: return "person.2"
        }
    }
}
```

- Default: `@State private var tab: SettingsTab = .general`
- Switch body:

```swift
switch tab {
case .general:
    generalSection
case .models:
    modelSettingsSection
case .usage:
    usageSection
case .toolsSkills:
    toolsSkillsSection
case .subagentModels:
    subagentModelsSection
}
```

- New `generalSection`:

```swift
private var generalSection: some View {
    VStack(alignment: .leading, spacing: 20) {
        VStack(alignment: .leading, spacing: 12) {
            Text("通用")
                .font(.title3.weight(.semibold))
            Toggle(isOn: $store.bossModeEnabled) {
                Label("Boss 模式", systemImage: "crown")
            }
            .help("Boss 模式：新会话以大组长协议启动——不亲自干活，按难度分派 subagent（简单派单兵、复杂派组长、调研扇出），配合反早停失败恢复协议")
            Text("开启后，新会话以大组长协议启动：不亲自干活，按难度分派 subagent。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        Divider()
        webSearchSection
    }
}
```

Keep `webSearchSection` private var as-is (still titled「网络搜索」inside). Remove all `case webSearch` references.

- [ ] **Step 1: Edit `SettingsTab` enum** — add `general`, remove `webSearch`, update `systemImage`.

- [ ] **Step 2: Default tab to `.general`**; update `switch tab` + add `generalSection`.

- [ ] **Step 3: Build**

Run: `swift build`
Expected: success. Grep sanity:

```bash
rg "case webSearch|网络搜索" Sources/PipiUI/Views/SettingsSheet.swift
```

Expected:「网络搜索」only as section title / copy inside `webSearchSection`, not as a tab case. No `case webSearch`.

- [ ] **Step 4: Commit (only if user asked)**

```bash
git add Sources/PipiUI/Views/SettingsSheet.swift
git commit -m "$(cat <<'EOF'
Add Settings General tab for Boss mode and web search.

EOF
)"
```

---

### Task 4: Package app + acceptance smoke

**Files:** none new (verify only)

- [ ] **Step 1: Run unit tests**

Run: `swift test --filter SidebarListLimitsTests`
Expected: PASS.

- [ ] **Step 2: Package shippable app**

Run: `./make-app.sh`
Then:

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  Sources/PipiUI/Views/SidebarView.swift \
  Sources/PipiUI/Views/SettingsSheet.swift \
  Sources/PipiUI/SidebarListLimits.swift
```

Expected: `PipiUI` binary mtime ≥ changed sources.

- [ ] **Step 3: Manual checklist** (from spec Acceptance)

1. Projects > 6 → 6 + 更多 / 收起  
2. Pinned > 10 → same  
3. Sessions > 20 → same; `new:*` count first  
4. ≤ limit → no 更多  
5. Settings first tab「通用」has Boss + web search; no「网络搜索」tab  
6. Sidebar footer gear only; Boss in General still flips `bossModeEnabled`  
7. Other settings tabs still work  

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Projects cap 6 + 更多/收起 | Task 2 |
| Pinned cap 10 + 更多/收起 | Task 2 |
| Sessions cap 20 + 更多/收起; new:* counted | Task 2 |
| Expand in-memory only | Task 2 `@State` |
| Reset sessions expand on project switch | Task 2 `onChange` |
| Settings「通用」first; Boss + web search | Task 3 |
| Remove「网络搜索」tab | Task 3 |
| Remove sidebar Boss toggle | Task 2 |
| Pure helper + tests | Task 1 |
| Ship `build/PipiUI.app` | Task 4 |

No TBD/placeholder steps. Types consistent: `SidebarListLimits` constants and `visiblePrefix` / optional `splitVisibleCounts` used as defined in Task 1–2.
