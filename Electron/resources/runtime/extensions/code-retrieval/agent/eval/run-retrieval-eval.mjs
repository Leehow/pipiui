#!/usr/bin/env node
/**
 * Read-only retrieval evaluation & report — remediation wave.
 *
 * Drives the COMPILED code-retrieval agent through the REAL registered tool
 * surface: the extension entry (`dist/index.js` default export) is installed
 * against a capturing ExtensionAPI, so every measured call runs the exact
 * production handler code path (SessionRuntime.ensure + settings + previews +
 * result persistence), including whatever repo_map renders after the core fix
 * lands. The evaluator never re-implements rendering.
 *
 * Safety model (review remediation, enforced):
 * - NEVER SIGTERMs any sidecar. Pre-existing/shared sidecars are leased
 *   (attach/detach) and left running; leases this run created are detached;
 *   spawned sidecars idle-exit on their own timer. Ownership policy lives in
 *   eval-lib/ownership.mjs and is pinned by node:test coverage.
 * - Deletes ONLY result files whose exact `details.resultsPath` THIS run
 *   received, and never files already present before the run
 *   (eval-lib/result-files.mjs).
 * - JSON output is aggregate/bounded case metrics only; raw attribution call
 *   arrays, queries, paths, tokens or secrets are never exported
 *   (eval-lib/trace-classify.mjs, result-files.mjs sanitizeValue).
 * - Trace adjacency is computed strictly per episode (sessionId+runId),
 *   never across globally interleaved calls (eval-lib/adjacency.mjs).
 * - Stale gold anchors and preview-budget violations FAIL the run with
 *   explicit denominators (eval-lib/gates.mjs).
 * - Honest limitation preserved: the live ≥30% grep+read and ≥20%
 *   descriptive-search call-reduction targets stay UNPROVEN until matched
 *   live traffic replays them.
 *
 * Reproduce:
 *   npm run build:code-retrieval        # from Electron/
 *   node agent/eval/run-retrieval-eval.mjs [--json /tmp/report.json]
 *        [--attribution-since ISO] [--require-map-previews] [--project DIR]
 *
 * Side effects: read-only over the source tree plus leases inside the standard
 * gitignored runtime home (.pi/agent/code-retrieval/), all cleaned up per the
 * safety model above.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { ResultFileTracker, createCleanupStack, toBoundedJson, toBoundedCaseMetric, sanitizeValue } from "./eval-lib/result-files.mjs";
import { caseParams, providerHonestyViolations, routingExplained, contrastSummary, contrastMarkdown } from "./eval-lib/jev-contrast.mjs";
import { classifyTrace } from "./eval-lib/trace-classify.mjs";
import {
  evaluateGates,
  independentAggregatePreviewViolations,
  PREVIEW_MAX_LINES,
  PREVIEW_BUDGET_TOKENS,
} from "./eval-lib/gates.mjs";
import { parsePreviewBlocks } from "./eval-lib/preview-parse.mjs";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = dirname(EVAL_DIR);
const DIST = join(AGENT_DIR, "dist");

function findProjectRoot() {
  let dir = AGENT_DIR;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "AGENTS.md")) && existsSync(join(dir, "Electron", "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const PROJECT_ROOT = resolve(argValue("--project") ?? findProjectRoot());

// ---------- args ----------
function argValue(name) {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
const hasFlag = (name) => process.argv.includes(name);
const JSON_OUT = argValue("--json");
const JEV_CONTRAST = hasFlag("--jev-contrast");
const REPETITIONS = Number(argValue("--repetitions") ?? 3);
const ATTRIBUTION_SINCE = argValue("--attribution-since");
const REQUIRE_MAP_PREVIEWS = hasFlag("--require-map-previews");
const CALL_TIMEOUT_MS = Number(argValue("--call-timeout-ms") ?? 45_000);
const OVERALL_BUDGET_MS = 240_000;
const startedAtMs = Date.now();
const cleanupStack = createCleanupStack();

function failExit(code, message) {
  process.stderr.write(`retrieval-eval: ${message}\n`);
  process.exit(code);
}

// ---------- dist freshness ----------
for (const name of ["previews.js", "code-search.js", "settings.js", "index.js", "protocol.js", "sidecar-lifecycle.js"]) {
  const src = join(AGENT_DIR, name.replace(/\.js$/, ".ts"));
  const out = join(DIST, name);
  if (!existsSync(out)) failExit(2, `dist/${name} missing — run 'npm run build:code-retrieval' in Electron/ first.`);
  if (existsSync(src) && statSync(src).mtimeMs > statSync(out).mtimeMs) {
    failExit(2, `dist/${name} is older than its .ts source — rebuild with 'npm run build:code-retrieval'.`);
  }
}

// ---------- module imports (the compiled production surface) ----------
const extensionInstall = (await import(`${DIST}/index.js`)).default;
const { executeCodeSearch } = await import(`${DIST}/code-search.js`);
const { executeReadSpans } = await import(`${DIST}/read-spans.js`);
const { RefRegistry } = await import(`${DIST}/protocol.js`);
const { extractSpanText, SeenRangeLedger } = await import(`${DIST}/ledger.js`);
const { estimateTokens, loadRetrievalSettings, normalizeExactProvider } = await import(`${DIST}/settings.js`);
const {
  attachSidecar,
  detachSidecar,
  pingSidecar,
  readSidecarSnapshot,
} = await import(`${DIST}/sidecar-lifecycle.js`);
const { CASES } = await import(`${EVAL_DIR}/retrieval-eval-cases.mjs`);

/** Capture the real registered tools instead of mirroring their bodies. */
function captureTools() {
  const tools = {};
  const eventHandlers = {};
  const api = {
    registerTool(tool) {
      tools[tool.name] = tool;
    },
    registerCommand() {},
    on(event, handler) {
      eventHandlers[event] = handler;
    },
  };
  extensionInstall(api);
  for (const expected of ["code_search", "code_nav", "repo_map", "read_spans"]) {
    if (!tools[expected]) failExit(2, `extension did not register ${expected} — dist/index.js changed shape`);
  }
  return { tools, shutdownSession: cleanupStack.add(() => eventHandlers["session_shutdown"]?.({}, { cwd: PROJECT_ROOT })) };
}

async function withTimeout(promise, ms, label, cancel) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { cancel?.(); reject(new Error(`timeout after ${ms}ms: ${label}`)); }, ms);
    })]);
  } finally { clearTimeout(timer); }
}

const fileCache = new Map();
async function projectFileLines(relPath) {
  const key = String(relPath).replace(/\\/g, "/");
  if (fileCache.has(key)) return fileCache.get(key);
  const abs = join(PROJECT_ROOT, key);
  try {
    const lines = (await readFile(abs, "utf8")).split("\n");
    fileCache.set(key, lines);
    return lines;
  } catch {
    fileCache.set(key, null);
    return null;
  }
}

/** Gold anchors re-verified against disk so stale case data is a hard failure,
 *  not silent noise. Suffixes are REPO-ROOT-relative. */
async function verifyGold(caseDef) {
  if (caseDef.behavioralOnly || !caseDef.snippets?.length) return true;
  const files = await Promise.all((caseDef.expectPathSuffixes ?? []).map(projectFileLines));
  if (!caseDef.snippets.every((needle) => files.some((lines) => lines?.some((line) => line.includes(needle))))) return false;
  for (const required of caseDef.requiredPathSuffixes ?? []) if (!await projectFileLines(required)) return false;
  return files.some(Boolean);
}

function matchHit(expect, relPath) {
  const p = String(relPath).replace(/\\/g, "/");
  if (expect.expectPathPrefix) return p === expect.expectPathPrefix || p.startsWith(`${expect.expectPathPrefix}/`);
  return (expect.expectPathSuffixes ?? []).some((s) => p.endsWith(s));
}

async function runTool(tools, name, params, caseId, tracker) {
  const t0 = performance.now();
  const controller = new AbortController();
  const pending = tracker.trackTask(
    Promise.resolve().then(() => tools[name].execute(`eval-${caseId}`, params, controller.signal, undefined, { cwd: PROJECT_ROOT })),
    () => controller.abort(new Error("evaluation cleanup")),
  );
  const result = await withTimeout(
    pending,
    CALL_TIMEOUT_MS,
    `${name}/${caseId}`,
    () => controller.abort(new Error("evaluation timeout")),
  );
  const details = result.details ?? {};
  tracker.trackResultPath(details.resultsPath);
  return { result, latencyMs: Math.round(performance.now() - t0) };
}

async function measureCase(caseDef, tools, ctx, tracker, arm = "A") {
  const rec = {
    id: caseDef.id,
    kind: caseDef.kind,
    tag: caseDef.tag,
    latencyMs: null,
    error: null,
    hits: [],
    firstGoldRank: null,
    goldInTop12: false,
    goldInTop3: false,
    degraded: false,
    provider: null,
    previewBlocks: [],
    previewTokensTotal: 0,
    previewUsedPerCall: null,
    anchorShown: false,
    anchorShownRef: null,
    avoidedFetchTokens: 0,
    budgetViolations: [],
    honestyViolations: [],
    outputTokenEstimate: 0,
    requiredCount: caseDef.requiredPathSuffixes?.length ?? 0,
    requiredFound: 0,
  };
  try {
    const { result, latencyMs } = await runTool(
      tools,
      caseDef.kind === "nav" ? "code_nav" : caseDef.kind === "map" ? "repo_map" : "code_search",
      caseParams(caseDef, arm),
      caseDef.id,
      tracker,
    );
    rec.latencyMs = latencyMs;

    const details = result.details ?? {};
    const text = result.content?.[0]?.text ?? "";
    rec.degraded = details.degraded === true;
    rec.provider = details.provider ?? null;
    rec.hits = (details.hits ?? []).map((h) => ({
      ref: h.ref,
      path: String(h.path).replace(/\\/g, "/"),
      startLine: h.startLine,
      endLine: h.endLine,
    }));

    rec.outputTokenEstimate = estimateTokens(text);
    rec.honestyViolations.push(...providerHonestyViolations(details, ctx.observedLiveProvider));
    // A live semantic layer can legitimately return a hit OR a non-degraded miss.
    // The old behavioral probe incorrectly required every question word to degrade.
    if (caseDef.expectHonestDegraded || caseDef.expectHonestOutcome) {
      rec.honestDegraded = routingExplained(details, text);
      if (!rec.honestDegraded) rec.honestyViolations.push("empty result has no honest explanation");
    }
    if (/^(?:code_search|code_nav|repo_map) failed\b/.test(text)) rec.error = "registered tool reported a failure";
    rec.requiredFound = (caseDef.requiredPathSuffixes ?? []).filter((path) => rec.hits.slice(0, 12).some((hit) => hit.path.endsWith(path))).length;

    // Recall on ranked refs.
    const rank = rec.hits.findIndex((h) => matchHit(caseDef, h.path));
    rec.firstGoldRank = rank >= 0 ? rank + 1 : null;
    rec.goldInTop12 = rec.firstGoldRank !== null && rec.firstGoldRank <= 12;
    rec.goldInTop3 = rec.firstGoldRank !== null && rec.firstGoldRank <= 3;

    // Preview budget enforcement PER RENDERED BLOCK (≤6 lines each), plus an
    // INDEPENDENT fixed aggregate cap per result: the SUM of every rendered
    // block must stay <= PREVIEW_BUDGET_TOKENS regardless of individual block
    // sizes and regardless of what the renderer's own footer claims.
    const blocks = parsePreviewBlocks(text);
    const blockTokens = [];
    for (const [ref, block] of blocks) {
      const hit = rec.hits.find((h) => h.ref === ref);
      const tokens = estimateTokens(block.text);
      if (block.srcLines.filter((l) => l.length > 0).length > PREVIEW_MAX_LINES) {
        rec.budgetViolations.push(`preview ${ref} exceeds ${PREVIEW_MAX_LINES} lines`);
      }
      if (tokens > PREVIEW_BUDGET_TOKENS) {
        rec.budgetViolations.push(`preview ${ref} alone is ${tokens} tokens (> ${PREVIEW_BUDGET_TOKENS})`);
      }
      if (block.srcLines.length > 0) {
        // Every rendered block counts toward the aggregate — even one that
        // already tripped a per-block rule — so sums cannot hide behind it.
        rec.previewBlocks.push({ ref, path: hit?.path ?? "?", lines: block.srcLines.length, tokens });
        rec.previewTokensTotal += tokens;
        blockTokens.push(tokens);
      }
    }
    const footer = text.match(/· ~(\d+)\/(\d+) preview tokens/);
    if (footer) rec.previewUsedPerCall = Number(footer[1]);
    rec.budgetViolations.push(
      ...independentAggregatePreviewViolations({
        blockTokens,
        footerUsed: footer ? Number(footer[1]) : null,
        footerDenominator: footer ? Number(footer[2]) : null,
      }),
    );

    // Anchor usefulness + avoided-fetch estimate.
    const shownPreview = rec.previewBlocks.find((b) =>
      (caseDef.snippets ?? []).some(
        (snippet) => blocks.get(b.ref)?.srcLines.join("\n").includes(snippet) ?? false,
      ),
    );
    if (shownPreview) {
      rec.anchorShown = true;
      rec.anchorShownRef = shownPreview.ref;
      const hit = rec.hits.find((h) => h.ref === shownPreview.ref);
      const lines = hit ? await projectFileLines(hit.path) : null;
      if (lines && hit) {
        const span = extractSpanText(lines.join("\n"), hit.startLine, hit.endLine);
        rec.avoidedFetchTokens = Math.max(0, estimateTokens(span) - shownPreview.tokens);
      }
    }
  } catch (error) {
    rec.error = error instanceof Error ? error.message : String(error);
  }
  return rec;
}

// Same handler, gold checker, metrics, and exact-file cleanup as the legacy run.
async function runJevContrast() {
  if (!Number.isInteger(REPETITIONS) || REPETITIONS < 3 || REPETITIONS > 10) failExit(2, "--repetitions must be an integer from 3 to 10");
  const { JEV_CASES } = await import(`${EVAL_DIR}/jev-eval-cases.mjs`);
  const settings = await loadRetrievalSettings(PROJECT_ROOT);
  const pre = await readSidecarSnapshot(PROJECT_ROOT);
  const live = pre ? await pingSidecar(pre) : undefined;
  const ctx = { observedLiveProvider: live?.provider ?? null };
  const resultsDirAbs = join(PROJECT_ROOT, ".pi", "agent", "code-retrieval", "results");
  let before = [];
  try { before = readdirSync(resultsDirAbs); } catch { /* not created yet */ }
  const tracker = new ResultFileTracker(before);
  const finalizeResults = cleanupStack.add(async () => {
    await tracker.settleTasks();
    return tracker.cleanup((name) => join(resultsDirAbs, name), (file) => rm(file, { force: true }));
  });
  const invalidGoldIds = [];
  for (const def of JEV_CASES) if (!await verifyGold(def)) invalidGoldIds.push(def.id);
  const records = [];
  let cleanup;
  try {
    for (let repetition = 0; repetition < REPETITIONS; repetition++) {
      // Separate registries/ledgers for A and B, reset for each repetition.
      // captureTools deliberately installs NO optimizer, regardless of env keys.
      const captures = { A: captureTools(), B: captureTools() };
      try {
        for (const def of JEV_CASES) {
          for (const arm of repetition % 2 ? ["B", "A"] : ["A", "B"]) {
            const rec = Date.now() - startedAtMs > OVERALL_BUDGET_MS
              ? { id: def.id, kind: def.kind, firstGoldRank: null, error: "overall time budget exceeded", skipped: true }
              : await measureCase(def, captures[arm].tools, ctx, tracker, arm);
            records.push({ ...rec, arm, repetition });
          }
        }
      } finally {
        await Promise.allSettled(Object.values(captures).map((capture) => capture.shutdownSession()));
      }
    }
  } finally {
    const outcome = await finalizeResults();
    cleanup = { tracked: outcome.trackedCount, deleted: outcome.deleted, refusedPreExisting: outcome.refusedPreExisting.length, pendingTasks: outcome.pendingTasks, sidecarsTerminated: 0 };
  }
  const summary = contrastSummary(JEV_CASES, records, invalidGoldIds, REPETITIONS);
  const settingsAfter = await loadRetrievalSettings(PROJECT_ROOT);
  if (JSON.stringify(settings) !== JSON.stringify(settingsAfter)) {
    summary.verdict = "FAIL"; summary.failedGates.push("settings-changed-during-run");
  }
  const report = {
    schemaVersion: 1, kind: "jev-offline-contrast", ranAt: new Date().toISOString(),
    repetitions: REPETITIONS, elapsedMs: Date.now() - startedAtMs,
    indexObservation: { preExistingSidecar: Boolean(live), forcedCold: false, firstObservedRepetition: 0, warmedRepetitions: "1+; not a forced cold/warm benchmark" },
    settings: { tokenBudget: settings.tokenBudget, exactProvider: settings.exactProvider, excludeGlobCount: settings.excludeGlobs.length },
    summary, cleanup,
    cases: JEV_CASES.map((def) => ({ id: def.id, kind: def.kind, shape: def.shape,
      A: records.filter(r => r.id === def.id && r.arm === "A").map((r) => ({ ...toBoundedCaseMetric(r), repetition: r.repetition })),
      B: records.filter(r => r.id === def.id && r.arm === "B").map((r) => ({ ...toBoundedCaseMetric(r), repetition: r.repetition })),
    })),
  };
  const markdown = contrastMarkdown(report);
  process.stdout.write(markdown);
  if (JSON_OUT) {
    await writeFile(resolve(JSON_OUT), `${JSON.stringify(sanitizeValue(report), null, 2)}\n`, "utf8");
    await writeFile(`${resolve(JSON_OUT)}.md`, markdown, "utf8");
  }
  process.exitCode = summary.verdict === "PASS" ? 0 : 1;
}

// =====================================================================
// main
// =====================================================================
async function main() {
  if (hasFlag("--live-jev") || hasFlag("--live")) failExit(2, "this entry is local-only; repository upload requires a separately authorized experiment");
  if (!Number.isFinite(CALL_TIMEOUT_MS) || CALL_TIMEOUT_MS < 1 || CALL_TIMEOUT_MS > 120000) failExit(2, "--call-timeout-ms must be between 1 and 120000");
  if (JEV_CONTRAST) return runJevContrast();
  const settings = await loadRetrievalSettings(PROJECT_ROOT);

  // ---- Pre-state: observe any existing sidecar WITHOUT leasing it. ----
  const preSnapshot = await readSidecarSnapshot(PROJECT_ROOT);
  const preLive = preSnapshot ? await pingSidecar(preSnapshot) : undefined;
  const sharedPreExistingPid = preLive?.pid ?? null;

  const { tools, shutdownSession } = captureTools();

  // Exact-file tracking starts BEFORE anything can persist results.
  const resultsDirAbs = join(PROJECT_ROOT, ".pi", "agent", "code-retrieval", "results");
  let preListing = [];
  try {
    preListing = readdirSync(resultsDirAbs);
  } catch {
    /* dir may not exist yet */
  }
  const tracker = new ResultFileTracker(preListing);
  const finalizeResults = cleanupStack.add(async () => {
    await tracker.settleTasks();
    await detachSidecar(PROJECT_ROOT, `retrieval-eval-b2-${startedAtMs}`).catch(() => {});
    return tracker.cleanup((name) => join(resultsDirAbs, name), (file) => rm(file, { force: true }));
  });

  // ---- Gold verification pass (hard gate). ----
  let goldChecked = 0;
  const invalidGoldIds = [];
  for (const c of CASES) {
    if (c.behavioralOnly || !c.snippets?.length) continue;
    goldChecked += 1;
    if (!(await verifyGold(c))) invalidGoldIds.push(c.id);
  }
  const goldValid = goldChecked - invalidGoldIds.length;

  // ---- Run cases through the real registered handlers. ----
  const ctx = { observedLiveProvider: preLive?.provider ?? null };
  const cases = [];
  const deadline = startedAtMs + OVERALL_BUDGET_MS;
  for (const c of CASES) {
    if (Date.now() > deadline) {
      cases.push({ id: c.id, kind: c.kind, tag: c.tag, latencyMs: null, error: "skipped: overall time budget exceeded", skipped: true,
        hits: [], previewBlocks: [], previewTokensTotal: 0, budgetViolations: [], honestyViolations: [], firstGoldRank: null });
      continue;
    }
    cases.push(await measureCase(c, tools, ctx, tracker));
  }
  const mapPreviewBlockCount = cases
    .filter((r) => r.kind === "map")
    .reduce((n, r) => n + (r.previewBlocks?.length ?? 0), 0);

  // Refresh live observation for honesty gating after the case sweep.
  const postSnapshot = await readSidecarSnapshot(PROJECT_ROOT);
  const postLive = postSnapshot ? await pingSidecar(postSnapshot) : undefined;
  const ownership =
    postLive?.pid != null
      ? { ...{ pid: postLive.pid }, preExisting: sharedPreExistingPid === postLive.pid }
      : null;

  // ---- Honesty probe B2: tantivy-requested fallback (never disturbs shared processes). ----
  const honestyProbes = [];
  if (postLive && postLive.provider === "tantivy") {
    honestyProbes.push({
      name: "tantivy-request-falls-back-honestly",
      pass: null,
      detail:
        "skipped: a shared tantivy sidecar is currently serving other sessions; the evaluator never stops or restarts it to manufacture this condition",
      skippedSharedProcess: true,
    });
  } else {
    let passB2 = false;
    let detailB2 = "";
    try {
      process.env.PIPIUI_CODE_RETRIEVAL_FORCE_RG = "1";
      // Temporary lease: spawned sidecars carry short idle timers, so dropping
      // the lease lets the process exit by itself. We never signal it.
      const conn = await attachSidecar({
        projectRoot: PROJECT_ROOT,
        sessionId: `retrieval-eval-b2-${startedAtMs}`,
        idleMs: 15_000,
        provider: "tantivy",
      }).catch(() => undefined);
      delete process.env.PIPIUI_CODE_RETRIEVAL_FORCE_RG;
      if (!conn) {
        detailB2 = "forced-rg attach unavailable (rg node sidecar missing?)";
      } else {
        const registry = new RefRegistry();
        const res = await executeCodeSearch({
          query: "maxsockets=3",
          projectRoot: PROJECT_ROOT,
          registry,
          excludeGlobs: settings.excludeGlobs,
          sidecar: conn,
          providerInfo: { requested: "tantivy", actual: conn.provider },
          tokenBudget: settings.tokenBudget,
        });
        tracker.trackResultPath(res.details?.resultsPath);
        const text = res.content?.[0]?.text ?? "";
        const saysFallback =
          text.includes("Requested exact provider tantivy is not available") ||
          text.includes("served by") ||
          Boolean(conn.providerFallback);
        passB2 = conn.provider !== "tantivy" && saysFallback;
        detailB2 = `actual=${conn.provider}; fallback surfaced=${saysFallback}`;
        await detachSidecar(PROJECT_ROOT, `retrieval-eval-b2-${startedAtMs}`).catch(() => {});
      }
    } catch (e) {
      delete process.env.PIPIUI_CODE_RETRIEVAL_FORCE_RG;
      detailB2 = `probe error: ${e?.message ?? e}`;
    }
    honestyProbes.push({ name: "tantivy-request-falls-back-honestly", pass: passB2, detail: detailB2 });
  }

  // ---- Honesty probe B3: no sidecar ⇒ truthful local-grep degradation. ----
  {
    let passB3 = false;
    let detailB3 = "";
    try {
      // Direct module call: exactly the implementation the registered handler
      // delegates to when SessionRuntime has no sidecar — exercised WITHOUT
      // stopping anyone's real sidecar.
      const registry = new RefRegistry();
      const res = await executeCodeSearch({
        query: "PIPIUI_VERIFY_TIMEOUT_MS",
        projectRoot: PROJECT_ROOT,
        registry,
        excludeGlobs: settings.excludeGlobs,
        sidecar: undefined,
        tokenBudget: settings.tokenBudget,
      });
      tracker.trackResultPath(res.details?.resultsPath);
      const text = res.content?.[0]?.text ?? "";
      // Runtime wording differs by version: "used grep fallback" (older) or
      // "used rg fallback (details.provider=rg, …)" (provenance-fixed runtime).
      passB3 = res.details?.degraded === true && /(?:rg|grep) fallback/i.test(text);
      detailB3 = `details.degraded=${res.details?.degraded}; fallback note=${/(?:rg|grep) fallback/i.test(text)}; gold found=${res.details?.hits?.some?.((h) => matchHit(CASES[0], String(h.path))) ?? false}`;
    } catch (e) {
      detailB3 = `probe error: ${e?.message ?? e}`;
    }
    honestyProbes.push({ name: "no-sidecar-degraded-truthful", pass: passB3, detail: detailB3 });
  }

  // ---- Legacy provider-value collapse (pure function). ----
  honestyProbes.push({
    name: "legacy-provider-values-collapse-to-auto",
    pass: normalizeExactProvider("zoekt") === "auto",
    detail: `normalizeExactProvider("zoekt") -> "${normalizeExactProvider("zoekt")}"`,
  });

  // ---- Ledger dedupe integration probe (booleans only in output). ----
  let dedupeProbe = null;
  try {
    const anchorCaseRec = cases.find((r) => r.hits.length > 0 && r.firstGoldRank !== null);
    if (anchorCaseRec) {
      const def = CASES.find((c) => c.id === anchorCaseRec.id);
      const registry = new RefRegistry();
      const seed = await executeCodeSearch({
        query: def.query ?? "PIPIUI_VERIFY_TIMEOUT_MS",
        mode: def.mode,
        projectRoot: PROJECT_ROOT,
        registry,
        excludeGlobs: settings.excludeGlobs,
        sidecar: undefined,
        tokenBudget: settings.tokenBudget,
      });
      tracker.trackResultPath(seed.details?.resultsPath);
      const hit = (seed.details?.hits ?? []).find((h) => matchHit(def, String(h.path)));
      if (hit) {
        // One shared seen-range ledger across both reads — exactly how a real
        // session's repeated read_spans behaves.
        const ledger = new SeenRangeLedger();
        const readOnce = async () => {
          const r = await executeReadSpans({
            refs: [hit.ref],
            projectRoot: PROJECT_ROOT,
            registry,
            ledger,
            tokenBudget: settings.tokenBudget,
          });
          tracker.trackResultPath(r.details?.resultsPath);
          return r.content?.[0]?.text ?? "";
        };
        await readOnce();
        const secondText = await readOnce();
        dedupeProbe = {
          citedInsteadOfReinlined: /\(already read\)/.test(secondText),
          secondRenderShorterOrEqual: Buffer.byteLength(secondText) < 800,
        };
      } else {
        dedupeProbe = { inconclusive: "no gold hit in seed search" };
      }
    }
  } catch (e) {
    dedupeProbe = { error: String(e?.message ?? e) };
  }

  // ---- Trace classification: bounded aggregates + per-episode adjacency. ----
  const trace = await classifyTrace(PROJECT_ROOT, ATTRIBUTION_SINCE);

  // ---- Hard validity gates with explicit denominators. ----
  const gates = evaluateGates({
    goldChecked,
    goldValid,
    invalidGoldIds,
    cases,
    caseDefs: CASES,
    requireRepoMapPreviews: REQUIRE_MAP_PREVIEWS,
    mapPreviewBlockCount,
  });

  // ---- Aggregates over valid denominators (for prose/report). ----
  const d = gates.denominators;
  const pct = (n, x) => (x === 0 ? "-" : `${Math.round((n / x) * 100)}%`);
  const casesWithPreviews = cases.filter((r) => !r.skipped && (r.previewBlocks?.length ?? 0) > 0).length;
  const previewTotals = cases.reduce(
    (acc, r) => ({ blocks: acc.blocks + (r.previewBlocks?.length ?? 0), tokens: acc.tokens + (r.previewTokensTotal ?? 0) }),
    { blocks: 0, tokens: 0 },
  );

  // ---- Cleanup: detach this run's leases; delete ONLY exact created files. ----
  // Fire the extension's own session_shutdown so its SessionRuntime detaches
  // its lease immediately instead of pinning a sidecar for the TTL window.
  try {
    await shutdownSession();
  } catch {
    /* never block cleanup */
  }
  const detachedLeases = [];
  const cleanupNotes = [];
  for (const sessionId of [`retrieval-eval-b2-${startedAtMs}`]) {
    await detachSidecar(PROJECT_ROOT, sessionId).catch(() => {});
    detachedLeases.push(sessionId);
  }
  const cleanup = await finalizeResults();

  // ---------------- report ----------------
  const L = [];
  L.push("# Retrieval evaluation report (remediation wave)");
  L.push("");
  L.push(`- project root: \`${PROJECT_ROOT}\``);
  L.push(`- ran: ${new Date(startedAtMs).toISOString()} · verdict: **${gates.verdict}**${gates.failedGates.length ? ` (failed gates: ${gates.failedGates.join(", ")})` : ""}`);
  L.push(`- surface: registered tool handlers from \`dist/index.js\` (code_search / code_nav / repo_map / read_spans executed exactly as sessions do)`);
  L.push(`- settings in force: tokenBudget=${settings.tokenBudget}, excludeGlobs=${settings.excludeGlobs.length} entries, exactProvider=${settings.exactProvider}`);
  L.push(
    `- sidecar: pre-existing-live=${sharedPreExistingPid != null}${sharedPreExistingPid != null ? ` (pid ${sharedPreExistingPid}, leased only)` : ""}${ownership && !ownership.preExisting ? ` · serving-after-run pid ${ownership.pid} (unproven spawn — treated as unowned)` : ""} · killed=none (policy: detach-only)`,
  );
  L.push("");
  L.push("## 20 bounded representative cases");
  L.push("");
  L.push("| case | shape | gold-rank | preview | anchor | ~tok saved | latency | served-by/degraded |");
  L.push("|---|---|---|---|---:|---:|---:|---|");
  for (const r of cases) {
    const def = CASES.find((c) => c.id === r.id);
    const recall = r.skipped ? "skip" : r.error ? "err" : r.firstGoldRank ? `@${r.firstGoldRank}` : "miss";
    const preview = r.previewBlocks?.length ? `${r.previewBlocks.length}blk/~${r.previewTokensTotal}tok` : "-";
    const anchor = r.anchorShown ? "shown" : r.goldInTop3 ? "top3-not-shown" : "-";
    const served = r.degraded ? "degraded" : r.provider ?? "-";
    L.push(`| ${r.id} | ${def?.shape ?? "?"} | ${recall} | ${preview} | ${anchor} | ${r.avoidedFetchTokens || "-"} | ${r.latencyMs ?? "-"}ms | ${served} |`);
  }
  L.push("");
  L.push("## Gates and explicit denominators");
  L.push("");
  L.push(`- stale-gold gate: ${goldValid}/${goldChecked} anchors verified${invalidGoldIds.length ? ` · EXCLUDED from scoring: ${invalidGoldIds.join(", ")}` : " · none excluded"}`);
  L.push(`- recall@12: **${d.recall12}/${d.recallScoredCases}** (${pct(d.recall12, d.recallScoredCases)}) · recall@3: **${d.recall3}/${d.recallScoredCases}** (${pct(d.recall3, d.recallScoredCases)}) · scored denominator excludes behavioral/skipped/error/stale-gold cases`);
  L.push(`- anchor-shown: **${d.anchorShown}/${d.anchorEligible}** eligible (${pct(d.anchorShown, d.anchorEligible)})`);
  L.push(`- previews: blocks=${previewTotals.blocks}, ~${previewTotals.tokens} tok total · ≤${PREVIEW_MAX_LINES}-lines-per-block and fixed ≤${PREVIEW_BUDGET_TOKENS}-token aggregate per result (independent of renderer footer) enforced as a HARD gate: ${gates.failedGates.includes("preview-budget") ? "**FAILED**" : "pass"}${casesWithPreviews ? "" : " · no inline previews rendered anywhere"}`);
  L.push(`- map previews (registered repo_map handler): ${mapPreviewBlockCount} inline preview block(s) rendered${REQUIRE_MAP_PREVIEWS ? ` (--require-map-previews: ${gates.failedGates.includes("repo-map-previews") ? "FAILED" : "pass"})` : " (informational; pass --require-map-previews to enforce)"}`);
  if (gates.reasons.length) for (const r of gates.reasons) L.push(`- gate reason: ${r}`);
  L.push("");
  L.push("## Honesty probes");
  L.push("");
  for (const p of honestyProbes) {
    L.push(`- **${p.name}**: ${p.pass === null ? "SKIPPED (safe)" : p.pass ? "PASS" : "FAIL"} — ${p.detail}`);
  }
  if (dedupeProbe) {
    const dedupeState = dedupeProbe.citedInsteadOfReinlined
      ? "cited-instead-of-reinlined=true"
      : dedupeProbe.inconclusive
        ? `inconclusive (${dedupeProbe.inconclusive})`
        : `false${dedupeProbe.error ? ` (${dedupeProbe.error})` : ""}`;
    L.push(`- **ledger-dedupe**: ${dedupeState}`);
  }
  L.push("");
  L.push("## Trace classification (bounded aggregates, adjacency per episode)");
  L.push("");
  if (trace.available) {
    L.push(`- window: ${trace.window.since} · records=${trace.window.totalRecords} · toolset-turns=${trace.turns} · episodes=${trace.episodes} (pairable=${trace.episodesWithPairableCalls})`);
    L.push(`- calls by tool: ${Object.entries(trace.callsByTool).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ") || "-"}`);
    if (trace.indexedConversion) {
      L.push(`- indexed funnel: code_search=${trace.indexedConversion.code_search}, immediately-followed-by-read_spans=${trace.indexedConversion.immediatelyFollowedByReadSpans} (per-episode pairs only)`);
    }
    L.push(`- cross-episode adjacencies a global sort would have wrongly added: ${trace.crossEpisodePairsAGlobalSortWouldHaveAdded}`);
    L.push(`- top adjacency pairs (within-episode): ${trace.adjacencyTop.map((a) => `${a.pair}:${a.count}`).join(", ") || "-"}`);
    L.push(`- tool_result coverage: ok=${trace.toolResults.ok}, error=${trace.toolResults.error}, degraded=${trace.toolResults.degraded}, withHits=${trace.toolResults.withHits}`);
  } else {
    L.push(`- ${trace.reason}`);
  }
  L.push("");
  L.push("## Limitations");
  L.push("");
  L.push("- **The live ≥30% grep+read call-reduction target (explore/reviewer tasks) and ≥20% descriptive-search target remain UNPROVEN** until matched live traffic replays them. Offline probes exercise tool behavior, not model choices.");
  L.push("- Case corpus is grounded in measured production task shapes (.pi/findings/retrieval-verdict.md, subagent-trajectories.md); recall numbers still describe retrieval quality, not realized trajectory savings.");
  L.push("- Sidecar conditions reflect machine state. When a shared tantivy sidecar is serving other sessions the forced-fallback probe is SKIPPED rather than manufactured.");
  L.push("- A spawned-during-run sidecar PID cannot be proven ours from outside; it is therefore treated as unowned and left to its own idle expiry.");
  L.push("- tool_result-kind attribution rows activate only after the packaged runtime ships telemetry v2.");
  L.push("");
  L.push(`## Cleanup attestation`);
  L.push("");
  L.push(`- sidecar processes terminated by this eval: none (detach-only policy)`);
  L.push(`- leases detached: ${detachedLeases.length ? detachedLeases.join(", ") : "none needed"}`);
  L.push(`- result files deleted: ${cleanup.deleted} of ${cleanup.trackedCount} tracked (pre-existing refused: ${cleanup.refusedPreExisting.length})`);
  L.push("");

  process.stdout.write(L.join("\n") + "\n");

  if (JSON_OUT) {
    const doc = {
      meta: {
        ranAt: new Date(startedAtMs).toISOString(),
        verdict: gates.verdict,
        // Note: no project-external paths, no raw attribution records, no tokens.
      },
      settingsSummary: {
        tokenBudget: settings.tokenBudget,
        excludeGlobsCount: settings.excludeGlobs.length,
        exactProvider: settings.exactProvider,
      },
      sidecar: {
        sharedPreExistingAttached: sharedPreExistingPid != null,
        killedProcesses: 0,
        cleanupPolicyNote: "attach/detach leases only; spawned sidecars idle-exit",
      },
      gates,
      agg: {
        executedCases: d.executedCases,
        recallScoredCases: d.recallScoredCases,
        recall12: d.recall12,
        recall3: d.recall3,
        anchorEligible: d.anchorEligible,
        anchorShown: d.anchorShown,
        casesWithPreviews,
        previewBlocksTotal: previewTotals.blocks,
        previewTokensTotal: previewTotals.tokens,
        mapPreviewBlockCount,
        executionErrorCount: gates.executionErrors.length,
      },
      honestyProbes,
      dedupeProbe,
      trace,
      // Per-case bounded metrics are projected by toBoundedJson below.
      cases,
    };
    await writeFile(resolve(JSON_OUT), JSON.stringify(toBoundedJson(doc), null, 2) + "\n", "utf8");
  }

  process.exitCode = gates.verdict === "FAIL" ? 1 : 0;
}

main().finally(() => cleanupStack.close()).catch((e) => {
  // Do not force-exit while a signal-ignoring handler may still deliver a tracked late receipt.
  process.stderr.write(`retrieval-eval: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exitCode = 1;
});
