#!/bin/bash
# 净室启动打包后的 PipiUI Electron：模拟"全新用户首次安装"。
#
# 同一个 build/PipiUI Electron.app 可以和日常实例并存（App 没有单实例锁），
# 隔离靠 --user-data-dir 把整个 userData（pi-agent 凭据/会话、runtime、缓存）
# 指到沙盒目录；HOME 指到空目录以屏蔽 ~/.pi 的 legacy 迁移；PATH 收缩成
# Finder 双击的最小集合（npm 不可用也是新用户真实环境的一部分）。
#
# 用法：
#   scripts/electron-cleanroom.sh            # 启动（沙盒状态保留，可反复进入）
#   scripts/electron-cleanroom.sh --reset    # 清空沙盒，回到全新用户
#   scripts/electron-cleanroom.sh --cdp 9225 # 指定远程调试端口（默认 9223）
#
# 验证隔离：真实 profile 在 ~/Library/Application Support/@pipiui/electron，
# 正常使用不受本脚本影响；想确认可看 /tmp/pipiui-cleanroom.log 里的
# [pipi-install] 路径是否落在沙盒内。
set -euo pipefail

APP="/Users/haoli/leehow/code/pipiui/build/PipiUI Electron.app"
BIN="$APP/Contents/MacOS/PipiUI Electron"
SANDBOX_DIR="/tmp/pipiui-cleanroom"
SANDBOX_HOME="/tmp/pipiui-cleanroom-home"
LOG="/tmp/pipiui-cleanroom.log"
CDP_PORT=9223

while [ $# -gt 0 ]; do
  case "$1" in
    --reset) rm -rf "$SANDBOX_DIR" "$SANDBOX_HOME"; echo "sandbox wiped: $SANDBOX_DIR"; shift ;;
    --cdp)   CDP_PORT="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

[ -x "$BIN" ] || { echo "packaged app missing: $APP" >&2; exit 1; }
mkdir -p "$SANDBOX_DIR" "$SANDBOX_HOME"

# --user-data-dir 必须是绝对路径（上面 mkdir 已确保存在）。
env -i \
  HOME="$SANDBOX_HOME" USER=fresh LOGNAME=fresh TMPDIR=/tmp/ \
  PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  "$BIN" --user-data-dir="$SANDBOX_DIR" --remote-debugging-port=$CDP_PORT \
  > "$LOG" 2>&1 &

echo "clean-room instance started (pid $!)"
echo "  userData : $SANDBOX_DIR   (重置: $0 --reset)"
echo "  HOME     : $SANDBOX_HOME"
echo "  log      : $LOG"
echo "  CDP      : http://127.0.0.1:$CDP_PORT/json/list"
