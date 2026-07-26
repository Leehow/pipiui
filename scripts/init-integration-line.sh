#!/bin/bash
# Initialize the shared green/staging integration line from one committed base.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/init-integration-line.sh \
    --base <committed-ref> \
    [--worktree-root <absolute-path> | --path <absolute-staging-path>]

Creates:
  integration/green    latest fully tested shared head (not checked out)
  integration/staging  merge/test candidate in a dedicated linked worktree

Defaults:
  The staging worktree path is:
  <primary-repo-parent>/<primary-repo-name>-wt/integration-staging

The current checkout may be dirty. Only the explicit committed --base is used;
uncommitted caller changes are never copied.
EOF
}

BASE=""
WORKTREE_ROOT=""
STAGING_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      [[ $# -ge 2 ]] || { echo "ERROR: --base requires a value" >&2; exit 2; }
      BASE="$2"
      shift 2
      ;;
    --worktree-root)
      [[ $# -ge 2 ]] || { echo "ERROR: --worktree-root requires a value" >&2; exit 2; }
      WORKTREE_ROOT="$2"
      shift 2
      ;;
    --path)
      [[ $# -ge 2 ]] || { echo "ERROR: --path requires a value" >&2; exit 2; }
      STAGING_PATH="$2"
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

if [[ -z "$BASE" ]]; then
  echo "ERROR: --base is required" >&2
  usage >&2
  exit 2
fi
if [[ -n "$WORKTREE_ROOT" && -n "$STAGING_PATH" ]]; then
  echo "ERROR: use only one of --worktree-root or --path" >&2
  exit 2
fi
if [[ "$BASE" == -* || "$BASE" == *[[:space:]]* ]]; then
  echo "ERROR: --base may not start with '-' or contain whitespace: '$BASE'" >&2
  exit 2
fi
if [[ -n "$WORKTREE_ROOT" && "$WORKTREE_ROOT" != /* ]]; then
  echo "ERROR: --worktree-root must be an absolute path" >&2
  exit 2
fi
if [[ "$WORKTREE_ROOT" == "/" ]]; then
  echo "ERROR: --worktree-root may not be filesystem root" >&2
  exit 2
fi
if [[ -n "$STAGING_PATH" && "$STAGING_PATH" != /* ]]; then
  echo "ERROR: --path must be an absolute path" >&2
  exit 2
fi

CALLER_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: run this command inside a Git worktree" >&2
  exit 1
}
PRIMARY_ROOT="$(
  git worktree list --porcelain |
    awk '$1 == "worktree" { print substr($0, 10); exit }'
)"
if [[ -z "$PRIMARY_ROOT" ]]; then
  echo "ERROR: could not determine the primary Git worktree" >&2
  exit 1
fi

BASE_COMMIT="$(git rev-parse --verify "${BASE}^{commit}" 2>/dev/null)" || {
  echo "ERROR: --base '$BASE' does not resolve to a committed Git object" >&2
  exit 1
}

for branch in integration/green integration/staging; do
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    echo "ERROR: local branch already exists: $branch" >&2
    exit 1
  fi
done

if [[ -z "$STAGING_PATH" ]]; then
  if [[ -z "$WORKTREE_ROOT" ]]; then
    PRIMARY_PARENT="$(dirname "$PRIMARY_ROOT")"
    PRIMARY_NAME="$(basename "$PRIMARY_ROOT")"
    WORKTREE_ROOT="${PRIMARY_PARENT}/${PRIMARY_NAME}-wt"
  fi
  STAGING_PATH="${WORKTREE_ROOT}/integration-staging"
fi

if [[ "$STAGING_PATH" == "/" || -e "$STAGING_PATH" || -L "$STAGING_PATH" ]]; then
  echo "ERROR: staging worktree path is unsafe or already exists: $STAGING_PATH" >&2
  exit 1
fi

mkdir -p "$(dirname "$STAGING_PATH")"

git update-ref "refs/heads/integration/green" "$BASE_COMMIT" ""
if ! git worktree add -b integration/staging "$STAGING_PATH" "$BASE_COMMIT"; then
  echo "ERROR: failed to create integration/staging worktree" >&2
  if ! git show-ref --verify --quiet refs/heads/integration/staging; then
    git update-ref -d refs/heads/integration/green "$BASE_COMMIT"
  else
    echo "integration/green was retained because staging state needs inspection." >&2
  fi
  exit 1
fi

echo
echo "Integration line ready"
echo "  caller:  $CALLER_ROOT"
echo "  base:    $BASE ($BASE_COMMIT)"
echo "  green:   integration/green"
echo "  staging: integration/staging"
echo "  path:    $STAGING_PATH"
echo
echo "Open PipiUI Boss with this project root:"
echo "  $STAGING_PATH"
echo
echo "Start external tasks from: --base integration/green"
