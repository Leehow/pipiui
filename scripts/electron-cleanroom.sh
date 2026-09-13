#!/bin/bash
# 净室启动打包后的 PipiUI：模拟"全新用户首次安装"。
#
# 同一个 build/PipiUI.app 可以和日常实例并存（App 没有单实例锁）。
# 隔离靠 --user-data-dir 把整个 userData（pi-agent 凭据/会话、runtime、缓存）
# 指到沙盒目录：main 进程只在**没有**收到这个开关时才把 userData pin 回历史
# profile（见 apps/electron/src/main/index.ts 的 hasExplicitUserDataDirSwitch），
# 收到了就沿用 Electron 自己解析出来的沙盒路径。
#
# macOS 上这个开关是唯一的杠杆：app.getPath('appData') 走 Chromium 的
# NSSearchPathForDirectoriesInDomains，不认 $HOME，所以 env -i HOME=<sandbox>
# 只能挡住 ~/.pi 的 legacy 迁移，挡不住 userData。Linux 相反，appData 跟随
# $XDG_CONFIG_HOME/$HOME，换 HOME 本身就已经隔离——本脚本两条一起给。
# PATH 收缩成 Finder 双击的最小集合（npm 不可用也是新用户真实环境的一部分）。
#
# 用法：
#   scripts/electron-cleanroom.sh            # 启动（沙盒状态保留，可反复进入）
#   scripts/electron-cleanroom.sh --reset    # 清空沙盒，回到全新用户
#   scripts/electron-cleanroom.sh --cdp 9225 # 指定远程调试端口（默认 9223）
#
# 验证隔离：启动前先在 app.asar 里确认这个包认识 --user-data-dir（旧包一启动就污染
# 真实 profile，只能提前拦）；启动后再等沙盒里长出 pi-agent/ 或 runtime/ 才算成功，
# 等不到就杀掉进程并报错，绝不让"净室"结论跑在
# ~/Library/Application Support/@pipiui/electron 上。
set -euo pipefail

APP="/Users/haoli/leehow/code/pipiui/build/PipiUI.app"
BIN="$APP/Contents/MacOS/PipiUI"
SANDBOX_DIR="/tmp/pipiui-cleanroom"
SANDBOX_HOME="/tmp/pipiui-cleanroom-home"
LOG="/tmp/pipiui-cleanroom.log"
CDP_PORT=9223
# 首个 ready 里就会建 pi-agent/ 与 runtime/；30s 足够冷启动，超时按未隔离处理。
ISOLATION_TIMEOUT_SECONDS=30

while [ $# -gt 0 ]; do
  case "$1" in
    --reset) rm -rf "$SANDBOX_DIR" "$SANDBOX_HOME"; echo "sandbox wiped: $SANDBOX_DIR"; shift ;;
    --cdp)   CDP_PORT="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

[ -x "$BIN" ] || { echo "packaged app missing: $APP" >&2; exit 1; }

# 预检：旧包一启动就会写真实 profile，所以在 exec 之前就拦住。打包后的 main bundle
# 没有压缩，直接能搜到开关名；搜不到就说明这个包早于 hasExplicitUserDataDirSwitch。
ASAR="$APP/Contents/Resources/app.asar"
if ! grep -aq -- 'user-data-dir' "$ASAR"; then
  {
    echo "packaged main predates the --user-data-dir opt-in: $ASAR"
    echo "  它会无条件 pin userData 到 ~/Library/Application Support/@pipiui/electron，"
    echo "  一启动就在污染真实 profile。请先重新打包：cd Electron && npm run package:mac"
  } >&2
  exit 1
fi

mkdir -p "$SANDBOX_DIR" "$SANDBOX_HOME"

# --user-data-dir 必须是绝对路径（上面 mkdir 已确保存在）。
env -i \
  HOME="$SANDBOX_HOME" USER=fresh LOGNAME=fresh TMPDIR=/tmp/ \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  "$BIN" --user-data-dir="$SANDBOX_DIR" --remote-debugging-port=$CDP_PORT \
  > "$LOG" 2>&1 &
PID=$!

# 只认这个 App 自己写的 profile 标记：沙盒目录是脚本 mkdir 出来的，"非空"证明不了什么。
isolated=""
deadline=$((SECONDS + ISOLATION_TIMEOUT_SECONDS))
while [ $SECONDS -lt $deadline ]; do
  if [ -e "$SANDBOX_DIR/pi-agent" ] || [ -e "$SANDBOX_DIR/runtime" ]; then isolated=1; break; fi
  if ! kill -0 "$PID" 2>/dev/null; then break; fi
  sleep 0.5
done

if [ -z "$isolated" ]; then
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "clean-room app exited before writing any profile (pid $PID)；日志：$LOG" >&2
    exit 1
  fi
  kill "$PID" 2>/dev/null || true
  {
    echo "clean-room isolation FAILED — killed pid $PID"
    echo "  沙盒里 ${ISOLATION_TIMEOUT_SECONDS}s 内没有出现 pi-agent/ 或 runtime/：$SANDBOX_DIR"
    echo "  userData 没有落到沙盒，很可能仍在写真实 profile："
    echo "    ~/Library/Application Support/@pipiui/electron"
    echo "  先看日志确认启动是否卡在别处：$LOG"
  } >&2
  exit 1
fi

echo "clean-room instance started (pid $PID)"
echo "  userData : $SANDBOX_DIR   (重置: $0 --reset)"
echo "  HOME     : $SANDBOX_HOME"
echo "  log      : $LOG"
echo "  CDP      : http://127.0.0.1:$CDP_PORT/json/list"
