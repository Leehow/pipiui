# 浏览器工具永久挂起：给每一处 await 划界

日期：2026-09-09

状态：已实现（本文即落地记录）

适用产品：Electron PipiUI，主会话浏览器工具（`webview-browser-extension` + `apps/electron/src/main/browser/`）

## 1. 症状

用户报告：Boss 用浏览器做测试时，经常在等某个浏览器命令时「就歇了，永远也起不来了」，并问能不能给它设个闹钟。

## 2. 为什么闹钟不是答案

闹钟（定时给 Boss 发一条消息）到不了现场。Boss 卡在工具调用的 `await` 里，pi 的消息通道只在回合之间投递；`{type:"abort"}` 也只在用户按 Stop 时才触发。真正的问题不是「没人提醒」，而是**这条调用链上有四处 await 根本没有上界**，其中一处连 Stop 都够不着。所以修法是给每一处 await 划界，而不是在外面加提醒。

## 3. 四处挂起点

| # | 位置 | 条件 | 后果 |
|---|---|---|---|
| H1 | `capability-bridge.ts` 的 token mint `fetch` | 主进程忙在嵌套 run loop（原生对话框、长同步操作），接受连接但不回应 | 无 signal 无超时。AbortController 在 mint **之后**才创建，所以调用超时和用户 Stop 都够不到它 |
| H2 | `tabs-host.ts` 的 6 处 `executeJavaScript` | 渲染进程被原生对话框阻塞（页内对话框抑制器是 best-effort，装载前或跨源 iframe 触发的挡不住）、页内死循环、target 中途销毁 | 永不 settle |
| H3 | `session-host.ts` 的每会话串行队列 | 任一操作不 settle | `record.tail` 永不前进，该会话之后每一个浏览器动作永久排队 |
| H4 | `browser_cancel` | agent 每次超时都会发 | 宿主侧根本没有这个 handler，落到 `unknown_action`；且它自己也排在被取消的那个操作后面 |

有直接先例：`ed50673b fix(browser): bound hung loadURL so navigate cannot pin the session queue` 修的是同一个失败形状，但只覆盖了 `loadURL`，`executeJavaScript` 没有跟上。`capability-bridge.ts` 里那句注释「the driver also drops the session queue on its own deadlines」当时就是不成立的。

## 4. 改法

**H1**：`AbortController` 提到 mint 之前，mint 与 action 两跳共用一个预算和一个 signal。`cancelToken()` 自己也套上 `CANCEL_TIMEOUT_MS`——取消路径存在的意义就是解开已经超时的调用，它自己不能继承那个挂起。`cua-extension/agent/host-capability-client.ts` 是同一处系统性写法，同步修正（`tokenProvider` 签名加可选 signal）。

**H2**：`navigation-settle.ts` 新增 `awaitPageEvaluate` + `BrowserPageUnresponsiveError`，与既有 `awaitLoadURL` 同一形状（迟到的 settle 被吞掉，不会变成 unhandled rejection）。`tabs-host` 新增私有 `evaluatePage()`，所有页面求值走它：默认 15 秒，`script` 动作因为页内自带 25 秒 deadline 用 35 秒。超时时 best-effort `stop()`（释放被导航阻塞的渲染进程），然后抛类型化错误，由外层动作渲染成结构化失败。`redaction.ts` 的净化求值同样加界——它跑在错误路径上，不加界就会在刚刚没回应的那个渲染进程上再挂一次。

**H3**：新增 `advanceQueueTail`，队列尾按「操作 settle」或「上限 90 秒」二者先到者前进。调用方仍然 await 真实结果，只有队列往前走。每个操作现在都自带上界，所以这条是兜底：将来任何一处新的无界 await 都不会再把整个会话钉死。

**H4**：`browser_cancel` 成为已知动作，返回 `{ ok: true, cancelled: false }` 并说明原因。它确实取消不了什么（宿主没有 per-request handle），但客户端每次超时都产生一条 `unknown_action` 错误是纯噪音。

## 5. 卡死的 pane 会被销毁重建

只加界还不够：被页内死循环卡住的渲染进程从此什么都不回，`stop()`、reload、navigate 全都要经过同一个卡住的渲染进程。那样每次调用只是「慢慢失败」而不是「挂住」——好一点，但仍然没用。

所以按同一个 view 的连续无应答次数分级（`BROWSER_PAGE_EVALUATE_STRIKES = 2`）：

- **第一次**：`stop()` 掉在飞的加载（这正是「卡在导航提交」那一类需要的），保留 surface，抛 `page_unresponsive`。
- **同一 surface 第二次**：调既有的 `retireView()` 退休它，抛 `page_discarded`。下一次动作走平常的 `ensurePane` 路径新建 view 并按 tab 的 URL 重新加载，恢复是自动的。

计数放在以 view 为键的 `WeakMap` 里：任何一次 settle（返回值**或**页面抛异常，两者都证明渲染进程活着）都清零，条目随 view 一起消失，所以替换出来的 surface 永远从零开始。页面自己抛异常不算一次 strike。

连带修掉一个真问题：这两类桥接错误现在**跳过净化步骤**。净化本身是一次页面求值，把它们送进去等于再问一次刚刚没回应的那个 surface；而退休之后根本没有 surface，结果真实原因被替换成「redaction capacity exceeded」，等于对模型说了假话。这两类错误的文本是我们自己生成的、不含任何页面内容，跳过是安全且正确的。

## 6. 没做的

- **不给主会话工具调用加通用超时。** pi 的 `tool.execute` 没有 per-call deadline，turn watchdog 也刻意豁免在飞的工具（两条测试钉住），因为一次 8 分钟的 build 不该被杀。正确的边界在工具自己身上，本次就是这么做的。

## 7. 验证

| 套件 | 结果 |
|---|---|
| `browser-host.test.ts`（含新增 6 例） | 152 全过 |
| 其余浏览器相关七个套件合计 | 136 全过 |

新增用例：hung page evaluate 在上界返回结构化错误并调用 `stop()`；hung evaluate 不再钉住会话队列；同一 surface 第二次无应答被销毁、下一次动作从新建的 surface 上成功返回；页面抛异常不算 strike、不会销毁 surface；`browser_cancel` 不再是 `unknown_action`；`advanceQueueTail` 在上限释放且吞掉迟到 rejection；token mint 面对「接受连接但永不回应」的宿主时按预算返回而不是挂死（无此修复时该用例会在 vitest 超时里失败）。

销毁重建那条用例同时钉住了净化旁路：没有它，第二次超时返回的是误导性的「redaction capacity exceeded」而不是真实原因。

全量 vitest 的其余失败与本次无关：`ui-registries` 在干净 HEAD 快照上同样失败，`extension-invoke` / `App.test.tsx` 属于树上其他写者正在改的文件，`turn-watchdog` 单独跑通过（并行满载时的时序 flake）。
