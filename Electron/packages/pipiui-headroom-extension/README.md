# pipiui-headroom

`pipiui-headroom` 是 PipiUI 对上游 [Headroom](https://github.com/headroomlabs-ai/headroom) 的独立薄适配器。

- 压缩算法和 `/v1/compress` / `/v1/retrieve` 协议由 Headroom 引擎负责；本包不复制 Headroom 算法。
- 用户不需要安装或启动服务。启用插件后，PipiUI 会校验并准备固定版本的 Headroom，在 App 内按项目启动一个仅监听回环地址的内部进程。
- 引擎程序缓存由 App 统一复用；运行状态、Headroom workspace、配置和模型缓存都留在当前项目的 `.pi/agent/headroom/`，不写全局 `~/.pi`，也不跨项目共享内容。
- `tool_result` 只异步准备候选；`context` 热路径只查内存缓存，不做网络 I/O。
- 每个 CCR 在接纳压缩结果前都会通过上游 `/v1/retrieve` 回读，并验证最终可达当前候选原文；CCR 哈希只在适配器内部参与校验。模型看到的 `headroom_retrieve` 没有参数，PipiUI 会按“最近未取回优先”返回本会话已验证的完整原始工具结果，不会让模型抄写哈希，也不会从上游共享存储盲取内容。
- Headroom 健康时持有主优化器租约，`context-fold` 保持挂载但进入 standby。
- 健康检查、请求、响应、CCR 校验或同步变换异常时，本会话粘滞回退 `context-fold`；单次结果只是收益不足时安全跳过，不触发降级；新会话重新探测 Headroom。

适配策略与 Headroom 官方 `headroom-pi` 提案（headroomlabs-ai/headroom#2657）对齐，PipiUI 只增加无感运行时托管、项目隔离、主/备协调和同轮故障回退。

本适配器基于该 Apache-2.0 上游提案修改，归属与许可见 `NOTICE` 和 `LICENSE`。

首次启用可能需要后台下载一次引擎；准备期间聊天不被阻塞，`context-fold` 继续工作。Headroom 就绪后会在尚未发生折叠的新会话中自动取得主优化器租约。关闭插件或退出 PipiUI 会停止对应内部进程。

构建会把编译产物同步到 `Electron/resources/runtime/extensions/pipiui-headroom/`：

```sh
npm run build -w @pipiui/pipiui-headroom --maxsockets 3
```
