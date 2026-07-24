#!/bin/bash
# Generate AppIcon.icns from assets/brand/app-icon.png (master 1024-class source).
# Usage: scripts/make-icon.sh [source.png] [dest.icns]
# Tolerant: warns and exits 0 if sips/iconutil missing or conversion fails.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/assets/brand/app-icon.png}"
DEST="${2:-}"

if [[ -z "$DEST" ]]; then
  echo "usage: $0 <source.png> <dest.icns>" >&2
  exit 2
fi

if [[ ! -f "$SRC" ]]; then
  echo "warning: make-icon: source missing: $SRC" >&2
  exit 0
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "warning: make-icon: sips not found; skipping AppIcon.icns" >&2
  exit 0
fi

if ! command -v iconutil >/dev/null 2>&1; then
  echo "warning: make-icon: iconutil not found; skipping AppIcon.icns" >&2
  exit 0
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/pipiui-iconset.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

ICONSET="$TMP/AppIcon.iconset"
mkdir -p "$ICONSET"

# Standard macOS iconset layout (point size → pixel size)
#   icon_16x16.png        16
#   icon_16x16@2x.png     32
#   icon_32x32.png        32
#   icon_32x32@2x.png     64
#   icon_128x128.png     128
#   icon_128x128@2x.png  256
#   icon_256x256.png     256
#   icon_256x256@2x.png  512
#   icon_512x512.png     512
#   icon_512x512@2x.png 1024
make_size() {
  local px="$1" name="$2"
  # sips warns on non-.png out paths (e.g. @2x names); write via a .png temp then rename.
  local tmp_out="$TMP/resize-${px}.png"
  sips -z "$px" "$px" "$SRC" --out "$tmp_out" >/dev/null
  mv -f "$tmp_out" "$ICONSET/$name"
}

if ! {
  make_size 16   icon_16x16.png
  make_size 32   icon_16x16@2x.png
  make_size 32   icon_32x32.png
  make_size 64   icon_32x32@2x.png
  make_size 128  icon_128x128.png
  make_size 256  icon_128x128@2x.png
  make_size 256  icon_256x256.png
  make_size 512  icon_256x256@2x.png
  make_size 512  icon_512x512.png
  make_size 1024 icon_512x512@2x.png
  mkdir -p "$(dirname "$DEST")"
  iconutil -c icns -o "$DEST" "$ICONSET"
}; then
  echo "warning: make-icon: failed to build $DEST" >&2
  exit 0
fi

echo "make-icon: wrote $DEST"
