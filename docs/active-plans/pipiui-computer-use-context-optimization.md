# PipiUI Computer Use 上下文优化（P0–P3）

状态：草案（2026）。相关主文档：[`docs/computer-use.md`](../computer-use.md)、[`docs/computer-runtime-v1.md`](../computer-runtime-v1.md)。

## 背景与根因

用户反馈 computer use「一个简单操作要反复尝试很久」。诊断结论：**不是单张截图被图淹没，而是上下文在两个维度劣化**——

1. **toolResult 文本里的完整 AX elements JSON 无界累积**。每批 `computer`/`open_application` 成功后，`screenshotToolResult()`（`Sources/PipiUI/PiExt/computer-use-strategy.ts:533`）把完整 `metadata`（含 `accessibility.elements` 全量数组）`JSON.stringify` 进 `content[0].text`，这条文本进会话历史且每轮随 messages 重发给模型。`compactAccessibility()`（同文件 `:492`）只挑字段、**保留完整 `elements` 数组**，是膨胀根源。对比给 UI 的 `compactToolDetails()` 已经只留 `elementCount`——所以 UI 没问题，问题是进持久化历史的那份 content 文本。
2. **历史截图每轮重注入，上限偏高**。`injectInMemoryScreenshots()`（`:592`）在 `pi.on("context")` 里把所有仍命中内存 Map 的 marker 重新拼成 image block 发给模型；`MAX_IN_MEMORY_SCREENSHOTS = 12`（`:22`）。
3. **失败反馈不够可执行**，模型容易原地无脑重试：letterbox 越界报错（`Sources/PipiUI/Computer/CuaScreenshotTransform.swift:148`）只说「outside the target screenshot」，不给有效坐标范围、不说重新 observe。

### 业界基准（带证据）

- Anthropic 官方 computer-use-demo 默认只保留最近 **3** 张截图（`only_n_most_recent_images = 3`），源码注释「images are screenshots that are of diminishing value」。
  <https://raw.githubusercontent.com/anthropics/anthropic-quickstarts/main/computer-use-demo/computer_use_demo/loop.py>
- OpenCUA 论文同样默认 visual history = 3 张。
  <https://arxiv.org/html/2508.09123v3>
- 官方 `tool_result` 只有短文本 + 截图，**不塞完整 accessibility tree**。无界 AX JSON 是 PipiUI 的非标准负担。
  <https://raw.githubusercontent.com/anthropics/anthropic-quickstarts/main/computer-use-demo/computer_use_demo/tools/computer.py>
- 失败反馈最佳实践：写清原因 + 强制下一步 re-observe/state；对 permanent error 禁止同参重试；设 `max_failures` 防无限重试环。
  <https://github.com/browser-use/browser-use/issues/286>
- Prompt caching tradeoff：官方在开了 prompt caching 时会关掉截图裁剪（cached read 便宜、打断 cache 不划算）。**PipiUI extension 层当前未开 Anthropic prompt caching**（全仓 `cache_control`/`cacheControl`/`promptCach` 零命中），故 P1 图片裁剪值得做、不会被该 tradeoff 否决。若未来开启 caching，需重新评估 P1。

---

## P0 — AX elements 文本裁剪（最高 ROI）

### 现状
- `compactAccessibility()`（`computer-use-strategy.ts:492`）：保留完整 `elements` 数组 + `truncated`/`focused_element_index`。
- 两个调用点 `computer`（`:737`）、`open_application`（`:665`）都 `compactAccessibility(result.accessibility)` 后塞进 `metadata`，再 `screenshotToolResult(result, metadata)`。
- `screenshotToolResult()`（`:533`）：`content[0].text = JSON.stringify(metadata, null, 2) + "\n[marker]"`。完整 elements 进 content → 持久化 → 每轮重发。

### 改法（生成侧裁剪，必做）
让 `compactAccessibility` 产出的 elements **按可交互性优先 + 数量/token budget 裁剪**，每轮 content 自身有界：
- **可交互元素优先**：保留可点/可输入/可操作的元素（按钮、链接、输入框、菜单项等，按 bridge 返回的 role/可操作性标记判断）；非交互容器/static text 折叠或丢弃。
- **硬上限**：可交互元素超过阈值（建议 K=48，可调）时截断，并在 `truncated=true` + `elementCount=<真实总数>` 中体现。
- `elementCount` 必须始终反映**未裁剪前的真实总数**，让模型知道有更多元素、需缩小范围或换 token。
- 具体阈值与「可交互」判定字段，由实现 worker 依据 cua-driver bridge 实际返回的 element 结构确定；遵循「模型真正要点击的是可交互元素」这一原则。

### 改法（注入侧 strip，可选增强 P0b）
在 `pi.on("context")` 的 hook 里，对**非最近 N 个** computer toolResult，把 content 文本里的完整 metadata JSON 替换为一行摘要（如 `observed {elementCount} elements @ t`），**保留 `[SCREENSHOT_MARKER:id]` 不动**（marker 是 inject 与 UI 解析的锚）。
- 风险：改写持久化文本的注入副本，须确保不破坏 `screenshotIDs()` 的正则匹配与 `ChatSession` 的 marker→UI 解析。
- 本轮默认**不做**，留作 P0 收效后按需追加；若做，必须补 `Tests/Node` 与 `ComputerContractTests` 用例。

### 验收
- `Tests/Node/test-computer-tool-schema.mjs` 新增/扩展用例：构造 elements 数 > K 的 accessibility，断言 content 文本里出现的元素数 ≤ K、`elementCount` 等于真实总数、`truncated=true`。
- marker 正则仍能从 content 文本解析出 id（inject 不回归）。
- 现有用例全绿。

---

## P1 — 模型侧图片 FIFO 12 → 3（仅模型链路，不动 UI）

### 现状
- Node 模型上下文：`MAX_IN_MEMORY_SCREENSHOTS = 12`（`computer-use-strategy.ts:22`），`retainScreenshot`（`:472`）FIFO，`injectInMemoryScreenshots`（`:592`）注入所有命中 marker。
- Swift UI 缩略图：`ComputerScreenshotMemoryCache.maxCount = 12`（`Sources/PipiUI/Computer/ComputerScreenshotMemoryCache.swift:11`），供 transcript 历史缩略图。

### 改法
- **Node `MAX_IN_MEMORY_SCREENSHOTS` 12 → 3**。这是模型实际看到的图流上限，对齐 Anthropic 官方默认 N=3。
- **Swift `maxCount` 保持 12 不变**。它是 UI transcript 缩略图，降级会让用户看不到历史截图——职责不同，必须分离。在 `MAX_IN_MEMORY_SCREENSHOTS` 处加注释说明：模型上下文图（此常量）与 UI 缩略图（Swift `ComputerScreenshotMemoryCache.maxCount`）是两条独立链路，本常量只管模型。
- `injectInMemoryScreenshots` **逻辑不变**：被 FIFO 淘汰的 marker 命中 `screenshots.get(id)` 返回 `undefined` 即跳过（已是现有行为，注释「Markers from a restarted session simply have no in-memory image」同理）。老 marker 文本仍留在 content（dead marker），但不再注入图——这正是 keep-last-N 的等价效果。

### 验收
- `Tests/Node` 新增用例：retain 4 张后第 1 张被淘汰，`injectInMemoryScreenshots` 对含该老 marker 的 toolResult 不再追加 image block；最近 3 张仍注入。
- Swift 侧 `maxCount` 未变（diff 中不得出现该改动）。

---

## P2 — 失败反馈结构化（减少无脑重试）

### 现状
- letterbox 越界：`CuaIntegrationError.coordinateOutsideScreenshot`（`CuaScreenshotTransform.swift:148`）→ 「Action coordinate falls inside the letterbox margin, outside the target screenshot.」无有效范围、无 re-observe 指引。
- element token 过期：`CuaActionMapper.swift:126-131` → 已说「capture a fresh observation」，可强化为明确禁止同 token 重试。
- `advertisedToSource`（`CuaScreenshotTransform.swift:41-49`）是越界判定点，持有 `offsetX/offsetY/scale/sourceSize/advertisedSize`，可据此给出有效坐标范围。

### 改法（必做）
- **letterbox**：错误文本改为包含**有效坐标范围**（基于 `advertisedSize` 与 letterbox offset 计算，形如 `valid x: [offsetX, advertisedWidth-offsetX)`）+ 「Re-capture a fresh screenshot and recompute coordinates before retrying; do not reuse this coordinate.」
- **element token**：强化为「This element_token is stale (from an older pinned screenshot). Capture a fresh observation and use the new token; do not retry the same token.」
- 两者均明确这是 **permanent until re-observed**，引导模型先 observe 而非原地重试。

### 改法（可选增强 P2b）
host 层（`ComputerCoordinatorCua.swift`）对 permanent failure 做同参重试抑制 / 计数上限（类比 browser-use `max_failures`）。工程量较大、跨协调层，本轮默认不做，留作 P2 收效后按需追加。

### 验收
- `Tests/PipiUITests/ComputerContractTests.swift`（或同级）新增用例：letterbox 越界与 stale token 抛出的错误描述包含 re-observe / 有效范围关键词。
- `swift build` 通过。

---

## P3 — Tool description / schema 强化（提示层）

### 现状
- 无独立 system prompt；所有纪律嵌在 tool `description`：`computer`（`computer-use-strategy.ts:684-705`）、`open_application`（`:625`）。
- 「single-action batch 是反模式」「优先 AX over pixels」已存在（`:699` 附近）。
- 缺「失败后先 observe、不重试同坐标/同 token」。

### 改法
在 `computer` tool `description` 追加一段（紧接现有 batch 纪律之后）：
> 「Failure discipline: when a coordinate is reported out-of-bounds or an element_token is stale, that input is permanent-fail until you re-observe. Do not retry the same coordinate or token. Re-capture a fresh screenshot / AX snapshot first, recompute, then act. Repeatedly retrying identical failing inputs wastes batches.」

`open_application` 的 description 无需改动（其失败语义由 P2 文本覆盖）。

### 验收
- `Tests/Node/test-computer-tool-schema.mjs` 断言 `computer` description 含关键词（如 `re-observe` / `do not retry`）。

---

## 实现切分（按文件边界，2 个并行 worker）

| Worker | 范围 | 文件 | 项 |
|--------|------|------|----|
| A | strategy.ts 单文件 | `Sources/PipiUI/PiExt/computer-use-strategy.ts` | P0（compactAccessibility 裁剪）+ P1（MAX 常量 12→3 + 注释）+ P3（computer description 追加） |
| B | Swift 两文件 | `Sources/PipiUI/Computer/CuaScreenshotTransform.swift`、`Sources/PipiUI/Computer/CuaActionMapper.swift` | P2（letterbox + token 错误文本） |

- 文件不重叠，可并行；runtime auto-merge 处理文件级隔离。
- 两者都不碰 Swift `ComputerScreenshotMemoryCache.maxCount`（P1 明确保留）。

### 验证命令
- Worker A：`node --test Tests/Node/test-computer-tool-schema.mjs`（或仓库现有 Node test 入口）+ `swift build`（确保无跨文件破坏）。
- Worker B：`swift build` + `swift test --filter ComputerContract`。
- **禁止**在任何 worker worktree 执行 `make-app.sh` / `build-app.sh`（仅主 checkout 可打包）。

## 风险与回滚
- P0 裁剪过激可能丢掉模型需要的元素 → K 设为可调常量，`elementCount`/`truncated` 让模型感知；先取宽松值（如 48），观察后再收紧。
- P1 降到 3 后，跨多步视觉对照任务可能变弱 → 可调常量；若启用 prompt caching 需重评。
- P2/P3 仅改文本与提示，无行为风险，最易回滚。
- 全部为可调常量/文本改动，回滚即改回原值。
