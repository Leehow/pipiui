import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { test } from "node:test";
import { executeCodeSearch } from "./code-search.js";
import { RefRegistry } from "./protocol.js";
import { attachSidecar, detachSidecar, pidAlive, readSidecarSnapshot } from "./sidecar-lifecycle.js";

test("seam 4: killed sidecar makes code_search grep-fallback with details.degraded", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-degrade-"));
  process.env.PIPIUI_CODE_RETRIEVAL_IDLE_MS = "8000";
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "auth.ts"), "export function validateSession() { return 1; }\n", "utf8");

    const sessionId = "seam4-a";
    const conn = await attachSidecar({ projectRoot: root, sessionId, idleMs: 8000 });
    assert.ok(conn, "sidecar should start");
    const pid = conn.pid;
    process.kill(pid, "SIGKILL");
    const deadline = Date.now() + 2000;
    while (pidAlive(pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(pidAlive(pid), false);

    const stale = await readSidecarSnapshot(root);
    const result = await executeCodeSearch({
      query: "validateSession",
      mode: "exact",
      projectRoot: root,
      registry: new RefRegistry(),
      excludeGlobs: [],
      sidecar: stale ? { ...stale } : conn,
    });

    assert.equal(result.details.degraded, true);
    assert.equal(result.details.kind, "code-retrieval.search");
    assert.ok(result.details.hits.length > 0, "must not disguise an empty success");
    assert.match(result.content[0]!.text, /validateSession|R1/);
    assert.match(result.content[0]!.text, /degraded|fallback|grep/i);
    await detachSidecar(root, sessionId);
  } finally {
    delete process.env.PIPIUI_CODE_RETRIEVAL_IDLE_MS;
    await rm(root, { recursive: true, force: true });
  }
});

test("code_search never throws when sidecar is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-absent-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "x.ts"), "export const foo = 1;\n", "utf8");
    const result = await executeCodeSearch({
      query: "foo",
      mode: "exact",
      projectRoot: root,
      registry: new RefRegistry(),
      excludeGlobs: [],
      sidecar: undefined,
    });
    assert.equal(result.details.degraded, true);
    assert.ok(result.details.hits.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic queries degrade honestly instead of pretending success", async () => {
  const root = await mkdtemp(join(tmpdir(), "cr-sem-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "x.ts"), "export const architecture = 1;\n", "utf8");
    const result = await executeCodeSearch({
      query: "why does zqglorb fizzbuzzwizzle work this way?",
      mode: "auto",
      projectRoot: root,
      registry: new RefRegistry(),
      excludeGlobs: [],
      sidecar: undefined,
    });
    assert.equal(result.details.degraded, true);
    assert.equal(result.details.hits.length, 0);
    assert.match(result.content[0]!.text, /semantic unavailable; attempted lexical\+symbol fallback/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
