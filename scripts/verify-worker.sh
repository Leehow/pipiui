#!/bin/bash
# Worker-safe verification: tests + worktree-local release app package.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/verify-worker.sh [--skip-tests]

Valid branches:
  ai/*
  pipiui/agent-*

The current workspace must be a genuine linked worktree; the primary checkout
is rejected even if it is manually switched to a worker-named branch.

Runs ./scripts/build-app.sh in that linked worktree. The resulting
build/PipiUI.app is local to it; /Applications is never modified.
Use --skip-tests only when the handoff explicitly records why tests were not run.
EOF
}

ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests)
      ARGS+=("--skip-tests")
      shift
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

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: run this command inside a Git worktree" >&2
  exit 1
}
cd "$REPO_ROOT"

BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || {
  echo "ERROR: detached HEAD is not a valid worker workspace" >&2
  exit 1
}

case "$BRANCH" in
  ai/*|pipiui/agent-*) ;;
  *)
    echo "ERROR: '$BRANCH' is not a worker branch (expected ai/* or pipiui/agent-*)" >&2
    echo "Use ./scripts/new-ai-worktree.sh to create an isolated worker workspace." >&2
    exit 1
    ;;
esac

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
  echo "ERROR: worker verification is forbidden in the primary checkout: $PRIMARY_PHYSICAL" >&2
  echo "Use ./scripts/new-ai-worktree.sh and run verification in its linked worktree." >&2
  exit 1
fi

echo "Worker verification"
echo "  branch:   $BRANCH"
echo "  worktree: $CURRENT_PHYSICAL"
echo "  output:   $CURRENT_PHYSICAL/build/PipiUI.app"
echo "  install:  disabled"

if [[ "${#ARGS[@]}" -gt 0 ]]; then
  exec ./scripts/build-app.sh "${ARGS[@]}"
else
  exec ./scripts/build-app.sh
fi
