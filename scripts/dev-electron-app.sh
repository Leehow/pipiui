#!/bin/bash
# Fast Electron development entry: fetch/verify the cached CUA driver, then
# start electron-vite in watch mode. This never packages, signs, or creates a DMG.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: scripts/dev-electron-app.sh [--prepare-only]

  --prepare-only  fetch/verify the cached CUA driver and print the dev command
                  without starting Electron
EOF
}

case "${1:-}" in
  "") ;;
  --prepare-only) PREPARE_ONLY=1 ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
DRIVER_DIR="$ROOT/Electron/.cua-driver"
DRIVER_NAME="cua-driver"
if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "MSYS"* || "$(uname -s)" == "CYGWIN"* ]]; then
  DRIVER_NAME="cua-driver.exe"
fi

cd "$ROOT/Electron"
node scripts/fetch-cua-driver.mjs
export PIPIUI_CUA_DRIVER_PATH="$DRIVER_DIR/$DRIVER_NAME"
export PIPIUI_RUNTIME_SOURCE_ROOT="$ROOT/Electron/resources/runtime"

if [[ "${PREPARE_ONLY:-0}" == "1" ]]; then
  printf 'CUA driver ready: %s\n' "$PIPIUI_CUA_DRIVER_PATH"
  printf 'Runtime assets: %s\n' "$PIPIUI_RUNTIME_SOURCE_ROOT"
  printf 'Dev command: npm --prefix %s run dev:watch\n' "$ROOT/Electron"
  exit 0
fi

exec npm run dev:watch
