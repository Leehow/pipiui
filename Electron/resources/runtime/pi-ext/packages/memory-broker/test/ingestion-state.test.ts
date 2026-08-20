import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  INGESTION_STATE_FILE,
  IngestionStateReporter,
  ingestionStatePath,
  publishIngestionState,
  readIngestionState,
} from "../src/ingestion-state.ts";

async function catalogRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "pipi-ingestion-"));
}

test("a wired session records that candidates are reaching the catalog", async () => {
  const root = await catalogRoot();
  try {
    const reporter = new IngestionStateReporter(root, () => 1_000);
    await reporter.start(true);
    reporter.forward();
    reporter.forward();
    await reporter.finish();

    const state = await readIngestionState(root);
    assert.equal(state?.wired, true);
    assert.equal(state?.reason, undefined);
    assert.deepEqual(state?.session, { received: 2, forwarded: 2, discarded: 0 });
    assert.equal(state?.lastCandidateAt, 1_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unwired session names the reason and counts what it dropped", async () => {
  const root = await catalogRoot();
  try {
    const reporter = new IngestionStateReporter(root, () => 2_000);
    await reporter.start(false, "no-catalog-port");
    await reporter.discard();
    await reporter.discard();
    await reporter.finish();

    const state = await readIngestionState(root);
    assert.equal(state?.wired, false);
    assert.equal(state?.reason, "no-catalog-port");
    assert.deepEqual(state?.session, { received: 2, forwarded: 0, discarded: 2 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the first discard is published immediately, so a crash still leaves evidence", async () => {
  const root = await catalogRoot();
  try {
    const reporter = new IngestionStateReporter(root, () => 3_000);
    await reporter.start(false, "curator-unavailable");
    await reporter.discard();
    // No finish(): stands in for a session that died before shutdown ran.

    const state = await readIngestionState(root);
    assert.equal(state?.wired, false);
    assert.equal(state?.session.discarded, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the silent-failure case this exists for is distinguishable from an idle session", async () => {
  const idleRoot = await catalogRoot();
  const droppingRoot = await catalogRoot();
  try {
    // Both catalogs stop growing. Only the state file tells them apart.
    const idle = new IngestionStateReporter(idleRoot, () => 4_000);
    await idle.start(true);
    await idle.finish();

    const dropping = new IngestionStateReporter(droppingRoot, () => 4_000);
    await dropping.start(false, "no-catalog-port");
    await dropping.discard();
    await dropping.finish();

    const idleState = await readIngestionState(idleRoot);
    const droppingState = await readIngestionState(droppingRoot);
    assert.equal(idleState?.wired, true);
    assert.equal(idleState?.session.received, 0);
    assert.equal(droppingState?.wired, false);
    assert.ok(droppingState!.session.discarded > 0);
  } finally {
    await rm(idleRoot, { recursive: true, force: true });
    await rm(droppingRoot, { recursive: true, force: true });
  }
});

test("publishing leaves no temp files behind", async () => {
  const root = await catalogRoot();
  try {
    await publishIngestionState(root, { wired: true, session: { received: 0, forwarded: 0, discarded: 0 } });
    await publishIngestionState(root, { wired: true, session: { received: 1, forwarded: 1, discarded: 0 } });

    assert.deepEqual(await readdir(root), [INGESTION_STATE_FILE]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a later session overwrites the previous snapshot in place", async () => {
  const root = await catalogRoot();
  try {
    await publishIngestionState(root, { wired: false, reason: "no-catalog", session: { received: 5, forwarded: 0, discarded: 5 } }, () => 1);
    await publishIngestionState(root, { wired: true, session: { received: 2, forwarded: 2, discarded: 0 } }, () => 2);

    const state = await readIngestionState(root);
    assert.equal(state?.at, 2);
    assert.equal(state?.wired, true);
    assert.equal(state?.reason, undefined, "a recovered session must not inherit the old reason");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unreadable or foreign state reads as absent rather than throwing", async () => {
  const root = await catalogRoot();
  try {
    assert.equal(await readIngestionState(root), undefined, "missing file");

    await writeFile(ingestionStatePath(root), "{ not json");
    assert.equal(await readIngestionState(root), undefined, "corrupt file");

    await writeFile(ingestionStatePath(root), JSON.stringify({ version: 99, wired: true }));
    assert.equal(await readIngestionState(root), undefined, "future version");

    await writeFile(ingestionStatePath(root), JSON.stringify([1, 2, 3]));
    assert.equal(await readIngestionState(root), undefined, "wrong shape");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("diagnostics never throw into a session, even on an unwritable path", async () => {
  const missing = join(tmpdir(), "pipi-ingestion-absent", "nested");
  await publishIngestionState(missing, { wired: true, session: { received: 0, forwarded: 0, discarded: 0 } });

  const reporter = new IngestionStateReporter(missing);
  await reporter.start(false, "no-catalog");
  await reporter.discard();
  await reporter.finish();
  assert.equal(await readIngestionState(missing), undefined);
});
