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
# Library+thin-entry layout: product binary is still named PipiUI (see Package.swift products).
cp .build/release/PipiUI "$APP/Contents/MacOS/PipiUI"
# Embed the SwiftPM resource bundle in the standard signed-app location.
# PipiResourceBundle resolves it here in packaged builds and falls back to
# Bundle.module for `swift run` / tests.
RESOURCE_BUNDLE="$APP/Contents/Resources/PipiUI_PipiUI.bundle"
mkdir -p "$RESOURCE_BUNDLE/Contents/Resources"
cp -R .build/release/PipiUI_PipiUI.bundle/. "$RESOURCE_BUNDLE/Contents/Resources/"

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
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key><true/>
        <key>NSAllowsLocalNetworking</key><true/>
    </dict>
    <key>NSHumanReadableCopyright</key><string></string>
</dict>
</plist>
PLIST
codesign --force --sign - "$RESOURCE_BUNDLE"
codesign --force --sign - "$APP"
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
