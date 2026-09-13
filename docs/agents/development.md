# PipiUI runtime development

Read before subprocess/worker changes or dependency installation respectively. Preserve the existing structural circuit breaker and proxy concurrency limits; historical timings are diagnostic context.

Paths and commands below are relative to the repository root unless absolute. Read only this route when the task requires it; it does not expand authorization.

### Electron 里 `process.execPath` 不是 node（binding）

主进程的 `process.execPath` 是**应用自己的二进制**。拿它 spawn 一个脚本 = 再开一个完整的
App；如果被 spawn 的那段代码自己也会 spawn（宿主 worker、子进程池、任何"宿主生成子进程"
的机制），副本会继续繁殖——这不是慢性泄漏而是 fork 炸弹，实测几秒内 Dock 排满、十几个
实例，只能全杀。

- 从宿主起 Node 子进程一律带 `ELECTRON_RUN_AS_NODE=1`（纯 node 下该变量被忽略，
  所以两条路径都安全）。
- 任何生成子进程的机制都要有**结构性断路器**：子进程内部不得再运行同一套生成逻辑
  （用自己的 env 身份标记判断，见 `extension-host-workers.ts` 的 `insideWorker`）。
  堵已知成因不够，要把这一类堵死。
- 两条都必须有测试钉住（断言 spawn 选项里的 `ELECTRON_RUN_AS_NODE`、断言 worker 内
  `reconcile` 是 no-op），否则下一个人照样会踩。

### npm 在本机会经代理死锁（binding）

本机 `HTTP_PROXY`/`HTTPS_PROXY` 指向 `127.0.0.1:6152`。npm 默认 `maxsockets=15`
经它会死锁：连接建立后被静默丢弃且收不到 FIN，npm 逐个等满 `fetch-timeout`。

`Electron/.npmrc` 已钉死 `maxsockets=3`，`scripts/fetch-pi-runtime.mjs` 里那次
`--prefix` 安装另行显式传参（它跑在 .npmrc 作用域之外）。**不要移除这些限制，
也不要改用户的全局 npm 或代理配置。** 从别处调 npm 时自己带上 `--maxsockets 3`。

识别方法：卡死时 `node_modules` 与 `~/.npm/_cacache` 零写入、累计 CPU 时间冻结、
数百条 ESTABLISHED socket。**registry 全程可达（3-4 秒），所以连通性测试查不出来**
—— 要看 CPU 时间和写入量，别看能不能 ping 通。
