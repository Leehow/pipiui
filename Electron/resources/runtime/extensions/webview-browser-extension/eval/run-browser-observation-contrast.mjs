#!/usr/bin/env node
/** Observation-level A/B(/C) only. Never a substitute for an agent-task benchmark. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { OBSERVATION_CASES, TASK_DEFINITIONS, SCHEMA_VERSION } from './fixtures.mjs';
import { createSession, destroySession, dispatchObserve, evalDispatch, loadControllerSource } from './harness.mjs';
import { scoreObservation, evaluateRequiredInfo, observationStats, estimateOutputTokens } from './score.mjs';
import { observeWithOptionalRerank } from '../agent/browser-reranker.ts';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quantile = (values, fraction) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
};

export function summarize(rows) {
  const eligible = rows.filter(row => row.goldExpected === true);
  return {
    runs: rows.length,
    hits: rows.filter(row => row.target?.target === 'hit').length,
    misses: rows.filter(row => row.target?.target === 'miss').length,
    notApplicable: rows.filter(row => row.target?.target === 'not_applicable').length,
    toolFailures: rows.filter(row => row.error).length,
    metricFailures: rows.filter(row => row.target?.target === 'missing_from_dom' || row.target?.target === 'false_positive').length,
    recallDenominator: eligible.length,
    recallAt12: eligible.length ? eligible.filter(row => row.target.recallAt12).length / eligible.length : null,
    coverageComplete: rows.filter(row => row.coverage?.status === 'complete').length,
    // Failures remain in timing/count denominators rather than disappearing.
    observationP50Ms: quantile(rows.map(row => row.durationMs), .5),
    observationP95Ms: quantile(rows.map(row => row.durationMs), .95),
    outputTokensEstimateP50: quantile(rows.map(row => row.tokens?.outputTokensEstimate), .5),
    submittedCount: rows.reduce((n, row) => n + (row.optimization?.submittedCount || 0), 0),
    evaluatedCount: rows.reduce((n, row) => n + (row.optimization?.evaluatedCount || 0), 0),
    inputTokens: rows.reduce((n, row) => n + (row.optimization?.inputTokens || 0), 0),
    fallbackRuns: rows.filter(row => row.optimization?.status === 'fallback').length,
  };
}

async function syntheticConnection(key, telemetry) {
  const { executeBrowserAvailability, executeBrowserRerank } = await import('../../jev-optimizer/agent/dist/browser-rerank.js');
  telemetry.adapterSha256 = createHash('sha256').update(readFileSync(new URL('../../jev-optimizer/agent/dist/browser-rerank.js', import.meta.url))).digest('hex');
  // This authority exists only in this process for the fixed generated fixtures.
  // Never enable real-project browser upload or persist a credential for an eval.
  const raw = JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: 'synthetic-code', browserEnabled: true, browserGeneration: 'synthetic-browser' });
  const deps = {
    env: { EXT_JEV_OPTIMIZER_APIKEY: key, PIPIUI_JEV_GENERATION: 'synthetic-code', PIPIUI_JEV_STATE_FILE: 'synthetic-browser-eval' },
    readState: async () => raw,
  };
  const abort = new AbortController();
  return {
    current: () => ({ signal: abort.signal, offer: {
      version: 1, provider: 'jev-optimizer', instanceId: 'synthetic-browser-eval',
      availability: (root, signal) => executeBrowserAvailability(root, deps, undefined, signal),
      rerank: async input => {
        const result = await executeBrowserRerank(input, deps);
        telemetry.scoreCalls += 1;
        telemetry.httpAttempts += Number(result.submittedCount > 0);
        telemetry.submittedCount += result.submittedCount;
        telemetry.evaluatedCount += result.evaluatedCount;
        telemetry.inputTokens += result.inputTokens || 0;
        return result;
      },
    } }),
    dispose: () => abort.abort(),
  };
}

function coverageFor(fixture, envelope, extras) {
  // Same semantic truth for all groups: can the unshown content still be inspected?
  // Intent intentionally has no pagination cursor; it exposes the ordinary-observe fallback.
  return evaluateRequiredInfo(envelope, fixture.requiredInfo.map(rule => rule.kind === 'field_truthy' && rule.field === 'nextCursor'
    ? { id: rule.id, kind: 'extra_true', extra: 'canInspectRemainder' } : rule), {
    ...extras,
    canInspectRemainder: Boolean(envelope?.nextCursor) || Boolean(envelope?.observationOptimization && envelope.truncated
      && envelope?.limitations?.some(text => text.includes('ordinary observe'))),
  });
}

async function runOne(fixture, viewport, group, repetition, connection) {
  const session = createSession(fixture, { viewport });
  let poolHash = null;
  let actualPoolHash = null;
  let probeMs = 0;
  let envelope;
  let error = null;
  let durationMs = 0;
  let extras = {};
  try {
    const query = { ...fixture.baselineQuery, intent: fixture.intent };
    if (group !== 'A') {
      const probeStart = performance.now();
      const probe = evalDispatch(session, { action: 'prepare_intent_observation', ...query });
      if (!probe.ok) throw new Error(`candidate-probe:${probe.code || 'failed'}`);
      poolHash = digest({ intent: probe.intent, candidates: probe.candidates });
      evalDispatch(session, { action: 'clear' });
      probeMs = performance.now() - probeStart;
    }
    const started = performance.now();
    try {
      if (group === 'A') envelope = dispatchObserve(session, fixture.baselineQuery);
      else {
        const bridge = async (action, params) => {
          const result = evalDispatch(session, { action, ...params });
          if (action === 'prepare_intent_observation' && result.ok) actualPoolHash = digest({ intent: result.intent, candidates: result.candidates });
          if (fixture.viewports && result.observationOptimization) result.observationOptimization.reason = 'multi-target-local';
          return result;
        };
        // Measurements are per-pane; the production consumer still sees the
        // both-viewports flag, so the dual case never makes a cloud request.
        envelope = await observeWithOptionalRerank({ ...query, ...(fixture.viewports ? { target: 'both' } : {}) }, '/synthetic/browser-eval', undefined,
          group === 'C' ? connection : undefined, bridge);
      }
      if (!envelope?.ok) error = { kind: 'tool-error', code: envelope?.code || 'observe-not-ok' };
    } catch { error = { kind: 'tool-error', code: 'observe-threw' }; }
    durationMs = performance.now() - started;
    const gold = viewport.goldSelector ? { ...fixture.gold, selector: viewport.goldSelector, name: viewport.goldName } : fixture.gold;
    const target = error ? { target: 'tool_error', recallAt12: null } : scoreObservation({ session, envelope, gold });
    if (!error && fixture.afterObserve) extras = fixture.afterObserve(session, envelope) || {};
    return {
      caseId: fixture.id, viewport: viewport.id || 'default', repetition, group, goldExpected: fixture.gold.present !== false,
      identity: error ? null : { snapshotHash: digest(envelope.snapshotID), tokenHashes: (envelope.elements || []).map(element => digest(element.token)) },
      target, coverage: error ? { status: 'missing', items: [], missing: fixture.requiredInfo.map(rule => rule.id) } : coverageFor(fixture, envelope, extras),
      stats: error ? null : observationStats(envelope), tokens: error ? null : estimateOutputTokens(envelope),
      durationMs, excludedCandidateProbeMs: probeMs,
      poolHash, actualPoolHash, error,
      optimization: envelope?.observationOptimization || null,
      expectedBaseline: group === 'A' ? fixture.expectedBaseline?.target : undefined,
      baselineDrift: group === 'A' && fixture.expectedBaseline?.target ? target.target !== fixture.expectedBaseline.target : false,
    };
  } catch {
    return { caseId: fixture.id, viewport: viewport.id || 'default', repetition, group, goldExpected: fixture.gold.present !== false,
      target: { target: 'tool_error', recallAt12: null }, coverage: { status: 'missing', items: [], missing: fixture.requiredInfo.map(rule => rule.id) },
      error: { kind: 'fixture-error', code: 'preparation-or-scoring-failed' }, durationMs, excludedCandidateProbeMs: probeMs, poolHash };
  } finally { destroySession(session); }
}

export async function runContrast({ repetitions = 3, liveSynthetic = false, apiKey } = {}) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('repetitions must be an integer from 1 to 10');
  // apiKey is only consulted after an explicit synthetic-upload request.
  if (liveSynthetic && !(typeof apiKey === 'string' && apiKey.trim())) return {
    schemaVersion: SCHEMA_VERSION, mode: 'contrast', ok: false, status: 'not_executed', reason: 'live-synthetic-key-required',
    executed: { observation: false, jev: false, model: false, taskAgent: false }, observations: [],
  };
  const groups = liveSynthetic ? ['A', 'B', 'C'] : ['A', 'B'];
  const consumerSource = readFileSync(new URL('../agent/browser-reranker.ts', import.meta.url), 'utf8');
  const consumerSha256 = createHash('sha256').update(consumerSource).digest('hex');
  const telemetry = { scoreCalls: 0, httpAttempts: 0, submittedCount: 0, evaluatedCount: 0, inputTokens: 0, adapterSha256: null };
  const connection = liveSynthetic ? await syntheticConnection(apiKey, telemetry) : undefined;
  const observations = [];
  const started = performance.now();
  try {
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const order = groups.slice(repetition % groups.length).concat(groups.slice(0, repetition % groups.length));
      for (const fixture of OBSERVATION_CASES) {
        for (const viewport of fixture.viewports || [{}]) {
          for (const group of order) observations.push(await runOne(fixture, viewport, group, repetition + 1, connection));
        }
      }
    }
  } finally { connection?.dispose(); }
  // Verify both snapshot and element-token separation, without persisting raw handles.
  for (const fixture of OBSERVATION_CASES.filter(item => item.viewports)) {
    for (const group of groups) for (let repetition = 1; repetition <= repetitions; repetition++) {
      const panes = observations.filter(row => row.caseId === fixture.id && row.group === group && row.repetition === repetition);
      const identities = panes.map(row => row.identity);
      const tokens = identities.flatMap(identity => identity?.tokenHashes || []);
      const isolated = identities.every(Boolean) && new Set(identities.map(identity => identity.snapshotHash)).size === panes.length
        && tokens.length === new Set(tokens).size;
      for (const row of panes) {
        const rule = row.coverage.items?.find(item => item.id === 'tokens-isolated');
        if (!rule) continue;
        rule.ok = isolated;
        row.coverage.missing = row.coverage.items.filter(item => !item.ok).map(item => item.id);
        row.coverage.status = row.coverage.missing.length ? 'partial' : 'complete';
      }
    }
  }
  const candidatePairs = observations.filter(row => row.group === 'C').map(row => {
    const b = observations.find(other => other.group === 'B' && other.caseId === row.caseId && other.viewport === row.viewport && other.repetition === row.repetition);
    return { caseId: row.caseId, viewport: row.viewport, repetition: row.repetition,
      equal: Boolean(b?.poolHash && row.poolHash === b.poolHash && (!row.actualPoolHash || row.actualPoolHash === row.poolHash)) };
  });
  const groupSummaries = Object.fromEntries(groups.map(group => [group, { status: 'measured', ...summarize(observations.filter(row => row.group === group)) }]));
  if (!liveSynthetic) groupSummaries.C = { status: 'not_executed', reason: 'live-synthetic-not-authorized' };
  const expected = OBSERVATION_CASES.reduce((n, item) => n + (item.viewports?.length || 1), 0) * repetitions * groups.length;
  const failures = observations.filter(row => row.error || row.target?.target === 'missing_from_dom' || row.target?.target === 'false_positive');
  const controller = loadControllerSource();
  return {
    schemaVersion: SCHEMA_VERSION, mode: 'contrast', ok: observations.length === expected && failures.length === 0 && candidatePairs.every(pair => pair.equal),
    executed: { observation: true, jev: telemetry.httpAttempts > 0, model: false, taskAgent: false },
    liveSyntheticRequested: liveSynthetic, jevTransport: telemetry,
    repetitions, independentCases: OBSERVATION_CASES.length, observationRuns: observations.length, expectedObservationRuns: expected,
    controller: { sha256: controller.sha256, bytes: controller.bytes }, consumerSha256, environment: 'jsdom-production-controller',
    groups: groupSummaries, candidatePairs, observations,
    timing: { wallMs: performance.now() - started, includes: 'one production observation path (local or prepare/score/finalize); in-process bridge only',
      excludes: 'fresh fixture setup and extra candidate-pool identity probe; no Electron IPC, model turn or complete task',
      order: 'groups rotated by repetition; same fixtures and viewport reset per run' },
    tasks: { independentTasks: TASK_DEFINITIONS.length, plannedRuns: 36, status: 'not_executed', reason: 'no fixed-model full agent loop executed; fixture clicks are not agent runs' },
    costUsd: { status: 'not_verified' }, verdict: 'observation-only; no end-to-end speed or cost claim',
    coverageNote: 'cursor-based remainder rules use the same semantic continue-inspecting check: cursor for A or truncated output plus explicit ordinary-observe fallback for B/C; gold targets unchanged',
  };
}

export async function main(argv = process.argv.slice(2)) {
  let repetitions = 3;
  let liveSynthetic = false;
  let json;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repetitions') repetitions = Number(argv[++i]);
    else if (argv[i] === '--json') json = argv[++i];
    else if (argv[i] === '--live-synthetic') liveSynthetic = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  const report = await runContrast({ repetitions, liveSynthetic, ...(liveSynthetic ? { apiKey: process.env.TYPESAFE_API_KEY } : {}) });
  if (json) {
    const file = resolve(json); await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({ ok: report.ok, status: report.status, reason: report.reason, groups: report.groups, tasks: report.tasks }, null, 2));
  if (!report.ok) process.exitCode = report.status === 'not_executed' ? 2 : 1;
  return report;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch(() => {
  console.error('browser contrast failed; no complete measurement was produced'); process.exitCode = 1;
});
