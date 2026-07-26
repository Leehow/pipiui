# PipiUI Computer Use v1

状态（2026-07-26）：代码与纯函数/静态自动测试已实现；真实 `.app` 的 TCC、截图、输入、急停热键和 TextEdit/Finder/Xcode/Simulator 流程尚未进行 V3 手工验收，均为 **Untested**。

## 产品边界

Computer Use 默认关闭。关闭时 `pipiui-computer-use.ts` 不会传给 `pi -e`，所以 `computer` 工具不存在，也不增加 tool prefix。设置变更会重启已打开的顶层会话。

v1 的边界：

- macOS 14+；一个设置中选定的显示器，不做多显示器全景拼接。
- ScreenCaptureKit 直接按最长边 1080 或 1440 px 降采样，内存中编码 PNG，并尽量排除 PipiUI 应用窗口。
- 不读取 Accessibility Tree、Secure Text Field 或 OCR，不能可靠理解像素中的“支付/发布/删除”语义；因此 v1 不允许无人值守的破坏性流程。常见 token/private-key 形态会在输入前被拦截，但这不是完整的 secret 检测。
- 任意时刻只有一个顶层会话持有全局桌面 lease。切换 PipiUI 会话、关闭/重启会话、进程退出、超时、用户接管或急停都会释放 lease。
- subagent 无条件排除 `computer`，不受工具设置或 agent 定义影响。
- 目标应用按当前前台 bundle identifier 每次重新核对。新应用需要显式确认；可以仅本会话允许或持久允许/拒绝。
- PipiUI 自身、Terminal/iTerm/Ghostty、密码管理器、钥匙串、系统授权进程和 System Settings 永久拒绝。`⌘Tab` / `⌘Space` 应用切换以及 `⌘Q` / `⌘Delete` 等高风险快捷键也被拒绝；需要用户亲自切到并授权新目标应用。
- 用户真实移动鼠标、点击、按键或滚动时立即暂停并释放控制权。全局急停为 `⌥⇧Esc`；它还会撤销所有会话授权、释放所有按键/鼠标 down 状态并向当前控制会话发送 abort。

## 工具协议

非 Anthropic provider 使用同一个自定义工具：

```json
{
  "name": "computer",
  "actions": [
    {"type": "click", "x": 300, "y": 240},
    {"type": "type", "text": "hello"},
    {"type": "keypress", "keys": ["ENTER"]}
  ]
}
```

支持 screenshot、mouse_move、left/right/middle click、double/triple click、left mouse down/up、drag、Unicode type（含中文/emoji）、named-key shortcut、hold_key、scroll 和 wait。最多 24 个动作一批；所有坐标在发送输入前统一验证，越界整批拒绝。

Anthropic + `anthropic-messages` 只在 provider 请求边界替换成官方：

```json
{
  "type": "computer_20251124",
  "name": "computer",
  "display_width_px": 1440,
  "display_height_px": 900
}
```

扩展会把 `computer-use-2025-11-24` 合并进已有 `anthropic-beta`，不会覆盖其他 beta。Anthropic 的单 action 输入会在本地规范化为长度 1 的 batch。

OpenAI/Codex 与其他 provider 仍走上述自定义工具。v1 **没有**实现或宣称支持 OpenAI 原生 `computer_call` / `computer_call_output` 循环。

每个被安全闸门接受的 batch 都以新截图结束，并返回动作 outcome、前台应用、窗口标题、截图尺寸和 focus-drift 状态。为了保证截图不落盘，扩展只把一个 opaque screenshot marker 写进 pi 的 toolResult；PNG 最多保留最近 12 张在扩展进程内存中，由 `context` hook 注入提供给模型。重启会话后旧 marker 对应的图片不可恢复。

## 权限与稳定签名

需要：

1. System Settings → Privacy & Security → Screen Recording
2. System Settings → Privacy & Security → Accessibility

设置页显示两项实时状态，并提供打开对应面板的按钮。

`make-app.sh` 默认查找代码签名 identity `PipiUI Dev`。存在时，资源 bundle 与 App 使用同一个稳定 identity；不存在时仍可正常构建，但退回 ad-hoc 签名并打印 TCC 警告。

一次性准备：

1. 打开 Keychain Access → Certificate Assistant → Create a Certificate。
2. 名称填写 `PipiUI Dev`，Identity Type 选择 Self Signed Root，Certificate Type 选择 Code Signing。
3. 在主工作区运行 `./make-app.sh`；输出应显示 `Signing with stable identity: PipiUI Dev`。
4. 打开唯一产物 `/Users/haoli/leehow/code/pipiui/build/PipiUI.app`。
5. 在 PipiUI 设置 → 工具与 Skills → Computer Use 中点击两项“去授权”，完成系统授权后重启 App。

若使用其他证书：

```bash
PIPIUI_SIGN_ID="Developer ID Application: Example" ./make-app.sh
```

开发期重置屏幕录制授权：

```bash
tccutil reset ScreenCapture com.leehow.pipiui
```

`swift run` 的 TCC 身份属于启动它的终端/裸二进制，与 `PipiUI.app` 不同，不能用于权限或稳定签名验收。

## 安全与隐私

- bridge 只监听 `127.0.0.1`，只接受有 Content-Length 的 `POST /rpc`，请求 body 上限 2 MiB，连接超时 40 秒。
- 每个顶层会话使用独立的 32-byte 路由 capability 与桌面写 capability；任何 bridge 请求都在主线程路由前做恒时比较验证，`computer_batch` 还要通过第二个 capability。桌面 capability 会从 subagent、验证 shell 和辅助 git 子进程的环境中删除。
- 截图 PNG 不写文件、不进入 pi JSONL；进程退出即丢失。
- `~/Library/Application Support/PipiUI/computer-audit.jsonl` 只记录时间、随机 audit session id、bundle id、应用名、动作种类/坐标/计数、结果与 focus drift。
- 审计不记录 screenshot/base64、输入文本、具名键内容、窗口标题、bridge capability、API key 或 token。
- 截图仍可能被发送给当前模型 provider。Anthropic 官方路径可能提供额外的 prompt-injection 防护；自定义 provider 路径没有这一保证。

## V3 手工验收清单（当前均 Untested）

所有步骤只在变更集成到主工作区后执行；linked worktree 禁止创建 `.app`。

### 前置

1. 在主工作区用稳定 identity 执行 `./make-app.sh`，核对输出与 App/source 时间戳。
2. 打开 `build/PipiUI.app`，在设置中开启 Computer Use，并授予两项 TCC 权限。
3. 建立顶层会话；确认工具栏出现桌面图标，subagent 的工具参数中没有 `computer`。
4. 首次工具调用应先返回 session consent required；批准后重试。首次目标应用调用应再返回 application authorization required；批准后必须切回该 App 再重试。

### TextEdit

1. 手动打开 TextEdit 空白文档并保持前台。
2. 让 agent 截图，然后分批点击编辑区、输入英文、中文和 emoji。
3. 对包含 Return 或保存的步骤保持人在回路中，确认每批结果都有最新截图及正确 app/window metadata。
4. 手动核对文本无缺字、坐标无偏移、保存位置符合预期。

### Finder

1. 手动打开一个专用临时测试目录，确保没有重要文件。
2. 让 agent 创建新文件夹并把一个可丢弃测试文件拖入其中。
3. 核对右键/拖拽/双击可用，焦点切到其他 App 时下一动作被 focus drift 阻止。
4. 不测试真实删除；v1 不允许无人值守破坏性操作。

### Xcode

1. 打开一个无敏感信息的测试项目并授权 Xcode。
2. 让 agent 点击 Run，等待并截图观察 build 状态。
3. 核对用户移动鼠标后 lease 立即暂停；点“恢复”后必须先切回 Xcode 才可继续。

### iOS Simulator

1. 手动启动 Simulator 并单独授权其 bundle identifier。
2. 让 agent 完成一段无账号、无支付的测试 UI 流程，覆盖点击、滚动和文本输入。
3. 核对跨到新 App 时不会沿用旧授权或旧前台身份。

### 急停与并发

1. 在 batch 执行时按 `⌥⇧Esc`；应在 1 秒内看到 lease/授权撤销、生成 abort，且没有残留 mouse-down/key-down。
2. 让两个顶层会话几乎同时调用 computer；第二个必须收到明确的 `computer busy`。
3. 切换 PipiUI 当前会话；旧会话 lease 必须立即释放。

网页 QA 仍应优先使用现有 `browser` 工具；只有浏览器工具够不到原生窗口或系统级交互时才使用 Computer Use。
