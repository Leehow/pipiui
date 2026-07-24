# 倒序 / 翻转 Transcript — 设计文档

- **日期**：2026-07-24
- **状态**：方案 1 已批准（翻转列表）

## 1. 问题

当前自上而下 `LazyVStack` + 程序化 `scrollTo(bottom)` 导致：打开/改宽要跳底、与滚轮抢 pin、右栏白屏竞态。用户希望像常见聊天 UI：最新在下，天然贴底。

## 2. 业界做法

| 做法 | 代表 | 取舍 |
|------|------|------|
| Scroll/List 整体翻转 + 行再翻转 | Stream iOS SDK、Swift 教程 | 打开即在最新；坐标需适配 |
| `defaultScrollAnchor(.bottom)` | Apple API | 曾与 LazyVStack 白屏 |
| UIKit 倒序列表 | 传统 IM | 改动面大 |

选定：**翻转 `ScrollView` 内容 + 每行再翻转**（方案 1）。

## 3. 设计

### 3.1 布局

- 数据仍用 `transcript.suffix(visibleCount)`（时间序）。
- `LazyVStack` 内顺序：**bottom 锚点 → streaming/waiting → `suffix.reversed()` →「更早」按钮**。
- `ScrollView` 与每个子行套 `.transcriptFlip()`（`rotationEffect(π)` + 必要 scale，与常见 chat flip 一致）。
- 视觉：最新在下；「更早」在上；打开时无需 `scrollTo` 才能看见最新。

### 3.2 贴底

- `StickToBottomTracker` 仍挂在 id `bottom`（视觉底）。
- pin 时：新内容增长跟底；用户滚轮离开底 → 同步 unpin（沿用 `StickToBottomLogic`）。
- 尽量少用 `scrollTo`；仅在 pin 且需要纠正时滚到 `bottom` / 最新 id。

### 3.3 吸顶条 / 点击

- Sticky Preference 几何在翻转坐标系下校正或暂时用「最新可钉」回退，避免条乱跳。
- PathLinkedText：行级双翻转后为正立；回归 ⌘+click。

### 3.4 非目标

- 不改 pi/jsonl 存储顺序。
- 不做 UIKit CollectionView 重写。
- 整窗 `uiScale` 另案。

## 4. 验收

- 打开长会话：直接见最新，无白屏、无先跳后漂。
- 滚轮上翻阅读：不反复弹回底。
- 贴底时流式输出：仍跟底。
- 开右栏：不白屏。
- 吸顶条可点可跳（允许小幅几何误差后续再磨）。
