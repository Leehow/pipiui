import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runContrast, summarize } from './run-browser-observation-contrast.mjs';

test('A/B use the production paths and retain the same complete case denominator', async () => {
  const oldFetch = globalThis.fetch;
  let network = 0;
  globalThis.fetch = async () => { network++; throw new Error('offline test must not upload'); };
  try {
    const report = await runContrast({ repetitions: 1, apiKey: 'must-be-ignored-without-live-flag' });
    assert.equal(report.ok, true, JSON.stringify(report.observations.filter(row => row.error)));
    assert.equal(report.independentCases, 12);
    assert.equal(report.observationRuns, 26);
    assert.equal(report.groups.A.runs, 13);
    assert.equal(report.groups.B.runs, 13);
    assert.equal(report.groups.A.recallDenominator, 12);
    assert.equal(report.groups.B.recallDenominator, 12);
    assert.equal(report.groups.A.hits, 7);
    assert.equal(report.groups.B.hits, 10);
    assert.equal(report.groups.A.notApplicable, 1);
    assert.equal(report.groups.B.notApplicable, 1);
    assert.equal(report.groups.C.status, 'not_executed');
    assert.equal(report.executed.jev, false);
    assert.equal(report.executed.model, false);
    assert.equal(report.tasks.status, 'not_executed');
    assert.equal(network, 0);
    assert.equal(report.groups.A.coverageComplete, 13);
    assert.equal(report.groups.B.coverageComplete, 13);
    assert.ok(report.observations.filter(row => row.group === 'B').every(row => row.poolHash && row.optimization));
    assert.equal(JSON.stringify(report).includes('must-be-ignored-without-live-flag'), false);
  } finally { globalThis.fetch = oldFetch; }
});

test('positive-target tool failures remain in recall and timing denominators', () => {
  const summary = summarize([
    { goldExpected: true, target: { target: 'hit', recallAt12: true }, durationMs: 5 },
    { goldExpected: true, target: { target: 'tool_error', recallAt12: null }, error: { kind: 'tool-error' }, durationMs: 90 },
    { goldExpected: false, target: { target: 'not_applicable', recallAt12: null }, durationMs: 10 },
  ]);
  assert.equal(summary.runs, 3);
  assert.equal(summary.recallDenominator, 2);
  assert.equal(summary.recallAt12, .5);
  assert.equal(summary.toolFailures, 1);
  assert.equal(summary.observationP95Ms, 90);
});

test('live synthetic mode without a key is explicitly not executed, never a mock score', async () => {
  const report = await runContrast({ liveSynthetic: true });
  assert.equal(report.ok, false);
  assert.equal(report.status, 'not_executed');
  assert.equal(report.reason, 'live-synthetic-key-required');
  assert.equal(report.executed.jev, false);
  assert.deepEqual(report.observations, []);
});

test('repetition bounds reject incomplete or accidental unbounded experiments', async () => {
  for (const repetitions of [0, 11, 1.5, NaN]) await assert.rejects(() => runContrast({ repetitions }));
});
