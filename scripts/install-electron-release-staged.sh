#!/bin/bash
# Install the staged PipiUI Electron release candidate into the canonical App
# path, atomically, with rollback. Repo-owned and directly testable; the
# pipiui-electron-build skill invokes it for `release --install-staged`
# (detached through launchd when the running App must be replaced).
#
# usage: install-electron-release-staged.sh [--root <repo>] [--overwrite-running] [--no-relaunch]
#
# Consumes the stable container:
#   build/PipiUI Electron.release-staged/{PipiUI Electron.app,receipt.json}
#   receipt schema pipiui-electron-release-staged/2
#
# Guarantees:
#   - Absolute no-follow walk: lstat EVERY existing component from / downward
#     for root, build, container, staged App, receipt, canonical, backup,
#     Trash/log/receipt parents. Any symlink ancestor or final component is
#     rejected. Missing finals (swap/backup/log) are allowed only after every
#     existing ancestor is validated. PATHS_TRUSTED is set only after that
#     complete walk. No recursive deletion of unknown paths.
#   - Validates the staged receipt, strict codesign, CDHash, main/Info.plist
#     hashes, extension-manifest aggregate, arm64 main executable and the
#     bundled OfficeCLI slice/hash/receipt/version/freshness/artifact inventory
#     BEFORE any quit or filesystem swap.
#   - Only exact canonical bundle-path processes are ever signalled (graceful
#     Quit, bounded wait, exact re-proven TERM/KILL last). No name matching.
#   - Never moves a live bundle; swaps only after every canonical process exited.
#   - Atomic swap with rollback: old canonical -> unique backup, staged ->
#     canonical, strict verify, restore + retain failed candidate on failure.
#   - Registers only the canonical App and unregisters nested helper Apps.
#   - --no-relaunch guarantees no launch of anything.
#   - Production test seams require PIPIUI_INSTALLER_TEST_MODE=1.
set -euo pipefail

INSTALLER_VERSION="2"
INSTALL_SCHEMA="pipiui-electron-release-install/1"
STAGED_SCHEMA="pipiui-electron-release-staged/2"
DEFAULT_ROOT="/Users/haoli/leehow/code/pipiui"
CANONICAL_BUNDLE_ID="com.leehow.pipiui-electron"
DEFAULT_STAGED_MAX_AGE_S=1209600
DEFAULT_GRACE_ATTEMPTS=40
DEFAULT_TERM_ATTEMPTS=20
DEFAULT_KILL_ATTEMPTS=20

# Production uses the hard-coded binaries and wait bounds. Env overrides that
# could weaken gates (tiny waits, replacement binaries, alternate Trash) are
# honored only when the caller explicitly opts into installer test mode.
if [[ "${PIPIUI_INSTALLER_TEST_MODE:-}" == "1" ]]; then
  INSTALLER_TEST_MODE=1
  STAGED_MAX_AGE_S="${PIPIUI_STAGED_MAX_AGE_S:-$DEFAULT_STAGED_MAX_AGE_S}"
  GRACE_ATTEMPTS="${PIPIUI_INSTALL_GRACE_ATTEMPTS:-$DEFAULT_GRACE_ATTEMPTS}"
  TERM_ATTEMPTS="${PIPIUI_INSTALL_TERM_ATTEMPTS:-$DEFAULT_TERM_ATTEMPTS}"
  KILL_ATTEMPTS="${PIPIUI_INSTALL_KILL_ATTEMPTS:-$DEFAULT_KILL_ATTEMPTS}"
  PS_BIN="${PS_BIN:-/bin/ps}"
  OSASCRIPT_BIN="${OSASCRIPT_BIN:-/usr/bin/osascript}"
  KILL_BIN="${KILL_BIN:-/bin/kill}"
  CODESIGN_BIN="${CODESIGN_BIN:-/usr/bin/codesign}"
  LIPO_BIN="${LIPO_BIN:-/usr/bin/lipo}"
  PLUTIL_BIN="${PLUTIL_BIN:-/usr/bin/plutil}"
  SHASUM_BIN="${SHASUM_BIN:-/usr/bin/shasum}"
  LSREGISTER_BIN="${LSREGISTER_BIN:-/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister}"
  OPEN_BIN="${OPEN_BIN:-/usr/bin/open}"
  LSOF_BIN="${LSOF_BIN:-/usr/sbin/lsof}"
  TRASH_DIR="${PIPIUI_INSTALLER_TRASH_DIR:-$HOME/.Trash}"
else
  INSTALLER_TEST_MODE=0
  STAGED_MAX_AGE_S="$DEFAULT_STAGED_MAX_AGE_S"
  GRACE_ATTEMPTS="$DEFAULT_GRACE_ATTEMPTS"
  TERM_ATTEMPTS="$DEFAULT_TERM_ATTEMPTS"
  KILL_ATTEMPTS="$DEFAULT_KILL_ATTEMPTS"
  PS_BIN="/bin/ps"
  OSASCRIPT_BIN="/usr/bin/osascript"
  KILL_BIN="/bin/kill"
  CODESIGN_BIN="/usr/bin/codesign"
  LIPO_BIN="/usr/bin/lipo"
  PLUTIL_BIN="/usr/bin/plutil"
  SHASUM_BIN="/usr/bin/shasum"
  LSREGISTER_BIN="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  OPEN_BIN="/usr/bin/open"
  LSOF_BIN="/usr/sbin/lsof"
  TRASH_DIR="$HOME/.Trash"
fi

# Bound wait overrides even in test mode: a zero/negative value would skip the
# graceful window and weaken the exact-PID escalation contract.
[[ "$GRACE_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || GRACE_ATTEMPTS="$DEFAULT_GRACE_ATTEMPTS"
[[ "$TERM_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || TERM_ATTEMPTS="$DEFAULT_TERM_ATTEMPTS"
[[ "$KILL_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || KILL_ATTEMPTS="$DEFAULT_KILL_ATTEMPTS"
[[ "$STAGED_MAX_AGE_S" =~ ^[1-9][0-9]*$ ]] || STAGED_MAX_AGE_S="$DEFAULT_STAGED_MAX_AGE_S"

INSTALL_ROOT="$DEFAULT_ROOT"
OVERWRITE_RUNNING=0
NO_RELAUNCH=0
PATHS_TRUSTED=0
PHYSICAL_ROOT=""
PHYSICAL_BUILD=""
usage() {
  echo "usage: $0 [--root <repo>] [--overwrite-running] [--no-relaunch]" >&2
  echo "  --root <repo>         repository containing build/ (default: $DEFAULT_ROOT)" >&2
  echo "  --overwrite-running   authorize quitting a running canonical App first" >&2
  echo "  --no-relaunch         never relaunch, even if the App was running" >&2
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      [[ -n "${2:-}" ]] || { echo "ERROR: --root requires a value" >&2; exit 2; }
      INSTALL_ROOT="$2"
      shift
      ;;
    --overwrite-running) OVERWRITE_RUNNING=1 ;;
    --no-relaunch) NO_RELAUNCH=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
  shift
done

INSTALL_ROOT="${INSTALL_ROOT%/}"
BUILD_DIR="$INSTALL_ROOT/build"
CANONICAL_APP="$BUILD_DIR/PipiUI Electron.app"
CANONICAL_EXE="$CANONICAL_APP/Contents/MacOS/PipiUI Electron"
STAGED_CONTAINER="$BUILD_DIR/PipiUI Electron.release-staged"
STAGED_APP="$STAGED_CONTAINER/PipiUI Electron.app"
STAGED_RECEIPT="$STAGED_CONTAINER/receipt.json"
LOG_FILE="$BUILD_DIR/PipiUI Electron.release-install.log"
INSTALL_RECEIPT="$BUILD_DIR/PipiUI Electron.release-install.json"

RECEIPT_WRITTEN=0
INSTALL_STATUS="failed"
INSTALL_DETAIL=""
STOP_METHOD="none"
ROLLBACK_PERFORMED=0
ROLLBACK_RESTORED_FROM=""
FAILED_CANDIDATE=""
RELAUNCH_PERFORMED=0
RELAUNCH_PID=""
STAGED_VERSION=""

json_quote() {
  local value="${1//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

log() {
  local line
  line="[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*"
  if [[ "$PATHS_TRUSTED" == "1" ]]; then
    echo "$line" >> "$LOG_FILE" 2>/dev/null || true
  fi
  echo "$line" >&2
}

receipt_field() {
  "$PLUTIL_BIN" -extract "$1" raw -o - "$STAGED_RECEIPT" 2>/dev/null || true
}

sha256_file() {
  "$SHASUM_BIN" -a 256 "$1" | /usr/bin/awk '{print $1}'
}

# After a successful no-follow walk no component is a symlink, so the logical
# path is already the physical path. These helpers never call cd -P.
physical_dir() {
  local path="$1"
  [[ ! -L "$path" && -d "$path" ]] || return 1
  printf '%s' "$path"
}

physical_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" ]] || return 1
  printf '%s' "$path"
}

WALK_FAIL_REASON=""

# lstat every existing component of an absolute path, starting at /. Never
# follows a symlink. allow_missing_final=1 permits only the last component to
# be absent, and only after every ancestor existed and was a non-symlink.
walk_absolute_path() {
  local path="$1" allow_missing_final="${2:-0}" remaining part acc="" last=0
  WALK_FAIL_REASON=""
  if [[ "$path" != /* ]]; then
    WALK_FAIL_REASON="not an absolute path"
    return 1
  fi
  remaining="${path#/}"
  if [[ -z "$remaining" ]]; then
    return 0
  fi
  while [[ -n "$remaining" ]]; do
    part="${remaining%%/*}"
    if [[ "$remaining" == */* ]]; then
      remaining="${remaining#*/}"
    else
      remaining=""
      last=1
    fi
    if [[ -z "$part" || "$part" == "." || "$part" == ".." ]]; then
      WALK_FAIL_REASON="illegal path component"
      return 1
    fi
    acc="$acc/$part"
    if [[ -L "$acc" ]]; then
      WALK_FAIL_REASON="symlink component: $acc"
      return 1
    fi
    if [[ ! -e "$acc" ]]; then
      if [[ "$last" == "1" && "$allow_missing_final" == "1" ]]; then
        return 0
      fi
      WALK_FAIL_REASON="missing component: $acc"
      return 1
    fi
  done
  return 0
}

path_under() {
  local child="$1" parent="$2"
  [[ -n "$child" && -n "$parent" ]] || return 1
  [[ "$child" == "$parent" || "$child" == "$parent"/* ]]
}

write_install_receipt() {
  # Best-effort final receipt; never masks the original failure. Refuses to
  # write until the build directory has been lstat-validated.
  [[ "$PATHS_TRUSTED" == "1" ]] || return 0
  local tmp
  tmp="$(mktemp "$BUILD_DIR/.release-install.receipt.XXXXXX" 2>/dev/null)" || return 0
  if [[ -L "$tmp" ]]; then
    rm -f "$tmp"
    return 0
  fi
  {
    printf '{\n'
    printf '  "schema": %s,\n' "$(json_quote "$INSTALL_SCHEMA")"
    printf '  "installerVersion": %s,\n' "$(json_quote "$INSTALLER_VERSION")"
    printf '  "status": %s,\n' "$(json_quote "$INSTALL_STATUS")"
    printf '  "detail": %s,\n' "$(json_quote "$INSTALL_DETAIL")"
    printf '  "installedAt": %s,\n' "$(json_quote "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
    printf '  "version": %s,\n' "$(json_quote "$STAGED_VERSION")"
    printf '  "canonicalPath": %s,\n' "$(json_quote "$CANONICAL_APP")"
    printf '  "stagedSourcePath": %s,\n' "$(json_quote "$STAGED_APP")"
    printf '  "containerPath": %s,\n' "$(json_quote "$STAGED_CONTAINER")"
    printf '  "signature": {"verified": %s, "mode": "deep-strict"},\n' "$([[ "$INSTALL_STATUS" == "installed" ]] && echo true || echo false)"
    printf '  "stopMethod": %s,\n' "$(json_quote "$STOP_METHOD")"
    printf '  "rollback": {"performed": %s, "restoredFrom": %s},\n' "$(( ROLLBACK_PERFORMED ))" "$(json_quote "$ROLLBACK_RESTORED_FROM")"
    printf '  "failedCandidatePath": %s,\n' "$(json_quote "$FAILED_CANDIDATE")"
    printf '  "relaunch": {"noRelaunchRequested": %s, "performed": %s, "pid": %s},\n' "$(( NO_RELAUNCH ))" "$(( RELAUNCH_PERFORMED ))" "$(json_quote "$RELAUNCH_PID")"
    printf '  "overwriteRunningAuthorized": %s\n' "$(( OVERWRITE_RUNNING ))"
    printf '}\n'
  } > "$tmp"
  mv -f "$tmp" "$INSTALL_RECEIPT" 2>/dev/null || rm -f "$tmp"
  RECEIPT_WRITTEN=1
}

fail() {
  INSTALL_DETAIL="$*"
  log "ERROR: $*"
  write_install_receipt
  exit 1
}

on_exit() {
  local code="$?"
  if [[ "$RECEIPT_WRITTEN" != "1" ]]; then
    INSTALL_DETAIL="${INSTALL_DETAIL:-installer exited with status $code}"
    write_install_receipt
  fi
  exit "$code"
}
trap on_exit EXIT

reject_symlink() {
  local path="$1" label="$2"
  if [[ -L "$path" ]]; then
    fail "$label is a symlink; refusing path substitution: $path"
  fi
}

require_walk() {
  local path="$1" label="$2" allow_missing_final="${3:-0}"
  if ! walk_absolute_path "$path" "$allow_missing_final"; then
    fail "$label failed no-follow walk (${WALK_FAIL_REASON:-unknown}): $path"
  fi
}

require_real_dir() {
  local path="$1" label="$2"
  require_walk "$path" "$label" 0
  [[ -d "$path" ]] || fail "$label is not a directory: $path"
}

require_real_file() {
  local path="$1" label="$2"
  require_walk "$path" "$label" 0
  [[ -f "$path" ]] || fail "$label is not a regular file: $path"
}

require_under() {
  local child="$1" parent="$2" label="$3"
  path_under "$child" "$parent" || fail "$label escaped its expected parent ($child is not under $parent)"
}

# ---------------------------------------------------------------- processes
pid_command() {
  "$PS_BIN" -ww -p "$1" -o command= 2>/dev/null || true
}

pid_is_canonical_process() {
  local pid="$1" command
  command="$(pid_command "$pid")"
  [[ -n "$command" && "${command#"$CANONICAL_APP/Contents/"}" != "$command" ]]
}

canonical_process_pids() {
  local pid command
  "$PS_BIN" -ww -axo pid=,command= | while read -r pid command; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    if [[ -n "$command" && "${command#"$CANONICAL_APP/Contents/"}" != "$command" ]]; then
      echo "$pid"
    fi
  done
}

canonical_main_pids() {
  local pid command
  "$PS_BIN" -ww -axo pid=,command= | while read -r pid command; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    if [[ "$command" == "$CANONICAL_EXE" || "${command#"$CANONICAL_EXE "}" != "$command" ]]; then
      echo "$pid"
    fi
  done
}

canonical_is_running() {
  local pid
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && return 0
  done < <(canonical_process_pids)
  return 1
}

wait_no_canonical_processes() {
  local attempts="$1" i
  for ((i = 0; i < attempts; i++)); do
    if ! canonical_is_running; then return 0; fi
    sleep 0.25
  done
  return 1
}

signal_canonical_processes() {
  local signal="$1" pid
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    # Re-prove the exact bundle-path command immediately before every signal
    # so PID reuse can never target an unrelated process.
    if pid_is_canonical_process "$pid"; then
      if "$KILL_BIN" "-$signal" "$pid" 2>/dev/null; then
        log "sent $signal to exact canonical pid $pid"
      fi
    else
      log "skip $signal for pid $pid: command no longer maps the canonical bundle"
    fi
  done < <(canonical_process_pids)
}

stop_canonical_app() {
  if ! canonical_is_running; then
    STOP_METHOD="none"
    return 0
  fi
  local quit_request_pid
  "$OSASCRIPT_BIN" -e "tell application id \"$CANONICAL_BUNDLE_ID\" to quit" >/dev/null 2>&1 &
  quit_request_pid=$!
  if wait_no_canonical_processes "$GRACE_ATTEMPTS"; then
    if "$KILL_BIN" -0 "$quit_request_pid" 2>/dev/null; then
      "$KILL_BIN" -TERM "$quit_request_pid" 2>/dev/null || true
    fi
    wait "$quit_request_pid" 2>/dev/null || true
    STOP_METHOD="graceful"
    return 0
  fi
  if "$KILL_BIN" -0 "$quit_request_pid" 2>/dev/null; then
    "$KILL_BIN" -TERM "$quit_request_pid" 2>/dev/null || true
  fi
  wait "$quit_request_pid" 2>/dev/null || true

  signal_canonical_processes TERM
  if wait_no_canonical_processes "$TERM_ATTEMPTS"; then
    STOP_METHOD="term"
    return 0
  fi
  signal_canonical_processes KILL
  if wait_no_canonical_processes "$KILL_ATTEMPTS"; then
    STOP_METHOD="kill"
    return 0
  fi
  return 1
}

# --------------------------------------------------------------- LaunchServices
register_canonical_only() {
  local exclusive="${1:-0}" helper_app
  [[ -d "$CANONICAL_APP" ]] || return 1
  "$LSREGISTER_BIN" -f "$CANONICAL_APP" >/dev/null 2>&1 || true
  # The product App is the only user-launchable registration. Electron and
  # embedded-driver helper Apps must not appear as independent applications.
  while IFS= read -r -d '' helper_app; do
    # -10814 means this exact helper was already absent, which is acceptable;
    # the single registry scan below verifies the actual final state.
    "$LSREGISTER_BIN" -u "$helper_app" >/dev/null 2>&1 || true
  done < <(/usr/bin/find "$CANONICAL_APP/Contents" -type d -name '*.app' -print0)
  "$LSREGISTER_BIN" -dump | /usr/bin/awk \
    -v canonical="$CANONICAL_APP" \
    -v bundle_id="$CANONICAL_BUNDLE_ID" \
    -v exclusive="$exclusive" '
      function inspect_record() {
        if (path == canonical && identifier == bundle_id) canonical_seen = 1
        if (index(path, canonical "/Contents/") == 1) nested_seen = 1
        if (identifier == bundle_id && path != canonical) duplicate_seen = 1
      }
      /^[-]{20,}[[:space:]]*$/ {
        inspect_record()
        path = ""
        identifier = ""
        next
      }
      /^path:[[:space:]]*/ {
        path = $0
        sub(/^path:[[:space:]]*/, "", path)
        sub(/[[:space:]]+\(0x[[:xdigit:]]+\)$/, "", path)
      }
      /^identifier:[[:space:]]*/ {
        identifier = $0
        sub(/^identifier:[[:space:]]*/, "", identifier)
      }
      END {
        inspect_record()
        exit(canonical_seen && !nested_seen && (!exclusive || !duplicate_seen) ? 0 : 1)
      }
    '
}

unregister_path() {
  "$LSREGISTER_BIN" -u "$1" >/dev/null 2>&1 || true
}

# ------------------------------------------------------------------ relaunch
loaded_executable_for_pid() {
  local pid="$1"
  "$LSOF_BIN" -a -p "$pid" -d txt -Fn 2>/dev/null \
    | /usr/bin/awk '/^n/ && !seen++ { sub(/^n/, ""); first = $0 } END { if (first != "") print first }'
}

relaunch_canonical_app() {
  local attempt pid loaded_executable
  [[ -x "$CANONICAL_EXE" ]] || return 1
  if ! "$OPEN_BIN" -n "$CANONICAL_APP"; then return 1; fi
  for ((attempt = 0; attempt < 40; attempt++)); do
    while IFS= read -r pid; do
      [[ "$pid" =~ ^[0-9]+$ ]] || continue
      loaded_executable="$(loaded_executable_for_pid "$pid" || true)"
      if [[ "$loaded_executable" == "$CANONICAL_EXE" ]]; then
        RELAUNCH_PID="$pid"
        return 0
      fi
    done < <(canonical_main_pids)
    sleep 0.25
  done
  return 1
}

# ----------------------------------------------------------- path validation
# True absolute no-follow walk: lstat every existing component from / down.
# cd -P is never used. PATHS_TRUSTED is set only after every path family below
# has been walked. Until then fail() writes stderr only.
validate_staged_paths() {
  require_real_dir "$STAGED_CONTAINER" "staged container"
  require_under "$STAGED_CONTAINER" "$PHYSICAL_BUILD" "staged container"
  [[ "$STAGED_CONTAINER" == "$PHYSICAL_BUILD/PipiUI Electron.release-staged" ]] \
    || fail "staged container is not the physical build's release-staged directory: $STAGED_CONTAINER"

  require_real_dir "$STAGED_APP" "staged App"
  require_under "$STAGED_APP" "$STAGED_CONTAINER" "staged App"
  [[ "$STAGED_APP" == "$STAGED_CONTAINER/PipiUI Electron.app" ]] \
    || fail "staged App is not the container's PipiUI Electron.app: $STAGED_APP"

  require_real_file "$STAGED_RECEIPT" "staged receipt"
  require_under "$STAGED_RECEIPT" "$STAGED_CONTAINER" "staged receipt"
  [[ "$STAGED_RECEIPT" == "$STAGED_CONTAINER/receipt.json" ]] \
    || fail "staged receipt is not the container's receipt.json: $STAGED_RECEIPT"
}

revalidate_trusted_paths() {
  local trash_parent
  require_real_dir "$INSTALL_ROOT" "root"
  require_real_dir "$BUILD_DIR" "build directory"
  require_under "$BUILD_DIR" "$PHYSICAL_ROOT" "build directory"
  [[ "$BUILD_DIR" == "$PHYSICAL_ROOT/build" ]] || fail "build directory escaped physical root"
  validate_staged_paths
  require_walk "$CANONICAL_APP" "canonical App" 1
  if [[ -e "$CANONICAL_APP" || -L "$CANONICAL_APP" ]]; then
    require_real_dir "$CANONICAL_APP" "canonical App"
    require_under "$CANONICAL_APP" "$PHYSICAL_BUILD" "canonical App"
  fi
  require_walk "$LOG_FILE" "install log" 1
  require_walk "$INSTALL_RECEIPT" "install receipt" 1
  trash_parent="$(dirname "$TRASH_DIR")"
  require_walk "$trash_parent" "Trash parent" 0
  require_walk "$TRASH_DIR" "Trash directory" 1
}

validate_install_paths() {
  local trash_parent
  [[ "$INSTALL_ROOT" == /* ]] || fail "root is not an absolute path: $INSTALL_ROOT"
  require_real_dir "$INSTALL_ROOT" "root"
  PHYSICAL_ROOT="$INSTALL_ROOT"

  require_real_dir "$BUILD_DIR" "build directory"
  PHYSICAL_BUILD="$BUILD_DIR"
  require_under "$PHYSICAL_BUILD" "$PHYSICAL_ROOT" "build directory"
  [[ "$PHYSICAL_BUILD" == "$PHYSICAL_ROOT/build" ]] || fail "build directory is not the physical root's build/: $PHYSICAL_BUILD"

  validate_staged_paths

  require_walk "$CANONICAL_APP" "canonical App" 1
  if [[ -e "$CANONICAL_APP" || -L "$CANONICAL_APP" ]]; then
    require_real_dir "$CANONICAL_APP" "canonical App"
    require_under "$CANONICAL_APP" "$PHYSICAL_BUILD" "canonical App"
  fi

  require_walk "$LOG_FILE" "install log" 1
  require_walk "$INSTALL_RECEIPT" "install receipt" 1
  require_under "$(dirname "$LOG_FILE")" "$PHYSICAL_BUILD" "install log parent"
  require_under "$(dirname "$INSTALL_RECEIPT")" "$PHYSICAL_BUILD" "install receipt parent"

  trash_parent="$(dirname "$TRASH_DIR")"
  [[ "$TRASH_DIR" == /* ]] || fail "Trash directory is not an absolute path: $TRASH_DIR"
  require_walk "$trash_parent" "Trash parent" 0
  [[ -d "$trash_parent" ]] || fail "Trash parent is not a directory: $trash_parent"
  require_walk "$TRASH_DIR" "Trash directory" 1

  # Backup/temp parent is BUILD_DIR — already walked. Only now may we write.
  PATHS_TRUSTED=1
}

extract_codesign_cdhash() {
  local app="$1" line
  line="$("$CODESIGN_BIN" -d --verbose=4 "$app" 2>&1 | /usr/bin/awk -F= '/^CDHash=/ {print $2; exit}')"
  [[ "$line" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$line"
}

extension_manifests_aggregate() {
  local app="$1" manifest rel sha count
  local -a lines=()
  while IFS= read -r manifest; do
    [[ -n "$manifest" ]] || continue
    if [[ -L "$manifest" ]]; then
      fail "extension manifest is a symlink; refusing path substitution: $manifest"
    fi
    rel="${manifest#"$app"/}"
    sha="$(sha256_file "$manifest")"
    lines+=("$rel  $sha")
  done < <(/usr/bin/find "$app/Contents/Resources/pipiui-runtime/extensions" -name pipiui-extension.json -print | LC_ALL=C sort)
  count="${#lines[@]}"
  if [[ "$count" -eq 0 ]]; then
    fail "staged App has no pipiui-extension.json manifests under Resources/pipiui-runtime/extensions"
  fi
  printf '%s %s\n' "$(printf '%s\n' "${lines[@]}" | "$SHASUM_BIN" -a 256 | /usr/bin/awk '{print $1}')" "$count"
}

validate_artifact_inventory() {
  local i kind arch path bytes sha actual_sha actual_bytes extra phys
  local -a seen=()
  extra="$(receipt_field artifacts.4.kind)"
  [[ -z "$extra" ]] || fail "staged receipt artifact inventory has more than 4 entries"
  for i in 0 1 2 3; do
    kind="$(receipt_field "artifacts.$i.kind")"
    arch="$(receipt_field "artifacts.$i.arch")"
    path="$(receipt_field "artifacts.$i.path")"
    bytes="$(receipt_field "artifacts.$i.bytes")"
    sha="$(receipt_field "artifacts.$i.sha256")"
    [[ "$kind" == "dmg" || "$kind" == "zip" ]] || fail "artifact $i has invalid kind '${kind:-missing}'"
    [[ "$arch" == "x64" || "$arch" == "arm64" ]] || fail "artifact $i has invalid arch '${arch:-missing}'"
    [[ -n "$path" ]] || fail "artifact $i has no path"
    require_real_file "$path" "artifact $i"
    phys="$(physical_file "$path")" || fail "artifact $i is not a regular file: $path"
    require_under "$phys" "$PHYSICAL_BUILD" "artifact $i"
    [[ "$bytes" =~ ^[0-9]+$ ]] || fail "artifact $i has no numeric bytes"
    actual_bytes="$(stat -f %z "$path")"
    [[ "$actual_bytes" == "$bytes" ]] || fail "artifact $i size $actual_bytes does not match receipt bytes $bytes"
    [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || fail "artifact $i has no valid sha256"
    actual_sha="$(sha256_file "$path")"
    [[ "$actual_sha" == "$sha" ]] || fail "artifact $i hash does not match the receipt"
    if printf '%s\n' ${seen[@]+"${seen[@]}"} | /usr/bin/grep -qx "$kind-$arch"; then
      fail "duplicate $kind-$arch artifact in the receipt"
    fi
    seen+=("$kind-$arch")
  done
  [[ "${#seen[@]}" -eq 4 ]] || fail "staged receipt artifact inventory is incomplete"
  for expected in dmg-arm64 dmg-x64 zip-arm64 zip-x64; do
    printf '%s\n' "${seen[@]}" | /usr/bin/grep -qx "$expected" \
      || fail "staged receipt is missing $expected artifact"
  done
}

# ----------------------------------------------------------------- validation
validate_staged() {
  local schema staged_path container_path main_arch epoch now bundle_version archs
  local office_bin office_bundled_receipt office_target office_sha office_bytes office_version office_receipt_path office_receipt_sha
  local bundled_target bundled_sha bundled_version actual_sha receipt_bytes
  local cdhash receipt_cdhash codesign_cdhash exe_path exe_sha exe_bytes plist_path plist_sha
  local manifest_count manifest_agg actual_identity actual_agg actual_count

  validate_staged_paths

  schema="$(receipt_field schema)"
  [[ "$schema" == "$STAGED_SCHEMA" ]] || fail "staged receipt schema is '${schema:-missing}', expected $STAGED_SCHEMA"
  container_path="$(receipt_field containerPath)"
  [[ "$container_path" == "$STAGED_CONTAINER" ]] || fail "staged receipt describes a different container: ${container_path:-missing}"
  staged_path="$(receipt_field stagedPath)"
  [[ "$staged_path" == "$STAGED_APP" ]] || fail "staged receipt describes a different path: ${staged_path:-missing}"
  main_arch="$(receipt_field mainArch)"
  [[ "$main_arch" == "arm64" ]] || fail "staged receipt mainArch is '${main_arch:-missing}', expected arm64"
  STAGED_VERSION="$(receipt_field version)"
  [[ -n "$STAGED_VERSION" ]] || fail "staged receipt has no version"
  epoch="$(receipt_field stagedAtEpoch)"
  [[ "$epoch" =~ ^[0-9]+$ ]] || fail "staged receipt has no numeric stagedAtEpoch"
  now="$(date +%s)"
  if (( now - epoch > STAGED_MAX_AGE_S )); then
    fail "staged candidate is stale (staged ${STAGED_MAX_AGE_S}s+ ago); rerun the stage step"
  fi
  if [[ ! -x "$STAGED_APP/Contents/MacOS/PipiUI Electron" ]]; then
    fail "staged App has no main executable"
  fi
  reject_symlink "$STAGED_APP/Contents/MacOS/PipiUI Electron" "staged main executable"
  reject_symlink "$STAGED_APP/Contents/Info.plist" "staged Info.plist"

  bundle_version="$("$PLUTIL_BIN" -extract CFBundleShortVersionString raw -o - "$STAGED_APP/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$bundle_version" == "$STAGED_VERSION" ]] || fail "staged bundle version '$bundle_version' does not match receipt version '$STAGED_VERSION'"
  archs="$("$LIPO_BIN" -archs "$STAGED_APP/Contents/MacOS/PipiUI Electron" 2>/dev/null || true)"
  [[ "$archs" == *"arm64"* ]] || fail "staged main executable is not arm64 (${archs:-unknown})"
  if ! "$CODESIGN_BIN" --verify --deep --strict --verbose=2 "$STAGED_APP"; then
    fail "staged App failed strict codesign verification"
  fi
  if ! cdhash="$(extract_codesign_cdhash "$STAGED_APP")"; then
    fail "could not read a valid CDHash for the staged App"
  fi
  receipt_cdhash="$(receipt_field app.cdhash)"
  codesign_cdhash="$(receipt_field codesign.cdhash)"
  [[ "$receipt_cdhash" =~ ^[0-9a-f]{64}$ ]] || fail "staged receipt has no valid app.cdhash"
  [[ "$codesign_cdhash" == "$receipt_cdhash" ]] || fail "receipt codesign.cdhash does not match app.cdhash"
  [[ "$cdhash" == "$receipt_cdhash" ]] || fail "live CDHash $cdhash does not match receipt CDHash $receipt_cdhash"

  exe_path="$(receipt_field app.mainExecutable.path)"
  exe_sha="$(receipt_field app.mainExecutable.sha256)"
  exe_bytes="$(receipt_field app.mainExecutable.bytes)"
  [[ "$exe_path" == "Contents/MacOS/PipiUI Electron" ]] || fail "receipt mainExecutable.path is '${exe_path:-missing}'"
  [[ "$exe_sha" =~ ^[0-9a-f]{64}$ ]] || fail "staged receipt has no valid main executable sha256"
  [[ "$exe_bytes" =~ ^[0-9]+$ ]] || fail "staged receipt has no numeric main executable bytes"
  [[ "$(sha256_file "$STAGED_APP/Contents/MacOS/PipiUI Electron")" == "$exe_sha" ]] \
    || fail "staged main executable hash does not match the receipt"
  [[ "$(stat -f %z "$STAGED_APP/Contents/MacOS/PipiUI Electron")" == "$exe_bytes" ]] \
    || fail "staged main executable size does not match the receipt"

  plist_path="$(receipt_field app.infoPlist.path)"
  plist_sha="$(receipt_field app.infoPlist.sha256)"
  [[ "$plist_path" == "Contents/Info.plist" ]] || fail "receipt infoPlist.path is '${plist_path:-missing}'"
  [[ "$plist_sha" =~ ^[0-9a-f]{64}$ ]] || fail "staged receipt has no valid Info.plist sha256"
  [[ "$(sha256_file "$STAGED_APP/Contents/Info.plist")" == "$plist_sha" ]] \
    || fail "staged Info.plist hash does not match the receipt"

  manifest_count="$(receipt_field app.extensionManifests.count)"
  manifest_agg="$(receipt_field app.extensionManifests.aggregateSha256)"
  [[ "$manifest_count" =~ ^[1-9][0-9]*$ ]] || fail "staged receipt has no valid extensionManifests.count"
  [[ "$manifest_agg" =~ ^[0-9a-f]{64}$ ]] || fail "staged receipt has no valid extensionManifests.aggregateSha256"
  actual_identity="$(extension_manifests_aggregate "$STAGED_APP")"
  read -r actual_agg actual_count <<< "$actual_identity"
  [[ "$actual_count" == "$manifest_count" ]] || fail "extension manifest count $actual_count does not match receipt $manifest_count"
  [[ "$actual_agg" == "$manifest_agg" ]] || fail "extension manifest aggregate does not match the receipt"

  office_target="$(receipt_field officecli.target)"
  office_sha="$(receipt_field officecli.sha256)"
  office_bytes="$(receipt_field officecli.bytes)"
  office_version="$(receipt_field officecli.version)"
  office_receipt_path="$(receipt_field officecli.receiptPath)"
  office_receipt_sha="$(receipt_field officecli.receiptSha256)"
  office_bin="$STAGED_APP/Contents/Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64/officecli"
  office_bundled_receipt="$(dirname "$office_bin")/receipt.json"
  [[ "$office_target" == "darwin-arm64" ]] || fail "staged receipt officecli target is '${office_target:-missing}', expected darwin-arm64"
  [[ "$office_sha" =~ ^[0-9a-f]{64}$ ]] || fail "staged receipt has no valid officecli sha256"
  [[ -n "$office_version" ]] || fail "staged receipt has no officecli version"
  [[ "$office_receipt_path" == "Contents/Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64/receipt.json" ]] \
    || fail "receipt officecli.receiptPath is '${office_receipt_path:-missing}'"
  [[ "$office_receipt_sha" =~ ^[0-9a-f]{64}$ ]] || fail "staged receipt has no valid officecli receiptSha256"
  reject_symlink "$office_bin" "bundled OfficeCLI binary"
  reject_symlink "$office_bundled_receipt" "bundled OfficeCLI receipt"
  [[ -x "$office_bin" && -f "$office_bundled_receipt" ]] || fail "staged App lacks the bundled darwin-arm64 OfficeCLI binary/receipt"
  bundled_target="$("$PLUTIL_BIN" -extract target raw -o - "$office_bundled_receipt" 2>/dev/null || true)"
  bundled_sha="$("$PLUTIL_BIN" -extract sha256 raw -o - "$office_bundled_receipt" 2>/dev/null || true)"
  bundled_version="$("$PLUTIL_BIN" -extract version raw -o - "$office_bundled_receipt" 2>/dev/null || true)"
  [[ "$bundled_target" == "darwin-arm64" ]] || fail "bundled OfficeCLI receipt target is '${bundled_target:-missing}'"
  [[ "$bundled_sha" == "$office_sha" ]] || fail "bundled OfficeCLI receipt hash does not match the staged receipt"
  [[ "$bundled_version" == "$office_version" ]] || fail "bundled OfficeCLI version '$bundled_version' does not match receipt version '$office_version'"
  [[ "$(sha256_file "$office_bundled_receipt")" == "$office_receipt_sha" ]] \
    || fail "bundled OfficeCLI receipt file hash does not match receiptSha256"
  actual_sha="$(sha256_file "$office_bin")"
  [[ "$actual_sha" == "$office_sha" ]] || fail "bundled OfficeCLI binary hash does not match the pinned sha256"
  receipt_bytes="$office_bytes"
  [[ "$receipt_bytes" =~ ^[0-9]+$ ]] || fail "staged receipt has no numeric officecli bytes"
  [[ "$(stat -f %z "$office_bin")" == "$receipt_bytes" ]] \
    || fail "bundled OfficeCLI size does not match receipt bytes $receipt_bytes"

  validate_artifact_inventory

  log "staged candidate validated: version=$STAGED_VERSION arch=arm64 cdhash=ok officecli=ok artifacts=4"
}

validate_generated_backup() {
  local backup_dir="$1"
  require_real_dir "$backup_dir" "generated backup"
  require_under "$backup_dir" "$PHYSICAL_BUILD" "generated backup"
  [[ "$(dirname "$backup_dir")" == "$PHYSICAL_BUILD" ]] \
    || fail "generated backup is not a direct child of the physical build directory: $backup_dir"
  [[ "$(basename "$backup_dir")" == .release-install-backup.* ]] \
    || fail "generated backup is not a .release-install-backup.* directory: $backup_dir"
}

# ---------------------------------------------------------------------- main
validate_install_paths

if [[ ! -e "$TRASH_DIR" ]]; then
  mkdir "$TRASH_DIR" || fail "could not create Trash directory: $TRASH_DIR"
fi
require_real_dir "$TRASH_DIR" "Trash directory"

log "install-electron-release-staged v$INSTALLER_VERSION root=$INSTALL_ROOT overwrite_running=$OVERWRITE_RUNNING no_relaunch=$NO_RELAUNCH test_mode=$INSTALLER_TEST_MODE"

validate_staged

revalidate_trusted_paths

was_running=0
if canonical_is_running; then
  was_running=1
  if [[ "$OVERWRITE_RUNNING" != "1" ]]; then
    fail "canonical App is running and --overwrite-running was not given; nothing was touched"
  fi
fi

if (( was_running )); then
  if ! stop_canonical_app; then
    fail "exact canonical processes did not exit; refusing to touch the live App bundle"
  fi
  if canonical_is_running; then
    fail "canonical PipiUI processes remain after shutdown; refusing to touch the live App bundle"
  fi
  log "canonical App stopped via $STOP_METHOD"
fi

revalidate_trusted_paths

backup_dir="$(mktemp -d "$BUILD_DIR/.release-install-backup.XXXXXX")"
if [[ -L "$backup_dir" ]]; then
  rmdir "$backup_dir" 2>/dev/null || true
  fail "generated backup is a symlink; refusing path substitution: $backup_dir"
fi
validate_generated_backup "$backup_dir"
had_canonical=0
if [[ -d "$CANONICAL_APP" ]]; then had_canonical=1; fi

if (( had_canonical )); then
  # The App is not running any more; only now may its bundle be moved.
  mv "$CANONICAL_APP" "$backup_dir/PipiUI Electron.app"
fi
if ! mv "$STAGED_APP" "$CANONICAL_APP"; then
  if (( had_canonical )); then
    if ! mv "$backup_dir/PipiUI Electron.app" "$CANONICAL_APP"; then
      fail "failed to move the staged candidate and failed to restore the previous App from $backup_dir/PipiUI Electron.app"
    fi
  fi
  rmdir "$backup_dir" 2>/dev/null || true
  fail "failed to move the staged candidate into the canonical path"
fi

rollback_to_previous() {
  ROLLBACK_PERFORMED=1
  ROLLBACK_RESTORED_FROM="$backup_dir/PipiUI Electron.app"
  FAILED_CANDIDATE="$BUILD_DIR/PipiUI Electron.release-install.failed.$(date +%Y%m%d-%H%M%S).app"
  if [[ -L "$FAILED_CANDIDATE" ]]; then
    log "ERROR: failed-candidate destination is a symlink; previous App remains at $ROLLBACK_RESTORED_FROM"
    return 1
  fi
  if ! mv "$CANONICAL_APP" "$FAILED_CANDIDATE"; then
    log "ERROR: could not park the failed candidate; previous App remains at $ROLLBACK_RESTORED_FROM"
    return 1
  fi
  if [[ -d "$backup_dir/PipiUI Electron.app" ]]; then
    if ! mv "$backup_dir/PipiUI Electron.app" "$CANONICAL_APP"; then
      log "ERROR: failed to restore previous App from $ROLLBACK_RESTORED_FROM; it remains there and the failed candidate is at $FAILED_CANDIDATE"
      return 1
    fi
  fi
  if [[ -d "$CANONICAL_APP" ]]; then
    register_canonical_only || true
  fi
  log "rolled back: previous App restored from backup; failed candidate retained at $FAILED_CANDIDATE"
  return 0
}

if ! "$CODESIGN_BIN" --verify --deep --strict --verbose=2 "$CANONICAL_APP"; then
  if rollback_to_previous; then
    INSTALL_STATUS="rolled_back"
    INSTALL_DETAIL="installed App failed strict codesign verification; previous App restored"
  else
    INSTALL_STATUS="failed"
    INSTALL_DETAIL="installed App failed strict codesign verification; restore of previous App failed"
  fi
  write_install_receipt
  if (( was_running )) && [[ "$NO_RELAUNCH" != "1" ]] && [[ -x "$CANONICAL_EXE" ]]; then
    relaunch_canonical_app || log "WARNING: previous App was restored but did not relaunch"
  fi
  log "ERROR: $INSTALL_DETAIL"
  exit 1
fi

if ! register_canonical_only; then
  if rollback_to_previous; then
    INSTALL_STATUS="rolled_back"
    INSTALL_DETAIL="LaunchServices did not accept the canonical registration; previous App restored"
  else
    INSTALL_STATUS="failed"
    INSTALL_DETAIL="LaunchServices did not accept the canonical registration; restore of previous App failed"
  fi
  write_install_receipt
  log "ERROR: $INSTALL_DETAIL"
  exit 1
fi

relaunch_note="not-requested"
if [[ "$NO_RELAUNCH" == "1" ]]; then
  relaunch_note="no-relaunch"
elif (( was_running )); then
  if relaunch_canonical_app; then
    RELAUNCH_PERFORMED=1
    relaunch_note="relaunched pid $RELAUNCH_PID"
  else
    if rollback_to_previous; then
      INSTALL_STATUS="rolled_back"
      INSTALL_DETAIL="replacement App did not launch from the canonical executable; previous App restored"
    else
      INSTALL_STATUS="failed"
      INSTALL_DETAIL="replacement App did not launch from the canonical executable; restore of previous App failed"
    fi
    write_install_receipt
    log "ERROR: $INSTALL_DETAIL"
    exit 1
  fi
fi

previous_app=""
if [[ -d "$backup_dir/PipiUI Electron.app" ]]; then
  reject_symlink "$TRASH_DIR" "Trash directory"
  previous_app="$TRASH_DIR/PipiUI Electron previous $(date +%Y%m%d-%H%M%S).app"
  if [[ -L "$previous_app" ]]; then
    fail "Trash destination is a symlink; previous App remains in $backup_dir"
  fi
  mv "$backup_dir/PipiUI Electron.app" "$previous_app"
  unregister_path "$previous_app"
fi
rmdir "$backup_dir" 2>/dev/null || true

INSTALL_STATUS="installed"
INSTALL_DETAIL="installed $STAGED_VERSION; relaunch: $relaunch_note"
write_install_receipt
log "installed $CANONICAL_APP (version $STAGED_VERSION, stop=$STOP_METHOD, relaunch=$relaunch_note)"
if [[ -n "$previous_app" ]]; then log "previous App moved to $previous_app"; fi
exit 0
