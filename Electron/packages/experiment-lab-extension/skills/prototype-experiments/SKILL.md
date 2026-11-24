---
name: prototype-experiments
description: 用户明确要求“先做原型测试”“比较方案再实现”或查看、停止已有实验时使用。主聊天组织冻结基线、never-merge 原型、真实 Pi 有界并发、证据报告和用户采纳交接；不是普通修 bug 的必经流程。仅讨论设计时先回答，不自动启动付费实验。
---

# 主聊天驱动原型实验

本 Skill 随 experiment-lab 扩展启用发现，完整过程按需加载。主聊天是入口，面板只是可选查看辅助，不要求用户打开面板、填写 ID／JSON 或逐轮确认。沿用用户语言解释结论与边界（本项目示例为中文）；内部语义 slug 由 Boss 根据任务命名。

## 请求与边界

- 用户明确说试原型／测试对比，即在已获授权范围内执行。先提炼待验证假设、共同测例、确定性检查和声明变量；上下文足够时直接说明假设，不重复询问。只有实质性歧义或新的授权边界才问必要问题。
- 未给预算时，声明适合任务的有界 repetitions、concurrency、maxTrials、trialTimeoutMs、totalTimeoutMs 后执行；不要求用户填表。模型／凭据／外部源码接收方必须已有授权，扩大预算或新对外发布另需授权。只讨论设计时先答，不自动收费。
- 先确认实际工具清单。以下都是 `experiment` 的 action，不是独立工具；未挂载或版本未实现时明确缺失，不模拟返回，不承诺尚无的能力。专用 Skill 关闭不改变普通开发路径。
- worktree 隔离不是 OS 安全边界；新 Pi 原型路径不强制 Docker／srt。旧命令 action `run` 是独立 OS 沙盒命令路径，配套 `status`／`cancel`／`cleanup`，历史记录保持其承载语义，不混写成 Pi 批次结果。
- 不触碰生产写接口，不扩大普通 Worker 的桌面权限；不自动提交、合并、发布、打包或重启 PipiUI。

## 1. 冻结讨论中的输入

1. `experiment` action `create`：提供 experimentId、question、kind、scopes、includeUntracked、variants、metrics、budget。声明现状与候选假设，不预设赢家；通常从现状与一个有区别的候选开始。`update` 可补草稿定义。
2. `freeze` 冻结当前讨论范围内的已跟踪 dirty，以及显式列出的相关 untracked 源码。检查返回的纳入／排除清单，不提交、stash、reset 或改变用户 index；遗漏的相关源码应修订补齐，不偷偷从主树借输入。`read`／`inventory` 查询持久证据；后续变更走 `revise`。
3. 候选必须在该修订冻结前已声明。共同验证器源码可在下一步通过 validationPaths 固定，不能让候选修改判分标准。没有确定性检查的探索明确标为未验证质量。

## 2. 正常 Worker 制作隔离原型

- 对待制作候选调用 `variant_prepare`，传 experimentId、variantId、专属语义 agentId、revision 和需要固定的 validationPaths。以返回 preparation 中的身份与工作树路径为准。
- 使用已挂载的正常 Worker 派工能力，以**同一个 agentId 和返回 path**继续该实验工作树；不另建树、不冒用角色、不故意失败。若派工工具支持 cwd，指向返回的工作树。仅允许方案范围内修改；可做该树私有 checkpoint。`mergePolicy=never` 是持久策略，成功、验证或接受结果均不会自动合并；不要解除它。
- Worker 完成且实际验证后，`variant_freeze` 冻结候选，显式纳入新增的相关源码。用 `variant_read`／`variant_list` 核对修订与指纹。之后的测试读取冻结快照，不读取仍可变的工作树。未完成的 Worker 不能当成已冻结候选。

## 3. 真实 Pi 批次与观察

- `batch_run` 传 experimentId、batchId、revision、profiles、piCases、budget、mode。profiles 每项是 `{ id: variantId, profile: { id, provider, model, thinking, tools, extensions?, skills?, systemPrompt? }, environmentKeys? }`；只选实际声明可用且已获授权的 Pi profile。环境仅引用已挂载变量名，不传密钥值，不复制凭据、其他项目状态或 trust，不静默换模型／runtime。
- piCases 每项包含 id、title、prompt、checks，可含 expectedAnswer／metricsFile；它不是旧 command cases。相同测例、输入、验证规则、预算与可比较并发条件适用于所有候选。profile 与验证输入随批次固定；comparison 与 throughput 的目的分开解释。
- 返回是异步受理，不是完成。相同 batchId 与同一定义幂等；需要复跑时用新的语义 batchId，计入已经声明的总消耗，不因通知或工具重试重复收费。
- `batch_status` 查询当前状态；`batch_list` 找既有批次。状态分页使用 limit（1–20）／offset。对关注的 trial 用 `batch_logs` 的 cursor、logLimit 增量读取，保存 nextCursor，并保留 truncated／缺失信息。不反复倾倒整份日志，不把无新日志当作死亡或编造百分比。
- `batch_respond` 只回复该 trial 实际等待输入的 inputRequestId（状态 inputRequest.id 或 batch_view 返回值），带 response 的 value／confirmed／cancelled。不要自行生成请求身份或把通知当作用户授权；人工输入会影响可比性，应单列。
- `batch_cancel` **带 trialId 取消单轮，不带 trialId 取消整批**。收到取消请求不等于实际退出；随后查询状态直到真实终态或明确中断／待核实，不宣称仅凭 ack 已停净。
- 重要提醒只提示阶段／错误／输入／结束，忙时可补查；准备汇报时必须重新查询。不得从重复提醒重新运行批次。
- `batch_view` 给同一 Pi 运行的只读 logPath、归属与输入状态；若已有 terminal 工具，可对该日志路径用 tail 查看。它**不是 PTY attach**，不启动第二个 Pi；无 tmux 或跨 App 退出保活承诺。会话结束／App 退出与仅结束一个模型回合不同；重开只读取证据，不自动复跑付费任务。

## 4. 界面原型的真实浏览器证据

- `preview_start` 为已冻结候选创建本实验的本机静态 HTML／CSS／JS URL，传 previewId、variantId，按需 entry 与 fixturePaths；不承诺 SSR／dev-server。使用声明夹具，不调用生产写接口。
- Boss 用已挂载 browser 对返回的实际 URL 做真实导航、点击、输入和状态检查。证据收集使用**单步** observe／screenshot；当前 collector 不拆 actions 批次，不把批次动作当作已关联证据。
- 响应式结论必须真实执行 `observe target=both` 与 `screenshot target=both`，并实际查看桌面／手机截图。新截图来源应有 URL、tabId、viewport；旧 host 缺来源时明确“未验证”，不能从一张图或文字描述推断已验收。
- `preview_evidence` 读取运行时关联的真实 browser tool_result，`preview_status`／`preview_list` 查看登记，`preview_stop` 只停止本实验创建的预览。未挂载 browser 或证据缺失就标未验证，不给普通 Worker 自动授权桌面。

## 5. 公平报告与用户采用

1. `batch_report` 默认 section=summary，由持久批次记录离线重建，不启动 Pi。按需用 points／pairs／differences／statistics／limitations 等 section 加 limit／offset 查看细节；saveReport 可保存本项目只读报告。引用真实 fingerprint 和证据路径，不自己捏造报告身份。
2. 主聊天先给结论与边界，再给样本、差值、失败案例与证据。列出全部计划、实际启动、成功、失败、超时、取消、无效、中断和缺失项；全部失败也如实报告，不筛掉不利样本。执行成功不等于质量达标，更不等于支持假设。未知用量／费用不补零，来源未知不是实际账单；Boss／原型制作／验证成本不混入被测 Pi 成本。
3. 说明共同基线、声明配置差异、资源争用、限流／缓存／seed 未知等公平条件；只比较兼容样本，必要时在已授权预算内串行复验。不强制综合排名、不凭小样本编造显著性；候选更差也是有效结论。
4. 向用户展示实际 `batch_report` 后等待其自然语言决定，例如“按 A 正式实现”。用户真实采用后才 `adopt`，提供 experimentId、batchId、variantId、revision 和此前报告的 reportFingerprint；userEntryId 仅在需要时定位已有用户消息，不要求用户填，也不能传 userText／source='user' 冒充来源。
5. 只有本会话真实报告展示与之后真实用户选择匹配时才生成正式实现交接；推荐、终态通知、页面引用、否定和提问均不是授权。若返回 suggestion-draft，明确只是建议，不能说已采用。
6. 交接引用冻结版本、可复用逻辑、应移除的 mock／试验代码及已验证／未验证项；主树变化后需正常整合回归。`adopt` 本身不执行、不 merge、不提交，也不解除 never；用户明确要求正式实现后进入正常开发流程。
