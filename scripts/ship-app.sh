#!/bin/bash
# The only supported installer for the canonical PipiUI application.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/ship-app.sh

Canonical release ship:
  1. Safety gate accepts main, codex/*, or integration/*.
  2. Requires a completely clean worktree (tracked and untracked files).
  3. Acquires a machine-wide, per-user atomic mkdir lock.
  4. Runs tests and creates worktree-local build/PipiUI.app.
  5. Installs /Applications/PipiUI.app.
  6. Verifies local/installed executable SHA-256 equality and timestamps.

Environment:
  PIPIUI_INSTALL_APP=/absolute/other/PipiUI.app
      Override the install destination (primarily for controlled validation).
  PIPIUI_SHIP_LOCK_DIR=/absolute/lock-directory
      Override the lock path (primarily for controlled validation).

There is intentionally no dirty-worktree, branch, test, or stale-lock override.
Never remove an existing lock unless its recorded owner has been investigated.

The shared green/staging workflow calls this only from clean release main after
an explicit integration/green -> main release merge. This script never performs
that merge.
EOF
}

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help)
      [[ $# -eq 1 ]] || { echo "ERROR: --help takes no other arguments" >&2; exit 2; }
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: run this command inside a Git worktree" >&2
  exit 1
}
cd "$REPO_ROOT"

BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || {
  echo "ERROR: detached HEAD cannot ship" >&2
  exit 1
}
case "$BRANCH" in
  main|codex/*|integration/*) ;;
  *)
    echo "ERROR: branch '$BRANCH' is not an integration ship branch" >&2
    echo "Allowed: main, codex/*, integration/*" >&2
    exit 1
    ;;
esac

WORKTREE_STATUS="$(git status --porcelain=v1 --untracked-files=all)"
if [[ -n "$WORKTREE_STATUS" ]]; then
  echo "ERROR: canonical ship requires a clean worktree (including untracked files)" >&2
  printf '%s\n' "$WORKTREE_STATUS" >&2
  exit 1
fi
START_HEAD="$(git rev-parse --verify HEAD)"

INSTALL_APP="${PIPIUI_INSTALL_APP:-/Applications/PipiUI.app}"
LOCK_DIR="${PIPIUI_SHIP_LOCK_DIR:-/tmp/pipiui-ship-${UID}.lock}"

if [[ "$INSTALL_APP" != /* || "$INSTALL_APP" != *.app ]]; then
  echo "ERROR: PIPIUI_INSTALL_APP must be an absolute .app path: '$INSTALL_APP'" >&2
  exit 2
fi
if [[ "$LOCK_DIR" != /* ]]; then
  echo "ERROR: PIPIUI_SHIP_LOCK_DIR must be an absolute path: '$LOCK_DIR'" >&2
  exit 2
fi
if [[ -L "$INSTALL_APP" ]]; then
  echo "ERROR: refusing to replace symlink install destination: $INSTALL_APP" >&2
  exit 1
fi
if [[ -e "$INSTALL_APP" && ! -d "$INSTALL_APP" ]]; then
  echo "ERROR: install destination exists but is not an app directory: $INSTALL_APP" >&2
  exit 1
fi

LOCK_OWNED=0
INSTALL_STAGE=""
INSTALL_BACKUP=""
PREVIOUS_MOVED=0
INSTALL_ACTIVATED=0
SHIP_VERIFIED=0

cleanup() {
  local exit_status=$?
  if [[ "$SHIP_VERIFIED" -eq 0 ]]; then
    if [[ "$INSTALL_ACTIVATED" -eq 1 ]]; then
      echo "Ship did not verify; rolling back the canonical install." >&2
      rm -rf "$INSTALL_APP"
    fi
    if [[ "$PREVIOUS_MOVED" -eq 1 && -n "$INSTALL_BACKUP" && -e "$INSTALL_BACKUP" && ! -e "$INSTALL_APP" ]]; then
      if ! mv "$INSTALL_BACKUP" "$INSTALL_APP"; then
        echo "ERROR: failed to restore previous application from $INSTALL_BACKUP" >&2
      fi
    fi
  elif [[ "$SHIP_VERIFIED" -eq 1 && -n "$INSTALL_BACKUP" && -e "$INSTALL_BACKUP" ]]; then
    rm -rf "$INSTALL_BACKUP"
  fi
  if [[ -n "$INSTALL_STAGE" && -d "$INSTALL_STAGE" ]]; then
    rm -rf "$INSTALL_STAGE"
  fi
  if [[ "$LOCK_OWNED" -eq 1 ]]; then
    rm -f "$LOCK_DIR/owner"
    if ! rmdir "$LOCK_DIR"; then
      echo "WARNING: could not release ship lock: $LOCK_DIR" >&2
      {
        echo "state=release-failed"
        echo "previous_pid=$$"
        echo "host=$(hostname)"
        echo "observed_utc=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        echo "worktree=$REPO_ROOT"
      } > "$LOCK_DIR/owner"
    fi
  fi
  return "$exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [[ -d "$LOCK_DIR" ]]; then
    echo "ERROR: canonical ship lock already exists: $LOCK_DIR" >&2
    if [[ -f "$LOCK_DIR/owner" ]]; then
      echo "Recorded owner:" >&2
      sed 's/^/  /' "$LOCK_DIR/owner" >&2
    else
      echo "No owner record is available. Investigate manually; the script will not delete it." >&2
    fi
  else
    echo "ERROR: could not create canonical ship lock: $LOCK_DIR" >&2
  fi
  exit 1
fi
LOCK_OWNED=1

{
  echo "pid=$$"
  echo "user=$(id -un)"
  echo "host=$(hostname)"
  echo "started_utc=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "branch=$BRANCH"
  echo "worktree=$REPO_ROOT"
  echo "install_app=$INSTALL_APP"
} > "$LOCK_DIR/owner"

echo "Canonical PipiUI ship"
echo "  branch:   $BRANCH"
echo "  worktree: $REPO_ROOT"
echo "  lock:     $LOCK_DIR"
echo "  install:  $INSTALL_APP"

./scripts/build-app.sh

if [[ "$(git rev-parse --verify HEAD)" != "$START_HEAD" ]]; then
  echo "ERROR: integration HEAD changed during ship; refusing to install" >&2
  exit 1
fi
WORKTREE_STATUS="$(git status --porcelain=v1 --untracked-files=all)"
if [[ -n "$WORKTREE_STATUS" ]]; then
  echo "ERROR: worktree changed during ship; refusing to install" >&2
  printf '%s\n' "$WORKTREE_STATUS" >&2
  exit 1
fi

LOCAL_APP="$REPO_ROOT/build/PipiUI.app"
LOCAL_BIN="$LOCAL_APP/Contents/MacOS/PipiUI"
if [[ ! -x "$LOCAL_BIN" ]]; then
  echo "ERROR: local packaged executable is missing: $LOCAL_BIN" >&2
  exit 1
fi

INSTALL_PARENT="$(dirname "$INSTALL_APP")"
INSTALL_NAME="$(basename "$INSTALL_APP")"
if [[ ! -d "$INSTALL_PARENT" || ! -w "$INSTALL_PARENT" ]]; then
  echo "ERROR: install parent is missing or not writable: $INSTALL_PARENT" >&2
  exit 1
fi

INSTALL_STAGE="$(mktemp -d "${INSTALL_PARENT}/.${INSTALL_NAME}.ship.XXXXXX")"
if command -v ditto >/dev/null 2>&1; then
  ditto "$LOCAL_APP" "$INSTALL_STAGE/$INSTALL_NAME"
else
  cp -R "$LOCAL_APP" "$INSTALL_STAGE/$INSTALL_NAME"
fi

INSTALL_BACKUP="${INSTALL_PARENT}/.${INSTALL_NAME}.previous.$$"
if [[ -e "$INSTALL_BACKUP" || -L "$INSTALL_BACKUP" ]]; then
  echo "ERROR: refusing to overwrite unexpected install backup path: $INSTALL_BACKUP" >&2
  exit 1
fi

if [[ -e "$INSTALL_APP" ]]; then
  mv "$INSTALL_APP" "$INSTALL_BACKUP"
  PREVIOUS_MOVED=1
fi
if ! mv "$INSTALL_STAGE/$INSTALL_NAME" "$INSTALL_APP"; then
  echo "ERROR: failed to activate installed application" >&2
  if [[ -e "$INSTALL_BACKUP" && ! -e "$INSTALL_APP" ]]; then
    mv "$INSTALL_BACKUP" "$INSTALL_APP"
    PREVIOUS_MOVED=0
    echo "Restored previous application." >&2
  fi
  exit 1
fi
INSTALL_ACTIVATED=1
rmdir "$INSTALL_STAGE"
INSTALL_STAGE=""

INSTALLED_BIN="$INSTALL_APP/Contents/MacOS/PipiUI"
if [[ ! -x "$INSTALLED_BIN" ]]; then
  echo "ERROR: installed executable is missing: $INSTALLED_BIN" >&2
  exit 1
fi

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo "ERROR: neither shasum nor sha256sum is available" >&2
    return 1
  fi
}

LOCAL_SHA="$(sha256_file "$LOCAL_BIN")"
INSTALLED_SHA="$(sha256_file "$INSTALLED_BIN")"
if [[ "$LOCAL_SHA" != "$INSTALLED_SHA" ]]; then
  echo "ERROR: installed binary SHA-256 does not match local package" >&2
  echo "  local:     $LOCAL_SHA" >&2
  echo "  installed: $INSTALLED_SHA" >&2
  exit 1
fi
SHIP_VERIFIED=1

echo "Installed and verified: $INSTALL_APP"
echo "SHA-256: $LOCAL_SHA"
stat -f 'Binary mtime: %Sm  %N' -t '%Y-%m-%d %H:%M:%S' "$LOCAL_BIN" "$INSTALLED_BIN"
echo "Open: open '$INSTALL_APP'"
