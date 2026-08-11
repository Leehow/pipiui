# Alibaba Page Agent 对 PipiUI Electron 内置浏览器的适用性评估

日期：2026-08-10  
评估对象：[alibaba/page-agent](https://github.com/alibaba/page-agent)  
上游快照：`main@d02db1ee7c41f5315beda88bab2fe935c580f662`，npm/工作区版本 `1.12.2`

资料范围：官方 README、`packages/core`、`packages/page-controller`、`packages/page-agent`、`packages/extension`、`packages/mcp`、官方文档站、CHANGELOG、LICENSE 与 GitHub Releases。仓库没有独立的 `examples/` 目录；官方首页/CDN demo、website 源码及文档代码示例是其正式示例入口。[README Quick Start](https://github.com/alibaba/page-agent#-quick-start)、[官方 Demo](https://alibaba.github.io/page-agent/)

## 结论先行

**有帮助，但不应整套接入。建议 `borrow`，不建议 `adopt`。**

Page Agent 最有价值的部分是 `@page-agent/page-controller` 中已经积累的 DOM 精简、可交互元素索引、React/富文本输入兼容、滚动容器识别、单层同源 iframe、点击命中校验等实现经验。它能作为 PipiUI `BrowserDOM/controller.js` 的**差分参考实现和测试 oracle**，帮助补强复杂网页成功率。

不建议把 `PageAgent`/`PageAgentCore`、Chrome 扩展或 MCP 整体装入 PipiUI：PipiUI 已有 Pi 模型循环、`browser` 工具协议、canonical capability bridge、`WebContentsView` 宿主与持久化浏览会话。再嵌一个 Page Agent 会形成“Pi agent 调用另一个 agent”的双层规划、双重模型调用、两套历史/取消/错误状态，反而削弱现有可观测性和权限边界。Page Agent 官方也把自身定位为“嵌入网页的 copilot”，而不是通用外部浏览器机器人。[官方 Overview](https://alibaba.github.io/page-agent/docs/introduction/overview/)明确将其与 browser-use 区分为 embedded component vs external tool；[README](https://github.com/alibaba/page-agent#page-agent)也写明它面向 client-side web enhancement，而非 server-side automation。

建议分三类处理：

| 决策 | 范围 | 理由 |
|---|---|---|
| **Borrow** | DOM 精简格式、可滚动容器索引、React/富文本输入、点击坐标与 `elementFromPoint` 校验、单层同源 iframe、动作 schema 自动修正思路 | 能直接提高现有 BrowserDOM 的鲁棒性，不改变 PipiUI 的 Agent/host 架构 |
| **Evaluate in PoC** | 仅 `@page-agent/page-controller`，作为注入到同一 `WebContentsView` 的对照实现 | 可量化观察质量和动作成功率；不发送页面给额外 LLM，不改变生产路径 |
| **Skip** | `PageAgent` UI、`PageAgentCore` LLM loop、`@page-agent/llms`、Chrome 扩展、MCP、免费测试 API、实验性 `execute_javascript` | 与 PipiUI 重复、扩大权限/依赖/数据边界，或不适配 Electron 自有宿主 |

## 1. 上游项目是什么

Page Agent 是一个在页面 JavaScript 环境中运行的、基于文本 DOM 的 GUI agent。它不依赖截图或多模态模型；基本循环是：

1. `PageController` 从当前 DOM 生成压缩后的可交互页面状态；
2. `PageAgentCore` 把任务、历史、观察交给 LLM；
3. LLM 先 reflection/规划，再选择一个工具；
4. `PageController` 执行动作，重新观察并循环，默认最多 40 步；
5. `PageAgent` 在 core/controller 外再附带网页内 UI panel。

这一分层由官方 API 文档直接说明：[PageController](https://alibaba.github.io/page-agent/docs/advanced/page-controller/)独立于 LLM，负责 DOM 抽取和元素动作；[PageAgentCore](https://alibaba.github.io/page-agent/docs/advanced/page-agent-core/)负责无 UI 的 agent loop、事件和工具；[PageAgent](https://alibaba.github.io/page-agent/docs/advanced/page-agent/)把二者与内置面板组合起来。对应源码分别是 [`PageController.ts`](https://github.com/alibaba/page-agent/blob/main/packages/page-controller/src/PageController.ts)、[`PageAgentCore.ts`](https://github.com/alibaba/page-agent/blob/main/packages/core/src/PageAgentCore.ts) 与 [`PageAgent.ts`](https://github.com/alibaba/page-agent/blob/main/packages/page-agent/src/PageAgent.ts)。

它的 monorepo 还包括：

- `@page-agent/llms`：OpenAI-compatible tool-call 客户端及按模型适配；
- `@page-agent/ui`：页面内操作面板；
- `@page-agent/ext`：Chrome MV3 扩展，增加真实多标签和任意网页控制；
- `@page-agent/mcp`：通过本机 HTTP/WebSocket Hub 连接扩展，对外暴露 `execute_task/get_status/stop_task` 三个 MCP 工具。

扩展与 MCP 不是 core 的必要依赖。官方[限制说明](https://alibaba.github.io/page-agent/docs/introduction/limitations/)明确区分：PageAgent.js 面向当前页/SPA；扩展才提供任意网页及打开、切换、关闭标签页。

## 2. 动作、观察与运行方式

### 2.1 内置动作

`PageAgentCore` 当前内置工具为：

- `done`
- `wait`（1–10 秒）
- `ask_user`（仅配置回调后启用）
- `click_element_by_index`
- `input_text`
- `select_dropdown_option`
- `scroll`
- `scroll_horizontally`
- `execute_javascript`（实验性、默认关闭）

完整 schema 和执行入口见官方 [`packages/core/src/tools/index.ts`](https://github.com/alibaba/page-agent/blob/main/packages/core/src/tools/index.ts)。源码的 TODO 仍列着 `send_keys`、上传文件、结构化表格抽取，因此它并不覆盖完整浏览器输入能力。

Chrome 扩展另行注入 `open_new_tab`、`switch_to_tab`、`close_tab`，见官方 [`tabTools.ts`](https://github.com/alibaba/page-agent/blob/main/packages/extension/src/agent/tabTools.ts)。导航不是 PageAgent.js 的通用 host 工具；通常由页面内点击触发，真正跨页/多标签需要扩展层。

### 2.2 DOM 观察

`PageController.getBrowserState()` 返回 URL、标题、视口/页面尺寸、上下滚动提示以及精简 HTML。内部维护 `highlightIndex → DOM element` 的 selector map，然后按 index 点击、输入、选择或滚动。官方源码见 [`PageController.ts`](https://github.com/alibaba/page-agent/blob/main/packages/page-controller/src/PageController.ts) 与 [`dom/index.ts`](https://github.com/alibaba/page-agent/blob/main/packages/page-controller/src/dom/index.ts)。

值得借鉴的具体实现包括：

- 把滚动信息附在可滚动元素上，允许模型明确滚动某个容器，而非只滚页面；
- 点击复用指针坐标并用 `elementFromPoint` 验证目标，减少遮罩/分层布局误点；
- 对 React 控件及 `contenteditable` 做专门输入补丁；
- 同源 iframe 内元素使用 iframe-safe 的原型 setter；
- 工具参数按单个 schema 校验，并自动修正常见小模型参数包装错误。

这些改进可从官方 [CHANGELOG](https://github.com/alibaba/page-agent/blob/main/docs/CHANGELOG.md) 的 1.4–1.12 演进记录以及 [`actions.ts`](https://github.com/alibaba/page-agent/blob/main/packages/page-controller/src/actions.ts) 验证。

### 2.3 模型和部署

Page Agent 直接调用支持 tool calls 的 OpenAI-compatible endpoint，也支持通过适配请求体连接 Claude 等服务，或连接 Ollama/LM Studio。官方当前模型表包括 Qwen、OpenAI、DeepSeek、Gemini、Claude、MiniMax、Grok、GLM 等；DeepSeek v4 flash 被列为推荐模型之一。[官方 Models 文档](https://alibaba.github.io/page-agent/docs/features/models/)还指出：典型页面可能需要约 15k tokens，建议上下文至少 8k；小于 10B 的本地模型通常不够稳定。

这并不意味着 PipiUI 需要采用 `@page-agent/llms`。Pi 已经负责模型选择、工具调用、会话历史、subagents 和 provider 认证；Page Agent 的 LLM 层在 PipiUI 中属于重复实现。

生产环境也不应把 LLM key 放进页面。官方建议 Web App 使用后端 proxy 和 cookie/custom fetch，并明确警告不要把真实 key 提交到前端代码。[Models / Production Authentication](https://alibaba.github.io/page-agent/docs/features/models/#production-authentication)

## 3. 能力边界

### 3.1 跨页、多标签与 iframe

- PageAgent.js 面向当前页/SPA，不自行拥有浏览器导航生命周期；点击导致整页跳转后，页面脚本本身也会被卸载，除非新页再次集成它。
- Chrome 扩展通过 content/background script 与 `TabsController` 才能跨页及管理真实标签页。[官方 Chrome Extension 文档](https://alibaba.github.io/page-agent/docs/features/chrome-extension/)
- 支持单层同源 iframe；不支持嵌套 iframe 和跨域 iframe。[官方 Limitations](https://alibaba.github.io/page-agent/docs/introduction/limitations/#interaction-capabilities)

PipiUI 的 Electron host 已经比 PageAgent.js 更适合跨页：同一个持久化 `WebContentsView` 由 main process 掌握 `loadURL/back/forward/reload`，每次导航后可重新注入 BrowserDOM。没有必要引入 Chrome 扩展来重新获得 Electron 本身已经拥有的能力。

### 3.2 登录、验证码和视觉页面

Page Agent 不提供登录绕过。它只能使用所在浏览器 profile 已有的 cookie/session，并像普通用户一样填写可见 DOM 表单。二次验证、验证码、设备确认、系统权限弹窗仍需用户接管。扩展的页面控制范围很广，但 token 授权只控制谁能调用扩展，不会替用户完成站点认证。[Chrome Extension / Authorization and Security](https://alibaba.github.io/page-agent/docs/features/chrome-extension/#authorization-and-security)

它完全没有视觉理解：不截图，无法理解图片、Canvas、WebGL、SVG、视觉提示；也不支持 hover、拖拽、右键、键盘快捷键、坐标动作、绘图、需要 JS 实例控制的 Monaco/CodeMirror。[官方 Limitations](https://alibaba.github.io/page-agent/docs/introduction/limitations/)

因此它不能替代 PipiUI 已有的 screenshot 与 Computer Use fallback。对 Bilibili 这类大量视频封面、canvas/播放器、动态浮层的网站，纯 DOM path 只能覆盖搜索、链接、普通表单等语义化区域。

### 3.3 CSP 与注入

一行 CDN/页面 script 方案可能被站点 CSP 阻止；官方首页也把 CSP script injection 列为某些站点的限制。PipiUI 从 Electron main process 调用 `webContents.executeJavaScript` 并内联受控 controller，不依赖目标站主动加载 CDN，宿主控制力更强。将 PageController 打包成字符串后由同一 host 注入可用于 PoC，但没有理由加载远程 CDN。

## 4. 安全与隐私边界

Page Agent 提供的是安全构件，不是完整的安全沙箱：

- `interactiveBlacklist` / `interactiveWhitelist` 可从 DOM 抽取及可操作集合中排除或限定元素；
- `transformPageContent` 可在页面文本发往 LLM 前脱敏；
- visual mask 可在 agent 运行时阻止用户同时操作；
- instructions 可声明禁止动作或要求用户确认。

官方入口分别见 [Security & Permissions](https://alibaba.github.io/page-agent/docs/advanced/security-permissions/)、[Data Masking](https://alibaba.github.io/page-agent/docs/features/data-masking/) 和 [PageController](https://alibaba.github.io/page-agent/docs/advanced/page-controller/)。其中“禁止/确认”有一部分依赖 prompt 指令，不应视为不可绕过的强制策略。

重要风险：

1. **DOM 内容会送往所配置的 LLM。** HTML 清理不能保证去除可见文本、表单值或个人数据；官方隐私条款明确提醒这一点。[Terms & Privacy](https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md)
2. **实验性 `execute_javascript` 默认关闭是正确选择。** 源码注释明确说明它可能绕过部分 safeguards 和 data masking；多页扩展甚至主动禁用它。见 [`AgentConfig.experimentalScriptExecutionTool`](https://github.com/alibaba/page-agent/blob/main/packages/core/src/types.ts) 与 [1.10.0 changelog](https://github.com/alibaba/page-agent/blob/main/docs/CHANGELOG.md#1100---2026-06-15)。
3. **免费测试 API 仅限技术评估。** 不得输入敏感信息，不得用于生产或规模化抓取，数据经中国大陆阿里云基础设施处理。[Terms & Privacy](https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md#2-testing-api-and-demo-disclaimer--terms-of-use)
4. **扩展/MCP 权限面比 PipiUI 当前桥更宽。** 扩展 API 用用户主动分享的 token 保护；MCP Hub 绑定 localhost，首次外部连接默认弹窗确认，但它仍会增加本地 WebSocket/HTTP 控制面。[Chrome Extension](https://alibaba.github.io/page-agent/docs/features/chrome-extension/#authorization-and-security)、[`hub-ws.ts`](https://github.com/alibaba/page-agent/blob/main/packages/extension/src/entrypoints/hub/hub-ws.ts)、[`mcp`](https://github.com/alibaba/page-agent/tree/main/packages/mcp)。

相较之下，PipiUI 当前 BrowserDOM 已有更适合外部网页的强约束：opaque snapshot/element token、导航及 DOM 变化后的 stale 检测、敏感 URL 参数和输入值脱敏、输出/元素/secret 容量上限、跨域 iframe/文件上传/弹窗限制声明，并通过 session capability 把 Pi 请求送到 canonical host bridge。这些边界不能因引入 PageController 而退化。

## 5. 与 PipiUI Electron 当前实现逐项对照

| 能力 | PipiUI 当前实现 | Page Agent | 判断 |
|---|---|---|---|
| 浏览器宿主 | Electron main 拥有一个真实 `WebContentsView`，工具模式移动到屏幕外 `BaseWindow` 保留 1280×800 layout | PageAgent.js 只在当前网页内运行；扩展才拥有 Chrome 标签 | **PipiUI 保留** |
| 导航 | host 原生支持 navigate/back/forward/reload，persistent partition 保留 cookie | core 没有通用导航工具；扩展提供 tab 工具 | **PipiUI 更匹配 Electron** |
| 观察 | `BrowserDOM/controller.js` 返回结构化元素、viewport/scroll、限制、opaque snapshot/token | 精简 HTML + highlight index selector map | 高度重复；**只做质量对比** |
| 点击/输入/选择 | token/index + snapshot 新鲜度校验；原生 value setter 与事件；动作后观察 | index 动作；React/contenteditable/iframe 兼容积累更成熟 | **借鉴兼容补丁** |
| 滚动 | 页面滚动，返回 position/pixels above/below | 页面、水平、指定滚动容器/祖先 | **优先借鉴容器滚动** |
| 截图 | host `capturePage()`，可交给多模态模型 | 明确不截图、无视觉 | **不可替代 PipiUI** |
| iframe | 单层同源；跨域/嵌套声明 fallback | 同样仅单层同源 | 重复；可比较边界用例 |
| 安全 | session capability、opaque/stale tokens、redaction/budget、明确 fallback | DOM allow/blocklist、transform hook、mask、prompt constraints | 可借鉴 allow/blocklist；**不得换掉现有硬边界** |
| Agent/模型 | Pi 统一模型、会话、工具、取消、subagent | 自带 ReAct/reflection loop、历史、LLM adapter | **不要双层 agent** |
| 多标签 | UI 是虚拟 tab，单一物理 view；切换时恢复 URL/history | 扩展是真实 Chrome tabs | 语义不同；扩展代码不能直接复用 |
| 外部协议 | Pi browser tool → capability bridge → Electron host | MCP → localhost Hub → Chrome extension | 重复且增加一套攻击面 |

PipiUI 本地关键实现：

- [`Sources/PipiUI/Resources/BrowserDOM/controller.js`](../../Sources/PipiUI/Resources/BrowserDOM/controller.js)：结构化 DOM、snapshot/token、脱敏与动作；
- [`Electron/apps/electron/src/main/browser-host.ts`](../../Electron/apps/electron/src/main/browser-host.ts)：`WebContentsView`、导航、截图、注入 controller；
- [`Electron/packages/pi-backend/src/browser-extension.ts`](../../Electron/packages/pi-backend/src/browser-extension.ts)：复用 Swift canonical browser tool 并改为 Electron capability transport；
- [`Electron/packages/pi-backend/src/index.ts`](../../Electron/packages/pi-backend/src/index.ts)：browser action 进入统一 host bridge。

## 6. 许可证、版本与活跃度

- 许可证：MIT，可使用、修改、分发和再许可，但复制大量源码或发布二进制时必须保留 copyright 和 permission notice。[官方 LICENSE](https://github.com/alibaba/page-agent/blob/main/LICENSE)
- 当前稳定版本：GitHub Release [`v1.12.2`](https://github.com/alibaba/page-agent/releases/tag/v1.12.2)，发布于 2026-07-16；各核心 workspace 包版本一致为 `1.12.2`。
- 活跃度（2026-08-10 查询）：仓库约 28.6k stars、2.5k forks、1,119 commits；`main` 当天仍有提交，近期从 1.10 到 1.12 持续修复生命周期、多窗口 tab 和 MV3 service worker 状态，属于活跃项目。[仓库主页](https://github.com/alibaba/page-agent)、[Releases](https://github.com/alibaba/page-agent/releases)、[CHANGELOG](https://github.com/alibaba/page-agent/blob/main/docs/CHANGELOG.md)
- 维护边界：安全修复只 best-effort 支持 `main` 和最新 npm release，旧版不支持。[Security Policy](https://github.com/alibaba/page-agent/blob/main/docs/SECURITY.md)

如果 PipiUI 复制上游实现而非仅参考算法，需要在 `ThirdPartyNotices` 中增加 MIT notice，并锁定 commit/version；否则上游快速演进会使差分难以审计。

## 7. 最小 PoC 方案（不进入生产路径）

目标不是“把 Page Agent 装进 PipiUI”，而是回答一个窄问题：**PageController 是否在复杂 DOM 上显著优于当前 BrowserDOM，值得移植哪些细节？**

### PoC 边界

1. 只使用 `@page-agent/page-controller@1.12.2`；不引入 `page-agent`、`@page-agent/core`、LLM、UI、extension、MCP。
2. 将 PageController 构建成固定本地 bundle，由现有 `BrowserTabsHost` 在测试模式注入同一个 `WebContentsView`；禁止远程 CDN。
3. 不调用任何 LLM，不外传 DOM，不启用 `execute_javascript` 工具，不修改生产 `browser` schema。
4. 仅在独立测试开关/fixture 下运行，对同一页面同时采集 PipiUI observation 与 PageController browser state。

### 测试集

- 本地可控 fixture：React controlled input、contenteditable、遮挡按钮、nested scroll container、shadow DOM、单层同源 iframe、跨域 iframe 占位、DOM 重排后的 stale target；
- 公开网页 smoke：Bilibili 搜索/热门页、标准表单下拉页；不登录、不提交、不抓取敏感内容；
- 动作矩阵：observe、click、replace/append input、select、垂直/水平容器滚动，导航/截图继续只走 PipiUI host。

### 量化指标

- 关键交互元素召回率与错误交互元素比例；
- observation 字符/token 数及截断率；
- 首次动作成功率、动态页面 stale 后误操作率；
- React/contenteditable/iframe/滚动容器成功率；
- 注入时间、观察耗时、renderer 内存增量；
- 是否产生现有 BrowserDOM 没有的敏感值泄露。

### 通过门槛与落地方式

只有当 PageController 在至少两个真实缺陷类别上取得稳定、可复现的提升，且 observation/token、内存和脱敏不退化，才移植**最小算法片段**。优先候选顺序：

1. indexed scroll container 与最近可滚祖先；
2. 点击坐标复用 + `elementFromPoint` 命中校验；
3. React/contenteditable/iframe-safe value setter；
4. 工具参数的 schema 级诊断/小模型 auto-fix。

不论 PoC 结果如何，都不替换 PipiUI 的 capability bridge、opaque snapshot/token、redaction budget、screenshot/Computer Use fallback、persistent `WebContentsView` 或 Pi agent loop。

## 最终建议

**采用结论：`Borrow selected techniques`。** Page Agent 对我们最大的价值不是提供一个新的浏览器 agent，而是提供一套活跃维护、MIT 许可、经过多类网页问题打磨的 DOM controller 参考实现。

短期最值得做的是上述只读差分 PoC，首先验证“滚动容器”和“React/富文本输入”两类已知高价值能力；现有 browser 的导航、截图、权限桥、持久登录态和 Pi 工具链都应保持不变。整套接入 PageAgent/Core/Extension/MCP 的收益小于复杂度和安全成本，应跳过。
