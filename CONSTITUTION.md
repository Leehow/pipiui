# PipiUI Constitution / 项目宪章

Binding rules for humans and coding agents. Short and enforceable.
人类与 coding agent 均须遵守。短、可执行、无例外（除非用户明确豁免）。

---

## 0. 易用性优先，先走通再加固（强制）

**The first milestone is a real, end-to-end usable product flow. Optional security hardening must not block that milestone.**

- MVP 首先保证普通用户无需理解基础设施即可完成核心任务；默认流程不得额外要求账号、邮箱验证码、手工填写凭据或服务器知识，除非这些步骤是核心功能不可替代的必要条件。
- 产品验收优先看真实用户步骤是否最短、是否真的能用。能用随机链接直接完成的流程，不得改成多层登录、授权和配对仪式。
- 首版只保留避免明显凭据泄露、破坏性操作和越权访问所必需的最小边界；纵深防御、复杂密钥治理、额外身份层和高级安全策略放到核心流程跑通之后。
- 任何会增加用户步骤的安全设计，必须先给出具体威胁和不可替代性；否则默认延后，不得以“更安全”为由阻塞可用版本。
- **错误必须可关闭**：所有持续显示的用户可见错误必须提供明确的关闭控制（如 × 按钮）；临时 toast 可自动消失，但仍须可手动关闭；错误不得永久占据 Composer 或阻塞后续操作，关闭后应能继续使用界面。

## 1. 唯一可运行包与唯一打包地点（强制）

**The only permitted runnable Apps are `/Users/haoli/leehow/code/pipiui/build/PipiUI.app` and `/Users/haoli/leehow/code/pipiui/build/PipiUI Electron.app`. Only this primary checkout may package them.**

凡成功编译、功能完成、或声称「构建通过 / 可运行」且意图更新可双击运行的 App 时，**只能**在主工作区 `/Users/haoli/leehow/code/pipiui` 随后打包。不得只停在 `.build/debug` 或 `.build/release`。

所有 linked worktree、临时 worktree 与 `pipiui-wt/*` 目录只可运行 `swift build`、`swift test`、`swift run` 或 Electron workspace build 作验证；**严禁**运行会创建 `build/PipiUI.app` 或 `build/PipiUI Electron.app` 的打包命令。不得保留、打开、分发或在 Launchpad 中依赖这些目录里的 `.app`。若发现历史遗留副本，应删除该副本，主工作区的两个唯一包不受影响。

Canonical commands:

```bash
cd /Users/haoli/leehow/code/pipiui
./make-app.sh                 # release → 此唯一位置的 build/PipiUI.app
./scripts/build-app.sh        # 可选：先测再打包（见脚本 --help）
./scripts/build-electron-app.sh  # Electron release → build/PipiUI Electron.app
```

Agents 不直接调用 `build-electron-app.sh`，一律经 `pipiui-electron-build` skill 打包（见 `AGENTS.md` → Electron packaging adapter）；该 skill 的 `release` 模式内部才调用本脚本。本条约束的是打包**地点**，skill 约束的是打包**方式**，两者并行生效。

## 1A. PipiUI 宿主进程生命周期由用户授权（强制）

运行中的 PipiUI 宿主进程属于当前用户。Agents/workers **不得**针对它执行 `kill`、`pkill`、`killall`、Force Quit、`NSRunningApplication.terminate()`、`NSRunningApplication.forceTerminate()` 或等价的终止操作。

构建、打包或更新后只负责产出包，并告知用户自行退出再手动重新打开 PipiUI；不得自动打开、启动或重启它。唯一例外是当前用户明确要求终止或重启 PipiUI；不得自行推断该请求，也不得把终止/重启当作验证步骤。

## 2. 时间戳验收（强制）

仅在主工作区打包后，验证对应 App 二进制新于改动源码：

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  Sources/PipiUI/Views/ImagePreview.swift   # 或本次实际改动的源文件
```

`build/PipiUI.app` 或 `build/PipiUI Electron.app` 的对应二进制必须新于本次变更的 sources，否则不算完成。

## 3. 禁止「半完成」话术

- **Do not** tell the user "done / ready to open app" if only `.build/debug`, bare `swift build`, or Electron workspace build succeeded and the corresponding `.app` is older than sources.
- 仅 `swift build` / `swift run` 成功而 `.app` 仍旧时，**不得**说「完成 / 可以打开 App 了」。

## 4. 开发 vs 交付

| 用途 | 命令 |
|------|------|
| 任意 worktree 的快速调试/验证 | `swift run` / `swift build -c debug` / `swift test` |
| 主工作区的可双击 Swift App | `./make-app.sh`（仅主工作区，release 打包到 `build/PipiUI.app`） |
| 主工作区的可双击 Electron App | `pipiui-electron-build` skill 的 `fast-app` / `release`（仅主工作区，打包到 `build/PipiUI Electron.app`；勿手调 electron-builder） |

Prefer release package via `make-app.sh` for the double-clickable app, but only from the primary checkout. `swift run` is for quick debug only.

## 5. 其它质量底线（简）

- 改动业务逻辑 / 解析 / 状态机时：尽量跑 `swift test` 或 `swift run PipiUITestRunner`（环境无 XCTest 时用后者）；`./scripts/build-app.sh` 默认会先测。
- 不破坏现有 `make-app.sh` 行为；脚本保持 `set -e` 与可执行位。
- 声称完成前：有命令级证据（构建/打包输出 + `build/PipiUI.app` 时间戳），禁止口头「应该好了」。

---

**权威产物路径：** `/Users/haoli/leehow/code/pipiui/build/PipiUI.app` · `/Users/haoli/leehow/code/pipiui/build/PipiUI Electron.app`（仅有的可运行包）
**入口脚本：** `./make-app.sh` · `./scripts/build-app.sh` · Electron 走 `pipiui-electron-build` skill（其 `release` 内部调 `./scripts/build-electron-app.sh`）
**Agent 入口：** 见根目录 `AGENTS.md`
