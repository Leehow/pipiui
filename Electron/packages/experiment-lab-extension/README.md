# 实验台（experiment-lab）

可选、按项目启用的 PipiUI coding 扩展。用实验回答设计问题，而不是要求每个修复都先做原型。

## 当前基线切片

已提供 `experiment` 工具和实验面板：创建草稿、记录方案假设／指标／预算、冻结当前源码、读取完整清单、建立新修订。**这一步不会运行被测命令，不代表测试通过，也不提供执行安全沙盒。** 后续执行、比较和采纳功能依批准规格逐票交付。

可以直接说：“先建一个检索对比实验，记录现状和宽召回方案，冻结当前基线，不改正式代码。”

工具动作：`create`、`list`、`read`、`update`、`freeze`、`revise`、`inventory`。实验身份使用语义 slug；`baseline` 是方案草稿中的对照项。

## 数据与边界

- 记录只在当前项目 `.pi/agent/experiments`，不写全局 Pi 家。
- 基线包含声明范围的已跟踪当前内容与明确指定的未跟踪源码；元数据、凭据、依赖缓存和构建输出被排除。
- 冻结不执行 Git add、commit、stash、reset 或 merge；不会改变用户 index。
- 同一修订冻结后不可就地修改。需要修改时使用 `revise`，旧事件和快照保留。
- 小型原子 checkpoint 引用完整事件的指纹；完整清单分成有界页，面板不需要读取多 MiB JSON。
- 每实验 SQLite 事务只用于跨进程互斥，业务记录仍为 JSON。进程退出由操作系统释放锁，不删除或按年龄抢占活跃锁。
- 中断快照有事务记录；恢复保留旧字节，再形成新快照。取消在最终 checkpoint 提交前生效。
- 面板读取不需要活动模型；修改控制通过已挂载本扩展的活动 Pi 会话，业务结果由带关联标识的扩展事件返回。

## 开发验证

要求 Node.js >=22.19.0，与当前 Pi runtime 一致。

```sh
cd Electron
npm run build -w @pipiui/experiment-lab-extension
npm test -w @pipiui/experiment-lab-extension
```

构建通过仓库统一同步脚本生成 Bundled runtime 副本；不要手改 `resources/runtime/extensions/experiment-lab`。扩展默认关闭，不属于基础必需能力。
