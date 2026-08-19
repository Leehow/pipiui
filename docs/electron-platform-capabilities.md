# Electron 版跨平台能力降级清单

日期：2026-08-10
关联：`docs/plans/2026-08-10-electron-cross-platform-spec.md`（跨平台构建部分）、
计划任务 `cross-platform-builds`。

## 能力矩阵

| 能力 | macOS (darwin) | Windows (win32) | Linux (linux) | 判定位置 |
|---|---|---|---|---|
| revealInFinder | ✅ | ❌ 隐藏 | ❌ 隐藏 | `packages/pi-backend`：`capabilities` → `revealInFinder: process.platform === 'darwin'`；UI 由 `capabilities.revealInFinder` 门控（`packages/ui` 的 `canRevealInFinder`） |
| computerUse | ✅ opt-in；单个 `computer-use` episode + macOS Cua Runtime v1 | ❌ | ❌ | `packages/pi-backend`：仅在 feature、descriptor 和 runtime usable 同时成立时返回 true；Windows/Linux driver 移植未实现 |
| terminal（xterm） | ✅ node-pty | ✅ node-pty | ✅ node-pty（glibc ≤ 2.35） | 已入包；Linux `pty.node` 必须在 Ubuntu 22.04（glibc 2.35）上编译 |
| 应用生命周期 | ✅ 关闭全部窗口不退出（macOS 惯例，dock 激活重建） | ✅ 全部窗口关闭即退出 | ✅ 同 win | `index.ts`：`if (process.platform !== 'darwin') app.quit()` |
| 安装形态 | .app / dmg / zip（x64+arm64） | NSIS .exe（x64） | AppImage + deb（x64） | `apps/electron/package.json` build.target |
| 密钥库（进程内存） | ✅ 仅当前 App 主进程 RAM，退出清除 | ✅ 同左 | ✅ 同左；不依赖钥匙串 / Secret Service | `packages/pi-backend/src/secret-vault.ts`；说明见 [`electron-secret-vault-linux.md`](./electron-secret-vault-linux.md) |
| 图标 | `build/icon.icns`（`scripts/make-icon.sh` 从 `assets/brand/app-icon.png` 生成，macOS 工具链；build/ 被 gitignore，CI mac job 先行再生成） | `assets/icons/512x512.png`（app-builder 自动转 .ico，≥256px） | `assets/icons/` 目录（16–1024 完整 png 集，deb/AppImage 各尺寸齐全） | 图标集提交在 `Electron/apps/electron/assets/icons/`（sips 生成一次，CI 无需工具链）；win/linux 由 app-builder 自动转换 |
| 默认 shell | zsh | cmd / PowerShell（node-pty 需 conpty） | bash / sh | 按 `process.platform` 选择 |
| 路径 | `{projectRoot}/.pi/agent` + App profile shared auth/model files | `%USERPROFILE%` project path（Computer Use 不可用） | project-local `.pi/agent`（Computer Use 不可用） | Computer Use Workflow Memory 只用 backend-resolved active project Pi home；不使用全局 `~/.pi` 或 App-profile Procedure Store |
| 文件/分隔符 | POSIX、LF | 反斜杠路径、CRLF | POSIX、LF | JSONL 写入统一 `\n`（与 pi 兼容）；`node:path` 处理分隔符 |
| pi 进程解析 | PATH 中的 `pi`（`PiBackendOptions.piPath` 可注入） | 需 `pi.exe` 在 PATH | 需 `pi` 在 PATH | `packages/pi-backend` 默认 `"pi"`；win/linux 安装指引另列 |
| 代码签名 | 无（CI 禁自动发现证书） | 无 | 无 | CI `CSC_IDENTITY_AUTO_DISCOVERY=false`；正式发布按平台接 notary/证书 |

## 原生依赖（node-pty，已入包）

- node-pty 已打进 Electron 包；CI 在 `npm ci` 之后执行
  `npx --maxsockets 3 electron-builder install-app-deps`，按运行平台编到 Electron ABI。
- Linux `pty.node` 必须在 Ubuntu 22.04（glibc 2.35）上编译。禁止在更新的滚动发行版
  （如 ubuntu-latest / 24.04+）上编，否则会带上 GLIBC_2.36+，旧发行版无法加载。
- CI linux job 钉在 `ubuntu-22.04`；打包后用 `scripts/check-linux-pty-glibc.mjs`
  扫描产物里的 `pty.node`，发现 2.36+ 即失败。
- 平台注意：Windows 走 node-pty 内建 conpty；Linux 需 gcc/libstdc++ 工具链；
  macOS 无额外依赖。

## 打包与 CI 说明

- 本地打包：`./scripts/build-electron-app.sh [mac|win|linux]`（默认 mac）。
  - mac 打包仅限主 checkout（AGENTS.md 守卫；worktree 降级为 `npm run build` 验证）。
  - win/linux 安装包不是 .app 产物，任意 checkout 均可交叉构建：
    electron-builder 25 在 macOS Catalina+ 无需 wine 即可产出 NSIS；
    AppImage 可直接在 macOS 交叉构建。
  - ⚠️ deb 例外：macOS 主机上 electron-builder 内置 fpm 1.9.3 在 macOS 15 ruby
    下会静默产出 96 字节空归档；`build-electron-app.sh linux` 会检测到空归档并
    明确报错（AppImage 仍正常产出）。deb 请在 ubuntu CI（workflow linux job）
    或 Linux 主机上构建；CI 有同样的大小守卫步骤。
- CI：`.github/workflows/electron.yml` 三平台 matrix
  （macos-latest / windows-2022 / ubuntu-22.04）：
  `npm ci` → `npm test` → `npm run build` → `electron-builder --<platform>` → 上传产物。
  按 AGENTS.md 非主工作区规则，CI 不上传裸 macOS `.app` 目录，只上传
  dmg/zip/exe/AppImage/deb；CI 构建/测试本身允许。
