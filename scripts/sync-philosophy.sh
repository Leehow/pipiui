#!/usr/bin/env bash
# Refresh the vendored copy of the pipi-philosophy pi package.
#
# The philosophy is developed as a standalone pi package so a bare TUI session can install it
# on its own. The App ships a snapshot of it so PipiUI users get it with no manual step; this
# script is how that snapshot is refreshed. Only the files package.json declares are vendored —
# tests and tsconfig stay in the source repo.
#
# The copy list is read from the source package.json `files` array rather than hardcoded. It
# used to be hardcoded, drifted from that array, and would have silently dropped
# retrieval-attribution.ts and scripts/ from the App on the next run.
#
# Layers are also edited in the vendored tree directly, which makes a blind overwrite from a
# stale source repo a real way to lose work. So the sync refuses to delete anything the
# incoming manifest does not account for, and --check reports drift without writing.
#
# Usage: sync-philosophy.sh [--check] [path-to-pipi-philosophy]
set -euo pipefail

CHECK=0
if [ "${1:-}" = "--check" ]; then CHECK=1; shift; fi

SRC="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/pipi-philosophy}"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/Electron/resources/runtime/pi-philosophy"

if [ ! -f "$SRC/package.json" ]; then
  echo "error: no pipi-philosophy package at $SRC" >&2
  echo "usage: $0 [--check] [path-to-pipi-philosophy]" >&2
  exit 1
fi

# The manifest entries, each a file or a directory, relative to the package root.
MANIFEST="$(node -p '
  const files = require(process.argv[1] + "/package.json").files;
  if (!Array.isArray(files) || files.length === 0) throw new Error("package.json declares no files[]");
  files.join("\n");
' "$SRC")"
MANIFEST="$MANIFEST
package.json"

# Every path the manifest actually resolves to, so we can compare the two trees file by file.
manifest_files() { # $1 = package root
  local root="$1" entry
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    if [ -d "$root/$entry" ]; then
      (cd "$root" && find "$entry" -type f)
    elif [ -f "$root/$entry" ]; then
      echo "$entry"
    else
      echo "error: package.json declares '$entry', which does not exist in $root" >&2
      return 1
    fi
  done <<< "$MANIFEST" | sort
}

SRC_FILES="$(manifest_files "$SRC")"
DEST_FILES="$(cd "$DEST" 2>/dev/null && find . -type f | sed 's|^\./||' | sort || true)"

# Anything vendored that this manifest would not put back is work about to be deleted.
ORPHANS="$(comm -13 <(echo "$SRC_FILES") <(echo "$DEST_FILES"))"
if [ -n "$ORPHANS" ]; then
  echo "error: these files exist in the vendored copy but are not in $SRC's manifest:" >&2
  echo "$ORPHANS" | sed 's|^|  |' >&2
  echo "syncing would delete them. Copy them back to the source package (or add them to" >&2
  echo "package.json files[]) before running this." >&2
  exit 1
fi

# Content drift, in both directions, for the files the manifest does cover.
DRIFT=""
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  if ! cmp -s "$SRC/$rel" "$DEST/$rel" 2>/dev/null; then
    DRIFT="$DRIFT$rel"$'\n'
  fi
done <<< "$SRC_FILES"

if [ "$CHECK" = "1" ]; then
  if [ -n "$DRIFT" ]; then
    echo "vendored copy differs from $SRC:"
    echo "$DRIFT" | sed '/^$/d;s|^|  |'
    echo "note: the App's copy is edited in place, so check which side is newer before syncing."
    exit 1
  fi
  echo "vendored copy is in sync with $SRC"
  exit 0
fi

rm -rf "$DEST"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  mkdir -p "$DEST/$(dirname "$rel")"
  cp "$SRC/$rel" "$DEST/$rel"
done <<< "$SRC_FILES"

VERSION="$(node -p "require('$DEST/package.json').version" 2>/dev/null || echo unknown)"
echo "vendored pipi-philosophy v$VERSION from $SRC"
echo "  -> $DEST"
echo "$SRC_FILES" | sed 's|^|  |'
