# Jev 浏览器观察优化：实现与验证报告

日期：2026-09-20。对应 [批准规格](../jev-browser-observation-v1.md) 和计划 `jev-browser-observation-v1`。

## 结论

**已实现本地目标相关观察及独立授权的可选 Jev 云评分路径；尚未证明 Jev 能让 PipiUI 完整任务更快。**

当前真实测量支持的是：这批合成页面上，本地 intent 筛选改善目标展示覆盖、减少工具 JSON 的粗略 token 估计；它增加了单次本地观察耗时。不能把这部分本地收益归功于 Jev，更不能把 mock HTTP 契约测试算作真实云质量或端到端提速。

没有打包、安装或重启 Canonical App。本报告的源码/工作区验证不代表运行中的 App 已加载新的工具 schema。

## 1. 已实现的路径

- `browser.observe` 可传 `intent`，保持 scope/region/role/name 硬约束；省略 intent 保留旧观察。已知 locator、流程和直接动作不被评分绕行。
- 本地路径一次宿主调用，在输出截断前选择候选；候选预算不再阻断弹窗/页面结构及限制信息扫描。返回真实 snapshot/token，保留同页安全重定位。
- 云路径复用独立 Jev 扩展，通过窄浏览器评分协议协作，不把 DOM 伪装成代码 span，不新增动作代理。
- 浏览器内容外发需要项目级 `ext.jev-optimizer.browserEnabled=true`，默认 false；无扩展、无 key、未获此授权时保留本地功能。
- 浏览器授权代际与代码凭据代际分离；关闭浏览器授权先撤销再进行设置 I/O，不使代码重排同时失效。
- 单视口最多一次评分、1500ms 等待预算；最终 HTTP 至多 64 候选、每候选描述 768 UTF-8 字节、整体 64 KiB。字段白名单、先脱敏后截短、完整 ID 校验、故障/平分回退和取消均有测试。
- 双视口固定本地、两份引用隔离；批次递归保留两份优化 metadata，最终每个视口各自遵守 20,000 UTF-16 JSON 信封上限。
- 最终 metadata 会再次检查预算。越界明确失败而非删掉结构或重编号引用；保留有界计数/usage，不继续批次尾部。

## 2. 实际 A/B 观察级对照

使用固定 12 个合成金标，每组重复 3 次。双视口案例拆成两份观察，因此每组 **39 次观察**；其中 3 次为无目标场景，正目标召回分母为 **36**。这不是 39 个独立任务。

两组使用同一生产控制器、同一夹具和金标；每次重建页面状态，组序按轮次为 A/B、B/A、A/B。A 不传 intent，B 使用生产消费者的本地 intent 路径。目标与案例未按结果修改。

| 指标 | A：旧观察 | B：本地目标筛选 |
| --- | ---: | ---: |
| 观察次数 | 39 | 39 |
| 命中 / 未命中 / N/A | 21 / 15 / 3 | 30 / 6 / 3 |
| Recall@12 | 58.3% | 83.3% |
| 必要信息覆盖完整 | 39/39 | 39/39 |
| 工具错误 / 金标错误 | 0 / 0 | 0 / 0 |
| 单次观察 P50 | 2.777 ms | 4.303 ms |
| 单次观察 P95 | 10.593 ms | 17.010 ms |
| 工具 JSON token 粗估中位数 | 1226 | 826 |
| 云请求 / API 输入 usage | 0 / 0 | 0 / 0 |

- B 的 Recall@12 增加 **25 个百分点**，JSON token 粗估下降约 **32.6%**；但单次观察更慢，并非单次执行加速。
- B 仍有两个独立案例未进入前 12 项：`zh-en-intent`、`over-budget`。不保证完整召回或所有页面都改善。
- token 粗估为 JSON UTF-16 长度除以 4，不是主模型实际账单输入，也不是工具格式化文本的精确 token 数。
- 计时为 JSDOM 中生产观察路径，包含本地处理或准备/评分/发布，但 bridge 为进程内转发；不包括真实 Electron IPC、主模型往返和完整任务。
- 夹具初始化和额外的候选窗口身份预检排除于单次观察计时，逐次记录预检耗时。JSDOM 布局 shim 不能作为 Chromium 性能模型。
- 共同的“还能检查剩余内容”判据在 A 用 cursor，在 B/C 用截断标记和明确的普通观察回退提示；只适配协议表示，不改变金标目标。
- 失败和未命中不从分母剔除；双视口同时校验 snapshot 和 element token 的隔离摘要。

命令：

```bash
cd Electron
node resources/runtime/extensions/webview-browser-extension/eval/run-browser-observation-contrast.mjs \
  --repetitions 3 --json /tmp/pipiui-browser-observation-contrast-final.json
```

实际返回 `ok:true`，78/78 观察完成，A 基线漂移 0。原始有界记录保留在上述本机路径。

本次测量源码身份：

- controller SHA-256：`ff1078361b14f5d7bfa7518e28a71c4d96f733aae741438328af01038cd396a9`
- consumer SHA-256：`7e91a4d3a0dea55bb25486f5134f43013d4f87d0eae189c5af464823cd05a0a5`

## 3. C 与完整 Agent 实验为何未执行

密钥库的实际响应为需要重新授权，当前会话没有可用 TypeSafe 挂载。没有读取或猜测旧环境密钥，也没有因此上传真实页面来验证连通性。

- **真实 C：未执行。** 没有 Jev 排序质量、真实云延迟或费用结论。
- **固定主模型的 36 次 A/B/C 完整任务：未执行。** 已交付 4 个任务定义、重置及完成判据，但 DOM click 只证明判据可达，不是 Agent 实验。
- **费用：未核实。** 不把公开单价估算成实际支出。
- **20% 完整任务中位耗时改善目标：尚未验证。** 不因缺数据降低标准，也不扩大到 Choice/CUA 追求好看的结果。

真实合成 C 的入口已提供，见 [评测使用说明](../../Electron/resources/runtime/extensions/webview-browser-extension/eval/README.md)。后续必须重新授权凭据，并显式传 `--live-synthetic`；默认即使环境有 key 也零上传。此模式只给固定生成夹具建立内存授权，不改变真实项目的浏览器外发设置。

实际执行了无 key 负向检查：清除命令环境的 `TYPESAFE_API_KEY` 后传入 `--live-synthetic`，返回 `live-synthetic-key-required`、exit 2，任何测量/上传之前停止。

## 4. 功能与兼容性验证

### 已通过

- host-api、Pi backend、Jev agent 和 Electron workspace 构建；Electron preload 验证通过。没有运行打包脚本。
- 最后一次主树相关 Vitest：**6 文件、307 项通过**，覆盖 DOM、本地/云消费、宿主路由、授权代际、旧工具迁移兼容及真实 DOM 贯通。
- Jev 全部 Node 测试和两份评测 Node 测试：**49 项通过**。根 `npm test` 不包含这些 runtime 测试，故单独执行。
- 真实 controller + 注册 browser + 生产 Jev provider + fake HTTP 的组合测试覆盖真实 token 点击、错误/平分回退、页变拒绝、未授权零 HTTP、跨层截短、双视口单/多项批次及每视口预算。**这是契约验证，不是 C 效果测量。**
- 冷审发现的边界均以失败回归证明后修复：候选 ID 脱敏、长表单前缀、交互状态、过滤预算、同名重定位、后置弹窗、滚动几何、跨层 key 截短、批次元数据及追加字段预算。最后双视口补测先 3 项失败，修复后纳入上述 307 项通过结果。

### 真实 Chromium 源码控制器验收

使用仅含生成内容的本机页面，加载本次 controller 源码，不需要重启 PipiUI：

1. 普通区域预览未展示的“下载电子发票”按钮，通过 intent 排到首位；返回的真实 token 点击后，页面状态变为“发票入口已打开”。
2. 短表单值不改坏 candidate ID；prepare 后 checked 状态变化会拒绝发布。
3. 固定高度滚动容器中，按钮初始 top=20；`scrollTop=300` 后 bottom=-236.5，finalize 实际返回 `browser_observation_changed`。这不是仅修改 JSDOM rect 的模拟。

临时服务已停止。此验收证明页内源码行为，不代表已打包 App 或新工具 schema 已加载。

### 全仓结果必须保留的限制

主树存在多个会话的并发改动，完整 `npm test` **两轮都没有全绿**：

- 默认并发：4819 通过、1 失败、2 跳过；失败为 `model-catalog-load` 的预加载等待。该文件单独复跑通过。
- 限制到 4 workers：4817 通过、3 失败、2 跳过；失败转为 `compaction-backend` 两项超时及 `App` 的项目折叠状态测试。

没有修改这些无关测试，也不把单独复跑通过改写为全仓通过。

### 精确提交态验证

另以 `9181435f` 的归档加本目标 31 个源码/测试文件构造隔离提交态。两份共享文件只移入 BrowserToolRequest 的一个 hunk 和宿主 Jev 的五个 hunks，排除其他会话的 extension-invoke/项目贡献上下文变更；主检出未为验证而临时回退。

运行时独立验证实际返回 exit 0：

- host-api、Pi backend、Jev agent、Electron workspace 四项构建通过；`verify:preload OK`。
- Jev 与评测 Node 测试 **49/49 通过**。
- 9 份 Vitest 文件 **563/563 通过**，包含本目标的相关测试，以及此前波动的 model-catalog-load、compaction-backend、App 三个文件。
- 31 个接受文件的哈希无漂移；2717 个基准文件中，manifest 之外未修改；21 个项目本地依赖链接指向隔离版本，而非混合主树源码。

这支持“本次精确源码版本通过目标范围验证”，**不证明**前两轮失败的根因，也不把它改写成“混合主树全仓全绿”。此前三个文件在隔离环境单独组合的 256 项测试也通过，但环境/并发度不同，不据此声称已修复其时序问题。

接受源码集合摘要：`d737e8982f4193d9a87729355c459f255c04825706557c45c531176e6bacc38e`。提交收尾需保持共享文件中其他会话的当前 combined 内容，仅暂存本目标已验证版本。

## 5. 范围与后续

本次不包含动作 Choice、原生 AX、像素 grounding、截图减频或主模型替换。浏览器优化仍为可选附加能力。

后续真实实验只有在重新授权 key 后，才能评价 C 相对 B 的净收益；需要同时报告成功率、P50/P95、主模型轮次和总费用，而不是从本报告的本地覆盖改善推导“Jev 已加速”。
