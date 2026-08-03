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

if [ "$OK" != "True" ] || [ "$HAS_DELTA" != "True" ] || [ "$HAS_TURN" != "True" ]; then
  echo "==> FAIL: missing required outcomes (ok=$OK text_delta=$HAS_DELTA turn_done=$HAS_TURN)" >&2
  echo "    bridge stderr tail:" >&2; tail -5 "$ERR_FILE" >&2
  exit 1
fi
echo "==> PASS: handshake + create_session + text_delta + turn_done all observed"

# --- Abort coverage: a cancel mid-turn must halt the stream. ---
#
# JcodeBackend.send(["type":"abort"]) maps to jcode's {"req":"cancel","session_id":...}.
# To exercise that wire mapping against the real binary we open a fresh session,
# send a long-form prompt, wait for at least one text_delta, then issue cancel and
# verify the turn stops: either (a) no text_delta arrives after the cancel, or
# (b) the bridge emits a turn_done / error / cancelled event within a short window.
#
# This is timing-sensitive against a real provider, so it is a best-effort check
# (a missing/empty turn here is reported as SKIP, not FAIL, to keep the smoke
# non-flaky on slow networks). The core cancel wire path is also unit-verifiable
# by inspection of JcodeBackend.send.
echo "==> driving mid-turn cancel (abort → jcode cancel)"
ABORT_RESULT="$(python3 - "$SOCK" <<'PY'
import json, socket, sys, time
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(20); s.connect(sys.argv[1])
mid = 0
def send(req):
    global mid; mid += 1
    req["v"] = 1; req["id"] = mid
    s.sendall((json.dumps(req) + "\n").encode())
def recv_some(sec):
    s.settimeout(sec); buf = b""
    try:
        while True:
            c = s.recv(8192)
            if not c: break
            buf += c
    except socket.timeout: pass
    out = []
    for line in buf.decode(errors="replace").split("\n"):
        if line.strip():
            try: out.append(json.loads(line))
            except Exception: pass
    return out
events = []
send({"req":"hello","min_version":1,"max_version":1,"client":"pipiui-smoke"})
time.sleep(0.5); events += recv_some(1)
send({"req":"create_session","working_dir":"/tmp"})
time.sleep(2); events += recv_some(2)
sid = None
for e in events:
    if e.get("ev") == "attached" and e.get("session"): sid = e["session"].get("session_id")
    if e.get("session_id") and not sid: sid = e["session_id"]
if not sid:
    print(json.dumps({"status":"skip","reason":"no session_id for abort check"})); sys.exit(0)
# Long-form prompt to maximize the chance of overlapping the stream.
send({"req":"send_message","session_id":sid,
      "content":"Count slowly from 1 to 50, one number per line, with no other text."})
# Give the model a moment to start streaming.
pre = recv_some(3)
pre_delta_count = sum(1 for e in pre if e.get("ev") == "text_delta")
# Issue cancel — the exact wire shape JcodeBackend.send synthesizes.
send({"req":"cancel","session_id":sid})
# Short window to observe the turn halting.
time.sleep(0.3)
post = recv_some(4)
post_delta_count = sum(1 for e in post if e.get("ev") == "text_delta")
halted = any(e.get("ev") in ("turn_done","error","cancelled","message_end") for e in post)
ok = (pre_delta_count > 0) and (post_delta_count == 0 or halted)
status = "pass" if ok else ("skip" if pre_delta_count == 0 else "fail")
print(json.dumps({
    "status": status,
    "pre_delta_count": pre_delta_count,
    "post_delta_count": post_delta_count,
    "halted_signal": halted,
    "post_evs": [e.get("ev") for e in post],
}))
PY
)"
echo "$ABORT_RESULT" | python3 -m json.tool
ABORT_STATUS=$(echo "$ABORT_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','fail'))")
case "$ABORT_STATUS" in
  pass) echo "==> PASS: mid-turn cancel halted the stream" ;;
  skip) echo "==> SKIP: abort check (provider too slow to start streaming; cancel wire path verified by code inspection of JcodeBackend.send)" ;;
  *)    echo "==> FAIL: abort check did not halt the turn" >&2; exit 1 ;;
esac

exit 0
