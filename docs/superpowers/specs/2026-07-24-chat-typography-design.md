# 聊天正文排版（Chat Typography）— 设计文档

- **日期**：2026-07-24
- **状态**：已批准（brainstorming），待 spec 审阅 → writing-plans

## 1. 背景与问题

聊天正文字号偏小、行距与消息间距偏紧，长回复读起来挤。

现有菜单「放大 / 缩小」走整窗 `.scaleEffect`：视觉放大但字发糊，且缩放后上方区域点击失效。用户明确只要**聊天正文**可读性，不要依赖整窗缩放。

## 2. 业界对照

| 产品 | 做法 | 启发 |
|------|------|------|
| Cursor | 独立 chat `textSizeScale` / 字号；用户还在要 line-height / 段距 | 聊天与 UI chrome 解耦 |
| Zed | `agent_ui_font_size` + `buffer_line_height: comfortable` | 字号 + 舒适行高 |
| Claude Code | `chat.fontSize` 等 CSS 变量 | 真改字号，非整窗 zoom |

SwiftUI 侧应对齐「真字号 + 行距」，不用根视图 `scaleEffect` 解决阅读问题。

## 3. 目标 / 非目标

**目标**
- 聊天正文有独立可调字号（持久化），默认比现状更大、更疏。
- 行距与消息间距随字号推导，消息内 Markdown 块间距一并略松。
- 菜单可调；快捷键不与整窗缩放冲突。
- 字号变化后文字清晰、可点选（非位图放大）。

**非目标**
- 不修改整窗 `uiScale` / `.scaleEffect` 行为（糊、点不到留待另议）。
- 不调整侧栏、Toolbar、InputBar、StickyTaskBar。
- 不做行距/间距独立滑杆；不做完整主题系统。

## 4. 设计

### 4.1 令牌 `ChatTypography`

Environment 注入；由单一持久化字段 `fontSize` 推导其余：

| 字段 | 含义 | 默认（fontSize=15） | 推导（建议） |
|------|------|---------------------|--------------|
| `fontSize` | 正文字号 pt | **15** | 持久化；范围 12…22，步进 1 |
| `lineSpacing` | `Text` 额外行距 pt | **≈4.5** | `fontSize * 0.3` |
| `messageSpacing` | transcript 消息间距 | **22** | `clamp(16…28, 18 + (fontSize - 13) * 2)`（15→22） |
| `blockSpacing` | Markdown 块间距 | **10** | `max(8, round(fontSize * 0.65))`（15→10） |

实现时 `ChatTypography.make(fontSize:)` 为纯函数，单元测试锁定公式。

**UserDefaults**：`pipiui.chatFontSize`（Double/CGFloat）。非法/缺失 → 默认 15。

### 4.2 AppStore + 菜单

- `AppStore.chatFontSize` + `setChatFontSize(_:)`（夹紧 + 持久化）。
- 根视图：`.environment(\.chatTypography, ChatTypography.make(fontSize: store.chatFontSize))`。
- 视图菜单（与整窗缩放同组或紧邻，文案区分）：
  - 「聊天字号放大」`⌘⇧=`
  - 「聊天字号缩小」`⌘⇧-`
  - 「聊天字号默认」`⌘⇧0`（重置为 15）
- 整窗「放大 / 缩小 / 实际大小」（`⌘=` / `⌘-` / `⌘0`）保持不变。

### 4.3 接入点

| 位置 | 行为 |
|------|------|
| `ChatDetailView` transcript `LazyVStack` | `spacing: typography.messageSpacing` |
| `MarkdownTextView` 根 `VStack` | `spacing: typography.blockSpacing` |
| `PathLinkedText` 默认字体 | `NSFont.systemFont(ofSize: typography.fontSize)`；附加 `.lineSpacing(typography.lineSpacing)` |
| `MarkdownBlockView` 标题 | 相对 `fontSize`：h1 +5、h2 +3、h3 +1（与现偏移一致，基数改为令牌） |
| `MarkdownBlockView` 代码 | monospaced，约 `fontSize - 1` |
| `MessageRow` 用户气泡 | 正文用令牌字号/行距；内边距略增（如 vertical 9→11） |

助手流式行、system 行凡走 `PathLinkedText` / `MarkdownTextView` 的，随 Environment 自动生效。

### 4.4 测试

**单元**
- 默认 15；夹紧 12 / 22；步进。
- `lineSpacing` / `messageSpacing` / `blockSpacing` 公式快照。

**手工**
- 默认打开：正文明显大于现状，消息更疏。
- `⌘⇧=` / `⌘⇧-`：字号变、字清晰、可选中。
- `⌘⇧0` 回到 15。
- 整窗 `⌘=` 行为与今日一致（本版不修其缺陷）。

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| `PathLinkedText` AppKit 命中字体与显示字体不一致 | 命中用的 `hitFont` 同步令牌字号 |
| 代码块 / MonoArt 固定 12pt 显得失调 | 代码跟 `fontSize - 1`；MonoArt 若难跟可本版仅普通 code |
| Environment 未传到某子树 | 从 `ContentView` / 会话详情根注入，避免只挂在 WindowGroup 外 |

## 6. 批准记录

- 范围：B（只要聊天正文）
- 控制：B（独立聊天字号可调 + 默认加大）
- 疏密度：C（行距 + 消息间距都松）
- 方案：1（ChatTypography 令牌，非整窗 scale）
- §1–§2 设计分段已口头批准（2026-07-24）
