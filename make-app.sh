#!/bin/bash
# Build PipiUI.app bundle from the SPM executable (release).
# CONSTITUTION.md: 编译通过即打包 — canonical ship path for build/PipiUI.app,
# then always install/sync to /Applications/PipiUI.app (user launch target).
#
# Escape hatches:
#   PIPIUI_SKIP_INSTALL=1              skip Applications install (rare CI/debug)
#   PIPIUI_INSTALL_APP=/other/path.app override install destination
set -e
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

# --- Install to Applications (user launch target) ---
# build/PipiUI.app stays the in-repo artifact; Applications is what users open.
INSTALL_APP="${PIPIUI_INSTALL_APP:-/Applications/PipiUI.app}"
if [[ "${PIPIUI_SKIP_INSTALL:-}" == "1" ]]; then
  echo "Skipped install (PIPIUI_SKIP_INSTALL=1)"
else
  echo "Installing → $INSTALL_APP"
  install_ok=0
  if command -v ditto >/dev/null 2>&1; then
    if ditto "$APP" "$INSTALL_APP"; then
      install_ok=1
    fi
  else
    rm -rf "$INSTALL_APP"
    if cp -R "$APP" "$INSTALL_APP"; then
      install_ok=1
    fi
  fi
  if [[ "$install_ok" -ne 1 ]]; then
    echo "ERROR: failed to install $APP → $INSTALL_APP" >&2
    if [[ ! -w "$(dirname "$INSTALL_APP")" ]]; then
      echo "  Permission denied writing $(dirname "$INSTALL_APP")." >&2
      echo "  Fix: grant write access, or run with sufficient privileges." >&2
      echo "  Escape: PIPIUI_SKIP_INSTALL=1 or PIPIUI_INSTALL_APP=\$HOME/Applications/PipiUI.app" >&2
    fi
    exit 1
  fi
  codesign --force --sign - "$INSTALL_APP" 2>/dev/null || true
  echo "Installed $INSTALL_APP"
  echo "Open: open -a PipiUI"
  echo "Open: open $INSTALL_APP"
  INSTALL_BIN="$INSTALL_APP/Contents/MacOS/PipiUI"
  if [[ -x "$BIN" && -x "$INSTALL_BIN" ]]; then
    stat -f 'Binary mtime: %Sm  %N' -t '%Y-%m-%d %H:%M:%S' "$BIN" "$INSTALL_BIN"
  elif [[ -x "$INSTALL_BIN" ]]; then
    stat -f 'Binary mtime: %Sm  %N' -t '%Y-%m-%d %H:%M:%S' "$INSTALL_BIN"
  fi
fi
