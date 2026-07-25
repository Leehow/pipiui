# Cursor 风格输入条外壳 — 设计文档

- **日期**：2026-07-24
- **状态**：已实现（方案 A 外壳）
- **范围**：仅视觉壳（方案 A）；行为与下方状态条不变

## 1. 背景与问题

当前 `InputBar` 主行是「外侧加号 + 独立圆角 TextField + 外侧停止/发送」，偏移动聊天条样式。用户希望外观贴近 Cursor 的 follow-up 输入条：控件收进**同一条胶囊容器**内。

参考：用户提供的 Cursor 截图（白/浅灰胶囊、内嵌 ⊕、内嵌主操作钮）。

## 2. 目标 / 非目标

**目标**
- 加号、文本、停止（流式时）、发送放在同一胶囊容器内。
- 视觉：大圆角、近白底、细边、轻阴影；文本区无独立底/边。
- 保留现有行为：多行 1…10、⌘↩ 发送、流式可同时见停止+发送、`plusMenu` / `canSend` / 排队 placeholder 不变。

**非目标**
- 不把模型选择、思考级别、额度、活动状态移入胶囊（仍走下方 `responsiveStatus`）。
- 不做「单主按钮在 stop/send 间切换」的交互改写。
- 不加麦克风等 Cursor 专有控件。
- 不改排队条、附件条、媒体模式条、斜杠面板逻辑。

## 3. 布局

```
┌──────────────────────────────────────────────────────┐
│  ⊕    TextField（plain）              [⏹]  [↑]     │
└──────────────────────────────────────────────────────┘
下方不变：modelMenu / thinkingMenu / activity / metrics
```

- **对齐**：多行增高时加号与右侧按钮 `alignment: .bottom`（与现一致）。
- **间距**：容器内水平约 10–12pt；文本 `flex` 占满中间。

## 4. 视觉令牌（建议）

| 令牌 | 建议值 |
|------|--------|
| 容器圆角 | 22–24pt continuous |
| 填充 | 近白：`Color(nsColor: .controlBackgroundColor)` 或 `Color.primary.opacity(0.03)` 浅填充；优先系统 controlBackground，暗色自适应 |
| 描边 | `Color.primary.opacity(0.10–0.12)` 1pt |
| 阴影 | 很轻：`radius ≈ 8, y ≈ 2, opacity ≈ 0.06`（暗色可再降） |
| 内边距 | 水平 10–12；垂直 8–10（随多行增高） |
| 加号 | 小号圆形（约 22–24pt），非外侧 26pt 大图标；`plus.circle.fill` 或描边圆 + `plus` |
| 停止 | 流式时显示；实心圆 + 停止符号（可继续 `stop.circle.fill`，色用红或近黑圆白方，与现语义一致即可） |
| 发送 | 实心圆上箭头；`canSend` 时高对比（accent 或 primary），否则低对比禁用 |

暗色模式：同一结构，用语义色（primary opacity / controlBackground），不硬编码纯白。

## 5. 实现落点

- **主改文件**：`Sources/PipiUI/Views/InputBar.swift`
- 将现有主行 `HStack { plusMenu; TextField+background; stop?; send }` 改为：
  - 外层 `HStack`（或等价）包一层胶囊 `background` + `overlay` stroke + `shadow`
  - `TextField` 去掉独立 `RoundedRectangle` fill/stroke
  - `plusMenu` / 按钮样式微调以适配内嵌尺寸
- `responsiveStatus` 及 strips / slash / paste / send 逻辑不改。

## 6. 测试与验收

**自动化**
- 无新单元逻辑则可不加测试；若抽出纯布局常量/helper 再补快照级断言（可选）。

**手工**
- 空闲：胶囊内 ⊕ + placeholder + 禁用态发送。
- 有文：发送可点，⌘↩ 仍发送。
- 流式：停止出现；输入显示排队 placeholder；发送在可发时可用。
- 多行拉高：按钮贴底，胶囊随高。
- 暗色：边/底/阴影可读、不刺眼。
- 下方模型/思考/额度布局与点击行为不变。

## 7. 决策记录

| 项 | 决定 |
|----|------|
| 范围 | A：仅壳，模型不进框 |
| 停止+发送 | 流式时并存（非 Cursor 单钮） |
| 麦克风 | 不做 |
