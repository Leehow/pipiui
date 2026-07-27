#!/bin/bash
# Build PipiUI.app bundle from the SPM executable (release).
# CONSTITUTION.md: 编译通过即打包 — canonical runnable artifact is build/PipiUI.app.
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
cd "$SCRIPT_DIR"

# A release .app is a single shared artifact. Git reports the primary checkout
# first; linked worktrees must use `swift build` / `swift test` only so they do
# not create competing `build/PipiUI.app` bundles.
CURRENT_ROOT="$(git rev-parse --show-toplevel)"
CANONICAL_ROOT="$(git worktree list --porcelain | awk '/^worktree / { sub(/^worktree /, ""); print; exit }')"
CANONICAL_ROOT="$(cd "$CANONICAL_ROOT" && pwd -P)"

if [[ "$CURRENT_ROOT" != "$CANONICAL_ROOT" ]]; then
  echo "Refusing to package PipiUI.app outside the canonical checkout." >&2
  echo "Canonical checkout: $CANONICAL_ROOT" >&2
  echo "Current checkout:   $CURRENT_ROOT" >&2
  echo "Use swift build or swift test in linked worktrees." >&2
  exit 1
fi

swift build -c release
APP=build/PipiUI.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"
mkdir -p "$APP/Contents/Helpers"
# Library+thin-entry layout: product binary is still named PipiUI (see Package.swift products).
cp .build/release/PipiUI "$APP/Contents/MacOS/PipiUI"
# Embed the SwiftPM resource bundle in the standard signed-app location.
# PipiResourceBundle resolves it here in packaged builds and falls back to
# Bundle.module for `swift run` / tests.
RESOURCE_BUNDLE="$APP/Contents/Resources/PipiUI_PipiUI.bundle"
mkdir -p "$RESOURCE_BUNDLE/Contents/Resources"
cp -R .build/release/PipiUI_PipiUI.bundle/. "$RESOURCE_BUNDLE/Contents/Resources/"

# Cua Driver is fetched only while packaging, pinned by version and SHA-256.
# The App never downloads executable code at runtime.
CUA_HELPER="$APP/Contents/Helpers/cua-driver"
./scripts/fetch-cua-driver.sh "$CUA_HELPER"
chmod 755 "$CUA_HELPER"
mkdir -p "$APP/Contents/Resources/ThirdPartyNotices"
cp ThirdPartyNotices/CuaDriver-LICENSE.txt \
  "$APP/Contents/Resources/ThirdPartyNotices/CuaDriver-LICENSE.txt"

# SwiftPM emits a flat resource directory without bundle metadata. Give it a
# valid bundle identity so codesign can seal it as nested code instead of
# rejecting the whole app as an unrecognized subcomponent.
cat > "$RESOURCE_BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key><string>com.leehow.pipiui.resources</string>
    <key>CFBundleName</key><string>PipiUI Resources</string>
    <key>CFBundlePackageType</key><string>BNDL</string>
    <key>CFBundleVersion</key><string>1</string>
</dict>
</plist>
PLIST

# App icon (.icns) from assets/brand/app-icon.png — before codesign
./scripts/make-icon.sh \
  assets/brand/app-icon.png \
  "$APP/Contents/Resources/AppIcon.icns" || true

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>PipiUI</string>
    <key>CFBundleIdentifier</key><string>com.leehow.pipiui</string>
    <key>CFBundleName</key><string>PipiUI</string>
    <key>CFBundleDisplayName</key><string>Pipi UI</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundleIconName</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSScreenCaptureUsageDescription</key>
    <string>Pipi UI captures the selected application window so its Computer Use agent can observe the result of requested desktop actions.</string>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key><true/>
        <key>NSAllowsLocalNetworking</key><true/>
    </dict>
    <key>NSHumanReadableCopyright</key><string></string>
</dict>
</plist>
PLIST

# Stable signing keeps Screen Recording / Accessibility TCC grants attached to
# the same designated requirement across rebuilds. A certificate is optional:
# clean machines retain the prior ad-hoc build path with an explicit warning.
SIGN_ID="${PIPIUI_SIGN_ID:-PipiUI Dev}"
if security find-identity -v -p codesigning 2>/dev/null \
  | grep -Fq "\"$SIGN_ID\""; then
  CODE_SIGN_ID="$SIGN_ID"
  echo "Signing with stable identity: $CODE_SIGN_ID"
else
  CODE_SIGN_ID="-"
  echo "⚠️  Stable code-signing identity '$SIGN_ID' was not found; using ad-hoc signing." >&2
  echo "    Computer Use TCC grants may be lost after rebuilds." >&2
  echo "    See docs/computer-use.md for one-time certificate and permission setup." >&2
fi

# Nested executable code must be signed before the outer bundle so the final
# app seal records the exact embedded helper identity. Preserve the upstream
# helper's screen-capture / Apple Events entitlements and hardened-runtime
# flags while replacing only its signer with PipiUI's stable identity.
codesign --force --sign "$CODE_SIGN_ID" \
  --preserve-metadata=identifier,entitlements,flags,runtime \
  "$CUA_HELPER"
codesign --verify --strict --verbose=2 "$CUA_HELPER"
codesign --force --sign "$CODE_SIGN_ID" "$RESOURCE_BUNDLE"
codesign --force --sign "$CODE_SIGN_ID" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
BIN="$APP/Contents/MacOS/PipiUI"
echo "Built $APP"
echo "Open:  open $APP"
if [[ -x "$BIN" ]]; then
  stat -f 'Binary mtime: %Sm  %N' -t '%Y-%m-%d %H:%M:%S' "$BIN"
fi
if [[ -f "$APP/Contents/Resources/AppIcon.icns" ]]; then
  stat -f 'AppIcon: %Sm  %N (%z bytes)' -t '%Y-%m-%d %H:%M:%S' "$APP/Contents/Resources/AppIcon.icns"
fi

# SwiftPM leaves 6 empty `TemporaryDirectory.XXXXXX` dirs in $TMPDIR per build
# invocation and never reaps them; agent-driven build loops push $TMPDIR past
# 10k entries, which makes Finder and directory enumeration crawl. Only touch
# entries older than an hour so concurrent builds keep theirs.
if [[ -n "${TMPDIR:-}" && -d "$TMPDIR" ]]; then
  STALE="$(find "$TMPDIR" -maxdepth 1 -type d -name 'TemporaryDirectory.*' -mmin +60 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$STALE" -gt 0 ]]; then
    find "$TMPDIR" -maxdepth 1 -type d -name 'TemporaryDirectory.*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
    echo "Reaped $STALE stale SwiftPM temp dirs in \$TMPDIR"
  fi
fi
