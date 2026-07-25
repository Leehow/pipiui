# 会话置顶（全局）— Design

Date: 2026-07-24  
Status: Approved  
Scope: Sidebar pin section + AppStore persistence; hover pin control + pointing-hand cursor on row actions

## Problem

侧栏只有「项目 → 当前项目会话 → 已归档」。跨项目常用会话无法固定在显眼位置；发送后的临时 `pinnedToTop` 只影响排序、不持久、也不是用户主动置顶。

## Goals

1. 用户可把任意已落盘会话**全局置顶**；置顶区位于 **项目与会话之间**。
2. 置顶项**只出现在置顶区**；取消置顶后回到所属项目的「会话」列表。
3. 悬停图钉 + 右键菜单均可置顶/取消置顶。
4. 置顶行副标题显示**所属项目名**（文件夹名）。
5. 悬停行内操作按钮时指针变为**小手**（`pointingHand`），便于发现可点。
6. 置顶区内按**最近活动时间**排序（与会话列表相同的 `effectiveModified` 语义）。
7. **归档自动取消置顶**，会话进入「已归档」。

## Non-goals

- 不拖拽手动排序置顶项
- 不把置顶写进 pi jsonl / session_info
- 不改变发送消息后的临时 `pinnedToTop` 排序行为（命名保持独立，避免混淆）
- 不支持尚未落盘（无 `sessionFile`）的 `new:*` 持久置顶
- 不做跨设备同步

## Approaches

| 方案 | 做法 | 取舍 |
|------|------|------|
| **1. UserDefaults path set（推荐）** | 仿 `archivedSessionPaths`：`pipiui.pinnedSessions` 存 session jsonl path；UI 过滤 + 独立 section | 与现有归档一致；项目归属用 `sessionDirectory(forCwd:)` 反查 |
| 2. path → projectPath 字典 | 持久化显式映射 | 多一份同步成本；目录规则已足够反查 |
| 3. 写进 jsonl session_info | 盘内元数据 | 越权改 pi 格式；扫盘更重 |

**选定方案 1。**

## Data

- Key：`pipiui.pinnedSessions`（`[String]`，加载为 `Set<String>`）
- 成员：session jsonl **绝对路径**（与归档相同粒度）
- API（`AppStore`）：
  - `userPinnedSessionPaths: Set<String>`（`@Published`）
  - `pinSession(path:)` / `unpinSession(path:)` / `isSessionPinned(path:) -> Bool`
  - `pinnedSessions: [SessionMeta]` 或等价派生：从各 `sessionsByProject`（及必要的扫盘合并）收集 path ∈ pin set 的 meta，按 `effectiveModified` 降序
  - `project(forSessionPath:) -> URL?`：`projects` 中 `sessionDirectory(forCwd:).path` 为 path 前缀者
- **命名**：勿复用 `pinnedToTop`；用户置顶用 `userPinned*` / `pinSession`

### 与活跃列表关系

- Meta **仍保留在** `sessionsByProject`（便于取消置顶立刻回列表、项目计数仍含该会话）
- `sessionsSection` **排除** `userPinnedSessionPaths` 中的 path
- 置顶区**始终可显示**（有置顶项时），不依赖当前是否选中项目

### 归档 / 移除项目

- `archiveSession`：从 `userPinnedSessionPaths` 移除该 path 并 persist（再走现有归档）
- `removeProject`：清除该项目 session 目录下所有 path 的 pin（或反查后批量 unpin）
- 启动加载：pin set 中文件已不存在或所属项目已移除 → 显示时跳过；可选懒清理

### 落盘前会话

- 无 `archivePath` / `sessionFile` 时不展示置顶按钮、菜单不提供置顶
- 落盘后与归档按钮同一时机可用

## UI

侧栏 `List` 顺序：

```
项目
置顶          ← 仅当有置顶项
会话          ← 当前选中项目；已排除置顶 path
已归档
```

### 置顶 section

- Header：`置顶`（无 trailing +）
- 行：复用 `SessionRow` / `LiveSessionRow` + `SessionRowContainer`
- **idle 副标题**：项目 `lastPathComponent`（不用相对时间）
- 悬停：图钉（取消置顶）+ 铅笔 + 归档；副标题隐藏规则与现网一致
- 点击行：`selectedProjectPath = project.path`（若不同）+ `openSession(meta, project:)`
- 右键：`取消置顶`、修改标题、归档会话

### 普通会话行

- 悬停增加图钉（置顶）；右键增加「置顶」
- 图标：`pin` / 已置顶区用 `pin.fill` 或统一 `pin` + help「取消置顶」

### 小手光标

- 行内悬停操作按钮（图钉 / 铅笔 / 归档）及 section header 图标按钮：`.pointingHandCursor()`（已有 `PointingHandCursor`）
- 整行选中区域不必强制小手（保持默认箭头即可）

## Files

| 文件 | 变更 |
|------|------|
| `Sources/PipiUI/AppStore.swift` | pin set、persist、pin/unpin、归档/删项目联动、派生列表与项目反查 |
| `Sources/PipiUI/Views/SidebarView.swift` | `pinnedSection`；过滤会话；图钉按钮/菜单；副标题；扩展 `SessionRowContainer` |
| `Sources/PipiUI/Views/HoverButtonStyle.swift` | 可选：在 `HoverButtonStyle` 内默认挂 pointing hand，避免逐按钮漏加 |
| `Tests/PipiUITests/…` | pin/unpin、归档清 pin、会话列表排除、项目反查等纯逻辑单测（若抽 helper）；否则 AppStore 可测路径优先 |

## Acceptance

1. 置顶后会话出现在「项目」与「会话」之间的「置顶」区，且不在下方「会话」重复。
2. 取消置顶后该项回到所属项目「会话」，按活动时间排序。
3. 跨项目置顶可见；点击切换到对应项目并打开会话；副标题为项目名。
4. 悬停图钉与右键均可操作；悬停按钮时指针为小手。
5. 归档后离开置顶区，进入「已归档」；重启后 pin 状态仍在（UserDefaults）。
6. 无 session 文件的新会话不能置顶。
7. 发送消息的临时抬顶（`pinnedToTop`）行为不变。

## Testing

- 单元：pin set 持久化形状、归档清 pin、列表过滤、`project(forSessionPath:)`
- 手动：两项目各置顶一会话；切换项目置顶区仍在；取消置顶回列表；归档置顶项；悬停小手
