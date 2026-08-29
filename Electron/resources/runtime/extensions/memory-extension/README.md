# memory-extension

核心能力扩展化四扩展之一：把记忆系统封装为独立扩展包。主实现是 loopback
memory broker 包（`resources/runtime/pi-ext/packages/memory-broker/`，host-neutral，
自带 `node --experimental-strip-types --test test/*.test.ts` 测试套），本目录的
agent half 只是把它作为独立扩展包分发的薄封装。

## 冻结契约（不得改变）

- 工具名与 schema 不变：`memory_query` / `memory_status`；无 add/replace/remove/search 工具。
- 数据路径不变：`{projectRoot}/.pi/agent`（pi home）与 `{projectRoot}/.pi/pipiui-memory`（V2 Catalog）。
- V1 queue（`pipiui-memory-broker-experience-v1.jsonl`）→ V2 Catalog 导入保持幂等。
- Hermes 原生目录解析不变：宿主注入 `PIPIUI_HERMES_PACKAGE_ROOT` /
  `PIPIUI_HERMES_NODE_MODULES_ROOT`（managed `pi-hermes-memory` 0.9.6）；
  Hermes 适配器是扩展内部兼容层，不是扩展 API 契约。
- JSONL/snapshot 格式与历史会话注入（advisory/untrusted `memory_context`）不变。

## 宿主最小面（留在 Electron 核心，未迁出）

- 项目身份绑定（`PIPIUI_MEMORY_PROJECT_ROOT`，spawn-assembly 桥接门控段）。
- spawn 环境清洗（`sanitizeEnvironment` 剥离继承的 `PIPIUI_MEMORY_*`）。
- 子代理 capability 签发（broker identity + loopback token，worker 角色门控）。
- 模型凭据（Hermes 复核模型复用会话已解析 model，不暴露凭据）。

## 挂载通道

- 主会话：`resolveSpawnPaths().memoryBroker` 解析到本包 agent entry；registry
  通道（manifest `agent.extension`）挂载同一路径，pi 按 resolved path 去重。
  扩展被禁用时 registry 状态为权威，旧通道不再复活记忆挂载。
- worker：绝不走 `PIPIUI_EXT_REGISTERED_PATHS` 重挂载（见 spawn-assembly 排除）；
  worker 记忆仅经 broker 签发的 identity/capability 通道，保持角色门控。

## manifest

`hostApi` 版本范围、`permissions`（`memory.read`）、更新元数据（`update`：
官方 `stable` 渠道 + `ed25519` 签名）。`update.source` 待官方发布源确定后补充。
