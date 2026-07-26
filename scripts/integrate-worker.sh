#!/bin/bash
# Serially merge one external IDE worker, then fully test/promote green.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/integrate-worker.sh \
    --branch <ai/codex/...|ai/claude/...|ai/cursor/...|ai/kimi/...|ai/qoder/...|ai/zcode/...>

Run only from the clean linked integration/staging worktree. Staging must equal
integration/green before accepting a worker. The script merges exactly one
external worker branch with --no-ff --no-edit, preserves that worker branch and
worktree, then calls promote-green.sh.

Hard lifecycle-owner precondition:
  integration/staging must have exactly one lifecycle owner at a time.
  Confirm no Boss child, auto-merge, post-merge verify, or recovery is active.
  Do not start/resume a Boss wave until this helper and promotion finish.
  The shell lock serializes helpers only; native MainRepoSerialQueue does not
  use it. This cross-runtime ownership handoff is intentionally not auto-detected.

PipiUI Boss native auto-merge never calls this helper. After a terminal Boss
wave with no active/recovery agent, post-merge verification, and clean staging,
the integration owner runs promote-green.sh.

On merge or test failure, staging is preserved for fixer/recovery and green/main
remain unchanged. The script never resets, reverts, cleans, deletes, or forces.
EOF
}

WORKER_BRANCH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      [[ $# -ge 2 ]] || { echo "ERROR: --branch requires a value" >&2; exit 2; }
      WORKER_BRANCH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$WORKER_BRANCH" ]]; then
  echo "ERROR: --branch is required" >&2
  usage >&2
  exit 2
fi
case "$WORKER_BRANCH" in
  ai/codex/*|ai/claude/*|ai/cursor/*|ai/kimi/*|ai/qoder/*|ai/zcode/*) ;;
  *)
    echo "ERROR: worker branch must be ai/codex/*, ai/claude/*, ai/cursor/*, ai/kimi/*, ai/qoder/*, or ai/zcode/*" >&2
    exit 2
    ;;
esac
if [[ "$WORKER_BRANCH" == *[[:space:]]* ]] ||
   ! git check-ref-format --branch "$WORKER_BRANCH" >/dev/null 2>&1; then
  echo "ERROR: unsafe worker branch name: '$WORKER_BRANCH'" >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: run this command inside a Git worktree" >&2
  exit 1
}
cd "$REPO_ROOT"

BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || {
  echo "ERROR: detached HEAD cannot integrate a worker" >&2
  exit 1
}
if [[ "$BRANCH" != "integration/staging" ]]; then
  echo "ERROR: integrate-worker requires integration/staging, found '$BRANCH'" >&2
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
  echo "ERROR: integrate-worker requires a clean worktree" >&2
  printf '%s\n' "$WORKTREE_STATUS" >&2
  exit 1
fi

GREEN_HEAD="$(git rev-parse --verify "refs/heads/integration/green^{commit}" 2>/dev/null)" || {
  echo "ERROR: integration/green does not exist" >&2
  exit 1
}
STAGING_HEAD="$(git rev-parse --verify HEAD)"
if [[ "$STAGING_HEAD" != "$GREEN_HEAD" ]]; then
  echo "ERROR: staging is not green; resolve/promote the existing candidate first" >&2
  echo "  green:   $GREEN_HEAD" >&2
  echo "  staging: $STAGING_HEAD" >&2
  exit 1
fi
GREEN_WORKTREE="$(
  git worktree list --porcelain |
    awk '
      $1 == "worktree" { path = substr($0, 10) }
      $1 == "branch" && $2 == "refs/heads/integration/green" { print path; exit }
    '
)"
if [[ -n "$GREEN_WORKTREE" ]]; then
  echo "ERROR: integration/green is checked out at: $GREEN_WORKTREE" >&2
  exit 1
fi

WORKER_HEAD="$(git rev-parse --verify "refs/heads/${WORKER_BRANCH}^{commit}" 2>/dev/null)" || {
  echo "ERROR: local worker branch does not exist: $WORKER_BRANCH" >&2
  exit 1
}
if git merge-base --is-ancestor "$WORKER_HEAD" "$STAGING_HEAD"; then
  echo "ERROR: worker branch is already contained in staging: $WORKER_BRANCH" >&2
  exit 1
fi

COMMON_DIR_RAW="$(git rev-parse --git-common-dir)"
COMMON_DIR="$(cd "$COMMON_DIR_RAW" 2>/dev/null && pwd -P)" || {
  echo "ERROR: could not resolve the common Git directory" >&2
  exit 1
}
# This lock serializes shell helpers only. It does not coordinate with PipiUI's
# native MainRepoSerialQueue; the human lifecycle-owner gate remains mandatory.
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
  echo "operation=integrate-worker"
  echo "pid=$$"
  echo "host=$(hostname)"
  echo "started_utc=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "worktree=$CURRENT_PHYSICAL"
  echo "worker_branch=$WORKER_BRANCH"
  echo "worker_head=$WORKER_HEAD"
  echo "expected_green=$GREEN_HEAD"
} > "$LOCK_DIR/owner"

# Recheck mutable state under the integration lock.
if [[ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" != "integration/staging" ||
      "$(git rev-parse --verify HEAD)" != "$STAGING_HEAD" ||
      "$(git rev-parse --verify refs/heads/integration/green)" != "$GREEN_HEAD" ||
      "$(git rev-parse --verify "refs/heads/${WORKER_BRANCH}")" != "$WORKER_HEAD" ]]; then
  echo "ERROR: integration refs changed before merge" >&2
  exit 1
fi
WORKTREE_STATUS="$(git status --porcelain=v1 --untracked-files=all)"
if [[ -n "$WORKTREE_STATUS" ]]; then
  echo "ERROR: staging changed before merge" >&2
  printf '%s\n' "$WORKTREE_STATUS" >&2
  exit 1
fi

echo "Merging external worker"
echo "  branch: $WORKER_BRANCH"
echo "  head:   $WORKER_HEAD"
git merge --no-ff --no-edit "$WORKER_BRANCH"

MERGE_HEAD="$(git rev-parse --verify HEAD)"
if [[ "$MERGE_HEAD" == "$STAGING_HEAD" ]]; then
  echo "ERROR: merge did not create a new staging commit" >&2
  exit 1
fi

# Release the merge lock before promote-green acquires it. At this point
# staging is ahead of green, so another integrate-worker invocation fails.
release_lock
trap - EXIT
LOCK_OWNED=0

exec ./scripts/promote-green.sh
