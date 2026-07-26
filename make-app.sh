#!/bin/bash
# Build PipiUI.app bundle from the SPM executable (release).
# This is deliberately worktree-local. Only scripts/ship-app.sh may install the
# canonical application under /Applications.
set -euo pipefail
cd "$(dirname "$0")"
swift build -c release
APP=build/PipiUI.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"
# Library+thin-entry layout: product binary is still named PipiUI (see Package.swift products).
cp .build/release/PipiUI "$APP/Contents/MacOS/PipiUI"
# Bundle.module 在可执行文件旁查找资源包，必须一起拷进 .app
cp -R .build/release/PipiUI_PipiUI.bundle "$APP/Contents/MacOS/" 2>/dev/null || true

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
codesign --force --sign - "$APP" 2>/dev/null || true
BIN="$APP/Contents/MacOS/PipiUI"
echo "Built $APP"
echo "Open:  open $APP"
if [[ -x "$BIN" ]]; then
  stat -f 'Binary mtime: %Sm  %N' -t '%Y-%m-%d %H:%M:%S' "$BIN"
fi
if [[ -f "$APP/Contents/Resources/AppIcon.icns" ]]; then
  stat -f 'AppIcon: %Sm  %N (%z bytes)' -t '%Y-%m-%d %H:%M:%S' "$APP/Contents/Resources/AppIcon.icns"
fi
echo "Local package only; canonical install requires ./scripts/ship-app.sh"
