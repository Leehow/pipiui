import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compactFailureMemory,
  compactFailureMemoryAtShutdown,
  watermarkMemoryDirectory,
  watermarkThresholds,
} from "../src/memory-watermark.ts";

const DELIMITER = "\n§\n";
/** Default failure cap: memoryCharLimit (5000) * 2. */
const DEFAULT_FAILURE_LIMIT = 10_000;

/** Entries wide enough that a handful crosses the cap, each individually small. */
function entries(count: number, size = 500): string[] {
  return Array.from({ length: count }, (_, index) => `entry-${index}`.padEnd(size, "."));
}

async function memoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pipi-watermark-"));
  await mkdir(join(dir, "pi-hermes-memory"), { recursive: true });
  return dir;
}

test("a store below the high-water mark is left untouched", async () => {
  const root = await memoryDir();
  try {
    const dir = join(root, "pi-hermes-memory");
    const content = entries(10).join(DELIMITER);
    await writeFile(join(dir, "failures.md"), content);

    const result = await compactFailureMemory({ memoryDir: dir });

    assert.equal(result.outcome, "below-high-water");
    assert.equal(await readFile(join(dir, "failures.md"), "utf8"), content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a store pinned at the cap is archived back below the low-water mark", async () => {
  const root = await memoryDir();
  try {
    const dir = join(root, "pi-hermes-memory");
    // 19 * 500 + delimiters ≈ 9554 chars — the 99%-of-cap state that makes every
    // subsequent add pay a consolidation subprocess.
    const original = entries(19);
    await writeFile(join(dir, "failures.md"), original.join(DELIMITER));

    const result = await compactFailureMemory({ memoryDir: dir });

    assert.equal(result.outcome, "compacted");
    assert.ok(result.before! > DEFAULT_FAILURE_LIMIT * 0.75, "precondition: above high water");
    assert.ok(result.after! <= DEFAULT_FAILURE_LIMIT * 0.7, `expected <= low water, got ${result.after}`);

    // Nothing is dropped: archive plus remainder reconstitutes the original set,
    // and the surviving entries are the newest ones.
    const remaining = (await readFile(join(dir, "failures.md"), "utf8")).split(DELIMITER);
    const archive = await readFile(join(dir, "failures-archive.md"), "utf8");
    assert.equal(remaining.length + result.archived!, original.length);
    assert.deepEqual(remaining, original.slice(original.length - remaining.length));
    for (const archived of original.slice(0, result.archived!)) {
      assert.ok(archive.includes(archived), "archived entry must be recoverable");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repeated runs are idempotent — the deadband stops the second pass", async () => {
  const root = await memoryDir();
  try {
    const dir = join(root, "pi-hermes-memory");
    await writeFile(join(dir, "failures.md"), entries(19).join(DELIMITER));

    const first = await compactFailureMemory({ memoryDir: dir });
    const second = await compactFailureMemory({ memoryDir: dir });

    assert.equal(first.outcome, "compacted");
    assert.equal(second.outcome, "below-high-water");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archiving appends across sessions rather than replacing the previous block", async () => {
  const root = await memoryDir();
  try {
    const dir = join(root, "pi-hermes-memory");
    await writeFile(join(dir, "failures-archive.md"), "earlier-session-entry");
    await writeFile(join(dir, "failures.md"), entries(19).join(DELIMITER));

    await compactFailureMemory({ memoryDir: dir });

    const archive = await readFile(join(dir, "failures-archive.md"), "utf8");
    assert.ok(archive.startsWith("earlier-session-entry"), "prior archive must survive");
    assert.ok(archive.includes("archived-at="), "new block must carry provenance");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a raised memoryCharLimit raises the cap the watermark is measured against", async () => {
  const root = await memoryDir();
  try {
    const dir = join(root, "pi-hermes-memory");
    const content = entries(19).join(DELIMITER);
    await writeFile(join(dir, "failures.md"), content);

    // 9554 chars is 99% of the default cap but only 60% of a 16000 cap.
    const result = await compactFailureMemory({ memoryDir: dir, config: { memoryCharLimit: 8000 } });

    assert.equal(result.outcome, "below-high-water");
    assert.equal(result.limit, 16_000);
    assert.equal(await readFile(join(dir, "failures.md"), "utf8"), content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a low-water mark that would erase the deadband falls back to the defaults", () => {
  assert.deepEqual(watermarkThresholds({ failureHighWater: 0.7, failureLowWater: 0.9 }), { highWater: 0.75, lowWater: 0.7 });
  assert.deepEqual(watermarkThresholds({ failureHighWater: 0.9, failureLowWater: 0.5 }), { highWater: 0.9, lowWater: 0.5 });
  assert.deepEqual(watermarkThresholds({ failureLowWater: 0 }), { highWater: 0.75, lowWater: 0.7 });
});

test("the user profile is never compacted, however full it is", async () => {
  const root = await memoryDir();
  try {
    const dir = join(root, "pi-hermes-memory");
    const profile = entries(40).join(DELIMITER);
    await writeFile(join(dir, "USER.md"), profile);
    await writeFile(join(dir, "failures.md"), entries(19).join(DELIMITER));

    await compactFailureMemory({ memoryDir: dir });

    assert.equal(await readFile(join(dir, "USER.md"), "utf8"), profile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a concurrent write aborts the trim instead of clobbering it", async () => {
  const root = await memoryDir();
  try {
    const dir = join(root, "pi-hermes-memory");
    const source = join(dir, "failures.md");
    await writeFile(source, entries(19).join(DELIMITER));
    const concurrent = `${entries(19).join(DELIMITER)}${DELIMITER}written-by-hermes-mid-compaction`;

    const result = await compactFailureMemory({
      memoryDir: dir,
      afterArchive: async () => { await writeFile(source, concurrent); },
    });

    assert.equal(result.outcome, "raced");
    // The racing writer's content survives untouched, and the entries this run
    // archived are still recoverable rather than lost to the aborted trim.
    assert.equal(await readFile(source, "utf8"), concurrent);
    const archive = await readFile(join(dir, "failures-archive.md"), "utf8");
    assert.ok(archive.includes("entry-0"), "archive must retain what the aborted trim would have removed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing failure store is a no-op rather than an error", async () => {
  const root = await memoryDir();
  try {
    const result = await compactFailureMemory({ memoryDir: join(root, "pi-hermes-memory") });
    assert.equal(result.outcome, "no-source");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a single oversized entry is kept rather than emptying the store", async () => {
  const root = await memoryDir();
  try {
    const dir = join(root, "pi-hermes-memory");
    const huge = "x".repeat(12_000);
    await writeFile(join(dir, "failures.md"), huge);

    const result = await compactFailureMemory({ memoryDir: dir });

    assert.equal(result.outcome, "nothing-removable");
    assert.equal(await readFile(join(dir, "failures.md"), "utf8"), huge);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown entry point reads the live config and honours a configured memoryDir", async () => {
  const root = await memoryDir();
  try {
    const store = join(root, "custom-store");
    await mkdir(store, { recursive: true });
    await writeFile(join(store, "failures.md"), entries(19).join(DELIMITER));
    await writeFile(
      join(root, "hermes-memory-config.json"),
      JSON.stringify({ memoryDir: store, memoryMode: "policy-only" }),
    );

    const result = await compactFailureMemoryAtShutdown({ PI_CODING_AGENT_DIR: root });

    assert.equal(result.outcome, "compacted");
    assert.ok(result.archived! > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown never throws when the agent root does not exist", async () => {
  const result = await compactFailureMemoryAtShutdown({
    PI_CODING_AGENT_DIR: join(tmpdir(), "pipi-watermark-absent-root"),
  });
  assert.equal(result.outcome, "no-source");
});

test("a legacy memoryDir is redirected to the real store, matching the adapter", () => {
  assert.equal(watermarkMemoryDirectory("/agent", { memoryDir: "/agent/memory" }), join("/agent", "pi-hermes-memory"));
  assert.equal(watermarkMemoryDirectory("/agent", {}), join("/agent", "pi-hermes-memory"));
  assert.equal(watermarkMemoryDirectory("/agent", { memoryDir: "/elsewhere" }), "/elsewhere");
});
