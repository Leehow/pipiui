import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repositoryRoot = new URL("../..", import.meta.url).pathname;
const packageRoot = join(repositoryRoot, "Sources/PipiUI/PiExt/packages/memory-broker");
const contractRoot = join(repositoryRoot, "Sources/PipiUI/PiExt/packages/memory-broker-contract");
const { InMemoryMemoryBackend } = await import(`${packageRoot}/src/backend.ts`);
const { importControlledMemoryIfRequested } = await import(`${packageRoot}/src/controlled-memory-migration.ts`);
const { MemoryBrokerServer } = await import(`${packageRoot}/src/server.ts`);

function hash(entries) {
  const payload = [...entries]
    .sort((a, b) => Buffer.compare(Buffer.from(a.id, "utf8"), Buffer.from(b.id, "utf8")))
    .map((entry) => [entry.id, entry.scope, entry.projectPath ?? "", entry.content].join("\u001f"))
    .join("\u001e");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

async function fixture(entries) {
  const root = await mkdtemp(join(tmpdir(), "pipiui-memory-import-"));
  const importFile = join(root, "import.jsonl");
  const receiptFile = join(root, "receipt.json");
  const manifest = {
    version: 1,
    kind: "pipiui-controlled-memory-import-manifest",
    migrationID: "migration-a",
    count: entries.length,
    contentHash: hash(entries),
  };
  const lines = [manifest, ...entries.map((entry) => ({
    version: 1,
    kind: "pipiui-controlled-memory-import-entry",
    migrationID: manifest.migrationID,
    ...entry,
  }))].map((line) => JSON.stringify(line));
  await writeFile(importFile, `${lines.join("\n")}\n`, "utf8");
  return { root, importFile, receiptFile, manifest };
}

test("main package imports verified legacy records durably, readbacks, and resumes idempotently", async () => {
  const data = await fixture([
    { id: "one", scope: "user", content: "remember the verified convention" },
    { id: "two", scope: "project", projectPath: "/project", content: "use narrow edits" },
  ]);
  const backend = new InMemoryMemoryBackend();
  const server = new MemoryBrokerServer({ projectRoot: "/project", backend });
  try {
    await server.start();
    const env = {
      PIPIUI_MEMORY_BROKER_IMPORT_FILE: data.importFile,
      PIPIUI_MEMORY_BROKER_IMPORT_RECEIPT_FILE: data.receiptFile,
    };
    await importControlledMemoryIfRequested(server, env);
    const receipt = JSON.parse(await readFile(data.receiptFile, "utf8"));
    assert.deepEqual(receipt, {
      version: data.manifest.version,
      migrationID: data.manifest.migrationID,
      count: data.manifest.count,
      contentHash: data.manifest.contentHash,
      success: true,
    });
    assert.equal(backend.ingested.length, 2);
    assert.ok(backend.ingested.every((entry) => entry.durable));
    assert.ok(backend.ingested.every((entry) => entry.candidate.provenance === "outcome"));

    await importControlledMemoryIfRequested(server, env);
    assert.equal(backend.ingested.length, 2, "same migration retry dedupes in the authoritative main broker");
  } finally {
    await server.close();
    await rm(data.root, { recursive: true, force: true });
  }
});

test("failed import leaves source data and resumes from its verified progress without duplicating completed entries", async () => {
  const data = await fixture([
    { id: "one", scope: "project", projectPath: "/project", content: "first durable import" },
    { id: "two", scope: "project", projectPath: "/project", content: "second durable import" },
  ]);
  const backend = new InMemoryMemoryBackend();
  const originalIngest = backend.ingest.bind(backend);
  let failSecond = true;
  backend.ingest = async (candidate, context, durable) => {
    if (failSecond && candidate.claim === "second durable import") throw new Error("simulated durable failure");
    await originalIngest(candidate, context, durable);
  };
  const server = new MemoryBrokerServer({ projectRoot: "/project", backend });
  try {
    await server.start();
    const env = {
      PIPIUI_MEMORY_BROKER_IMPORT_FILE: data.importFile,
      PIPIUI_MEMORY_BROKER_IMPORT_RECEIPT_FILE: data.receiptFile,
    };
    await importControlledMemoryIfRequested(server, env);
    const failed = JSON.parse(await readFile(data.receiptFile, "utf8"));
    assert.equal(failed.success, false);
    assert.equal(backend.ingested.length, 1);
    assert.equal(await readFile(data.importFile, "utf8") !== "", true, "package never deletes the legacy import source");

    failSecond = false;
    await importControlledMemoryIfRequested(server, env);
    const complete = JSON.parse(await readFile(data.receiptFile, "utf8"));
    assert.equal(complete.success, true);
    assert.equal(backend.ingested.length, 2, "resume skips the progress-recorded first entry");
  } finally {
    await server.close();
    await rm(data.root, { recursive: true, force: true });
  }
});

test("UTF-8 byte ID ordering has the same hash vector as Swift", async () => {
  const entries = [
    { id: "é", scope: "user", content: "accent" },
    { id: "z", scope: "user", content: "zed" },
    { id: "😀", scope: "project", projectPath: "/项目", content: "emoji" },
    { id: "a", scope: "project", projectPath: "/项目", content: "ascii" },
  ];
  const expected = "7fe47a928adb93e3d2b1c7dc834b5e012110218558bc116426c45e8e623398c6";
  assert.equal(hash(entries), expected);
  const data = await fixture(entries);
  try {
    assert.equal(data.manifest.contentHash, expected);
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
});

test("formal package owns migration while legacy Swift write entry points stay absent", async () => {
  const [extensionSource, migrationSource, appStore] = await Promise.all([
    readFile(join(packageRoot, "src/extension.ts"), "utf8"),
    readFile(join(packageRoot, "src/controlled-memory-migration.ts"), "utf8"),
    readFile(join(repositoryRoot, "Sources/PipiUI/AppStore.swift"), "utf8"),
  ]);
  assert.match(extensionSource, /importControlledMemoryIfRequested/);
  assert.match(migrationSource, /verifyMainImportedCandidate/);
  assert.match(migrationSource, /compareUTF8Bytes/);
  assert.doesNotMatch(migrationSource, /ControlledMemoryStore|func approve\(|func reject\(|func setEnabled\(/);
  assert.doesNotMatch(appStore, /action == "memory_broker"|MemoryBrokerHost|ComputerMemoryBrokerAdapter/);
  assert.doesNotMatch(`${extensionSource}\n${migrationSource}`, /ComputerMemoryBrokerAdapter|MemoryBrokerHost|action:\s*["']memory_broker["']/);
  await assert.rejects(access(join(repositoryRoot, "Sources/PipiUI/ControlledMemory.swift")));
  await assert.rejects(access(join(repositoryRoot, "Sources/PipiUI/Views/ControlledMemoryView.swift")));
  assert.ok(contractRoot.endsWith("memory-broker-contract"));
});
