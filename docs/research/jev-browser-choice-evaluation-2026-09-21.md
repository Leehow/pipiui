# Jev Choice 与凭据修复：实现和验证报告

## 结论与范围

本轮实现的是 **Choice 动作闭环**，不是上一轮 observe / Score 的本地排序。主模型一次调用 `browser action=goal`，扩展内部完成多轮操作/目标选择、快照校验和执行；仅填字调用当前会话模型。代码、浏览器 Score、Choice 共用 Jev 扩展同一份项目凭据，新增 OS 加密持久化。

对应[功能合同](../jev-browser-choice-v1.md)。本报告只陈述实际执行的验证：**真实 Jev API 成功率、费用及净提速尚未验证；没有打包、重启或宣称当前 App 已更新。**

## 已跑验证

- 最终定向 Vitest：**15 文件、385/385 通过**，`--maxWorkers=1`。
  - 覆盖凭据存储/恢复/清除、Jev 状态与通用 vault 契约、扩展设置通道、Electron 加密适配、Choice DOM/loop/text/集成、原 intent/Score 及宿主浏览器路由。
- 最终 Node：**63/63 通过**。
  - Jev agent 全部 **52** 项，加既有观察评测 **11** 项。保留 Score 行为验证。
- 最终构建：host-api、Pi backend、Jev agent、Electron workspace **均 exit 0**；`verify:preload OK`。
- 存储冷审通过；控制闭环冷审发现的视口字段错配、大下拉窗口及本地信封预算问题，经失败回归修复后复核通过。

## 完整合成任务怎样验证

`Electron/packages/pi-backend/test/browser-choice-integration.test.ts` 不复制生产算法，直接使用：

```text
当前 controller.js DOM 快照
 → 宿主真实 tagObservation / untaggedRequest
 → webview Choice consumer 与有界 loop
 → Jev 扩展真实 payload、传输及响应校验
 → Pi modelRegistry.complete 填字接缝
 → 同快照 DOM 执行器
```

仅 HTTP 返回及文字模型使用确定性测试替身，凭据是假 key。任务为填写 Paris、选择 Business、点击 Search；分别覆盖普通、200 项和 300 项额外下拉选项。每项任务在一次 goal 调用内执行 **3 个动作、4 次 Choice、1 次填字调用**，另由独立 DOM 谓词检查 `Paris|internal-business`。模型的 DONE 仍返回 `verified:false / needs_verification`，不替代检查器。

其他用例验证关闭浏览器许可时零 HTTP/零动作，以及非法 Choice 不改变 DOM。该结果证明生产接缝能够闭环，**不是 Jev 模型本身的能力或性能基准**。没有填写虚构的任务墙钟、真实 API usage 或费用。

## 失败后修复的重点

- 无 cipher 时原实现仍返回 RAM 保存成功：回归先失败，改为明确拒绝，不再伪装持久化。
- Linux `basic_text`：回归先失败，改为拒绝该降级后端。
- 宿主返回 `viewportTarget`，loop 误读 `target`：引入真实 tag/untag 的集成回归后修复，active 此后固定到首次观察的具体视口。
- 下拉选项超过 64 导致整次 goal 失败：改为与 Choice 头一致的 255 上限，超限按任务相关性选择并标记截断；provider 的 SELECT 选项总窗口也有界，避免重复构造大量不可选择的数据。
- 70k 名称导致本地准备结果膨胀：返回有界错误并清 guard，不先裁掉潜在 key 边界。
- 填入普通字段后显式任务中的 Paris 被抹去：仅对任务做敏感值脱敏，保留明确任务词。
- 中文目标被 512 UTF-8 字节截掉尾部要求、项目状态仅做宽泛前缀匹配：新增失败回归后，分别保留完整合法目标、精确匹配规范化项目状态路径。
- 中途替换 env 凭据却仍接受旧响应：既有回归实际失败后补齐发送前、返回后及轮询中的 key 一致性检查。

## 全仓与并发检查限制

不能将以上结果称为“全仓全绿”：

1. `npm test -- --maxWorkers=2` 在 300 秒预算内未完成；期间记录到 `token-ledger` 超时和 `vision-model` 失败。
2. 这两份文件随后单独定向复跑 **15/15 通过**。
3. 扩大到 17 份文件的组合运行结果为 **399 通过、1 失败**；失败是 `vision-model` 在检查目录时读到了并发生成的 `pipiui-subagent-model-catalog-runtime.json.tmp-*` 文件。
4. 本目标 15 份文件在双 worker 下还出现过旧 idle-wait 亚秒时限用例失败；未修改 wait 实现、未放宽断言。串行运行同样 15 份文件最终 **385/385 通过**。

这些失败均保留为限制，不把单独/串行通过改写成并发全仓通过，也不据此臆断已修复根因。

## 真实凭据与 App 验收边界

本轮只检查非敏感元数据：当前执行环境无 `EXT_JEV_OPTIMIZER_APIKEY`；项目宿主快照为 `enabled=true / hasKey=false / browserEnabled=false`。没有读取或输出 key 明文，没有借用通用 vault 推断扩展配置，也未调用真实 TypeSafe。

旧版退出后已经消失的内存 key 无法凭此修复恢复。加载新代码后，需要在 Jev 扩展设置中补填一次实际 key，之后由加密持久化跨重启恢复。真实 OS 钥匙串往返、真实 Jev 和完整模型任务对照留待新版本 App 验收；不能用 mock 或 JSDOM 数字替代。
