# Jev Choice 浏览器控制

> 2026-09-21 后续实现：生产 `browser goal` 已切换为固定提交
> `1231850a0bf1a0c0341fe408ef1668dbbfdfac46` 的 Browser Use jev-ultrafast Python
> 核心，通过 Electron WebContents 适配层运行。原版快照/提示词保持不变，保留当前字段值、
> 选中状态、可见正文及动作后重观察。Jev 和填字请求仍由宿主使用现有凭据执行。
> 运行时、维护补丁与测试入口见
> [适配说明](../Electron/resources/runtime/extensions/webview-browser-extension/agent/jev-upstream/README.md)，
> 交付与实机证据见 [实施记录](active-plans/jev-upstream-browser.md)。
> 下文保留首版设计背景；原有 TS 简化循环不再是生产 `goal` 的执行路径。

## 目标与范围

本轮按用户明确要求实现 **Choice 动作控制**，不再把观察候选 Score 当成控制提速。参考 [Browser Use / Jev Ultrafast](https://github.com/browser-use/jev-ultrafast) 的动态操作/目标选择方式，但复用 PipiUI 已有 WebView、执行器、当前模型和 Jev 扩展，不引入第二套浏览器或凭据。

旧 [`observe + intent / Score`](jev-browser-observation-v1.md) 保持兼容；普通观察不会自动点击。Choice 只由一次显式 `browser` 调用启动：

```json
{"action":"goal","goal":"将目的地填为 Paris，选择 Business，然后搜索","max_steps":12,"timeoutSecs":30,"target":"desktop"}
```

先导航到目标页面，再调用。`goal` 不可放入 `actions[]`；不支持 `target=both`。默认 12 次决策、30 秒，上限 30 次决策、60 秒。默认 active 在第一次宿主观察的 `viewportTarget` 上锚定，不跟随中途切换的活跃视口。

## 决策与执行链路

1. DOM 控制器在同一快照中收集可见、可用、非敏感的控件及原生下拉选项。
2. Jev 扩展在 **一次 TypeSafe 请求**中选择 operation，以及各操作对应的投机 target。仅消费所选操作对应的目标，其他预测不会执行。
3. 执行器检查快照、guard、DOM/表单变化、节点身份和遮挡，再执行既有点击、输入、选择或滚动。Jev 不生成 selector、坐标、JS 或 shell 命令。
4. `TYPE_TEXT` 才调用当前会话的 `ctx.modelRegistry.complete`，复用运行时模型认证，严格解析单字段 `{"text":"…"}`；缺信息或无当前模型时交回主模型，不猜凭据。
5. 返回新快照进入下一轮，无须主会话逐步发点击指令。超限、取消、撤销、服务错误或无法前进时结束并明确报告；过期最多重新观察两次。

操作集合：`CLICK`、`TYPE_TEXT`、`SELECT`、`SCROLL_UP`、`SCROLL_DOWN`、`WAIT`、`DONE`、`BLOCKED`。发送、购买、支付、删除等明显有后果的动作在快循环中交接给主模型/用户，不自动提交。

**`DONE` 只是模型判断，结果是 `needs_verification`、`verified:false`，不是成功证明。** 调用方必须独立检查实际结果；测试夹具通过 DOM 完成谓词验证，不能用 Jev 自报替代。

## 一份扩展凭据

- 唯一设置是当前项目 Jev 扩展的 `ext.jev-optimizer.apiKey`。
- 检索 Score、浏览器 Score、浏览器 Choice 共用 `EXT_JEV_OPTIMIZER_APIKEY`，无需通用 vault mount 或第二份 `TYPESAFE_API_KEY`。
- Jev key 与 OCR 凭据一样保存在本地文件，原子写入 `{project}/.pi/agent/jev-optimizer/credential.json`，重建 backend 时恢复到同一项目的扩展内存缓存。设置页只读取 presence 布尔，不返回 key。
- 保存/替换先写密文后更新缓存；失败不伪装成功。清除同时删除密文与缓存。相关读写在同一 Jev 串行队列中，避免迟到读取使旧 key 复活。
- macOS/Linux 使用目录 `0700`、文件 `0600`；Windows 继承所在目录的 ACL，不依赖钥匙串、DPAPI 或 Linux secret service。旧 `credential.enc` 保留但不自动解密，升级后在扩展设置中重新保存一次密钥；清除后不会从旧密文恢复。通用 `secret_vault_*` 仍是 RAM-only，不受此修改影响。
- 这不会恢复在旧版退出时已经丢失的 key。若旧 key 已丢，需要在扩展设置中重新填写一次；之后才由新持久化链路保存。
- 仍按项目隔离，不自动把一个项目的 key 复制到其他项目。浏览器云端使用由 `ext.jev-optimizer.browserEnabled` 控制，代码检索不受该开关影响。更换 key 后开启新会话，避免继续使用旧环境与代际。

## 边界

- 候选最多 64。SELECT 每个观察窗口最多 255 个选项，超限优先保留与任务相关的选项并标记 truncated；provider 的单个 SELECT 头总计至多 255 个选择。
- 本地准备结果、云请求各有 64KiB 上限；云端只收到允许的目标、控件/选项描述和动作历史，不收到 token、guard、locator、实际 option value、截图或整页。
- 已知 key 在 provider 中先脱敏后裁剪；本地超大描述直接返回有界错误，不先截断可能包含密钥的原始名称。显式任务不会因后来填入普通表单值而被抹去，敏感值仍脱敏。
- provider 校验 Choice 枚举、有限概率分布及选中最大项；未知目标不能执行。项目状态文件按规范化项目路径精确绑定，取消/代际/凭据变化在上传前后检查。
- 取消是有界、尽力中止：已经进入宿主执行队列的一次合法动作不能承诺撤回。后续动作不得继续。
- 这是有界原生 DOM 控制，不是视觉 grounding；canvas、跨域框架、复杂自定义键盘控件和后果动作可能需要普通工具或人工接管。

## 验证口径

实现与实际验证见[本轮报告](research/jev-browser-choice-evaluation-2026-09-21.md)。单元/贯通测试使用合成 key 与可控远端模型替身；它们证明链路和边界，不证明真实 Jev 的任务成功率、费用或净提速。真实任务测试应使用当前扩展已保存凭据和 `browser goal`，不把独立 CLI 环境变量当成产品的第二份配置。
