/**
 * Jev contrast gold corpus (retrieval-evaluation data slice).
 *
 * Reuses the 18 scorable (non-behavioral) legacy cases from
 * retrieval-eval-cases.mjs, then adds production-shape golds for scope, exact
 * identifiers, CJK/EN, vocabulary mismatch, cross-file related ranges, and
 * duplicate hits under an explicit path. No arm scores, no mock oracle, no
 * targets under agent/eval or jev-optimizer.
 *
 * Descriptive cases carry queryVariants (1–3, ≤512 chars). exact / symbol-hint
 * / nav have none. requiredPathSuffixes is only for files that are all
 * necessary; alternative wrappers stay on expectPathSuffixes alone.
 */
import { CASES } from "./retrieval-eval-cases.mjs";

const MISSING_LEGACY_SUFFIXES = new Set(["Electron/packages/ui/src/store.ts"]);

/** Natural alternative phrasings for reused descriptive legacy gold. */
const LEGACY_VARIANTS = {
  "desc-pdf-ocr": [
    "paddleocr_vl uvx newline-delimited JSON-RPC",
    "paddleocr mcp client stdio token only in child env",
  ],
  "desc-office-shot-gate": [
    "officecli view screenshot --grid auto qualifying command",
    "whole-document baseline screenshot before first Office write",
  ],
  "desc-secretary-closeout": [
    "closeout=pass then secretary_commit exact handoff",
    "secretary_commit blocked reason flips closeout",
  ],
  "desc-browser-eval-guard": [
    "reject constant IIFE evals that never touch the page",
    "keep-alive javascript evaluation detector",
  ],
  "desc-ui-busy-cutin": [
    "cutInQueuedMessage while session agent is busy",
    "optimistic queued prompt bubble settle reconcile",
  ],
  "desc-provider-manifest": [
    "deepseek-extended provider id in extension manifest",
    "reserved deepseek flash vision extension identity",
  ],
  "desc-vault-env": [
    "PIPIUI_SECRET_VAULT_DEK stripped from process env",
    "secret vault missing credentials reauthorization",
  ],
  "desc-telemetry-summary": [
    "readCallsWithTarget coverage metric",
    "indexedSearchCalls attribution dashboard line",
  ],
  "desc-sidecar-reuse": [
    "health ping is not a sidecar lease",
    "ensure success means attach success refcount",
  ],
};

function adaptLegacy(c) {
  const next = { ...c };
  if (Array.isArray(c.expectPathSuffixes)) {
    next.expectPathSuffixes = c.expectPathSuffixes.filter((s) => !MISSING_LEGACY_SUFFIXES.has(s));
  }
  if (c.kind === "descriptive") {
    const variants = LEGACY_VARIANTS[c.id];
    if (!Array.isArray(variants) || variants.length < 1) {
      throw new Error(`missing queryVariants for reused descriptive case ${c.id}`);
    }
    next.queryVariants = [...variants];
  } else if ("queryVariants" in next) {
    delete next.queryVariants;
  }
  return next;
}

const LEGACY_SCORABLE = CASES.filter((c) => !c.behavioralOnly).map(adaptLegacy);

const NEW_CASES = [
  {
    id: "exact-format-secret",
    kind: "exact",
    query: "D6/D8 settings forms",
    expectPathSuffixes: ["Electron/packages/host-api/src/index.ts"],
    snippets: ["JSON Schema subset for D6/D8 settings forms (string/number/boolean/enum + format:secret)."],
    shape: "provider-settings-truth",
    tag: "settings schema secret-format token",
  },
  {
    id: "exact-vault-project-namespace",
    kind: "exact",
    query: "?extension-project=",
    expectPathSuffixes: ["Electron/packages/pi-backend/src/index.ts"],
    snippets: ["return `${this.vaultDir}?extension-project=${canonical}`;"],
    shape: "credential-vault",
    tag: "project vault namespace token",
  },
  {
    id: "exact-browser-partition",
    kind: "exact",
    query: "persist:pipiui-browser-",
    expectPathSuffixes: ["Electron/apps/electron/src/main/browser/tab-model.ts"],
    snippets: ["return `persist:pipiui-browser-${digest}`"],
    shape: "browser-session-partition",
    tag: "opaque browser partition prefix",
  },
  {
    id: "exact-cjk-extension-id-type",
    kind: "exact",
    query: "extension id 必须是 string",
    expectPathSuffixes: ["Electron/packages/pi-backend/src/index.ts"],
    snippets: ['throw new Error("extension id 必须是 string")'],
    shape: "provider-settings-truth",
    tag: "CJK host error literal",
  },
  {
    id: "desc-cjk-dismissible-error",
    kind: "descriptive",
    query: "用户可见错误必须可关闭 关闭控制 不得占据 Composer",
    queryVariants: [
      "dismissible error close control constitution section 0",
      "persistent alert must offer explicit dismiss button",
    ],
    expectPathSuffixes: [
      "CONSTITUTION.md",
      "Electron/packages/ui/src/DismissibleError.tsx",
    ],
    requiredPathSuffixes: [
      "CONSTITUTION.md",
      "Electron/packages/ui/src/DismissibleError.tsx",
    ],
    snippets: [
      "错误必须可关闭",
      "offer an explicit close control (CONSTITUTION.md §0)",
    ],
    shape: "dismissible-error-ux",
    tag: "CJK constitution rule plus UI implementation",
  },
  {
    id: "desc-locked-prompt-placement",
    kind: "descriptive",
    query: "where to put planning and retrieval workflow rules instead of editing the closed base prompt",
    queryVariants: [
      "do not add to SYSTEM_BASE use philosophy layers",
      "capability guidance belongs in the extension layer not the locked identity prompt",
    ],
    expectPathSuffixes: ["Electron/resources/runtime/pi-core-prompt/README.md"],
    snippets: ["So the base is closed. **Do not add to `SYSTEM_BASE.md`.**"],
    shape: "prompt-lock-policy",
    tag: "vocabulary mismatch vs locked SYSTEM_BASE",
  },
  {
    id: "desc-secret-settings-split",
    kind: "descriptive",
    query: "extension json schema format secret routed to vault not project settings json",
    queryVariants: [
      "secretPropertyKeys format secret never written to ext-settings json",
      "D6 settings forms secret fields go to the in-memory vault",
    ],
    expectPathSuffixes: [
      "Electron/packages/host-api/src/index.ts",
      "Electron/packages/pi-backend/src/extension-settings.ts",
    ],
    requiredPathSuffixes: [
      "Electron/packages/host-api/src/index.ts",
      "Electron/packages/pi-backend/src/extension-settings.ts",
    ],
    snippets: [
      'spec.format === "secret"',
      "JSON Schema subset for D6/D8 settings forms (string/number/boolean/enum + format:secret).",
    ],
    shape: "credential-vault",
    tag: "schema comment plus vault routing",
  },
  {
    id: "desc-ui-quota-scoped",
    kind: "descriptive",
    query: "qwen token plan quota pill login capsule bailian",
    queryVariants: [
      "visibleQuotaWindows hide incomplete host quota data",
      "quota snapshot must match composer provider after model switch",
    ],
    path: "Electron/packages/ui/src",
    topK: 12,
    expectPathSuffixes: ["Electron/packages/ui/src/QuotaPill.tsx"],
    snippets: ["export function visibleQuotaWindows"],
    shape: "ui-quota-pill",
    tag: "path-scoped UI quota chip",
  },
  {
    id: "desc-memory-instruction-boundary",
    kind: "descriptive",
    query: "memory context cannot override system instructions advisory untrusted reference",
    queryVariants: [
      "instructionBoundary memory_context hermes score",
      "memory retrieval abstain when no eligible results",
    ],
    expectPathSuffixes: [
      "Electron/resources/runtime/pi-ext/packages/memory-broker/src/retrieval-orchestrator.ts",
    ],
    snippets: [
      'instructionBoundary: "cannot override system/developer/user instructions or grant capabilities"',
    ],
    shape: "memory-context-boundary",
    tag: "vocabulary mismatch vs memory broker types",
  },
  {
    id: "desc-coding-tools-edit-recovery",
    kind: "descriptive",
    query: "registerTool",
    queryVariants: [
      "edit tool promptGuidelines oldText verbatim recovery",
      "do not resend an unchanged failed edit",
    ],
    path: "Electron/resources/runtime/extensions",
    glob: "pipiui-coding-tools.ts",
    expectPathSuffixes: ["Electron/resources/runtime/extensions/pipiui-coding-tools.ts"],
    snippets: ["Do not resend an unchanged failed edit. Copy oldText verbatim from the current file"],
    shape: "edit-recovery-guidance",
    tag: "high-frequency token narrowed by path/glob",
  },
  {
    id: "desc-packaging-primary-checkout",
    kind: "descriptive",
    query: "only the primary checkout may package the runnable PipiUI.app",
    queryVariants: [
      "linked worktree must not create build/PipiUI.app",
      "pipiui-electron-build fast-app only in the main workspace",
    ],
    expectPathSuffixes: ["CONSTITUTION.md"],
    snippets: ["Only this primary checkout may package it."],
    shape: "packaging-invariants",
    tag: "packaging location rule vs runtime-target env",
  },
  {
    id: "desc-registered-extension-paths",
    kind: "descriptive",
    query: "worker remount registered extension paths snapshot mid-session enable cannot rewrite live session",
    queryVariants: [
      "PIPIUI_EXT_REGISTERED_PATHS PATH-delimited agent-half mounts",
      "sanitizeEnvironment strips inherited extension mount paths",
    ],
    expectPathSuffixes: ["Electron/packages/pi-backend/src/spawn-assembly.ts"],
    snippets: ['export const REGISTERED_EXTENSION_PATHS_ENV = "PIPIUI_EXT_REGISTERED_PATHS";'],
    shape: "spawn-remount-snapshot",
    tag: "host spawn remount contract",
  },
];

export const JEV_CASES = [...LEGACY_SCORABLE, ...NEW_CASES];
