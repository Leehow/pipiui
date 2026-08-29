# web-access-extension

核心能力扩展化：Web Access 工具层所属的独立扩展包。四个冻结工具
`web_search` / `fetch_content` / `source_check` / `get_search_content` 经
本包的 `agent/index.ts` 挂载。

## 状态（web-access-mig 波次已交付）

- `agent/index.ts`：包装（wrap）版本钉死的 `pi-web-access` 工具层——工具名、
  schema、wire 行为、旧会话 transcript renderer 全部不变；provider 适配、
  DOM 提取/压缩、结果格式化与工具 schema 挂载经本扩展边界持有，实现原样
  复用 pinned 包，不做重写。
- manifest：脚手架冻结字段（`hostApi` / `permissions: net.request` /
  `update: stable + ed25519`）原样保留，新增 `agent.extension`。
- `pi-web-access` 的宿主最小部分（managed-npm 安装、runtime 内置、密钥/
  feature 宿主侧）留在核心；共享注册表与更新中心未改动。

## Seed 切换（归 seed-release 波次）

本波只随包提供（bundled seed），活跃挂载源仍是 managed `pi-web-access`。
切换时由 seed-release 决定挂载源与解析接线（打包态 `pi-web-access` 位于
`pi/lib/node_modules`，扩展目录解析需 seed 波补 NODE_PATH/解析接线）。
切换前两个挂载源必须行为等价，由
`Electron/packages/pi-backend/test/web-access-extension.test.ts` 钉住：
schema 快照、结果格式化、注册路径、四工具经扩展挂载后行为等价。

## 冻结契约

- 工具名与 schema 不变：`web_search` / `fetch_content` / `source_check` /
  `get_search_content`。
- manifest 声明 `hostApi` 版本范围（核心能力扩展必填）、`permissions`
  （`net.request`）、更新元数据（`update`：官方 `stable` 渠道 + `ed25519`
  签名，第一版仅官方签名扩展）。
- 活跃会话不热换扩展；新版本从新会话生效。
- 代码包与版本元数据走 App-profile 共享的内容寻址存储；启用状态、授权、
  设置、trust 仍严格按项目隔离。
