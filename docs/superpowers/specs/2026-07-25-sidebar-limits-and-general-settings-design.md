# 侧栏列表限额 + 设置「通用」— Design

Date: 2026-07-25  
Scope: 侧栏项目/置顶/会话截断与「更多」展开；设置新增「通用」页承载 Boss 与网络搜索；侧栏底栏去掉 Boss 开关

## Goal

1. 侧栏列表过长时默认只显示有限行，超限用「更多 / 收起」就地展开或折叠。
2. Boss 模式与网络搜索归入设置「通用」，侧栏底栏不再放 Boss 开关。

## Non-goals

- 不改会话排序、置顶/归档语义、项目增删逻辑。
- 不把展开状态写入 UserDefaults（仅进程内记忆）。
- 不新增独立「全部会话」sheet / 路由。
- 不改网络搜索后端、key 存储或热读行为。

## Decisions

| 项 | 选择 |
|----|------|
| 「更多」行为 | 就地展开显示该区块全部项；再点变为「收起」 |
| 项目 / 置顶 | 与会话相同：超限显示「更多」，可展开/收起 |
| Boss 入口 | 仅设置「通用」；侧栏底栏 Toggle 删除 |
| 网络搜索 | 并入「通用」；删除独立「网络搜索」页签 |
| 展开状态持久化 | 否（`@State` 即可） |

## Limits

| 区块 | 默认上限 |
|------|---------|
| 项目 | 6 |
| 置顶 | 10 |
| 会话 | 20 |

### 计数规则

- **项目**：`store.projects` 按现有顺序；前 6 条默认显示。
- **置顶**：与现 `pinnedSection` 同一列表；前 10 条默认显示。
- **会话**：现有顺序不变——先未落盘 `new:*`，再 `SessionPinLogic.activeMetas`；两者合计计入 20。展开前截断时，按该合并顺序取前 20。
- 未超限时不显示「更多」。

### 「更多 / 收起」UI

- 放在该 section 行列表末尾，样式弱于会话行（次要文字按钮即可）。
- 文案：折叠态 `更多`；展开态 `收起`。
- 三个 section 各自独立 `@State`（如 `projectsExpanded` / `pinnedExpanded` / `sessionsExpanded`）。切换项目时会话区展开状态可重置为折叠（避免误以为新项目也已展开全部）。

## Settings：「通用」

- 新增 `SettingsTab.general = "通用"`，建议 SF Symbol `slider.horizontal.3`，**排在页签最前**。
- 内容自上而下：
  1. **Boss 模式**：`Toggle` 绑定 `store.bossModeEnabled`；help 文案与现侧栏一致（大组长协议说明）。
  2. **网络搜索**：现有 `webSearchSection` 整段迁入（后端选择、API key、说明），标题可保留小节「网络搜索」。
- 从 `SettingsTab` 移除 `webSearch` case；`switch tab` 不再单独分支到该页。
- 默认打开设置时落在「通用」（`@State private var tab: SettingsTab = .general`）。

## Sidebar footer

- 仅保留设置齿轮按钮；去掉 Boss `Toggle` 与相关 `Spacer` 布局可简化为左对齐齿轮（或保持现有左侧齿轮即可）。

## Touch points

| 文件 | 变更 |
|------|------|
| `Sources/PipiUI/Views/SidebarView.swift` | 三区截断 + 更多/收起；底栏去 Boss |
| `Sources/PipiUI/Views/SettingsSheet.swift` | 新增 `general`；迁入 Boss + web search；删独立 webSearch tab |

可选：限额常量抽成 `enum SidebarListLimits { static let projects = 6; ... }` 便于单测，非必须。

## Acceptance

1. 项目 > 6：默认 6 行 +「更多」；点开见全部，「收起」回到 6。
2. 置顶 > 10：同上（上限 10）。
3. 会话合计 > 20：同上（上限 20）；`new:*` 计入前部。
4. ≤ 上限时无「更多」。
5. 设置首 tab 为「通用」，含 Boss 开关与网络搜索 UI；无独立「网络搜索」页签。
6. 侧栏底栏无 Boss；改「通用」里 Boss 后行为与现网一致（新会话是否注入 boss prompt）。
7. 现有发送、置顶、归档、设置其他页签不被回归。

## Test plan

- 单元（可选）：截断 helper——给定 N 与 limit/expanded，返回期望 prefix 与是否显示更多。
- 手动：多项目 / 多置顶 / 多会话项目验证展开收起；设置改 Boss 与搜索后端；确认侧栏底栏仅齿轮。
