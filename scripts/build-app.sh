#!/bin/bash
# Test (optional) then package the worktree-local build/PipiUI.app.
# This script never installs /Applications/PipiUI.app.
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/build-app.sh [--skip-tests]

  Runs swift test (unless --skip-tests), then ./make-app.sh
  (release → worktree-local build/PipiUI.app).

  This is worker-safe and never writes /Applications.
  For canonical integration delivery use: ./scripts/ship-app.sh
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

if [[ "$SKIP_TESTS" -eq 0 ]]; then
  echo "==> swift test"
  if ! swift test; then
    echo "swift test failed; if XCTest is unavailable try: swift run PipiUITestRunner" >&2
    echo "Re-run with --skip-tests to package without tests." >&2
    exit 1
  fi
else
  echo "==> skipping tests (--skip-tests)"
fi

echo "==> ./make-app.sh"
exec ./make-app.sh
