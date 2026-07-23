# Sidebar「添加项目」入口位置调整 — Design

Date: 2026-07-23  
Status: Approved  
Scope: Sidebar UI only — move add-project control into the 项目 section header; clean bottom bar

## Problem

侧栏底部 `safeAreaInset` 左侧的「添加项目」文案按钮位置突兀：离项目列表远、和右侧 Boss 开关挤在同一底栏，视觉权重不清晰。用户期望把添加入口放到上方，做成 `+`。

## Goals

1. 「添加项目」入口出现在「项目」section 标题行右侧，图标按钮形式。
2. 底部不再展示「添加项目」文案/按钮。
3. Boss 模式开关仍在底部可用，布局干净。
4. 行为不变：仍调用 `store.addProjectViaPanel()`（系统选文件夹面板）。

## Non-goals

- 不改项目列表行、右键菜单（Finder / 移除项目）
- 不改会话区「新建会话」
- 不改空状态主内容区（`App.swift`）的「添加项目文件夹」引导入口
- 不改 `addProjectViaPanel` / 持久化逻辑
- 不做拖入文件夹添加、不做项目重命名等新功能

## Approach（已选）

**方案 1：Header `+` + 底部只留 Boss**

- 与 macOS 侧栏 section 动作习惯一致
- 与列表内「新建会话」层级区分（header 动作 vs 列表主操作）
- 单一入口，避免底栏重复

未选：双入口（顶部+底部）、header 短文案「+ 添加」、工具栏按钮。

## UI Spec

### 项目 section header

```
项目                          [folder.badge.plus]
```

- 左：`Text("项目")`（沿用 `Section` header 语义）
- 右：`Button` → `store.addProjectViaPanel()`
- 图标：`folder.badge.plus`（与现有添加项目语义一致）
- 样式：`.buttonStyle(.plain)`，次要/强调色与现有侧栏控件协调（可读、可点即可）
- `.help("添加项目")` 补可发现性
- 可访问性：label 仍应表达「添加项目」（`Label` 隐藏标题或 `accessibilityLabel`）

### 底部 bar

- 移除左侧「添加项目」`Button` / `Label`
- 保留 Boss `Toggle`（`crown` + 文案 + mini switch）
- Boss 右对齐（`Spacer()` + Toggle，或等价布局）
- 内边距与 `.background(.bar)` 保持现有观感

### 空项目列表

- 仅 header `+` 即可添加；无额外空态行（主内容区空态引导仍在，不在本变更范围）

## Files

| 文件 | 变更 |
|---|---|
| `Sources/PipiUI/Views/SidebarView.swift` | `projectsSection` 自定义 header；底部 inset 去掉添加项目 |
| 其它 | 不改 |

## Acceptance

1. 点击「项目」标题右侧图标 → 弹出选文件夹面板，选中后项目出现在列表（与现行为一致）。
2. 侧栏底部不再出现「添加项目」文案或等价主按钮。
3. Boss 开关仍在底部，可切换，help 文案保留。
4. 窄侧栏下 header 单行不换行挤爆；图标可点区域足够。
5. 会话区「新建会话」、项目右键菜单行为不变。

## Testing

- 手动：有项目 / 无项目时点 header `+`；确认底栏仅 Boss。
- 若有相关 UI 自测则跑 `SelfTest`；本变更以布局为主，无强制新单测。
