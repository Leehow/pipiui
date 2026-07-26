# PipiUI Constitution / 项目宪章

Binding rules for humans and coding agents. Short and enforceable.
人类与 coding agent 均须遵守。短、可执行、无例外（除非用户明确豁免）。

---

## 1. 编译通过即打包（强制）

**Any successful `swift build` / feature completion / "build passed" verification that is meant to update the runnable app MUST also package so `build/PipiUI.app` is not stale.**

凡成功编译、功能完成、或声称「构建通过 / 可运行」且意图更新可双击运行的 App 时，**必须**随后打包，不得只停在 `.build/debug` 或 `.build/release`。

Canonical commands:

```bash
./make-app.sh                 # release → build/PipiUI.app
./scripts/build-app.sh        # 可选：先测再打包（见脚本 --help）
```

## 2. 时间戳验收（强制）

打包后验证 `build/PipiUI.app` 二进制新于改动源码：

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' \
  build/PipiUI.app/Contents/MacOS/PipiUI \
  Sources/PipiUI/Views/ImagePreview.swift   # 或本次实际改动的源文件
```

`build/PipiUI.app` 二进制必须新于本次变更的 sources，否则不算完成。

## 3. 禁止「半完成」话术

- **Do not** tell the user "done / ready to open app" if only `.build/debug` (or bare `swift build`) succeeded and `.app` is older than sources.
- 仅 `swift build` / `swift run` 成功而 `.app` 仍旧时，**不得**说「完成 / 可以打开 App 了」。

## 4. 开发 vs 交付

| 用途 | 命令 |
|------|------|
| 快速调试 | `swift run` / `swift build -c debug` |
| 可双击 / 给用户打开的 App | `./make-app.sh`（release 打包到 `build/PipiUI.app`） |

Prefer release package via `make-app.sh` for the double-clickable app. `swift run` is for quick debug only.

## 5. 其它质量底线（简）

- 改动业务逻辑 / 解析 / 状态机时：尽量跑 `swift test` 或 `swift run PipiUITestRunner`（环境无 XCTest 时用后者）；`./scripts/build-app.sh` 默认会先测。
- 不破坏现有 `make-app.sh` 行为；脚本保持 `set -e` 与可执行位。
- 声称完成前：有命令级证据（构建/打包输出 + `build/PipiUI.app` 时间戳），禁止口头「应该好了」。

---

**权威产物路径：** `build/PipiUI.app`（唯一可运行包）
**入口脚本：** `./make-app.sh` · `./scripts/build-app.sh`  
**Agent 入口：** 见根目录 `AGENTS.md`
