#!/bin/bash
# Build PipiUI Electron packages.
# Usage: scripts/build-electron-app.sh [mac|win|linux|--check-signing]   (default: mac)
#   mac   → dmg + zip (x64 + arm64) + canonical single artifact build/PipiUI Electron.app
#   win   → NSIS installer (x64) — cross-built on any host (no .app produced)
#   linux → AppImage + deb (x64) — cross-built on any host (no .app produced)
# The macOS .app packaging guard from AGENTS.md stays: only the primary
# checkout may package the runnable App; worktrees degrade to build-only.
set -euo pipefail

DEFAULT_MAC_SIGNING_IDENTITY="108232C5A713C15A869FC4C267E18D2E35CD276C"

prepare_mac_signing_identity() {
  local requested="${PIPIUI_ELECTRON_SIGNING_IDENTITY:-$DEFAULT_MAC_SIGNING_IDENTITY}"
  local identities matches match_count fingerprint certificate_name

  if [[ ! "$requested" =~ ^[0-9A-Fa-f]{40}$ ]]; then
    echo "ERROR: PIPIUI_ELECTRON_SIGNING_IDENTITY must be one exact 40-character SHA-1 fingerprint." >&2
    return 1
  fi

  if ! command -v security >/dev/null 2>&1; then
    echo "ERROR: macOS 'security' tool is required for stable Electron signing." >&2
    return 1
  fi
  identities="$(security find-identity -v -p codesigning 2>&1)"
  matches="$(while IFS= read -r line; do
    [[ "$line" == *"$requested"* ]] && printf '%s\n' "$line"
  done <<< "$identities"; true)"
  match_count="$(grep -c . <<< "$matches" || true)"
  if [[ "$match_count" != "1" ]]; then
    echo "ERROR: expected exactly one valid macOS signing identity matching '$requested'; found $match_count." >&2
    echo "Install/unlock the persistent 'PipiUI Dev' identity, or set" >&2
    echo "PIPIUI_ELECTRON_SIGNING_IDENTITY to one exact valid SHA-1 fingerprint." >&2
    return 1
  fi

  fingerprint="$(awk '{print $2}' <<< "$matches")"
  certificate_name="$(sed -E 's/^[^"]*"([^"]+)".*$/\1/' <<< "$matches")"
  if [[ ! "$fingerprint" =~ ^[0-9A-Fa-f]{40}$ ]]; then
    echo "ERROR: could not resolve a stable signing fingerprint for '$requested'." >&2
    return 1
  fi

  # electron-builder consumes CSC_NAME as an identity qualifier. Supplying the
  # exact fingerprint plus disabling discovery prevents certificate drift and
  # prevents a missing identity from silently becoming an ad-hoc signature.
  CSC_NAME="$(printf '%s' "$fingerprint" | tr '[:lower:]' '[:upper:]')"
  export CSC_NAME
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  echo "Electron signing identity: $certificate_name ($CSC_NAME)"
}

MAC_ENTITLEMENTS="Electron/node_modules/app-builder-lib/templates/entitlements.mac.plist"
MAC_INHERIT_ENTITLEMENTS="${PIPIUI_ELECTRON_INHERIT_ENTITLEMENTS:-$MAC_ENTITLEMENTS}"

expected_mac_bundle_is_complete() {
  local app="$1"
  [[ -d "$app" ]] \
    && [[ -x "$app/Contents/MacOS/PipiUI Electron" ]] \
    && [[ -d "$app/Contents/Frameworks/Electron Framework.framework" ]] \
    && [[ -x "$app/Contents/Resources/cua-driver/cua-driver" ]] \
    && [[ -x "$app/Contents/Resources/pipiui-embedded/node/bin/node" ]] \
    && [[ -d "$app/Contents/Resources/pipiui-runtime" ]]
}

builder_failure_is_outer_seal_only() {
  local log="$1" app="$2"
  [[ -s "$log" ]] || return 1
  grep -Fq "$app" "$log" || return 1
  grep -Eq 'a sealed resource is missing or invalid|file (added|modified|missing):|resource envelope is obsolete' "$log"
}

discover_macho_candidates() {
  local app="$1"
  # Embedded Pi/Node resources contain tens of thousands of JSON/JS/text
  # files. Calling `file` once for every resource made finalization take
  # minutes before the first signature. Mach-O payloads in this product are
  # either executable or native-library artifacts. Keep suffix predicates so
  # native modules with a lost executable bit are still discovered, then let
  # `file` make the authoritative format decision.
  find "$app/Contents" -type f \( \
      -perm -111 -o -name '*.node' -o -name '*.dylib' -o -name '*.so' \
    \) -print \
    | while IFS= read -r candidate; do
        file -b "$candidate" 2>/dev/null | grep -q '^Mach-O' && printf '%s\n' "$candidate"
      done
}

process_list_contains_exact_executable() {
  local target="$1"
  local pid executable
  local found=1
  while read -r pid executable; do
    if [[ "$executable" == "$target" ]]; then
      found=0
    fi
  done
  return "$found"
}

canonical_electron_app_is_running() {
  local executable="$1"
  process_list_contains_exact_executable "$executable" < <(/bin/ps -axo pid=,comm=)
}

verify_embedded_node_signing() {
  local embedded_node="$1"
  local embedded_entitlements jit_entitlement host_arch node_arches
  local -a node_command=()

  if ! codesign --verify --strict --verbose=2 "$embedded_node"; then
    echo "ERROR: embedded Node signature verification failed: $embedded_node" >&2
    return 1
  fi
  if ! embedded_entitlements="$(codesign -d --entitlements :- "$embedded_node" 2>/dev/null)"; then
    echo "ERROR: could not read embedded Node entitlements: $embedded_node" >&2
    return 1
  fi
  jit_entitlement="$(
    printf '%s' "$embedded_entitlements" \
      | /usr/bin/plutil -extract 'com\.apple\.security\.cs\.allow-jit' raw -o - - 2>/dev/null \
      || true
  )"
  if [[ "$jit_entitlement" != "true" ]]; then
    echo "ERROR: embedded Node is missing required com.apple.security.cs.allow-jit entitlement: $embedded_node" >&2
    return 1
  fi

  host_arch="$(/usr/bin/uname -m)"
  if ! node_arches="$(/usr/bin/lipo -archs "$embedded_node" 2>/dev/null)" || [[ -z "$node_arches" ]]; then
    echo "ERROR: could not determine embedded Node architecture: $embedded_node" >&2
    return 1
  fi
  case " $node_arches " in
    *" $host_arch "*)
      node_command=("$embedded_node")
      ;;
    *" x86_64 "*)
      if [[ "$host_arch" == "arm64" ]] && /usr/bin/arch -x86_64 /usr/bin/true >/dev/null 2>&1; then
        node_command=(/usr/bin/arch -x86_64 "$embedded_node")
      fi
      ;;
  esac

  if [[ "${#node_command[@]}" -eq 0 ]]; then
    echo "Embedded Node signature/JIT verified; startup probe skipped for $node_arches on $host_arch."
    return 0
  fi
  if ! /usr/bin/env -i HOME="${TMPDIR:-/tmp}" PATH=/usr/bin:/bin \
      "${node_command[@]}" -e 'if (!process.versions || !process.versions.node) process.exit(1)'; then
    echo "ERROR: embedded Node failed the minimal JavaScript startup probe: $embedded_node" >&2
    return 1
  fi
  echo "Embedded Node signature/JIT/startup verified: $embedded_node"
}

finalize_mac_bundle() {
  local app="$1"
  local embedded_node="$app/Contents/Resources/pipiui-embedded/node/bin/node"
  expected_mac_bundle_is_complete "$app" || {
    echo "ERROR: refusing to sign incomplete Electron bundle: $app" >&2
    return 1
  }
  [[ -f "$MAC_ENTITLEMENTS" ]] || {
    echo "ERROR: missing Electron macOS entitlements: $MAC_ENTITLEMENTS" >&2
    return 1
  }
  [[ -f "$MAC_INHERIT_ENTITLEMENTS" ]] || {
    echo "ERROR: missing Electron nested-code entitlements: $MAC_INHERIT_ENTITLEMENTS" >&2
    return 1
  }

  # Apple code signing is inside-out. `--deep` signing is intentionally not
  # used: it is a verification convenience, not a reliable signing strategy,
  # and can leave nested frameworks/helpers with an old or absent timestamp.
  # First sign every loose Mach-O payload (native modules, dylibs, helper
  # executables), then containing frameworks/XPCs/helper Apps deepest-first,
  # and only then seal the root App.
  while IFS= read -r nested; do
    if [[ "$nested" == "$embedded_node" ]]; then
      codesign --sign "$CSC_NAME" --force --timestamp --options runtime \
        --entitlements "$MAC_ENTITLEMENTS" "$nested"
    else
      codesign --sign "$CSC_NAME" --force --timestamp --options runtime "$nested"
    fi
  done < <(
    discover_macho_candidates "$app" \
      | awk '{ path=$0; depth=gsub("/", "/", path); print depth, $0 }' \
      | sort -rn \
      | cut -d' ' -f2-
  )
  verify_embedded_node_signing "$embedded_node"

  while IFS= read -r nested; do
    case "$nested" in
      *.app|*.xpc)
        codesign --sign "$CSC_NAME" --force --timestamp --options runtime \
          --entitlements "$MAC_INHERIT_ENTITLEMENTS" "$nested"
        ;;
      *)
        codesign --sign "$CSC_NAME" --force --timestamp --options runtime "$nested"
        ;;
    esac
    codesign --verify --strict --verbose=2 "$nested"
  done < <(
    find "$app/Contents" -type d \( -name '*.framework' -o -name '*.xpc' -o -name '*.app' \) -print \
      | awk '{ path=$0; depth=gsub("/", "/", path); print depth, $0 }' \
      | sort -rn \
      | cut -d' ' -f2-
  )

  codesign --sign "$CSC_NAME" --force --timestamp --options runtime \
    --entitlements "$MAC_ENTITLEMENTS" "$app"
  codesign --verify --deep --strict --verbose=2 "$app"
}

package_mac_arch() {
  local arch="$1"
  local app_dir="$2"
  local app="$app_dir/PipiUI Electron.app"
  local log status
  if [[ "${PIPIUI_ELECTRON_PACKAGING_FUNCTION_TEST:-0}" == "1" ]]; then
    printf '%s\n' "$app"
    return 0
  fi
  log="$(mktemp "${TMPDIR:-/tmp}/pipiui-electron-builder-${arch}.XXXXXX.log")"
  set +e
  (
    cd Electron/apps/electron
    CUA_TARGET_PLATFORM=darwin node ../../scripts/fetch-cua-driver.mjs \
      && PIPIUI_EMBEDDED_RUNTIMES_ROOT="$ROOT/Electron/.embedded-runtimes" node ../../scripts/fetch-pi-runtime.mjs --platform darwin --arch "$arch" --check \
      && PIPIUI_EMBEDDED_RUNTIME_TARGET="darwin-$arch" ../../node_modules/.bin/electron-builder --mac --"$arch"
  ) 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  set -e

  if [[ "$status" -ne 0 ]]; then
    if ! builder_failure_is_outer_seal_only "$log" "$app" || ! expected_mac_bundle_is_complete "$app"; then
      echo "ERROR: electron-builder failed for $arch; failure is not the recoverable outer sealed-resource verification class." >&2
      rm -f "$log"
      return "$status"
    fi
    echo "electron-builder left a complete $arch App with a stale outer seal; applying the final stable-identity root seal." >&2
  fi
  rm -f "$log"
  finalize_mac_bundle "$app"
}

PLATFORM="${1:-mac}"
case "$PLATFORM" in
  mac|win|linux) ;;
  --check-signing)
    prepare_mac_signing_identity
    exit 0
    ;;
  -h|--help)
    echo "usage: $0 [mac|win|linux|--check-signing]"
    echo "mac signing defaults to persistent identity PipiUI Dev ($DEFAULT_MAC_SIGNING_IDENTITY)."
    echo "Override intentionally with PIPIUI_ELECTRON_SIGNING_IDENTITY=<exact SHA-1>."
    echo "Prepare release runtimes first: npm --prefix Electron run runtime:prepare:mac"
    echo "Note: electron-vite dev runs the framework Electron binary and does not share the packaged App's TCC signing identity."
    exit 0
    ;;
  *) echo "usage: $0 [mac|win|linux|--check-signing]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"
CURRENT_ROOT="$(git rev-parse --show-toplevel)"
PRIMARY_ROOT="/Users/haoli/leehow/code/pipiui"

if [[ "$CURRENT_ROOT" != "$PRIMARY_ROOT" ]]; then
  if [[ "$PLATFORM" != "mac" ]]; then
    # Win/Linux installers (exe/AppImage/deb) are not .app bundles: cross
    # products are allowed from any checkout (electron-builder 25 cross-builds
    # NSIS on macOS without wine; deb on macOS hosts is broken — bundled fpm
    # writes an empty archive — and is rejected with a clear error below).
    echo "Worktree checkout: cross-building $PLATFORM packages (no .app produced)." >&2
  else
    echo "Refusing to package PipiUI Electron.app outside the primary checkout." >&2
    echo "Primary checkout: $PRIMARY_ROOT" >&2
    echo "Current checkout: $CURRENT_ROOT" >&2
    echo "Running the Electron workspace build only." >&2
    exec npm --prefix Electron run build
  fi
fi

if [[ "$PLATFORM" == "mac" ]]; then
  CANONICAL_ELECTRON_EXECUTABLE="$ROOT/build/PipiUI Electron.app/Contents/MacOS/PipiUI Electron"
  if canonical_electron_app_is_running "$CANONICAL_ELECTRON_EXECUTABLE"; then
    echo "ERROR: refusing to build or replace the canonical Electron App while it is running." >&2
    echo "Quit PipiUI Electron manually, then rerun this command. The running process was not terminated." >&2
    exit 1
  fi
fi

if [[ "$PLATFORM" == "mac" ]]; then
  prepare_mac_signing_identity
fi

# build/ is gitignored, so the .icns may be absent on fresh checkouts; the
# mac icon is generated from the tracked brand png (tolerant: skips if the
# macOS toolchain is missing).
if [[ "$PLATFORM" == "mac" ]]; then
  scripts/make-icon.sh assets/brand/app-icon.png Electron/apps/electron/build/icon.icns
fi

case "$PLATFORM" in
  mac)
    npm --prefix Electron run build
    package_mac_arch x64 "$ROOT/build/mac"
    package_mac_arch arm64 "$ROOT/build/mac-arm64"

    # Canonical single artifact: build/PipiUI Electron.app
    APP_SRC="$ROOT/build/mac-arm64/PipiUI Electron.app"
    APP_DST="$ROOT/build/PipiUI Electron.app"
    if [[ -d "$APP_SRC" ]]; then
      rm -rf "$APP_DST"
      mv "$APP_SRC" "$APP_DST"
      codesign --verify --deep --strict --verbose=2 "$APP_DST"
      echo "Packaged: $APP_DST"
    fi
    rm -rf "$ROOT/build/mac-arm64" "$ROOT/build/mac"
    ;;
  win)
    npm --prefix Electron run package:win
    echo "Win installer: $ROOT/build/PipiUI Electron Setup *.exe"
    ;;
  linux)
    npm --prefix Electron run package:linux

    # macOS cross-built debs are known-broken: electron-builder's bundled fpm
    # 1.9.3 silently writes an empty ~96-byte ar stub under modern macOS ruby.
    # Fail loudly instead of shipping a hollow archive (AppImage above is fine).
    DEB="$(ls "$ROOT"/build/pipiui_e_*_amd64.deb 2>/dev/null | head -1 || true)"
    if [[ -z "$DEB" || "$(stat -f %z "$DEB" 2>/dev/null || stat -c %s "$DEB" 2>/dev/null)" -lt 1024 ]]; then
      echo "ERROR: deb cross-build produced an empty/stub archive." >&2
      echo "electron-builder's bundled fpm is broken on macOS hosts; the" >&2
      echo "AppImage target still builds (see build/pipiui_e-*.AppImage)." >&2
      echo "Produce the deb on the ubuntu CI job (.github/workflows/electron.yml" >&2
      echo "linux) or a Linux host instead." >&2
      rm -f "$DEB"
      exit 1
    fi
    echo "Linux artifacts: $ROOT/build/pipiui_e-*.AppImage $DEB"
    ;;
esac
