# Retrieval evaluation (remediation wave)

Read-only evaluation surface for the code-retrieval extension. This directory is
the only place the evaluator lives; it is development tooling and is excluded
from production packaging concerns by construction (it never registers itself —
it *drives* the registered tools).

## What changed in the remediation wave

Reviewer findings (`retrieval-behavior`, `retrieval-review-safety`) mapped to fixes:

| Finding | Fix |
|---|---|
| Eval could SIGTERM a shared/pre-existing sidecar | `eval-lib/ownership.mjs`: detach-only cleanup. No `process.kill` anywhere; spawned sidecars idle-exit. Decision logic pinned by `eval-tests/ownership.test.mjs`. |
| Snapshot-diff deletion could remove other sessions' files | `eval-lib/result-files.mjs` `ResultFileTracker`: only exact `details.resultsPath` values returned to THIS run are deleted; pre-existing names are refused even if re-created mid-run. |
| JSON exported raw attribution call arrays | `eval-lib/trace-classify.mjs` + `sanitizeValue/toBoundedJson`: aggregates, redacted keys (`bearer/apiKey/authorization/token…`), string/array caps. No `calls[]` key exists at all. |
| Adjacency across globally interleaved runs | `eval-lib/adjacency.mjs`: pairs counted strictly within `(sessionId, runId)` episodes; the count of cross-episode pairs a global sort WOULD have added is reported for honest reconciliation. |
| Budget/stale-gold printed but not enforced | `eval-lib/gates.mjs`: stale anchors are excluded from all denominators AND fail the run; preview violations are enforced per rendered block (≤6 lines, ≤1000 tok/block) plus an INDEPENDENT fixed aggregate cap per result — the SUM of all block tokens must stay ≤1000 regardless of each block's size or any self-reported footer numerator/denominator (a missing, understated, or inflated "~1200/4000" footer cannot mask an over-budget result) — and fail the run. Exit code 1 on FAIL. |
| Self-referential optimization-file corpus | `retrieval-eval-cases.mjs`: 20 cases grounded in measured production task shapes (pdf-plugin-recon read×86, office gate, closeout/secretary, browser guard, UI busy cut-in, provider manifest truth, secret vault, npm proxy deadlock, packaging runtime-target, constitution slug rule, CJK recon layer, telemetry). Pinned by `eval-tests/cases.test.mjs`. |
| Evaluator faked its own repo_map renderer | The runner installs the real extension entry (`dist/index.js`) against a capturing ExtensionAPI and executes the REGISTERED handlers exactly as sessions do. `eval-tests/map-tool.test.mjs` additionally drives the compiled `executeRepoMap` shared implementation, asserting inline previews, ≤6-line blocks, stable R# continuation and ledger marking of the shown window. |
| Live reduction claims | Report still states verbatim: live ≥30% grep+read and ≥20% descriptive call-reduction targets remain **unproven** until matched live traffic replays them. |

## Run

```bash
cd Electron/
npm run build:code-retrieval        # required first; eval fails loudly on stale dist
node resources/runtime/extensions/code-retrieval/agent/eval/run-retrieval-eval.mjs \
     [--json /tmp/report.json] [--attribution-since ISO] [--require-map-previews]
```

Deterministic unit coverage (no network, no sidecars, no symbol extraction):

```bash
node --test resources/runtime/extensions/code-retrieval/agent/eval/eval-tests/
```

## Safety contract while running

- Existing sidecars on this machine (including user sessions') are leased via
  attach/detach or merely pinged. They are never signaled.
- A sidecar whose PID appeared during the run cannot be proven ours from
  outside; it is treated as unowned and left to its own idle expiry (spawned
  probe sidecars get `idleMs: 15s`).
- Result/index writes happen only inside `.pi/agent/code-retrieval/results/`
  under the project home; every written file this run received is recorded and
  removed at exit unless it existed before the run started.
- Forced-fallback honesty probing skips (never manufactures unsafe states) when
  a shared tantivy sidecar is currently serving.

## Files

- `run-retrieval-eval.mjs` — runner (drives real registered tool handlers)
- `retrieval-eval-cases.mjs` — 20 representative bounded cases with verified gold
- `eval-lib/*.mjs` — ownership / file tracking / aggregation+redaction /
  adjacency / gates / trace aggregation (pure, testable)
- `eval-tests/*.test.mjs` — deterministic node:test suites pinning each finding fix
