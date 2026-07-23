# Sidebar「添加项目」入口位置调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the sidebar “添加项目” control from the bottom bar into the 「项目」section header as a `folder.badge.plus` button; leave only the Boss toggle in the bottom bar.

**Architecture:** Single-file SwiftUI layout change in `SidebarView.swift`. No store/API changes. Custom `Section` header for projects; slim bottom `safeAreaInset`.

**Tech Stack:** SwiftUI (macOS 14+), existing `AppStore.addProjectViaPanel()`.

**Spec:** `docs/superpowers/specs/2026-07-23-sidebar-add-project-placement-design.md`

## Global Constraints

- Only modify `Sources/PipiUI/Views/SidebarView.swift` unless build forces a trivial fix elsewhere.
- Do not change `addProjectViaPanel`, project persistence, sessions UI, or empty-state in `App.swift`.
- Icon must be `folder.badge.plus`; help text `"添加项目"`.
- Bottom bar must not show “添加项目” label/button.
- Boss toggle remains bottom-right with existing help string.
- Repo has **no git** — skip all commit steps; do not `git init`.
- Prefer `swift build` for compile verification.

## File map

| File | Role |
|---|---|
| `Sources/PipiUI/Views/SidebarView.swift` | Only file to modify |

---

### Task 1: Relocate add-project control in SidebarView

**Files:**
- Modify: `Sources/PipiUI/Views/SidebarView.swift`

**Interfaces:**
- Consumes: `store.addProjectViaPanel()`, `$store.bossModeEnabled`
- Produces: unchanged public API

- [ ] **Step 1: Update `projectsSection` to use a custom header with add button**

Replace the current:

```swift
private var projectsSection: some View {
    Section("项目") {
        ForEach(store.projects, id: \.path) { project in
            // ... unchanged rows ...
        }
    }
}
```

with a header that places the add control on the trailing edge:

```swift
private var projectsSection: some View {
    Section {
        ForEach(store.projects, id: \.path) { project in
            HStack(spacing: 6) {
                Image(systemName: "folder")
                    .foregroundStyle(project.path == store.selectedProjectPath ? Color.accentColor : .secondary)
                Text(project.lastPathComponent)
                    .fontWeight(project.path == store.selectedProjectPath ? .semibold : .regular)
                Spacer()
            }
            .contentShape(Rectangle())
            .onTapGesture {
                store.selectedProjectPath = project.path
                store.refreshSessions(for: project)
            }
            .contextMenu {
                Button("在 Finder 中显示") {
                    NSWorkspace.shared.activateFileViewerSelecting([project])
                }
                Button("移除项目", role: .destructive) {
                    store.removeProject(project)
                }
            }
        }
    } header: {
        HStack {
            Text("项目")
            Spacer()
            Button {
                store.addProjectViaPanel()
            } label: {
                Image(systemName: "folder.badge.plus")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("添加项目")
            .accessibilityLabel("添加项目")
        }
    }
}
```

Keep the `ForEach` row body identical to the current file (only the `Section("项目")` → `Section { } header: { }` wrapper changes if you edit surgically).

- [ ] **Step 2: Slim the bottom `safeAreaInset` to Boss only**

Replace the bottom inset `HStack` content so it no longer includes the add-project button:

```swift
.safeAreaInset(edge: .bottom) {
    HStack {
        Spacer()
        Toggle(isOn: $store.bossModeEnabled) {
            Label("Boss", systemImage: "crown")
                .font(.callout)
        }
        .toggleStyle(.switch)
        .controlSize(.mini)
        .help("Boss 模式：新会话以大组长协议启动——不亲自干活，按难度分派 subagent（简单派单兵、复杂派组长、调研扇出），配合反早停失败恢复协议")
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .background(.bar)
}
```

- [ ] **Step 3: Verify source no longer has bottom “添加项目”**

Run:

```bash
rg -n "添加项目|folder\.badge\.plus|addProjectViaPanel" Sources/PipiUI/Views/SidebarView.swift
```

Expected:
- `folder.badge.plus` appears in the projects header
- `addProjectViaPanel` is called from that header button only
- No `Label("添加项目"` in the bottom inset
- Help/accessibility still say `添加项目`

- [ ] **Step 4: Build**

Run:

```bash
cd /Users/haoli/leehow/code/pipiui && swift build 2>&1
```

Expected: build succeeds (exit 0).

- [ ] **Step 5: Skip commit**

No git repository — do not initialize one. Report DONE with build output summary.

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| Header trailing `folder.badge.plus` | Task 1 Step 1 |
| `.help("添加项目")` + a11y | Task 1 Step 1 |
| Bottom bar without 添加项目 | Task 1 Step 2 |
| Boss right-aligned, help kept | Task 1 Step 2 |
| No other files / behavior changes | Global Constraints |

## Self-review

- No placeholders
- Single task, complete code
- Commit steps explicitly skipped (no git)
