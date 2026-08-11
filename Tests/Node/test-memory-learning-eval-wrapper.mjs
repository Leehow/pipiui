import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wrapper = join(root, "scripts/run-memory-learning-eval.mjs");

async function run(cwd, report) {
  const { stdout } = await execFileAsync(process.execPath, [wrapper, "--json", report], { cwd, maxBuffer: 1024 * 1024 });
  assert.match(stdout, /Memory eval v1: PASS/);
  return JSON.parse(await readFile(resolve(cwd, report), "utf8"));
}

test("root memory eval wrapper is cwd-independent and writes the authoritative JSON report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-memory-eval-wrapper-"));
  try {
    const [fromRoot, fromTemporary] = await Promise.all([
      run(root, join(directory, "root.json")),
      run(directory, "temporary.json"),
    ]);
    for (const result of [fromRoot, fromTemporary]) {
      assert.equal(result.sampleCount, 30);
      assert.equal(result.metrics.precisionAt3, 1);
      assert.equal(result.metrics.noMemoryAbstention, 1);
      assert.deepEqual(result.failures, []);
    }
    // Wall-clock p95 is intentionally variable; all deterministic JSON stays equal.
    const stable = (result) => ({ ...result, metrics: { ...result.metrics, retrievalP95Ms: 0 }, performance: { ...result.performance, p95Ms: 0 } });
    assert.deepEqual(stable(fromRoot), stable(fromTemporary));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("root memory eval wrapper forwards clear argument errors", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [wrapper, "--json"], { cwd: tmpdir() }),
    (error) => { assert.equal(error.code, 1); assert.match(error.stderr, /Usage: eval-memory\.ts \[--json <path>\]/); return true; },
  );
});
