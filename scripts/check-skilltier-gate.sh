#!/bin/bash
# Functional check for the weak-model dispatch gate in SkillTierExtension.swift.
#
# The gate can block the user's own workflow if it misfires, and its logic lives in a
# TypeScript string literal that `swift test` can only inspect structurally. This script
# extracts the real extension source and drives its handlers directly under node, with no
# API call and no pi process.
#
#   ./scripts/check-skilltier-gate.sh
#
# Requires node >= 22.6 (uses --experimental-strip-types).
set -e

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

python3 - "$root" "$work" <<'PY'
import re, sys, pathlib
root, work = sys.argv[1], sys.argv[2]
src = pathlib.Path(root, "Sources/PipiUI/SkillTierExtension.swift").read_text(encoding="utf-8")
ts = re.search(r'#"""\n(.*?)\n"""#', src, re.S).group(1)
pathlib.Path(work, "skilltier.ts").write_text(ts, encoding="utf-8")
PY

echo '{"weakModels":["test-provider/weak-model"]}' > "$work/tiers.json"

cat > "$work/gate-test.ts" <<'EOF'
import ext from "./skilltier.ts";

const fresh = () => {
  const h: Record<string, any[]> = {};
  ext({ on: (ev: string, fn: any) => { (h[ev] ||= []).push(fn); } } as any);
  return { toolCall: h["tool_call"][0], beforeStart: h["before_agent_start"][0] };
};

const WEAK = { model: { provider: "test-provider", id: "weak-model" } };
const STRONG = { model: { provider: "test-provider", id: "strong-model" } };
const dispatch = { toolName: "subagent", input: { agent: "general-purpose", task: "x" } };
const skillRead = { toolName: "read", input: { path: "/x/skills/writing-plans/SKILL.md" } };
const plainRead = { toolName: "read", input: { path: "/x/src/main.swift" } };
const blocked = (r: any) => r?.block === true;

const results: [string, boolean][] = [];

const a = fresh();
results.push(["weak model blocks the first dispatch", blocked(a.toolCall(dispatch, WEAK))]);
results.push(["...and never blocks a second time", !blocked(a.toolCall(dispatch, WEAK))]);

const b = fresh();
b.toolCall(plainRead, WEAK);
results.push(["an ordinary read is not a skill read", blocked(b.toolCall(dispatch, WEAK))]);

const c = fresh();
c.toolCall(skillRead, WEAK);
results.push(["a skill read opens the gate", !blocked(c.toolCall(dispatch, WEAK))]);

const d = fresh();
results.push(["strong model is never gated", !blocked(d.toolCall(dispatch, STRONG))]);

const e = fresh();
const once = e.beforeStart({ systemPrompt: "SYSTEM" }, STRONG);
results.push(["strong tier text injected", String(once?.systemPrompt).includes("Superpowers (reference)")]);
results.push(["append is idempotent", e.beforeStart({ systemPrompt: once.systemPrompt }, STRONG) === undefined]);
results.push([
  "weak tier text injected",
  String(fresh().beforeStart({ systemPrompt: "SYSTEM" }, WEAK)?.systemPrompt)
    .includes("Superpowers (mandatory for this model)"),
]);

let ok = true;
for (const [name, pass] of results) {
  if (!pass) ok = false;
  console.log((pass ? "  PASS  " : "  FAIL  ") + name);
}
process.exit(ok ? 0 : 1);
EOF

echo "skilltier gate:"
PIPIUI_MODEL_TIERS_FILE="$work/tiers.json" \
  node --experimental-strip-types --disable-warning=ExperimentalWarning "$work/gate-test.ts"
