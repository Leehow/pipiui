# PipiUI Office 架构（当前状态）

> 2026-08 T8 收口后的当前架构说明。历史迁移证据见
> `office-behavior-baseline.md`（重构前行为基线）与
> `direct-mcp-parity-v1.json`（双轨对比证据），两者均不再被执行或更新。

## 扩展的两半

Office 能力全部由扩展 `office-extension`
（`Electron/packages/pipiui-office-extension`，运行时镜像
`Electron/resources/runtime/extensions/office-extension`，由构建生成、禁止手改）提供：

- **App half**：`app/dist/office-renderer.js` 按 manifest 注册
  word/spreadsheet/presentation 文档渲染器；渲染器只收 path-free 的
  props，无 Node/Electron/IPC 访问。宿主仍持有文档读取/监听/校验和
  唯一的 anydoc 转换引擎；核心 UI 没有 Office 特例
  （`office-special-case-removed.test.ts` 钉死），viewer 失败走通用
  anydoc Markdown 回退。
- **Agent half**：只注册一个工具 `pipiui_officecli`，经
  `DirectOfficeAdapter` → `@officecli/sdk` 常驻进程 → 打包内置的原生
  `officecli` 二进制。命令为 `{ command: string | string[] }`，无 shell。
  稳定宿主库入口为 `agent/dist/host.js`。

## 直连（direct-only）

- 没有 Office MCP 服务器、没有 MCP 配置、没有凭据或 PATH 查找；用户
  无需任何设置。PipiUI 的通用 MCP 支持（`.pi/mcp.json` 解析、扩展面板、
  用户自建 MCP 服务器）与 Office 无关，保持通用。
- 二进制按 checksum 锁定的 release 获取并随包分发
  （见 `THIRD-PARTY-NOTICES-OFFICECLI.md`），子进程带
  `OFFICECLI_SKIP_UPDATE=1`，SDK `install()` 被禁用。
- 截图闸门（`resources/runtime/extensions/pipiui-office-doc-shot-gate.ts` +
  `office-doc-shot-gate.ts`）只认 `pipiui_officecli` 与通用
  `officecli`/`*_officecli` 工具名家族：已有文件先整档 baseline 截图
  （`officecli view <file> screenshot --grid auto`），末次写之后需要晚于
  它的 final 截图；bash 直调 officecli 被阻断。

## 格式承诺

机器可读契约仍是 `format-matrix.json`（v1，承诺不变）：
`.docx/.xlsx/.pptx` 原生预览 + 保证编辑（经 `pipiui_officecli`）；viewer
失败走 anydoc 回退；`.docm/.xlsm/.pptm` 仅预览/保留、宏永不执行；旧格式
best-effort；模板扩展确定性报错。`office-format-baseline.test.ts` 双向
钉死矩阵与分类表/闸门表。

## 历史证据（不执行）

- `office-behavior-baseline.md` — T1 冻结的重构前行为基线，其中关于
  `mcp_officecli_officecli` 的描述是当时现状的记录。
- `direct-mcp-parity-v1.json` — 2026-08 direct-vs-MCP 双轨对比的产物，
  产生它的 parity harness 已随迁移删除；该 JSON 是不可变的迁移证据，
  不是可执行的产品或测试代码。
