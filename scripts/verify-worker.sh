#!/bin/bash
# Worker-safe verification: debug tests by default, optional local preview.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/verify-worker.sh [--package-preview]

Valid branches:
  ai/*
  pipiui/agent-*

The current workspace must be a genuine linked worktree; the primary checkout
is rejected even if it is manually switched to a worker-named branch.

Default:
  Runs swift test (real debug compile + tests, never lint/diff-only). It does
  not run make-app.sh or create a release App package.

Options:
  --package-preview  Run tests, then create worktree-local build/PipiUI.app.

/Applications is never modified.
EOF
}

PACKAGE_PREVIEW=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --package-preview)
      PACKAGE_PREVIEW=1
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
  echo "External IDEs use new-ai-worktree.sh; PipiUI Boss uses its native extension." >&2
  exit 1
fi

echo "Worker verification"
echo "  branch:   $BRANCH"
echo "  worktree: $CURRENT_PHYSICAL"
echo "  install:  disabled"

if [[ "$PACKAGE_PREVIEW" -eq 1 ]]; then
  echo "  mode:     test + local release package"
  echo "  output:   $CURRENT_PHYSICAL/build/PipiUI.app"
  exec ./scripts/build-app.sh
else
  echo "  mode:     swift test (real debug compile + tests; no release package)"
  echo "  output:   $CURRENT_PHYSICAL/.build/"
  exec swift test
fi
