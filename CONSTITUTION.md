# PipiUI Constitution / 项目宪章

Binding rules for humans and coding agents. Short and enforceable.
人类与 coding agent 均须遵守。短、可执行、无例外（除非用户明确豁免）。

---

## 1. 编译通过即打包（强制）

**Any successful `swift build` / feature completion / "build passed" verification that is meant to update the runnable app MUST also package so `build/PipiUI.app` is not stale.**

凡成功编译、功能完成、或声称「构建通过 / 可运行」且意图更新可双击运行的 App 时，**必须**随后打包，不得只停在 `.build/debug` 或 `.build/release`。

Canonical commands:

```bash
./make-app.sh                 # release → build/PipiUI.app + install /Applications/PipiUI.app
./scripts/build-app.sh        # 可选：先测再打包（见脚本 --help）
```

## 2. 打包后必须安装到应用程序（强制）

**After every successful `./make-app.sh`, `/Applications/PipiUI.app` MUST be refreshed (same generation as `build/PipiUI.app`).**

`./make-app.sh` 成功后，**必须**把同代产物同步到 `/Applications/PipiUI.app`。用户打开路径是应用程序（`open -a PipiUI` / Launchpad / 应用程序文件夹）。

- `build/PipiUI.app` = in-repo build artifact（仓库内构建产物）
- `/Applications/PipiUI.app` = user launch target（用户启动目标）
- Escape（rare）：`PIPIUI_SKIP_INSTALL=1` 或 `PIPIUI_INSTALL_APP=/other/path.app`

Do not claim done if the Applications copy is older than the build product or sources.
Applications 副本旧于 `build/PipiUI.app` 或源码时，**不得**声称完成。

## 3. 时间戳验收（强制）

打包后验证 **build + Applications** 二进制均新于改动源码：

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  /Applications/PipiUI.app/Contents/MacOS/PipiUI \
  Sources/PipiUI/Views/ImagePreview.swift   # 或本次实际改动的源文件
```

两者 **必须** 新于本次变更的 sources，且 Applications 与 build 同代。否则不算完成。

## 4. 禁止「半完成」话术

- **Do not** tell the user "done / ready to open app" if only `.build/debug` (or bare `swift build`) succeeded and `.app` is older than sources.
- 仅 `swift build` / `swift run` 成功而 `.app` 仍旧时，**不得**说「完成 / 可以打开 App 了」。
- 仅 `build/PipiUI.app` 更新而 `/Applications/PipiUI.app` 仍旧时，同样不算完成。

## 5. 开发 vs 交付

| 用途 | 命令 |
|------|------|
| 快速调试 | `swift run` / `swift build -c debug` |
| 可双击 / 给用户打开的 App | `./make-app.sh`（release 打包 + 安装到应用程序） |

Prefer release package via `make-app.sh` for the double-clickable app. `swift run` is for quick debug only.

## 6. 其它质量底线（简）

- 改动业务逻辑 / 解析 / 状态机时：尽量跑 `swift test` 或 `swift run PipiUITestRunner`（环境无 XCTest 时用后者）；`./scripts/build-app.sh` 默认会先测。
- 不破坏现有 `make-app.sh` 行为；脚本保持 `set -e` 与可执行位。
- 声称完成前：有命令级证据（构建/打包/安装输出 + 双路径时间戳），禁止口头「应该好了」。

---

**权威产物路径：** `build/PipiUI.app`（仓库产物）· `/Applications/PipiUI.app`（用户启动）  
**入口脚本：** `./make-app.sh` · `./scripts/build-app.sh`  
**Agent 入口：** 见根目录 `AGENTS.md`
