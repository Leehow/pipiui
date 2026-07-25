# 会话置顶（全局）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏在项目与会话之间增加全局「置顶」区；用户可悬停/右键置顶与取消置顶，归档自动清 pin。

**Architecture:** `UserDefaults` 存 `pipiui.pinnedSessions`（session jsonl path set），仿归档。Meta 仍留在 `sessionsByProject`，UI 与派生列表过滤。项目归属用 `sessionDirectory(forCwd:)` 前缀反查。临时发送抬顶 `pinnedToTop` 不动。

**Tech Stack:** SwiftUI · AppStore · UserDefaults · XCTest

## Global Constraints

- 置顶区在「项目」与「会话」之间
- 全局 pin；取消置顶回所属项目会话列表；会话区不重复
- 副标题：项目名；排序：`effectiveModified` 降序
- 归档清 pin；无 session 文件不可 pin
- 行内操作按钮小手光标；勿与 `pinnedToTop` 混淆命名

---

### Task 1: `SessionPinLogic` + tests

**Files:**
- Create: `Sources/PipiUI/SessionPinLogic.swift`
- Create: `Tests/PipiUITests/SessionPinLogicTests.swift`

**Interfaces:**
- Produces:
  - `package enum SessionPinLogic`
  - `static func activeMetas(from metas: [SessionMeta], excludingPinned pinned: Set<String>) -> [SessionMeta]`
  - `static func pinnedMetas(sessionsByProject: [String: [SessionMeta]], pinned: Set<String>, sortBy: (SessionMeta, SessionMeta) -> Bool) -> [SessionMeta]`
  - `static func projectPath(forSessionPath: String, projects: [URL], sessionDirectory: (String) -> URL) -> String?`

- [ ] **Step 1: Failing tests** for filter / collect / project resolve
- [ ] **Step 2: Implement `SessionPinLogic`**
- [ ] **Step 3: `swift test --filter SessionPinLogicTests` PASS**
- [ ] **Step 4: Commit** `feat(sidebar): add SessionPinLogic for global pins`

---

### Task 2: AppStore pin API + archive/remove hooks

**Files:**
- Modify: `Sources/PipiUI/AppStore.swift`

**Interfaces:**
- Produces:
  - `userPinnedSessionPaths: Set<String>`
  - `pinSession(path:)` / `unpinSession(path:)` / `togglePinSession(path:)`
  - `isSessionPinned(_ path: String) -> Bool`
  - `pinnedSessionMetas: [SessionMeta]` (computed via SessionPinLogic + effectiveModified sort)
  - `project(forSessionPath:) -> URL?`
- Consumes: SessionPinLogic; on `archiveSession` / `removeProject` clear pins

- [ ] **Step 1: Load/persist `pipiui.pinnedSessions`**
- [ ] **Step 2: pin/unpin + derived list + project lookup**
- [ ] **Step 3: archiveSession / removeProject clear pins**
- [ ] **Step 4: Commit** `feat(store): persist global session pins`

---

### Task 3: Sidebar UI + pointing hand

**Files:**
- Modify: `Sources/PipiUI/Views/SidebarView.swift`
- Modify: `Sources/PipiUI/Views/HoverButtonStyle.swift` (default pointing hand on HoverButtonStyle)

**Interfaces:**
- Consumes: AppStore pin API
- `SessionRowContainer` gains optional `onPin: (() -> Void)?` and `isPinned: Bool` for icon/help

- [ ] **Step 1: HoverButtonStyle + pointingHandCursor**
- [ ] **Step 2: pinnedSection between projects and sessions**
- [ ] **Step 3: Filter sessionsSection; pin button + context menus**
- [ ] **Step 4: Manual smoke + `./make-app.sh` if claiming app ready**
- [ ] **Step 5: Commit** `feat(sidebar): global pinned sessions section`

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Global pin section between projects/sessions | 3 |
| No duplicate in sessions; unpin returns | 2+3 |
| Hover pin + context menu | 3 |
| Project name subtitle | 3 |
| Pointing hand on action buttons | 3 |
| Sort by activity | 1+2 |
| Archive clears pin | 2 |
| No pin without file | 3 |
| UserDefaults persist | 2 |
| Keep pinnedToTop separate | 2 (naming) |
