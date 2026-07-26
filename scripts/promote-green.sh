#!/bin/bash
# Fully test integration/staging, then atomically advance integration/green.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/promote-green.sh

Run only from the clean linked worktree on integration/staging.

The script:
  1. Requires integration/green to be an unchecked-out ancestor of staging.
  2. Runs full swift test with no skip/bypass.
  3. Rechecks branch, HEAD, and cleanliness.
  4. Atomically advances integration/green using the exact old SHA.

It never changes main, packages an App, installs /Applications, resets, cleans,
or removes a failed staging worktree.
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
  echo "ERROR: detached HEAD cannot promote green" >&2
  exit 1
}
if [[ "$BRANCH" != "integration/staging" ]]; then
  echo "ERROR: promote-green requires integration/staging, found '$BRANCH'" >&2
  exit 1
fi

PRIMARY_ROOT="$(
  git worktree list --porcelain |
    awk '$1 == "worktree" { print substr($0, 10); exit }'
)"
if [[ -z "$PRIMARY_ROOT" ]]; then
  echo "ERROR: could not determine the primary Git worktree" >&2
  exit 1
fi
CURRENT_PHYSICAL="$(pwd -P)"
PRIMARY_PHYSICAL="$(cd "$PRIMARY_ROOT" 2>/dev/null && pwd -P)" || {
  echo "ERROR: primary Git worktree is unavailable: $PRIMARY_ROOT" >&2
  exit 1
}
if [[ "$CURRENT_PHYSICAL" == "$PRIMARY_PHYSICAL" ]]; then
  echo "ERROR: integration/staging must use a linked worktree, not the primary checkout" >&2
  exit 1
fi

WORKTREE_STATUS="$(git status --porcelain=v1 --untracked-files=all)"
if [[ -n "$WORKTREE_STATUS" ]]; then
  echo "ERROR: promote-green requires a clean worktree" >&2
  printf '%s\n' "$WORKTREE_STATUS" >&2
  exit 1
fi

OLD_GREEN="$(git rev-parse --verify "refs/heads/integration/green^{commit}" 2>/dev/null)" || {
  echo "ERROR: integration/green does not exist" >&2
  exit 1
}
STAGING_HEAD="$(git rev-parse --verify HEAD)"

if ! git merge-base --is-ancestor "$OLD_GREEN" "$STAGING_HEAD"; then
  echo "ERROR: integration/green is not an ancestor of staging HEAD" >&2
  exit 1
fi

green_worktree_path() {
  git worktree list --porcelain |
    awk '
      $1 == "worktree" { path = substr($0, 10) }
      $1 == "branch" && $2 == "refs/heads/integration/green" { print path; exit }
    '
}

GREEN_WORKTREE="$(green_worktree_path)"
if [[ -n "$GREEN_WORKTREE" ]]; then
  echo "ERROR: integration/green is checked out at: $GREEN_WORKTREE" >&2
  exit 1
fi

COMMON_DIR_RAW="$(git rev-parse --git-common-dir)"
COMMON_DIR="$(cd "$COMMON_DIR_RAW" 2>/dev/null && pwd -P)" || {
  echo "ERROR: could not resolve the common Git directory" >&2
  exit 1
}
LOCK_DIR="$COMMON_DIR/pipiui-integration-line.lock"
LOCK_OWNED=0

release_lock() {
  local exit_status=$?
  if [[ "$LOCK_OWNED" -eq 1 ]]; then
    rm -f "$LOCK_DIR/owner"
    if ! rmdir "$LOCK_DIR"; then
      echo "WARNING: could not release integration lock: $LOCK_DIR" >&2
    fi
  fi
  return "$exit_status"
}
trap release_lock EXIT

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "ERROR: integration operation already locked: $LOCK_DIR" >&2
  if [[ -f "$LOCK_DIR/owner" ]]; then
    sed 's/^/  /' "$LOCK_DIR/owner" >&2
  fi
  exit 1
fi
LOCK_OWNED=1
{
  echo "operation=promote-green"
  echo "pid=$$"
  echo "host=$(hostname)"
  echo "started_utc=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "worktree=$CURRENT_PHYSICAL"
  echo "staging_head=$STAGING_HEAD"
  echo "expected_green=$OLD_GREEN"
} > "$LOCK_DIR/owner"

# Recheck mutable preconditions under the integration lock.
if [[ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" != "integration/staging" ||
      "$(git rev-parse --verify HEAD)" != "$STAGING_HEAD" ||
      "$(git rev-parse --verify refs/heads/integration/green)" != "$OLD_GREEN" ]]; then
  echo "ERROR: integration refs changed before testing" >&2
  exit 1
fi
WORKTREE_STATUS="$(git status --porcelain=v1 --untracked-files=all)"
if [[ -n "$WORKTREE_STATUS" ]]; then
  echo "ERROR: staging changed before testing" >&2
  printf '%s\n' "$WORKTREE_STATUS" >&2
  exit 1
fi

echo "Testing integration/staging"
echo "  green:   $OLD_GREEN"
echo "  staging: $STAGING_HEAD"
echo "==> swift test"
swift test

if [[ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" != "integration/staging" ]]; then
  echo "ERROR: branch changed during integration test" >&2
  exit 1
fi
if [[ "$(git rev-parse --verify HEAD)" != "$STAGING_HEAD" ]]; then
  echo "ERROR: staging HEAD changed during integration test" >&2
  exit 1
fi
WORKTREE_STATUS="$(git status --porcelain=v1 --untracked-files=all)"
if [[ -n "$WORKTREE_STATUS" ]]; then
  echo "ERROR: staging worktree changed during integration test" >&2
  printf '%s\n' "$WORKTREE_STATUS" >&2
  exit 1
fi
GREEN_WORKTREE="$(green_worktree_path)"
if [[ -n "$GREEN_WORKTREE" ]]; then
  echo "ERROR: integration/green was checked out during integration test: $GREEN_WORKTREE" >&2
  exit 1
fi

git update-ref refs/heads/integration/green "$STAGING_HEAD" "$OLD_GREEN"

echo "Promoted integration/green"
echo "  old: $OLD_GREEN"
echo "  new: $STAGING_HEAD"
echo "main was not changed."
