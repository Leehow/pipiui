#!/bin/bash
# Test (optional) then package build/PipiUI.app via make-app.sh
# See CONSTITUTION.md — 编译通过即打包.
set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/build-app.sh [--skip-tests]

  Runs swift test + the node gates (qoder 200K compat, main compaction),
  unless --skip-tests, then ./make-app.sh (release → build/PipiUI.app).

  Canonical ship path per CONSTITUTION.md. For debug-only iteration use: swift run
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
  # Node gate: qoder 200K context-window compat + main-session compaction
  # (real extension loaded through the installed pi runtime). A failure here
  # must block packaging just like a swift test failure.
  echo "==> node --test Tests/Node/test-qoder-context-window.mjs Tests/Node/test-main-compaction.mjs"
  if ! node --test \
    Tests/Node/test-qoder-context-window.mjs \
    Tests/Node/test-main-compaction.mjs; then
    echo "node tests failed; Re-run with --skip-tests to package without tests." >&2
    exit 1
  fi
else
  echo "==> skipping tests (--skip-tests)"
fi

echo "==> ./make-app.sh"
exec ./make-app.sh
