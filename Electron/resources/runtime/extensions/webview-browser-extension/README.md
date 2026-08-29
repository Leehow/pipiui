# webview-browser-extension（脚手架）

核心能力扩展化的四个空脚手架之一。迁移 worker 只写本目录；共享注册表
（`Electron/packages/pi-backend/src/extension-registry.ts` 的
`CORE_CAPABILITY_EXTENSION_PACKAGES`）归 contract-scaffold 波次所有。

## 冻结契约

- 工具名与 schema 不变：`browser_search` / `browser_fetch` / `browser`
  （当前实现：`pipiui-browser-search.ts` + `pipiui-electron-webview.ts`；
  迁移时原样搬入本扩展）。
- 宿主最小面留在 Electron 核心，不得迁出：WebContentsView、partition、
  session、DOM bridge 原生层。
- manifest 声明 `hostApi` 版本范围、`permissions`（`browser.session`）、
  更新元数据（`update`：官方 `stable` 渠道 + `ed25519` 签名）。
- browser session 数据严格按项目隔离；只有不可变代码包与版本元数据走
  App-profile 共享存储。活跃会话不热换扩展。

## 下一步（迁移 worker）

1. ~~添加 `agent/` half，manifest 增加 `agent.extension`。~~（已完成：
   `agent/index.ts` 挂载三个冻结工具，传输层经 Host Capability API
   `agent/capability-bridge.ts`；watch 协议不变，subscribe 走 `browser.watch` op）
2. 补充 `update.source`（确定官方发布源后）。
