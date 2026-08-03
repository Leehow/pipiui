#!/usr/bin/env bash
# End-to-end smoke test for the jcode engine backend.
#
# Drives a REAL `jcode api-bridge`: hello handshake, create_session, send_message,
# and asserts that at least one text_delta and a turn_done arrive — proving the
# NDJSON transport, protocol envelope, and event stream all work against the
# real binary. Also validates the Plan B auth design by injecting pi's
# ~/.pi/agent/.env (so jcode can use the same API keys pi uses).
#
# NOT a CI test — requires jcode installed (~/.local/bin/jcode or PATH) and a
# provider reachable via the injected .env keys. Defaults to deepseek because
# the primary checkout's .env ships a DEEPSEEK_API_KEY; override with
# JCODE_SMOKE_PROVIDER + ensure the matching *_API_KEY is in the env/.env.
#
# Usage:
#   PATH="$HOME/.local/bin:$PATH" bash scripts/jcode-smoke-test.sh
#   JCODE_SMOKE_PROVIDER=deepseek bash scripts/jcode-smoke-test.sh
set -euo pipefail

PROVIDER="${JCODE_SMOKE_PROVIDER:-deepseek}"
JCODE_BIN="${JCODE_BIN:-jcode}"
DOTENV="$HOME/.pi/agent/.env"

# Verify jcode is reachable (the installer puts it at ~/.local/bin/jcode).
if ! command -v "$JCODE_BIN" >/dev/null 2>&1; then
  if [ -x "$HOME/.local/bin/jcode" ]; then
    JCODE_BIN="$HOME/.local/bin/jcode"
  else
    echo "FAIL: jcode binary not found (tried PATH and ~/.local/bin/jcode)" >&2
    echo "      install with: curl -fsSL https://jcode.sh/install | bash" >&2
    exit 2
  fi
fi

# Load pi's .env so jcode inherits the same API keys (Plan B auth design).
ENV_ARGS=()
if [ -f "$DOTENV" ]; then
  # Source into the environment for the jcode subprocess only.
  set -a
  # shellcheck disable=SC1090
  . "$DOTENV"
  set +a
fi

SOCK="$(mktemp -u "${TMPDIR:-/tmp}/jcode-smoke-XXXXXX.sock")"
rm -f "$SOCK"
ERR_FILE="$(mktemp)"

cleanup() {
  [ -n "${BRIDGE_PID:-}" ] && kill "$BRIDGE_PID" 2>/dev/null || true
  rm -f "$SOCK" "$ERR_FILE"
}
trap cleanup EXIT

echo "==> starting jcode api-bridge (provider=$PROVIDER, socket=$SOCK)"
"$JCODE_BIN" api-bridge --api-socket "$SOCK" --provider "$PROVIDER" --quiet --no-update 2>"$ERR_FILE" &
BRIDGE_PID=$!

# Wait up to 30s for the socket to appear.
for _ in $(seq 1 60); do
  [ -S "$SOCK" ] && break
  sleep 0.5
done
if [ ! -S "$SOCK" ]; then
  echo "FAIL: api-bridge socket never appeared. stderr:" >&2
  cat "$ERR_FILE" >&2
  exit 1
fi

echo "==> driving handshake + create_session + send_message"
RESULT="$(python3 - "$SOCK" <<'PY'
import json, socket, sys, time
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(20)
s.connect(sys.argv[1])
mid = 0; events = []
def send(req):
    global mid; mid += 1
    req["v"] = 1; req["id"] = mid
    s.sendall((json.dumps(req) + "\n").encode())
def drain(sec):
    s.settimeout(sec); buf = b""
    try:
        while True:
            c = s.recv(8192)
            if not c: break
            buf += c
    except socket.timeout: pass
    for line in buf.decode(errors="replace").split("\n"):
        if line.strip():
            try: events.append(json.loads(line))
            except Exception: pass
send({"req":"hello","min_version":1,"max_version":1,"client":"pipiui-smoke"})
time.sleep(1); drain(1)
send({"req":"create_session","working_dir":"/tmp"})
time.sleep(2); drain(2)
sid = None
for e in events:
    if e.get("ev") == "attached" and e.get("session"): sid = e["session"].get("session_id")
    if e.get("session_id") and not sid: sid = e["session_id"]
if not sid:
    print(json.dumps({"ok": False, "reason": "no session_id", "events": [e.get("ev") for e in events]}))
    sys.exit(0)
send({"req":"send_message","session_id":sid,"content":"Reply with exactly the word pong and nothing else."})
time.sleep(1); drain(30)
text = "".join(e.get("text","") for e in events if e.get("ev")=="text_delta")
counts = {}
for e in events:
    k = e.get("ev","?"); counts[k] = counts.get(k,0)+1
print(json.dumps({
    "ok": True,
    "session_id": sid,
    "event_counts": counts,
    "has_text_delta": counts.get("text_delta",0) > 0,
    "has_turn_done": counts.get("turn_done",0) > 0,
    "text": text[:200],
}))
PY
)"
echo "$RESULT" | python3 -m json.tool

# Assert the load-bearing outcomes.
OK=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok', False))")
HAS_DELTA=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('has_text_delta', False))")
HAS_TURN=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('has_turn_done', False))")

if [ "$OK" = "True" ] && [ "$HAS_DELTA" = "True" ] && [ "$HAS_TURN" = "True" ]; then
  echo "==> PASS: handshake + create_session + text_delta + turn_done all observed"
  exit 0
else
  echo "==> FAIL: missing required outcomes (ok=$OK text_delta=$HAS_DELTA turn_done=$HAS_TURN)" >&2
  echo "    bridge stderr tail:" >&2; tail -5 "$ERR_FILE" >&2
  exit 1
fi
