#!/usr/bin/env bash
# Refresh the vendored copy of the pipi-philosophy pi package.
#
# The philosophy is developed as a standalone pi package so a bare TUI session can install it
# on its own. The App ships a snapshot of it so PipiUI users get it with no manual step; this
# script is how that snapshot is refreshed. Only the files package.json declares are vendored —
# tests and tsconfig stay in the source repo.
set -euo pipefail

SRC="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/pipi-philosophy}"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/Sources/PipiUI/PiPhilosophy"

if [ ! -f "$SRC/package.json" ]; then
  echo "error: no pipi-philosophy package at $SRC" >&2
  echo "usage: $0 [path-to-pipi-philosophy]" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST/layers"
cp "$SRC/package.json" "$SRC/philosophy.ts" "$SRC/compose.ts" \
   "$SRC/capabilities.json" "$SRC/README.md" "$SRC/LICENSE" "$DEST/"
cp "$SRC"/layers/*.md "$DEST/layers/"

VERSION="$(node -p "require('$DEST/package.json').version" 2>/dev/null || echo unknown)"
echo "vendored pipi-philosophy v$VERSION from $SRC"
echo "  -> $DEST"
find "$DEST" -type f | sed "s|$DEST|  |" | sort
