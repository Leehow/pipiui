import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRuntimeMetricsCollector } from "../src/runtime-metrics.ts";

test("runtime metrics are versioned, deterministic, and contain no text fields", () => {
  const metrics = new MemoryRuntimeMetricsCollector(() => 42, "test-platform");
  for (const latencyMs of [1, 5, 2, 4, 3]) metrics.record({ triggered: true, latencyMs, resultCount: 1 });
  const summary = metrics.summary();
  assert.equal(summary.version, 1);
  assert.equal(summary.platform, "test-platform");
  assert.equal(summary.p95LatencyMs, 5);
  assert.equal(summary.sampleCount, 5);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(summary))).sort(), ["p95LatencyMs", "platform", "sampleCount", "totals", "version"]);
  assert.doesNotMatch(JSON.stringify(summary), /query|body|token|typed|text/i);
});
