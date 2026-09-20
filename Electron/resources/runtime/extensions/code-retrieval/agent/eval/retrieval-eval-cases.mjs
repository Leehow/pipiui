/**
 * Evaluation case corpus (remediation wave: representativeness).
 *
 * The previous corpus was dominated by retrieval-optimization implementation
 * files — useful as integration coverage but not representative of the
 * production trajectories measured in .pi/findings/. Each case here maps to an
 * EVIDENCED production task shape from those reports (see `shape`):
 *
 *   pdf-plugin-recon        — read ×86 outlier worker: PDF extension architecture recon
 *   office-plugin-pattern    — Office extension / document gate exploration
 *   closeout-codepath/timing — subagent closeout deadlines, secretary commit handoff
 *   browser-watch-reviewer   — browser/computer-use guard review dimension
 *   ui-session-lifecycle     — busy cut-in / queued-message store work
 *   provider-settings-truth  — exact-provider manifest truthfulness slice
 *   credential-vault         — secret_vault env / reauthorization handling
 *   npm-proxy-deadlock       — root-cause hunting on install stalls (.npmrc)
 *   packaging-invariants     — fast-app runtime-target packaging scripts
 *   stable-id-policy         — semantic-slug ID constitution rule lookups
 *   project-isolation-policy — CJK constitution §6 project isolation rule
 *   telemetry                — attribution classifier/summary surfaces
 *   worker-closeout-timing   — symbol-graph questions over deadline helpers
 *   honesty-contract         — pure question words must degrade honestly
 *   orientation-probe        — repo_map first-move for unfamiliar trees
 *
 * Hard rules pinned by eval-tests/cases.test.mjs:
 * - exactly 20 bounded cases; every non-behavioral case carries verified gold
 * - NO case targets agent/eval/** (no self-referential optimization tests)
 * - at most 3 cases live inside extensions/code-retrieval/** (integration only)
 * - every case declares one evidenced production `shape`
 *
 * Anchor paths are REPO-ROOT-relative (not Electron/-relative). Anchors are
 * re-verified against disk before measuring; stale anchors are reported as
 * failures with explicit exclusions (see eval-lib/gates.mjs).
 */
export const CASES = [
  {
    id: "exact-verify-deadline",
    kind: "exact",
    query: "PIPIUI_VERIFY_TIMEOUT_MS",
    expectPathSuffixes: ["Electron/resources/runtime/extensions/git-capability/host/worktree/deadlines.ts"],
    snippets: ["process.env.PIPIUI_VERIFY_TIMEOUT_MS"],
    shape: "worker-closeout-timing",
    tag: "known-token env override",
  },
  {
    id: "exact-slug-policy",
    kind: "exact",
    query: "never a UUID, random hex",
    expectPathSuffixes: ["CONSTITUTION.md"],
    snippets: ["never a UUID, random hex"],
    shape: "stable-id-policy",
    tag: "constitution rule literal",
  },
  {
    id: "exact-npm-deadlock",
    kind: "exact",
    query: "maxsockets",
    expectPathSuffixes: ["Electron/.npmrc"],
    snippets: ["maxsockets=3"],
    shape: "npm-proxy-deadlock",
    tag: "config key from incident report",
  },
  {
    id: "exact-runtime-target",
    kind: "exact",
    query: "PIPIUI_EMBEDDED_RUNTIME_TARGET",
    expectPathSuffixes: ["Electron/scripts/fetch-pi-runtime.mjs"],
    snippets: ["env.PIPIUI_EMBEDDED_RUNTIME_TARGET"],
    shape: "packaging-invariants",
    tag: "packaging env token",
  },
  {
    id: "exact-cjk-project-isolation",
    kind: "exact",
    query: "禁止跨写其他项目",
    expectPathSuffixes: ["CONSTITUTION.md"],
    snippets: ["项目隔离：每个打开项目的 sessions、skills、memory、resources、settings.json、trust.json、models-store.json 只存在于 `{projectRoot}/.pi/agent`，禁止跨写其他项目"],
    shape: "project-isolation-policy",
    tag: "CJK constitution project-isolation rule",
  },
  {
    id: "exact-attribution-classifier",
    kind: "exact",
    query: "classifyGrepPattern",
    expectPathSuffixes: ["Electron/resources/runtime/pi-philosophy/retrieval-attribution.ts"],
    snippets: ["export function classifyGrepPattern"],
    shape: "telemetry",
    tag: "known-token function",
  },
  {
    id: "desc-pdf-ocr",
    kind: "descriptive",
    query: "PDF OCR extraction paddleocr mcp client stdio json rpc",
    expectPathSuffixes: ["Electron/resources/runtime/extensions/pdf-extension/README.md"],
    snippets: ["paddleocr-mcp-client.ts"],
    shape: "pdf-plugin-recon",
    tag: "read×86 outlier task shape",
  },
  {
    id: "desc-office-shot-gate",
    kind: "descriptive",
    query: "office document edit baseline screenshot gating view grid page",
    expectPathSuffixes: [
      "Electron/resources/runtime/extensions/office-doc-shot-gate.ts",
      "Electron/resources/runtime/extensions/pipiui-office-doc-shot-gate.ts",
    ],
    snippets: ["officecli view"],
    shape: "office-plugin-pattern",
    tag: "document tooling exploration",
  },
  {
    id: "desc-secretary-closeout",
    kind: "descriptive",
    query: "secretary commit manifest closeout pass merge verification handoff",
    expectPathSuffixes: ["Electron/resources/runtime/pi-ext/agents/secretary/AGENT.md"],
    snippets: ["secretary_commit"],
    shape: "closeout-codepath",
    tag: "closeout chain recon",
  },
  {
    id: "desc-browser-eval-guard",
    kind: "descriptive",
    query: "browser javascript eval guard constant keep-alive page rejection",
    expectPathSuffixes: ["Electron/resources/runtime/extensions/browser-eval-guard.ts"],
    snippets: ["constant IIFE evals that never touch the page"],
    shape: "browser-watch-reviewer",
    tag: "reviewer safety dimension",
  },
  {
    id: "desc-ui-busy-cutin",
    kind: "descriptive",
    query: "queued message cut in while busy optimistic bubble settle reconcile",
    expectPathSuffixes: ["Electron/packages/ui/src/useSessionQueue.ts"],
    snippets: ["cutInQueuedMessage(activeSessionId, messageId)"],
    shape: "ui-session-lifecycle",
    tag: "UI queue lifecycle",
  },
  {
    id: "desc-provider-manifest",
    kind: "descriptive",
    query: "deepseek extended reserved extension provider id manifest flash vision",
    expectPathSuffixes: ["Electron/resources/runtime/extensions/deepseek/pipiui-extension.json"],
    snippets: ['"id": "deepseek-extended"'],
    shape: "provider-settings-truth",
    tag: "provider truthfulness",
  },
  {
    id: "desc-vault-env",
    kind: "descriptive",
    query: "secret vault dek environment variable missing credentials reauthorize",
    expectPathSuffixes: ["Electron/resources/runtime/extensions/secret-vault-core.ts"],
    snippets: ["PIPIUI_SECRET_VAULT_DEK"],
    shape: "credential-vault",
    tag: "credential handling",
  },
  {
    id: "desc-telemetry-summary",
    kind: "descriptive",
    query: "attribution summary coverage readCallsWithTarget indexed calls dashboard",
    expectPathSuffixes: ["Electron/resources/runtime/pi-philosophy/retrieval-attribution.ts"],
    snippets: ["readCallsWithTarget"],
    shape: "telemetry",
    tag: "dashboard metric surface",
  },
  {
    id: "symdef-verify-timeout",
    kind: "symbol-hint",
    query: "resolveVerifyTimeoutMs 定义在哪",
    expectPathSuffixes: ["Electron/resources/runtime/extensions/git-capability/host/worktree/deadlines.ts"],
    snippets: ["export function resolveVerifyTimeoutMs"],
    shape: "worker-closeout-timing",
    tag: "CJK definition question routes to symbol layer",
  },
  {
    id: "symref-cutin",
    kind: "symbol-hint",
    query: "who references cutInQueuedMessage",
    expectPathSuffixes: [
      "Electron/packages/ui/src/useSessionQueue.ts",
      "Electron/packages/ui/src/store.ts",
    ],
    snippets: ["cutInQueuedMessage"],
    shape: "ui-session-lifecycle",
    tag: "references question (any def/use site)",
  },
  {
    id: "nav-def-resolve-verify",
    kind: "nav",
    operation: "definition",
    symbol: "resolveVerifyTimeoutMs",
    expectPathSuffixes: ["Electron/resources/runtime/extensions/git-capability/host/worktree/deadlines.ts"],
    snippets: ["export function resolveVerifyTimeoutMs"],
    shape: "worker-closeout-timing",
    tag: "code_nav definition probe outside code-retrieval area",
  },
  {
    id: "behavioral-empty-honesty",
    kind: "behavioral",
    query: "为什么",
    mode: "semantic",
    behavioralOnly: true,
    expectHonestDegraded: true,
    shape: "honesty-contract",
    tag: "pure question word must degrade honestly",
  },
  {
    id: "map-runtime-tree",
    kind: "map",
    expectPathPrefix: "Electron/resources/runtime",
    minHits: 5,
    behavioralOnly: true,
    shape: "orientation-probe",
    tag: "repo_map orientation probe through the registered tool",
  },
  {
    id: "desc-sidecar-reuse",
    kind: "descriptive",
    query: "running sidecar reused session attach refcount health lease timeout",
    expectPathSuffixes: [
      "Electron/resources/runtime/extensions/code-retrieval/agent/sidecar-lifecycle.ts",
    ],
    snippets: ["Health-only is not a lease. ensure() success === attach success."],
    shape: "retrieval-safety-remediation",
    tag: "measures attach/lease semantics this remediation depends on",
  },
];
