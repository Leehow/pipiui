#!/bin/bash
# Create one isolated branch + linked worktree for an external coding tool.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/new-ai-worktree.sh \
    --tool <codex|claude|cursor|kimi|qoder|zcode> \
    --work-id <slug> \
    --topic <slug> \
    --base <committed-ref> \
    [--worktree-root <absolute-path>]

Examples:
  ./scripts/new-ai-worktree.sh \
    --tool codex --work-id settings --topic sidebar --base integration/green

Branches:
  ai/<tool>/<work-id>-<topic>

PipiUI Boss subagents are not supported by this helper. Its native extension
exclusively owns their worktrees, pipiui/* branches, verification, and merge.

The default worktree root is a sibling of the primary checkout:
  <primary-repo-parent>/<primary-repo-name>-wt/

The current checkout may be dirty. The new worktree always starts from the
explicit committed --base ref; uncommitted changes are never copied.

Normal tasks should use --base integration/green. The base remains explicit so
the caller always chooses the exact shared head intentionally.
EOF
}

TOOL=""
WORK_ID=""
TOPIC=""
BASE=""
WORKTREE_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool)
      [[ $# -ge 2 ]] || { echo "ERROR: --tool requires a value" >&2; exit 2; }
      TOOL="$2"
      shift 2
      ;;
    --work-id)
      [[ $# -ge 2 ]] || { echo "ERROR: --work-id requires a value" >&2; exit 2; }
      WORK_ID="$2"
      shift 2
      ;;
    --topic)
      [[ $# -ge 2 ]] || { echo "ERROR: --topic requires a value" >&2; exit 2; }
      TOPIC="$2"
      shift 2
      ;;
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

for required in TOOL WORK_ID TOPIC BASE; do
  if [[ -z "${!required}" ]]; then
    echo "ERROR: --$(printf '%s' "$required" | tr '[:upper:]_' '[:lower:]-') is required" >&2
    usage >&2
    exit 2
  fi
done

case "$TOOL" in
  codex|claude|cursor|kimi|qoder|zcode) ;;
  *)
    echo "ERROR: unsupported --tool '$TOOL' (expected codex, claude, cursor, kimi, qoder, or zcode)" >&2
    exit 2
    ;;
esac

validate_slug() {
  local label="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || [[ "$value" == *..* ]] || [[ "$value" == *--* ]]; then
    echo "ERROR: $label must match [a-z0-9][a-z0-9._-]* and may not contain '..' or '--': '$value'" >&2
    exit 2
  fi
}

validate_slug "work-id" "$WORK_ID"
validate_slug "topic" "$TOPIC"
if [[ "$BASE" == -* || "$BASE" == *[[:space:]]* ]]; then
  echo "ERROR: --base may not start with '-' or contain whitespace: '$BASE'" >&2
  exit 2
fi

CURRENT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: run this command inside a PipiUI Git worktree" >&2
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

BRANCH="ai/${TOOL}/${WORK_ID}-${TOPIC}"
if ! git check-ref-format --branch "$BRANCH" >/dev/null 2>&1; then
  echo "ERROR: generated branch name is not a valid Git ref: $BRANCH" >&2
  exit 2
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "ERROR: local branch already exists: $BRANCH" >&2
  exit 1
fi

if [[ -z "$WORKTREE_ROOT" ]]; then
  PRIMARY_PARENT="$(dirname "$PRIMARY_ROOT")"
  PRIMARY_NAME="$(basename "$PRIMARY_ROOT")"
  WORKTREE_ROOT="${PRIMARY_PARENT}/${PRIMARY_NAME}-wt"
elif [[ "$WORKTREE_ROOT" != /* ]]; then
  echo "ERROR: --worktree-root must be an absolute path" >&2
  exit 2
fi

WORKTREE_PATH="${WORKTREE_ROOT}/${TOOL}-${WORK_ID}-${TOPIC}"
if [[ -e "$WORKTREE_PATH" || -L "$WORKTREE_PATH" ]]; then
  echo "ERROR: worktree path already exists: $WORKTREE_PATH" >&2
  exit 1
fi

mkdir -p "$WORKTREE_ROOT"

echo "Creating isolated AI worktree"
echo "  caller:  $CURRENT_ROOT"
echo "  base:    $BASE ($BASE_COMMIT)"
echo "  branch:  $BRANCH"
echo "  path:    $WORKTREE_PATH"
git worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_COMMIT"

echo
echo "Ready:"
echo "  cd '$WORKTREE_PATH'"
echo "  ./scripts/verify-worker.sh"
