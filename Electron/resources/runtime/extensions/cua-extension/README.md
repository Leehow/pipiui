# cua-extension（CUA 工具层已迁入）

核心能力扩展化四个扩展之一。CUA 的模型侧工具层（`computer` / `open_application`
的定义、schema、Anthropic `computer_20251124` provider 适配、AX 压缩、截图
marker/注入、shell open 拦截）现由本包 `agent/` half 挂载；驱动调用经版本化
Host Capability API broker（`host_capability` wire action + `native.cua` op +
一次性 capability token）。

## 冻结契约

- 工具名与 schema 不变：`computer` / `open_application`。
- wire actions 不变：driver 请求仍是 `computer_batch` /
  `computer_open_application` / `computer_cancel` /
  `computer_runtime_capabilities`，逐字节放进 broker envelope 的 `params`
  （含 `sessionKey` 与 desktop-grant `computerCapability`，授权语义不变）。
- 旧会话渲染不变：opaque screenshot marker + provider 注入 + details 压缩
  与原策略逐字节一致。
- 宿主最小面留在 Electron 核心：TCC/Accessibility、CuaDriverHost 生命周期、
  精确 pid/window 绑定、截图与清理。
- manifest 声明 `hostApi >=1.0.0 <2.0.0`、`permissions: ["native.exec"]`、
  `nativeResources`（驱动资源）、`update`（官方 `stable` + `ed25519`）。

## Land 阶段待接（宿主侧，见 `.pi/findings/cua-mig.md`）

1. **token 签发面**：扩展客户端默认经 loopback `host_capability_token` op
   请宿主逐调用铸造一次性 token；宿主侧尚无该 op（Electron main 的 broker
   只绑定了 dispatch）。未接入前本扩展 fail closed（报
   `HostCapabilityError: token mint failed`），不回退旧通道。
2. **desktop-grant 校验**：broker `native.cua` 路由需在调 driver 前校验
   `params.computerCapability` 对应 HostBridge `computers` 注册
   （旧 `computer_*` 路由的校验语义，须原样保留）。
3. 驱动落位到扩展目录后，`nativeResources[0].entry`
   （`native/cua-driver` 占位，契约测试钉住）再对齐实际路径；
   `scripts/fetch-cua-driver.mjs` 归 seed-release。
4. **挂载切换归 seed-release**：`spawn-assembly.ts` 仍指向旧
   `pipiui-computer-use.ts`（`p.computerUse`）；切换前两条挂载必须行为等价
   （`packages/pi-backend/test/cua-extension.test.ts` 钉住）。
