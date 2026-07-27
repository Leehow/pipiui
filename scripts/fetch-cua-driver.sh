#!/bin/bash
# Fetch the pinned universal Cua Driver used by the packaged PipiUI helper.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
VERSION="0.12.5"
TAG="cua-driver-rs-v${VERSION}"
ASSET="cua-driver-rs-${VERSION}-darwin-universal-binary.tar.gz"
SHA256="898a143559694d6083feb89e3991581c87f5c9adf997876588cc262ade529e35"
URL="https://github.com/trycua/cua/releases/download/${TAG}/${ASSET}"
CACHE_DIR="${PIPIUI_CUA_CACHE_DIR:-$REPO_ROOT/.build/cua-driver-cache}"
ARCHIVE="$CACHE_DIR/$ASSET"
DESTINATION="${1:-$CACHE_DIR/cua-driver}"

mkdir -p "$CACHE_DIR"

archive_is_valid() {
  [[ -f "$ARCHIVE" ]] \
    && [[ "$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')" == "$SHA256" ]]
}

if ! archive_is_valid; then
  DOWNLOAD="$(mktemp "$CACHE_DIR/.cua-driver-download.XXXXXX")"
  trap 'rm -f "$DOWNLOAD"' EXIT
  curl --fail --location --retry 3 --output "$DOWNLOAD" "$URL"
  ACTUAL="$(shasum -a 256 "$DOWNLOAD" | awk '{print $1}')"
  if [[ "$ACTUAL" != "$SHA256" ]]; then
    echo "Cua Driver checksum mismatch: expected $SHA256, got $ACTUAL" >&2
    exit 1
  fi
  mv "$DOWNLOAD" "$ARCHIVE"
  trap - EXIT
fi

EXTRACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pipiui-cua-extract.XXXXXX")"
trap 'rm -rf "$EXTRACT_DIR"' EXIT
tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
EXTRACTED="$EXTRACT_DIR/cua-driver"
if [[ ! -f "$EXTRACTED" ]]; then
  EXTRACTED="$(find "$EXTRACT_DIR" -type f -name cua-driver -print -quit)"
fi
if [[ -z "$EXTRACTED" || ! -f "$EXTRACTED" ]]; then
  echo "Pinned Cua Driver archive did not contain cua-driver" >&2
  exit 1
fi

mkdir -p "$(dirname "$DESTINATION")"
install -m 755 "$EXTRACTED" "$DESTINATION"
echo "$DESTINATION"
