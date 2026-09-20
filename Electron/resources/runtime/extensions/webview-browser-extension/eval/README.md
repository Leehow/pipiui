# 浏览器观察评测

用于 `jev-browser-observation-v1`：固定 12 个合成金标、4 个完整任务定义、A 组基线，以及同生产接缝的 A/B(/C) 观察级对照。金标不是模型/Jev 输出；不复制排序算法，不使用真实网站或用户表单。

## 环境与离线运行

使用工作区已安装的 jsdom 和 Node 24（对照 runner 直接导入生产 TypeScript 消费者，需支持 Node 原生类型擦除）。不安装依赖，不启动 Canonical App。

```bash
cd Electron
node --test \
  resources/runtime/extensions/webview-browser-extension/eval/browser-eval.test.mjs \
  resources/runtime/extensions/webview-browser-extension/eval/contrast-eval.test.mjs
node resources/runtime/extensions/webview-browser-extension/eval/run-browser-observation-eval.mjs \
  --mode baseline --json /tmp/pipiui-browser-eval-baseline.json
node resources/runtime/extensions/webview-browser-extension/eval/run-browser-observation-contrast.mjs \
  --repetitions 3 --json /tmp/pipiui-browser-observation-contrast.json
```

- 基线命令仍只测 A，不把 `--mode local/jev` 悄悄改成模拟分。
- 对照默认只测 A/B，**不读 key、不发网络请求**；C 明确 `not_executed`。
- A=无 intent 的生产控制器；B=生产浏览器消费者的本地 intent 路径；C=同消费者、真实 Jev 适配器和准备/发布路径。
- 每次使用新的 JSDOM 窗口，`runScripts: outside-only` 执行真实 controller 原文。分组顺序按重复轮次轮换，默认每组重复 3 次，上限 10 次。
- 双视口案例产生两个逐视口观测，所以每组 12 案例对应 13 次观测。目标不存在的场景为 N/A，不当作命中；正目标的工具失败仍进入召回分母，所有失败进入耗时分母。
- 返回码：测量完整且无工具/夹具失败为 0；测量失败为 1；显式请求 live 但缺 key 为 2。低召回率不会冒充工具错误，也不会被删除。

## 后续获准的真实合成 C

**本轮未执行。** 当前会话密钥库要求重新授权。只有用户重新授权凭据及本次合成外发后，才运行：

```bash
cd Electron
npm run build:jev-optimizer
# TYPESAFE_API_KEY 由安全环境投送；不要写在命令行或报告里。
node resources/runtime/extensions/webview-browser-extension/eval/run-browser-observation-contrast.mjs \
  --repetitions 3 --live-synthetic --json /tmp/pipiui-browser-observation-live.json
```

`--live-synthetic` 仅对本目录固定生成夹具建立内存中的授权状态，调用官方 Jev 评分接口；不写项目设置、不为真实网页开启外发、不保存 key。未提供该标志，即使环境有 key 也不会上传。

B/C 记录同一候选窗口的内容摘要，并核对 C 实际准备结果与 B 一致；双视口仍按生产规则只走本地。评分次数、提交/实际评价数量与 usage 独立记录，不把授权开关当作成功调用证据。候选身份预检单独计时且排除于单次观察计时之外，报告会明确这部分开销。

## 测量边界

- 计时包括一次生产观察路径：本地，或 prepare/评分/finalize；这里的 bridge 是进程内 DOM 转发，不包含 Electron IPC、主模型轮次或完整任务。
- 夹具初始化、额外候选身份预检不计入观察耗时；报告列出排除项。JSDOM 布局 shim 不是 Chromium 性能模型。
- 比较共同语义：未展示内容是否还能继续检查。A 用 cursor；B/C 用明确的 ordinary-observe 回退提示。只适配这个协议表示差异，不改变金标目标或挑选案例。
- 各组保留全部 hit/miss/N/A、必要信息覆盖、错误、token 估计、P50/P95。token 估计与 API usage 分开。没有账单时不填实价。
- 4 个任务定义和重置/完成判据可复用，但为证明完成谓词而进行的 DOM click **不是 Agent 实验**。计划的 36 次固定模型 A/B/C 完整任务本轮未执行，不填写伪造的墙钟、成功率或费用。
- 模拟服务只用于产品贯通测试，不输出 C 的效果排名或提速百分比。

## 可复用接口

`index.mjs` 导出 `OBSERVATION_CASES`、`TASK_DEFINITIONS`、`createSession`、`dispatchObserve`、`dispatchAction`、`destroySession`、`scoreObservation`、`evaluateRequiredInfo`、`runBaseline` 和 `runContrast`。

报告区分覆盖改善与端到端提速：没有真实 C/完整 Agent 数据时，结论必须为“尚未证明 Jev 净提速”。
