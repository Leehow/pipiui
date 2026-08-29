---
name: browser-operator
description: Drive the built-in WebView with the browser tool. Use when navigating, observing, clicking, filling forms, scrolling, or recovering from stale snapshots / missing elements / unresponsive clicks; when the page is large, has popovers, or you must choose among observe, script, screenshot, and desktop escalation. 内置浏览器、填表、点选、观察页面时使用。
---

# 操作内置 browser

只控制应用内 WebView（工具名 `browser`）。Chrome / 系统浏览器走主会话的 `computer` / `open_application` 桌面工具，不要混用。动作契约以 `browser` `action:"help"` 为准；本技能教节奏，不发明工具没有的能力。

结构化动作只有 `click` / `input` / `select` / `scroll`，一律带当前 `snapshot_id`，且 `element_token` 与 `element_index` 二选一（优先 token）。token / snapshot 按 viewport 隔离，desktop 与 mobile 不可混用。

## 操作节奏

- `navigate` / `back` / `forward` / `reload` 之后必再 `observe`（或用返回的新观察）；旧 token 作废。
- `click` / `input` / `select` / `scroll` 会返回新观察和 `mutation` 摘要。若弹出菜单、下拉、dialog、新 URL，先读这次 `mutation`；摘要不够或 UI 未出现 → `wait`（`idle` 或目标 `selector`）再 `observe`，然后才点下一步。
- 无限滚动 / 懒加载：先 `scroll`，等加载，再 `observe`。不要对着未进入视口的旧快照操作。
- 一次只推进一个可见状态变化。禁止「同一组参数再点一次碰运气」。

## 区域优先观察

默认 `scope=viewport`。`scope=page` 会把预算砸在全页 dump 上，只在已滚动仍找不到、且区域过滤也不够时才用。

`observe` 按 landmark / 语义容器分区（`header` / `nav` / `main` / `aside` / `footer` / `form` / `dialog` / `section` 及对应 ARIA role）。无 landmark 时退化为 DOM 层级聚合。默认先给区域摘要（区域名 + 元素数 + 前几项），不要一上来展开全页。

用这些参数收窄，不要反复全量观察：

- `region`：展开某一个区域
- `role` / `name`：按角色或无障碍名过滤
- `cursor`：同一过滤条件下分页

目标在后半页：先 `scroll` 再观察。截断（`truncated`）时收紧 `region` / `role` / `name` 或翻 `cursor`，不要改用 `content` 捞全文。

## 批量优先

默认批量：把无需中间观察的连续动作打进一次 `browser` `actions[]`（1..8），不要每个微动作单独调用。

可安全连发：

- `fill_form` 一次填完全部字段，同一批里再 `click` 提交
- `click` 后立刻 `wait`（`idle` 或目标 `selector`）
- `type` / `input` 后立刻回车（同批下一项）

「可安全连发」仅表示技术上无需中间观察；最终提交、支付、删除仍受下方授权红线约束（用户没明示就不要点）。

强制断点（做完必须停下来观察，再开下一批）：

- `navigate` / `back` / `forward` / `reload` 之后
- 提交表单之后
- 可能出现弹窗、验证码、登录墙时

多字段表单先 `observe` 拿到 token，再用一次 `fill_form`（或 `script`）填完，禁止「observe → input → observe → input」逐格循环。

`script` 提供 `step(label)` 与 `el(token)`：用 `el` 取当前快照元素，用 `step` 标进度。25s 截止；失败不回滚已发生的副作用。`script` **不**刷新 snapshot、**不**附 `mutation`、**不**返回新观察——有副作用后必须再 `observe`，再用新 token 继续。token 失效时 `el` 抛 `stale_snapshot` → 重新 `observe`，不要改字面重跑同一脚本。

单字段、点一下、选一个 option：用 `input` / `click` / `select`（能连发就放进 `actions[]`）。`script` 不是通用 eval；读密钥或绕过结构化保护改用下面的红线。

## 失败恢复决策树

每一步必须换观察、换定位或换通道。禁止同一参数裸重试。

1. `stale_browser_snapshot` / `stale_snapshot` / `requiresObservation` → 立刻 `observe`，只用新 `snapshot_id` 与新 token。URL 变了一律不重定位。动作结果带 `relocated: true` 是同页唯一匹配成功，不是失败，用返回的新观察继续。
2. 找不到元素 → 换 `region` / `role` / `name`，或换可见文案 / CSS `selector`（`wait` / `type` 才吃 selector；`click`/`input`/`select` 不吃）。仍没有 → `screenshot` 看实际画面，再决定滚还是换区域。
3. `click` 无响应或 `browser_target_obscured` → 读 `limitations` 与遮挡提示；先观察遮罩 / dialog / 下拉，点开路的控件，不要对同一 token 连点。
4. 结构化通道走不通 → `screenshot` 看一眼。确认是工具覆盖不到的控件再升级，不要用 `eval` / `content` 当默认 Plan B。

## 安全红线

- 密码、支付、验证码、OTP 字段走面板用户手输（`user_handoff_required`）。禁止用 `content` / `eval` / `screenshot` 旁路读或填。不确定是不是敏感字段时，停下交给用户。
- 最终提交、支付、删除：用户没明示就不要点。
- 跳到登录 / SSO / 同意授权页：停止操作，报告当前 URL 与需要用户做什么。
- `content` / `eval` / `screenshot` 会绕过结构化 redaction；鉴权页与结账页默认不用。`eval` 禁止用来返回字面量或保活。

## 双 viewport

- `target=both` **只**用于响应式验收：先 `observe` `target=both`，再 `screenshot` `target=both`，对照两张 desktop / mobile 图。
- `click` / `input` / `type` / `select` / `scroll` / `eval` / `content` / `console` / `wait` 禁止 `both`。要操作就指定 `desktop` 或 `mobile`。
- 日常浏览保持默认 `target=active`。不要把一个 viewport 的 token 用到另一个上。

## 死角升级

`limitations` 里有几条**每次 observe 都会出现**（尤其 `closed_shadow_roots_not_structured`、`js_dialogs_not_handled`、`file_input_paths_not_supported`）。看见它们 ≠ 当前目标进了死角，禁止据此升级。

只有**任务要点的那个控件**同时满足下面两条，才停手改用主会话的 `computer` 桌面工具（或请用户在面板里手操）：

1. 结构化通道失败：换 `region` / `role` / `name` / `cursor`、滚动、`screenshot` 对照后，仍没有能操作该控件的 token；或对现有 token 的 `click`/`input` 无效。
2. 有位置证据说明它落在工具进不去的地方：`screenshot` 看见控件，但结构化树只有外壳——对照到具体的跨域 iframe（`cross_origin_iframe:…` / `nested_iframe_unavailable`）、closed shadow 宿主、或 canvas/WebGL 自绘面。

页面别处有 iframe / canvas / 那条恒常 closed-shadow 提示，而目标控件已经在观察结果里，继续用 `browser`。

任务本身就是应答 JS dialog，或给 file input 喂本地路径：这两件事工具做不到，直接升级或交给用户。升级时用一句话说清「哪个控件 + 为什么进不去」，不要再换 selector 空转。
