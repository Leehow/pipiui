# PipiUI Electron 跨平台版开源复用审计

日期：2026-08-10  
状态：选型定稿；尚未向仓库加入 Electron/Node 依赖  
依据：`docs/plans/2026-08-10-electron-cross-platform-spec.md`

## 审计规则

- **版本/活跃度**是本次选型的基线记录；所有计划依赖在首次写入 lockfile 前必须复核最新稳定版本、上游许可证、transitive notices 和安全公告。
- “直接依赖”只表示已批准的引入方式，不表示目前已安装。当前所有 Electron 依赖均为 **pending**。
- 仅架构参考不复制代码、商标、产品资源，不产生当前分发 NOTICE 义务；若改为复制或改造，必须先补齐许可证、版权声明和本目录 NOTICE。
- `ThirdPartyNotices/Electron-*-PENDING.txt` 是计划占位，不可替代实际引入时按锁定版本生成的完整 notice。

## 候选清单

| 名称 | 仓库 URL | 版本 / 活跃度（2026-08-10 基线） | 许可证 | 采用方式 | 理由 |
|---|---|---|---|---|---|
| craft-agents-oss | https://github.com/craft-ai-agents/craft-agents-oss | 最新 release 基线：v0.8.2；活跃 | Apache-2.0 | 仅架构参考 | 参考“一套 renderer 同时服务桌面与 headless/WSS”的模式；不 fork、不复制产品层。若未来复制代码，先补 Apache-2.0 LICENSE 与其上游 NOTICE。 |
| pi-gui | https://github.com/minghinmatthewlam/pi-gui | 版本在实施前锁定；活跃 | MIT | 仅架构参考 | 参考 pi session、进程生命周期和桌面宿主边界；不复制代码。 |
| openpi | https://github.com/heyhuynhgiabuu/openpi | 研究基线：v0.2.0；活跃 | MIT | 仅架构参考 | 参考 Pi Coding Agent 的桌面 workbench/进程整合思路；不复制代码。 |
| assistant-ui | https://github.com/assistant-ui/assistant-ui | 版本在实施前锁定；活跃 | MIT | 直接依赖 | 使用 custom runtime / ExternalStore，将 pi RPC 事件映射为聊天 UI store，而非接入其默认 AI runtime。 |
| Streamdown | https://github.com/vercel/streamdown | 版本在实施前锁定；活跃 | Apache-2.0 | 直接依赖 | 处理流式、不完整 Markdown；Mermaid/KaTeX 延迟加载。 |
| Shiki | https://github.com/shikijs/shiki | 版本在实施前锁定；活跃 | MIT | 直接依赖 | 为 Streamdown/代码块提供语法高亮。 |
| @git-diff-view/react | https://github.com/MrWangJustToDo/git-diff-view | 版本在实施前锁定；活跃度在落锁前复核 | MIT | 直接依赖（候选 A） | GitHub 风格 diff；与候选 B 二选一，未选中者不进入 lockfile。 |
| react-diff-view | https://github.com/otakustay/react-diff-view | 版本在实施前锁定；活跃度在落锁前复核 | MIT | 直接依赖（候选 B） | GitHub 风格 diff；与候选 A 二选一，未选中者不进入 lockfile。 |
| react-virtuoso（核心包） | https://github.com/petyosi/react-virtuoso | 版本在实施前锁定；活跃 | MIT | 直接依赖 | 虚拟化长会话、工具日志和 agent 列表；**不得使用其商业 Message List 包**。 |
| electron-vite | https://github.com/alex8088/electron-vite | 版本在实施前锁定；活跃 | MIT | 直接依赖 | Electron + React/TypeScript 的开发与构建骨架。 |
| electron-builder | https://github.com/electron-userland/electron-builder | 版本在实施前锁定；活跃 | MIT | 直接依赖 | macOS/Windows/Linux 安装包构建。 |
| electron-updater | https://github.com/electron-userland/electron-builder | 版本在实施前锁定；活跃 | MIT | 直接依赖 | 配合 electron-builder 提供桌面更新能力。 |
| xterm.js | https://github.com/xtermjs/xterm.js | 版本在二期实施前锁定；活跃 | MIT | 直接依赖（二期） | 终端 UI；延后以避免阻塞核心聊天与 Subagents 首期交付。 |
| node-pty | https://github.com/microsoft/node-pty | 版本在二期实施前锁定；活跃 | MIT | 直接依赖（二期） | 终端 PTY 的唯一原生依赖；需随 Electron 版本执行 electron-rebuild。 |
| ws | https://github.com/websockets/ws | 版本在实施前锁定；活跃 | MIT | 直接依赖 | 浏览器/服务器共享 UI 的 Node WebSocket transport。 |
| opcode/claudia | https://github.com/getAsterisk/claudia | 停更风险 | AGPL-3.0 | 排除 | AGPL 义务与停更风险不符合本项目复用策略。 |
| Chainlit | https://github.com/Chainlit/chainlit | 活跃但技术栈不匹配 | Apache-2.0 | 排除 | Python 应用栈，不能作为 Electron + React/TypeScript UI 库直接复用。 |
| chatbot-ui | https://github.com/mckaywrigley/chatbot-ui | 版本在需要时复核 | MIT | 排除 | 完整应用而非可低耦合集成的组件库，fork/拆取成本高。 |
| Vercel AI SDK（全量） | https://github.com/vercel/ai | 活跃 | Apache-2.0 | 排除（仅架构/组件模式参考） | 全量 runtime/provider 抽象会锁定数据流，与 pi typed RpcClient + `PipiHostAPI` 阻抗不匹配；仅参考 AI Elements 的组件模式。 |

**复制改造状态：** 当前没有获批的复制改造候选。craft-agents-oss、pi-gui 和 openpi 均严格限于仅架构参考；任何未来复制改造都须在复制前转为该采用方式，并补齐对应 LICENSE、版权声明和 NOTICE。

## ThirdPartyNotices 落地与 TODO

当前尚无 Electron package manifest 或 lockfile，因此没有已分发的 Node 第三方代码。本次在 `ThirdPartyNotices/` 为每项批准的直接依赖建立 **PENDING** 占位条目（含 assistant-ui）；候选 diff 的两个条目均保留，实际只能完成被选中包的正式化。

首次实际引入任一依赖时，实施 PR 必须：

1. 将精确 package 版本、解析后的仓库 commit（如适用）和上游版权行写入对应 notice。
2. 以该锁定版本的上游 `LICENSE` 替换占位内容，或在 notice 中引用随分发提供的完整对应许可证文本；审计许可证变更及 transitive notices。
3. 删除未被选择的 diff 候选占位条目；若 `xterm.js`/`node-pty` 仍未进入二期，不得把它们标为已分发。
4. 若从 craft-agents-oss 复制或改造任何代码，在复制前新增 Apache-2.0 LICENSE 和该版本的 NOTICE（如有）；pi-gui/openpi 同理按实际复制来源补 notice。

不为仅架构参考或排除项分发许可证文本：它们没有被纳入产物，也没有代码复制。
