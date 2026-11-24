#!/bin/bash
# Build PipiUI packages.
# Usage: scripts/build-electron-app.sh [mac|mac --stage-only|win|linux|--check-signing]   (default: mac)
#   mac   → dmg + zip (x64 + arm64) + canonical single artifact build/PipiUI.app
#   mac --stage-only → stage the container build/PipiUI.release-staged/
#                      (verified arm64 PipiUI.app + receipt.json) without
#                      touching the canonical App; see publish_release_staged below.
#   win   → NSIS installer (x64) — cross-built on any host (no .app produced)
#   linux → AppImage + deb (x64) — cross-built on any host (no .app produced)
# The macOS .app packaging guard from AGENTS.md stays: only the primary
# checkout may package the runnable App; worktrees degrade to build-only.
set -euo pipefail

DEFAULT_MAC_SIGNING_IDENTITY="108232C5A713C15A869FC4C267E18D2E35CD276C"

prepare_mac_signing_identity() {
  # Test-only seam: route tests exercise the top-level release flow without a
  # keychain. Never active unless PIPIUI_ELECTRON_RELEASE_FUNCTION_TEST=1.
  if [[ "${PIPIUI_ELECTRON_RELEASE_FUNCTION_TEST:-0}" == "1" ]]; then
    CSC_NAME="PIPIUI-TEST-IDENTITY"
    export CSC_NAME
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    return 0
  fi
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
  # Same SHA-1 can appear twice when the cert is in two keychains.
  matches="$(awk '!seen[$2]++' <<< "$matches")"
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
    && [[ -x "$app/Contents/MacOS/PipiUI" ]] \
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

process_listing() {
  # Test-only seam: never active unless PIPIUI_ELECTRON_RELEASE_FUNCTION_TEST=1.
  if [[ "${PIPIUI_ELECTRON_RELEASE_FUNCTION_TEST:-0}" == "1" && -n "${PIPIUI_PS_SEAM_FILE:-}" ]]; then
    /bin/cat "${PIPIUI_PS_SEAM_FILE}"
  else
    /bin/ps -axo pid=,comm=
  fi
}

canonical_electron_app_is_running() {
  local executable="$1"
  process_list_contains_exact_executable "$executable" < <(process_listing)
}

verify_embedded_node_shim() {
  local shim="$1"
  local app="$2"
  local app_name electron_binary helper_plist background_agent entitlements jit_entitlement probe

  [[ -x "$shim" ]] || { echo "ERROR: embedded Node shim is not executable: $shim" >&2; return 1; }
  head -c 2 "$shim" | grep -q '#!' || {
    echo "ERROR: embedded Node is neither a Mach-O nor a shim script: $shim" >&2
    return 1
  }

  app_name="$(basename "$app" .app)"
  electron_binary="$app/Contents/Frameworks/$app_name Helper.app/Contents/MacOS/$app_name Helper"
  helper_plist="$app/Contents/Frameworks/$app_name Helper.app/Contents/Info.plist"
  [[ -x "$electron_binary" ]] || { echo "ERROR: no background Electron Helper to back the Node shim: $electron_binary" >&2; return 1; }
  background_agent="$(/usr/bin/plutil -extract LSUIElement raw -o - "$helper_plist" 2>/dev/null || true)"
  [[ "$background_agent" == "true" ]] || {
    echo "ERROR: Electron Node host is not an LSUIElement background helper: $helper_plist" >&2
    return 1
  }

  # V8 needs JIT wherever it runs. That requirement moved from the standalone
  # Node onto the Electron binary the shim delegates to, so assert it there.
  if ! entitlements="$(codesign -d --entitlements :- "$electron_binary" 2>/dev/null)"; then
    echo "ERROR: could not read entitlements for $electron_binary" >&2
    return 1
  fi
  jit_entitlement="$(
    printf '%s' "$entitlements" \
      | /usr/bin/plutil -extract 'com\.apple\.security\.cs\.allow-jit' raw -o - - 2>/dev/null \
      || true
  )"
  if [[ "$jit_entitlement" != "true" ]]; then
    echo "ERROR: Electron binary backing the Node shim lacks com.apple.security.cs.allow-jit: $electron_binary" >&2
    return 1
  fi

  # The startup probe is the whole point: prove the shim really yields a Node.
  probe="$(/usr/bin/env -i HOME="${TMPDIR:-/tmp}" PATH=/usr/bin:/bin \
    PIPIUI_ELECTRON_BINARY="$electron_binary" \
    "$shim" -e 'process.stdout.write(process.versions.node)' 2>/dev/null)" || {
    echo "ERROR: embedded Node shim failed its startup probe: $shim" >&2
    return 1
  }
  [[ -n "$probe" ]] || { echo "ERROR: embedded Node shim reported no Node version: $shim" >&2; return 1; }
  echo "Embedded Node shim verified; background Electron Helper provides Node $probe with allow-jit."
}

verify_embedded_node_signing() {
  local embedded_node="$1"
  local app="${2:-}"
  local embedded_entitlements jit_entitlement host_arch node_arches
  local -a node_command=()

  # The embedded Node is a shell shim that execs Electron's background Helper in
  # Node mode; shipping a standalone Node cost ~85MB once Electron 43 cleared pi's
  # Node floor. Nothing about a script can be codesigned, arch-probed, or carry
  # entitlements, so verify what actually has to hold on the Helper instead.
  if [[ "$(/usr/bin/file -b "$embedded_node")" != Mach-O* ]]; then
    verify_embedded_node_shim "$embedded_node" "$app"
    return $?
  fi

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
  local embedded_python="$app/Contents/Resources/pipiui-runtime/extensions/webview-browser-extension/runtime/python/bin/python3.12"
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
    # Keep the vendor-signed OfficeCLI byte-identical to its pinned receipt.
    if [[ "$nested" == "$app/Contents/Resources/pipiui-runtime/extensions/office-extension/bin/"*/officecli ]]; then
      codesign --verify --strict --verbose=2 "$nested" || return 1
      continue
    fi
    if [[ "$nested" == "$embedded_node" ]]; then
      codesign --sign "$CSC_NAME" --force --timestamp --options runtime \
        --entitlements "$MAC_ENTITLEMENTS" "$nested"
    elif [[ "$nested" == "$embedded_python" ]]; then
      codesign --sign "$CSC_NAME" --force --timestamp --options runtime \
        --entitlements "Electron/apps/electron/entitlements.python.plist" "$nested"
    else
      codesign --sign "$CSC_NAME" --force --timestamp --options runtime "$nested"
    fi
  done < <(
    discover_macho_candidates "$app" \
      | awk '{ path=$0; depth=gsub("/", "/", path); print depth, $0 }' \
      | sort -rn \
      | cut -d' ' -f2-
  )
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
  # A script shim delegates Node execution to the root Electron binary, so its
  # JIT check is only meaningful after that binary carries the final entitlement.
  # Standalone embedded Node binaries remain fully verified here as well.
  verify_embedded_node_signing "$embedded_node" "$app"
  if [[ -x "$embedded_python" ]]; then
    codesign --verify --strict "$embedded_python"
    if [[ "$(lipo -archs "$embedded_python")" == "$(uname -m)" ]]; then
      "$embedded_python" -I -B -c 'import sys, json, hashlib, ssl; assert sys.version_info >= (3, 12); print("Embedded Jev Python startup verified")' || return 1
    fi
  fi
  codesign --verify --deep --strict --verbose=2 "$app"
}

package_mac_arch() {
  local arch="$1"
  # Each invocation owns an output directory under this run's unique run root
  # (passed to electron-builder via --config.directories.output), so nothing
  # reads or writes the fixed shared build/mac* trees.
  local out_dir="$2"
  local app_subdir app log status
  case "$arch" in
    x64) app_subdir="mac" ;;
    arm64) app_subdir="mac-arm64" ;;
    *) echo "ERROR: unsupported mac architecture: $arch" >&2; return 1 ;;
  esac
  app="$out_dir/$app_subdir/PipiUI.app"
  if [[ "${PIPIUI_ELECTRON_PACKAGING_FUNCTION_TEST:-0}" == "1" ]]; then
    # Function-test seam: optionally materialize a complete fake candidate and
    # fake arch-tagged artifacts from a fixture, so the top-level release route
    # can execute end-to-end without electron-builder. Filenames here only need
    # the <version> and <arch> tokens the artifact contract classifies on.
    if [[ -n "${PIPIUI_PACKAGING_TEST_FIXTURE:-}" ]]; then
      local version="${PIPIUI_PACKAGING_TEST_VERSION:-0.0.0}"
      local skip="${PIPIUI_PACKAGING_TEST_SKIP:-}" extra
      mkdir -p "$(dirname "$app")"
      cp -R "$PIPIUI_PACKAGING_TEST_FIXTURE" "$app"
      [[ "$skip" == *"$arch-dmg"* ]] || printf 'fake %s dmg %s\n' "$arch" "$version" > "$out_dir/PipiUI-$version-$arch.dmg"
      [[ "$skip" == *"$arch-zip"* ]] || printf 'fake %s zip %s\n' "$arch" "$version" > "$out_dir/PipiUI-$version-$arch.zip"
      if [[ "$arch" == "arm64" && -n "${PIPIUI_PACKAGING_TEST_EXTRA_ARM64:-}" ]]; then
        for extra in ${PIPIUI_PACKAGING_TEST_EXTRA_ARM64}; do
          printf 'extra %s\n' "$extra" > "$out_dir/$extra"
        done
      fi
    fi
    printf '%s\n' "$app"
    return 0
  fi
  # BSD mktemp only randomizes a trailing XXXXXX; characters after it become a
  # literal pathname (so the second arch would collide on the same .log file).
  log="$(mktemp "${TMPDIR:-/tmp}/pipiui-electron-builder-${arch}.log.XXXXXX")"
  local -a version_args=()
  if [[ -n "${PIPIUI_ELECTRON_BUILD_VERSION:-}" ]]; then
    version_args+=(--config.extraMetadata.version="$PIPIUI_ELECTRON_BUILD_VERSION")
  fi
  set +e
  (
    cd Electron/apps/electron
    CUA_TARGET_PLATFORM=darwin node ../../scripts/fetch-cua-driver.mjs \
      && PIPIUI_EMBEDDED_RUNTIMES_ROOT="$ROOT/Electron/.embedded-runtimes" node ../../scripts/fetch-pi-runtime.mjs --platform darwin --arch "$arch" --check \
      && node ../../scripts/package-electron-target.mjs --platform darwin --arch "$arch" -- --mac --"$arch" \
           --config.directories.output="$out_dir" ${version_args[@]+"${version_args[@]}"}
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

json_quote() {
  # Escape the characters that can appear in paths and plist-derived strings;
  # reject remaining control characters instead of emitting invalid JSON.
  local value="${1//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  if printf '%s' "$value" | LC_ALL=C grep -q $'[^ -~]'; then
    echo "ERROR: refusing to embed control characters in the staged receipt" >&2
    return 1
  fi
  printf '"%s"' "$value"
}

sha256_file() {
  /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'
}

# Root CodeDirectory hash. CDHash is computed by codesign over the sealed
# bundle resources, so it binds the whole signed App, not just one file.
extract_codesign_cdhash() {
  # codesign prints the 20-byte truncated identity as `CDHash=<40 hex>` and the
  # untruncated digest as `CandidateCDHashFull sha256=<64 hex>`. Prefer the full
  # hash, fall back to the truncated one; requiring 64 hex from the `CDHash=`
  # line alone can never match on a current macOS.
  local app="$1" out line
  out="$(codesign -d --verbose=4 "$app" 2>&1)"
  line="$(printf '%s\n' "$out" | /usr/bin/awk '/^CandidateCDHashFull sha256=/ {sub(/^.*sha256=/, ""); print; exit}')"
  if [[ ! "$line" =~ ^[0-9a-f]{64}$ ]]; then
    line="$(printf '%s\n' "$out" | /usr/bin/awk -F= '/^CDHash=/ {print $2; exit}')"
  fi
  [[ "$line" =~ ^[0-9a-f]{40}$ || "$line" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$line"
}

RELEASE_STAGED_SCHEMA="pipiui-electron-release-staged/2"
BUILD_ELECTRON_APP_VERSION="2"
stage_cleanup_paths=()

stage_sibling_path() {
  local dest="$1" suffix="$2"
  printf '%s/.%s.%s\n' "$(dirname "$dest")" "$(basename "$dest")" "$suffix"
}

stage_cleanup_temps() {
  local path
  for path in "${stage_cleanup_paths[@]:-}"; do
    [[ -n "$path" ]] && rm -rf "$path"
  done
  stage_cleanup_paths=()
}

stage_forget_path() {
  # Drop one exact path from the cleanup array. Element-exact string matching
  # only — never word-split — so paths containing spaces stay intact.
  local drop="$1" path
  local -a keep=()
  for path in ${stage_cleanup_paths[@]+"${stage_cleanup_paths[@]}"}; do
    [[ "$path" == "$drop" ]] || keep+=("$path")
  done
  stage_cleanup_paths=(${keep[@]+"${keep[@]}"})
}

# Replace dest with src without ever exposing a partial dest: park src in a
# sibling .next, park any previous dest in .prev, then complete with one mv.
# The EXIT trap (stage_cleanup_temps) discards parked paths on a crash; every
# early return forgets exactly the paths it parked, preserving the rest of the
# cleanup array (paths may contain spaces and are never word-split).
atomic_publish_dir() {
  local src="$1" dest="$2" next prev
  [[ -d "$src" ]] || return 1
  mkdir -p "$(dirname "$dest")" || return 1
  next="$(stage_sibling_path "$dest" next)"
  prev="$(stage_sibling_path "$dest" prev)"
  rm -rf "$next" "$prev"
  stage_cleanup_paths+=("$next" "$prev")
  if ! mv "$src" "$next"; then
    stage_forget_path "$next"
    stage_forget_path "$prev"
    return 1
  fi
  if [[ -e "$dest" ]]; then
    if ! mv "$dest" "$prev"; then
      mv "$next" "$src" 2>/dev/null || true
      stage_forget_path "$next"
      stage_forget_path "$prev"
      return 1
    fi
  fi
  if ! mv "$next" "$dest"; then
    # Best-effort restore of the previous pair. If a restore itself fails the
    # stable dest is simply absent — never a mismatched pair.
    if [[ -e "$prev" ]]; then mv "$prev" "$dest" 2>/dev/null || true; fi
    if [[ -e "$next" ]]; then mv "$next" "$src" 2>/dev/null || true; fi
    stage_forget_path "$next"
    stage_forget_path "$prev"
    return 1
  fi
  rm -rf "$prev"
  stage_forget_path "$next"
  stage_forget_path "$prev"
  return 0
}

publish_release_artifacts() {
  # Validate exactly this run's four expected artifacts (x64+arm64 dmg+zip),
  # each tagged with this release's version, all unique, then - and only after
  # the full matrix validated - move them into build/ with same-filesystem
  # atomic renames. Files arrive per arch in the arch-owned run-root subdir, so
  # classification never depends on parsing artifact basenames. A validation
  # failure leaves build/ and any prior artifacts completely untouched.
  # Prints the JSON object entries (comma-joined) for the receipt inventory.
  local root="$1" run_root="$2" version="$3" arch file base kind bytes sha entry
  local -a entries=() found=() moves=()
  for arch in x64 arm64; do
    for file in "$run_root/$arch"/*.dmg "$run_root/$arch"/*.zip; do
      [[ -f "$file" ]] || continue
      base="$(basename "$file")"
      case "$base" in
        *.dmg) kind="dmg" ;;
        *.zip) kind="zip" ;;
        *) continue ;;
      esac
      if printf '%s\n' ${found[@]+"${found[@]}"} | /usr/bin/grep -qx "$kind-$arch"; then
        echo "ERROR: release: duplicate $arch $kind artifact in the run root: $base" >&2
        return 1
      fi
      if [[ -n "$version" && "$base" != *"$version"* ]]; then
        echo "ERROR: release: artifact $base is not tagged with the release version $version" >&2
        return 1
      fi
      found+=("$kind-$arch")
      moves+=("$file")
      bytes="$(stat -f %z "$file")"
      sha="$(sha256_file "$file")"
      entries+=("{\"kind\":\"$kind\",\"arch\":\"$arch\",\"path\":$(json_quote "$root/build/$base"),\"bytes\":$bytes,\"sha256\":\"$sha\"}")
    done
  done
  if [[ "${#found[@]}" -ne 4 ]]; then
    echo "ERROR: release: expected exactly 4 artifacts (x64+arm64 dmg+zip) for version ${version:-unknown}, found ${#found[@]}: ${found[*]:-none}" >&2
    return 1
  fi
  for file in ${moves[@]+"${moves[@]}"}; do
    if ! mv "$file" "$root/build/"; then
      echo "ERROR: release: failed to publish artifact $(basename "$file") into build/" >&2
      return 1
    fi
  done
  (IFS=,; printf '%s' "${entries[*]}")
}

extension_manifests_aggregate() {
  # Deterministic identity of the bundled extension manifest set: every
  # pipiui-extension.json under Resources/pipiui-runtime/extensions, sorted by
  # relative path, folded as "<relpath>  <sha256>" lines and hashed. Prints
  # "<aggregateSha256> <count>". The installer recomputes this to bind the
  # staged App to its receipt without hashing the whole multi-GB bundle.
  local app="$1" manifest rel sha count
  local -a lines=()
  while IFS= read -r manifest; do
    rel="${manifest#"$app"/}"
    sha="$(sha256_file "$manifest")"
    lines+=("$rel  $sha")
  done < <(find "$app/Contents/Resources/pipiui-runtime/extensions" -name pipiui-extension.json -print | LC_ALL=C sort)
  count="${#lines[@]}"
  if [[ "$count" -eq 0 ]]; then
    echo "ERROR: staged App has no pipiui-extension.json manifests under Resources/pipiui-runtime/extensions" >&2
    return 1
  fi
  printf '%s %s\n' "$(printf '%s\n' "${lines[@]}" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')" "$count"
}

# Stage-only step: verify the finished arm64 candidate strictly, gather its
# cryptographic identity, publish this run's four validated artifacts into
# build/, and publish candidate+receipt together as one atomic container swap
# to build/PipiUI.release-staged/ (App + receipt.json). The canonical
# App (running or not) is never touched, and a failed run leaves the previous
# complete container pair intact - a mismatched candidate/receipt pair is
# never exposed.
publish_release_staged() {
  local run_root="$1"
  local app_src="$run_root/arm64/mac-arm64/PipiUI.app"
  local container_dst="$ROOT/build/PipiUI.release-staged"
  local main_exe office_bin office_receipt_dir office_receipt office_target office_sha office_bytes office_version office_receipt_sha
  local cdhash exe_sha exe_bytes plist_sha bundle_version archs epoch staged_at tmp_container tmp_receipt inventory
  local manifest_identity manifest_agg manifest_count

  [[ -d "$app_src" ]] || { echo "ERROR: stage-only: expected the arm64 App at $app_src" >&2; return 1; }
  expected_mac_bundle_is_complete "$app_src" || { echo "ERROR: stage-only: refusing to stage an incomplete Electron bundle: $app_src" >&2; return 1; }
  main_exe="$app_src/Contents/MacOS/PipiUI"
  if ! codesign --verify --deep --strict --verbose=2 "$app_src"; then
    echo "ERROR: stage-only: strict codesign verification failed for $app_src" >&2
    return 1
  fi
  if ! cdhash="$(extract_codesign_cdhash "$app_src")"; then
    echo "ERROR: stage-only: could not read a valid CDHash for $app_src" >&2
    return 1
  fi
  archs="$(lipo -archs "$main_exe" 2>/dev/null || true)"
  [[ "$archs" == *"arm64"* ]] || { echo "ERROR: stage-only: staged main executable is not arm64 (${archs:-unknown})" >&2; return 1; }
  bundle_version="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$app_src/Contents/Info.plist" 2>/dev/null || true)"
  [[ -n "$bundle_version" ]] || { echo "ERROR: stage-only: staged App has no CFBundleShortVersionString" >&2; return 1; }
  exe_sha="$(sha256_file "$main_exe")"
  exe_bytes="$(stat -f %z "$main_exe")"
  plist_sha="$(sha256_file "$app_src/Contents/Info.plist")"
  if ! manifest_identity="$(extension_manifests_aggregate "$app_src")"; then
    return 1
  fi
  read -r manifest_agg manifest_count <<< "$manifest_identity"

  # The packaging contract ships exactly one OfficeCLI slice per target; a
  # staged candidate without a hash-valid darwin-arm64 slice is not installable.
  office_receipt_dir="$app_src/Contents/Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64"
  office_bin="$office_receipt_dir/officecli"
  office_receipt="$office_receipt_dir/receipt.json"
  [[ -x "$office_bin" && -f "$office_receipt" ]] || { echo "ERROR: stage-only: staged App lacks the bundled darwin-arm64 OfficeCLI binary/receipt" >&2; return 1; }
  office_target="$(/usr/bin/plutil -extract target raw -o - "$office_receipt" 2>/dev/null || true)"
  office_sha="$(/usr/bin/plutil -extract sha256 raw -o - "$office_receipt" 2>/dev/null || true)"
  office_bytes="$(/usr/bin/plutil -extract bytes raw -o - "$office_receipt" 2>/dev/null || true)"
  office_version="$(/usr/bin/plutil -extract version raw -o - "$office_receipt" 2>/dev/null || true)"
  office_receipt_sha="$(sha256_file "$office_receipt")"
  [[ "$office_target" == "darwin-arm64" ]] || { echo "ERROR: stage-only: bundled OfficeCLI receipt target is ${office_target:-missing}, expected darwin-arm64" >&2; return 1; }
  [[ "$office_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "ERROR: stage-only: bundled OfficeCLI receipt has no valid sha256" >&2; return 1; }
  [[ "$office_bytes" =~ ^[0-9]+$ ]] || office_bytes=0
  [[ "$(sha256_file "$office_bin")" == "$office_sha" ]] || { echo "ERROR: stage-only: bundled OfficeCLI hash does not match its receipt" >&2; return 1; }

  if ! inventory="$(publish_release_artifacts "$ROOT" "$run_root" "$bundle_version")"; then
    return 1
  fi

  # Build the complete replacement container (App + receipt) in a unique temp
  # directory, then swap the stable container in one atomic rename chain: a
  # crash leaves either the previous complete pair or the new complete pair,
  # never a candidate/receipt mismatch.
  tmp_container="$(mktemp -d "$ROOT/build/.release-staged-container.XXXXXX")"
  stage_cleanup_paths+=("$tmp_container")
  if ! mv "$app_src" "$tmp_container/PipiUI.app"; then
    echo "ERROR: stage-only: failed to assemble the staged container" >&2
    return 1
  fi
  epoch="$(date +%s)"
  staged_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmp_receipt="$(mktemp "$ROOT/build/.release-staged.receipt.XXXXXX")"
  stage_cleanup_paths+=("$tmp_receipt")
  {
    printf '{\n'
    printf '  "schema": %s,\n' "$(json_quote "$RELEASE_STAGED_SCHEMA")"
    printf '  "sourceScriptVersion": %s,\n' "$(json_quote "$BUILD_ELECTRON_APP_VERSION")"
    printf '  "version": %s,\n' "$(json_quote "$bundle_version")"
    printf '  "containerPath": %s,\n' "$(json_quote "$container_dst")"
    printf '  "stagedPath": %s,\n' "$(json_quote "$container_dst/PipiUI.app")"
    printf '  "mainArch": "arm64",\n'
    printf '  "stagedAt": %s,\n' "$(json_quote "$staged_at")"
    printf '  "stagedAtEpoch": %s,\n' "$epoch"
    printf '  "app": {\n'
    printf '    "cdhash": %s,\n' "$(json_quote "$cdhash")"
    printf '    "mainExecutable": {"path": %s, "sha256": %s, "bytes": %s},\n' "$(json_quote "Contents/MacOS/PipiUI")" "$(json_quote "$exe_sha")" "$exe_bytes"
    printf '    "infoPlist": {"path": %s, "sha256": %s},\n' "$(json_quote "Contents/Info.plist")" "$(json_quote "$plist_sha")"
    printf '    "extensionManifests": {"count": %s, "aggregateSha256": %s}\n' "$manifest_count" "$(json_quote "$manifest_agg")"
    printf '  },\n'
    printf '  "officecli": {\n'
    printf '    "target": %s,\n' "$(json_quote "$office_target")"
    printf '    "sha256": %s,\n' "$(json_quote "$office_sha")"
    printf '    "bytes": %s,\n' "$office_bytes"
    printf '    "version": %s,\n' "$(json_quote "$office_version")"
    printf '    "receiptPath": %s,\n' "$(json_quote "Contents/Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64/receipt.json")"
    printf '    "receiptSha256": %s\n' "$(json_quote "$office_receipt_sha")"
    printf '  },\n'
    printf '  "codesign": {"verified": true, "mode": "deep-strict", "cdhash": %s},\n' "$(json_quote "$cdhash")"
    printf '  "artifacts": [%s]\n' "$inventory"
    printf '}\n'
  } > "$tmp_receipt"
  if ! mv "$tmp_receipt" "$tmp_container/receipt.json"; then
    echo "ERROR: stage-only: failed to seal the receipt into the staged container" >&2
    return 1
  fi
  stage_forget_path "$tmp_receipt"

  if ! atomic_publish_dir "$tmp_container" "$container_dst"; then
    echo "ERROR: stage-only: failed to publish the staged container atomically; any previous staged container was kept" >&2
    return 1
  fi
  stage_forget_path "$tmp_container"

  echo "Staged release container: $container_dst"
  echo "Staged receipt: $container_dst/receipt.json"
}

PLATFORM="${1:-mac}"
# mac --stage-only: full dual-architecture DMG/ZIP release build that never
# touches, moves, or quits build/PipiUI.app. The verified arm64
# candidate and its receipt are published as one atomic container to
# build/PipiUI.release-staged/ (PipiUI.app + receipt.json),
# for scripts/install-electron-release-staged.sh.
STAGE_ONLY=0
USAGE_LINE="usage: $0 [mac [--stage-only]|win|linux|--check-signing]"
case "$PLATFORM" in
  mac)
    if [[ "${2:-}" == "--stage-only" ]]; then
      STAGE_ONLY=1
    elif [[ -n "${2:-}" ]]; then
      echo "$USAGE_LINE" >&2
      exit 2
    fi
    ;;
  win|linux)
    if [[ -n "${2:-}" ]]; then
      echo "$USAGE_LINE" >&2
      exit 2
    fi
    ;;
  --check-signing)
    prepare_mac_signing_identity
    exit 0
    ;;
  -h|--help)
    echo "$USAGE_LINE"
    echo "mac signing defaults to persistent identity PipiUI Dev ($DEFAULT_MAC_SIGNING_IDENTITY)."
    echo "Override intentionally with PIPIUI_ELECTRON_SIGNING_IDENTITY=<exact SHA-1>."
    echo "Prepare release runtimes first: npm --prefix Electron run runtime:prepare:mac"
    echo "mac --stage-only keeps a running PipiUI alive: it publishes the verified arm64"
    echo "candidate plus receipt as one atomic container, build/PipiUI.release-staged/"
    echo "(PipiUI.app + receipt.json), and never touches the canonical App."
    echo "Install it later with install-electron-release-staged.sh."
    echo "Note: electron-vite dev runs the framework Electron binary and does not share the packaged App's TCC signing identity."
    exit 0
    ;;
  *) echo "$USAGE_LINE" >&2; exit 2 ;;
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
    echo "Refusing to package PipiUI.app outside the primary checkout." >&2
    echo "Primary checkout: $PRIMARY_ROOT" >&2
    echo "Current checkout: $CURRENT_ROOT" >&2
    echo "Running the Electron workspace build only." >&2
    exec npm --prefix Electron run build
  fi
fi

if [[ "$PLATFORM" == "mac" && "$STAGE_ONLY" != "1" ]]; then
  CANONICAL_ELECTRON_EXECUTABLE="$ROOT/build/PipiUI.app/Contents/MacOS/PipiUI"
  if canonical_electron_app_is_running "$CANONICAL_ELECTRON_EXECUTABLE"; then
    echo "ERROR: refusing to build or replace the canonical Electron App while it is running." >&2
    echo "Quit PipiUI manually, then rerun this command. The running process was not terminated." >&2
    echo "For a full release while PipiUI stays open, rerun with: $0 mac --stage-only" >&2
    exit 1
  fi
fi

if [[ "$PLATFORM" == "mac" ]]; then
  prepare_mac_signing_identity
fi

# build/ is gitignored, so the .icns may be absent on fresh checkouts; the
# mac icon is generated from the tracked brand png (tolerant: skips if the
# macOS toolchain is missing). Route tests skip repo-mutating preparation.
if [[ "$PLATFORM" == "mac" && "${PIPIUI_ELECTRON_RELEASE_FUNCTION_TEST:-0}" != "1" ]]; then
  scripts/make-icon.sh assets/brand/app-icon.png Electron/apps/electron/build/icon.icns
fi

case "$PLATFORM" in
  mac)
    if [[ "${PIPIUI_ELECTRON_RELEASE_FUNCTION_TEST:-0}" != "1" ]]; then
      npm --prefix Electron run build
    fi
    # Every release run builds into one unique owned run root under build/,
    # passed to electron-builder via --config.directories.output. Nothing reads
    # or deletes the fixed shared build/mac* trees, and cleanup touches only
    # this run's own root (via the EXIT trap on failure, explicitly on success).
    run_root="$(mktemp -d "$ROOT/build/.release-run.XXXXXX")"
    trap stage_cleanup_temps EXIT
    stage_cleanup_paths+=("$run_root")
    echo "Release run root: $run_root"
    package_mac_arch x64 "$run_root/x64"
    package_mac_arch arm64 "$run_root/arm64"

    if [[ "$STAGE_ONLY" == "1" ]]; then
      # Two-phase release, step 1. DMG/ZIP artifacts for both architectures
      # are validated and published into build/; the verified arm64 candidate
      # and its receipt are published as one atomic container swap to
      # build/PipiUI.release-staged/. The canonical App — running or
      # not — is never touched, moved, or quit, and nothing is installed.
      if [[ "${PIPIUI_EDITION:-full}" == "base" ]]; then
        # Base releases only publish installers; keep the Coding App and its
        # OfficeCLI-bound installation receipt intact.
        base_app="$run_root/arm64/mac-arm64/PipiUI.app"
        base_version="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$base_app/Contents/Info.plist")"
        publish_release_artifacts "$ROOT" "$run_root" "$base_version" >/dev/null
        echo "Published base release artifacts: $base_version (x64+arm64 dmg+zip)"
      else
        publish_release_staged "$run_root"
      fi
    else
    # Canonical single artifact: build/PipiUI.app
    APP_SRC="$run_root/arm64/mac-arm64/PipiUI.app"
    APP_DST="$ROOT/build/PipiUI.app"
    if [[ -d "$APP_SRC" ]]; then
      APP_VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$APP_SRC/Contents/Info.plist" 2>/dev/null || true)"
      publish_release_artifacts "$ROOT" "$run_root" "$APP_VERSION" >/dev/null
      rm -rf "$APP_DST"
      mv "$APP_SRC" "$APP_DST"
      codesign --verify --deep --strict --verbose=2 "$APP_DST"
      echo "Packaged: $APP_DST"
    fi
    fi
    # Owned run-root cleanup only — never the fixed shared build/mac* trees.
    rm -rf "$run_root"
    stage_forget_path "$run_root"
    ;;
  win)
    npm --prefix Electron run package:win
    echo "Win installer: $ROOT/build/PipiUI Setup *.exe"
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
