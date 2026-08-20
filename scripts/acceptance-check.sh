#!/usr/bin/env bash
# PipiUI Electron 集成验收自动检查脚本（integration-acceptance）
# 只读检查 + 运行 Electron 工作区测试；不修改产品代码，不打包。
# 用法: ./scripts/acceptance-check.sh [--skip-tests]
# 退出码: 0=自动项全过; 1=存在失败项; 人工项不参与退出码。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="$ROOT/Electron"
SKIP_TESTS=0
[ "${1:-}" = "--skip-tests" ] && SKIP_TESTS=1

PASS=0; FAIL=0; WARN=0
ok()   { PASS=$((PASS+1)); printf '  [PASS] %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  [FAIL] %s\n' "$1"; }
warn() { WARN=$((WARN+1)); printf '  [WARN] %s\n' "$1"; }

echo "== PipiUI Electron 集成验收：自动检查 =="

# ---------- 1. Electron .app 产物存在 ----------
echo "-- 1. Electron App 产物 --"
ELECTRON_APP=""
for candidate in "$ROOT/build/PipiUI Electron.app" "$ROOT/build/pipiui_e.app"; do
  [ -d "$candidate" ] && ELECTRON_APP="$candidate" && break
done
if [ -n "$ELECTRON_APP" ]; then
  ok "Electron App 存在: ${ELECTRON_APP#$ROOT/build/}"
  [ "$(basename "$ELECTRON_APP")" = "PipiUI Electron.app" ] || \
    warn "Electron 产物名为 $(basename "$ELECTRON_APP")，spec 约定为 'PipiUI Electron.app'"
else
  bad "Electron App 缺失（期望 build/PipiUI Electron.app 或 build/pipiui_e.app）"
fi

# ---------- 2. 产物时间戳 vs 源码（AGENTS.md 规则） ----------
echo "-- 2. 产物时间戳核对 --"
newest_electron_src=$(find "$ELECTRON/packages" "$ELECTRON/apps" \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/out/*' -type f -print0 2>/dev/null | xargs -0 stat -f '%m' 2>/dev/null | sort -rn | head -1)
[ -z "$newest_electron_src" ] && newest_electron_src=0

if [ -n "$ELECTRON_APP" ]; then
  elec_bin=$(find "$ELECTRON_APP/Contents/MacOS" -type f -maxdepth 1 | head -1)
  elec_bin_mtime=$(stat -f '%m' "$elec_bin" 2>/dev/null || echo 0)
  [ "$elec_bin_mtime" -ge "$newest_electron_src" ] \
    && ok "Electron App 时间戳新鲜（bin $(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$elec_bin")）" \
    || warn "Electron App 二进制早于最新 Electron 源码 → 需重新 package 后再验收"
else
  warn "Electron App 缺失，跳过时间戳核对"
fi

# ---------- 3. Electron 工作区测试 ----------
echo "-- 3. npm test（Electron 工作区）--"
if [ "$SKIP_TESTS" = "1" ]; then
  warn "跳过测试（--skip-tests）"
elif [ ! -d "$ELECTRON/node_modules" ]; then
  bad "Electron/node_modules 缺失，无法跑测试（先 npm install）"
else
  TEST_OUT=$(cd "$ELECTRON" && npm test 2>&1)
  TEST_RC=$?
  if [ $TEST_RC -eq 0 ]; then
    FILES=$(printf '%s\n' "$TEST_OUT" | grep -oE 'Test Files  [0-9]+ passed' | grep -oE '[0-9]+')
    TESTS=$(printf '%s\n' "$TEST_OUT" | grep -oE 'Tests  [0-9]+ passed' | grep -oE '[0-9]+')
    ok "npm test 全绿（Test Files ${FILES:-?} / Tests ${TESTS:-?} passed）"
  else
    bad "npm test 失败（exit ${TEST_RC}）— 输出见下："
    printf '%s\n' "$TEST_OUT" | tail -30 | sed 's/^/      /'
  fi
fi

# ---------- 4. 关键文件存在 ----------
echo "-- 4. 关键文件 --"
KEY_FILES=(
  "$ELECTRON/package.json"
  "$ELECTRON/apps/electron/package.json"
  "$ELECTRON/apps/electron/src/main/index.ts"
  "$ELECTRON/apps/electron/src/main/browser-host.ts"
  "$ELECTRON/apps/electron/src/preload/index.ts"
  "$ELECTRON/apps/server/src/index.ts"
  "$ELECTRON/apps/server/src/relay-pairing.ts"
  "$ELECTRON/packages/host-api/src/index.ts"
  "$ELECTRON/packages/host-api/test/contract.test.ts"
  "$ELECTRON/packages/pi-backend/src/index.ts"
  "$ELECTRON/packages/pi-backend/src/lease.ts"
  "$ELECTRON/packages/pi-backend/src/spawn-assembly.ts"
  "$ELECTRON/packages/pi-backend/test/lease.test.ts"
  "$ELECTRON/packages/ui/src/App.tsx"
  "$ELECTRON/packages/ui/src/SubagentPanel.tsx"
  "$ELECTRON/packages/ui/src/DocumentPanel.tsx"
  "$ELECTRON/packages/ui/src/TerminalPanel.tsx"
  "$ELECTRON/packages/ui/src/BrowserPanel.tsx"
  "$ELECTRON/packages/ui/vite.browser.config.ts"
  "$ROOT/docs/plans/2026-08-10-session-lease-protocol.md"
)
missing=0
for f in "${KEY_FILES[@]}"; do
  [ -f "$f" ] || { missing=$((missing+1)); printf '  [FAIL] 缺失: %s\n' "${f#$ROOT/}"; }
done
if [ "$missing" -eq 0 ]; then ok "关键文件 ${#KEY_FILES[@]} 个全部存在"; else bad "缺失 $missing 个关键文件（见上）"; fi

# ---------- 5. 已知缺口提示（不判失败） ----------
echo "-- 5. 已知缺口（人工核对，不判失败）--"
grep -rn "relay-pairing" "$ELECTRON/apps" "$ELECTRON/packages" --include="*.ts" 2>/dev/null | grep -v "src/relay-pairing.ts" | grep -q . \
  && ok "relay-pairing 已被引用" || warn "relay-pairing.ts 未被引用 → 远程 Node host 端到端待合入"
cd "$ROOT" && git ls-files --error-unmatch Electron/package.json >/dev/null 2>&1 \
  && ok "Electron/ 已纳入 git" || warn "Electron/ 工作区未提交（git untracked）→ 验收基线前需先合入"

# ---------- 汇总 ----------
echo "=============================================="
echo "自动项: PASS=$PASS FAIL=$FAIL WARN=$WARN"
echo "=============================================="
echo ""
echo "== 人工验收项（勾选占位，未勾选不阻塞脚本）=="
MANUAL_ITEMS=(
  "同一 UI：浏览器（配对链接）与 Electron 渲染 DOM 一致（需远程合入）"
  "长会话性能：10MB+ JSONL 打开不卡、滚动流畅"
  "多 Subagent：树列表实时状态/费用 + 详情日志流 + abort/resolve/merge/discard 全链路"
  "浅色/深色跟随系统切换即时生效"
  "右栏四页：Subagents/Document/Terminal/Browser 逐一可用；无浏览器能力连接优雅降级"
)
for i in "${!MANUAL_ITEMS[@]}"; do
  printf '  [ ] %02d. %s\n' "$((i+1))" "${MANUAL_ITEMS[$i]}"
done

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
