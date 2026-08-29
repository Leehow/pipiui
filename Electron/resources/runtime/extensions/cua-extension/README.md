# cua-extension（PipiUI 唯一的 computer-use 面）

PipiUI 的 computer-use 工具层扩展：在主会话里挂载 `computer` /
`open_application` 两个工具（无 `computer_task`，无独立 Computer Use agent）。
驱动调用经版本化 Host Capability API broker（`host_capability` wire action +
`native.cua` op + 一次性 capability token）进入 Electron 核心的
CuaDriverHost → bundled cua-driver；desktop-grant capability 随每个 driver
请求传递，授权语义不变。TCC/Accessibility、CuaDriverHost 生命周期、精确
pid/window 绑定、截图与清理留在宿主最小面。

## 模型侧 schema（与宿主支持集一致）

- 支持的 action 恰好是：`screenshot, click, left_click, right_click,
  middle_click, double_click, triple_click, type, key, keypress, scroll,
  wait, invoke_menu`。`invoke_menu` 用 `path` 传无点菜单路径（如
  `File > Save As…`），宿主原样转发给 driver。
- 宿主对整批做预校验：批内出现支持集之外的动作时以 `unsupported_action`
  （retryable:false）整体拒绝，不执行任何动作，message 列出支持的类型。
- 批次语义：`computer_batch` 返回 `outcomes[]`，逐动作给出
  `ok | failed | not_executed`；首个失败即停批，尾部全部 `not_executed`。
  `coordinate_out_of_bounds`（retryable:true）的 message 含有效像素范围。
- 驱动 wire actions 不变：`computer_batch` / `computer_open_application` /
  `computer_cancel` / `computer_runtime_capabilities`，逐字节放进 broker
  envelope 的 `params`（含 `sessionKey` 与 desktop-grant
  `computerCapability`）。
- manifest 声明 `hostApi >=1.0.0 <2.0.0`、`permissions: ["native.exec"]`、
  `nativeResources`（驱动资源）、`update`（官方 `stable` + `ed25519`）。

## 坐标/缩放契约

每次观察（`computer_batch` 与 `computer_open_application` 的结果）可带顶层
`screenshot: { width, height, scaleX, scaleY }`：交付给模型的图像像素尺寸，
以及回到 driver 像素的缩放。模型坐标按交付截图像素空间解释，宿主做边界
检查并映射回去；无该块即无变换信息（legacy/fake）。两个工具 executor 把
`screenshot` 与 `outcomes` 透传进 toolResult 的 metadata JSON 与压缩后的
`details`（只留 dims+scale，不进图像字节）。

## 截图 marker 管线

toolResult 只把 opaque `[PIPIUI_COMPUTER_SCREENSHOT:id]` marker 写进 agent
state/session JSONL（图像字节不落盘）；provider-context 钩子做
prune+inject：带 marker 的消息的 image blocks 被重建为"该消息 marker ID
在 3 项 FIFO 内存截图中仍保留"的那些图像——被逐出的截图其 inline image
从 provider 上下文剔除，不再无限累积；不带我们 marker 的消息原样放行，
其它工具的图像不受影响。返回给 UI 的 toolResult 形状不变（marker 文本 +
inline image，UI 用它水合）。

## Provider 适配

Anthropic messages 仅把 `computer` 替换为 typed tool `computer_20251124`
并补 `anthropic-beta: computer-use-2025-11-24`。typed tool 仍可能发出支持
集之外的动作（mouse_move 等）——宿主以 `unsupported_action` 预校验拒绝，
如实失败。不承诺 OpenAI native computer_call。

## 待接（宿主侧）

- 驱动落位到扩展目录后，`nativeResources[0].entry`（`native/cua-driver`
  占位，契约测试钉住）再对齐实际路径；`scripts/fetch-cua-driver.mjs` 归
  seed-release。
