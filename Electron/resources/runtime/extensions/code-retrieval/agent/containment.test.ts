import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildInlinePreviews } from "./previews.js";
import { RefRegistry } from "./protocol.js";
import { executeReadSpans, resolveProjectFile } from "./read-spans.js";
import { SeenRangeLedger } from "./ledger.js";

const SECRET = "TOP SECRET outside content";

async function withEscapingSymlink<T>(body: (root: string, outerDir: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "cr-contain-"));
  const outerDir = await mkdtemp(join(tmpdir(), "cr-outside-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "demo.ts"), "export const demo = 1;\n", "utf8");
    await writeFile(join(outerDir, "secret.txt"), `${SECRET}\nsecond line\n`, "utf8");
    // In-project path that lexically resolves inside the root but really points out.
    await symlink(join(outerDir, "secret.txt"), join(root, "link.ts"));
    return await body(root, outerDir);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outerDir, { recursive: true, force: true });
  }
}

test("resolveProjectFile rejects an in-project symlink that escapes the project", async () => {
  await withEscapingSymlink(async (root) => {
    assert.equal(await resolveProjectFile(root, "link.ts"), undefined);
    // Relative escape keeps failing too.
    assert.equal(await resolveProjectFile(root, "../outside/secret.txt"), undefined);
    // A genuine in-project file still resolves.
    assert.ok(await resolveProjectFile(root, "src/demo.ts"));
  });
});

test("previews of an escaping symlink render the unavailable marker and never leak source", async () => {
  await withEscapingSymlink(async (root) => {
    const registry = new RefRegistry();
    const records = registry.assignAll([
      { path: "link.ts", startLine: 1, endLine: 2 },
      { path: "src/demo.ts", startLine: 1, endLine: 1 },
    ]);
    const outcome = await buildInlinePreviews(records, { projectRoot: root });
    const leak = outcome.previews.get(records[0]!.ref)!;
    assert.match(leak, /\(preview unavailable\)/);
    assert.ok(!leak.includes(SECRET));
    // The real in-project hit right after it previews fine.
    assert.ok(outcome.previews.get(records[1]!.ref)!.includes("export const demo = 1;"));
  });
});

test("read_spans over an escaping symlink returns no body and no leaked content", async () => {
  await withEscapingSymlink(async (root) => {
    const registry = new RefRegistry();
    const result = await executeReadSpans({
      refs: ["link.ts:1-2"],
      projectRoot: root,
      registry,
      ledger: new SeenRangeLedger(),
      tokenBudget: 4000,
    });
    const text = result.content[0]!.text;
    assert.ok(!text.includes(SECRET), text);
    assert.match(text, /no known refs/, "unresolvable span is dropped, not rendered");
    assert.equal(result.details.hits.length, 0);
  });
});

test("registry-backed hits whose stored path escapes stay refused in read_spans", async () => {
  await withEscapingSymlink(async (root, outerDir) => {
    const registry = new RefRegistry();
    // Simulate a poisoned registry entry (e.g. from an index built before
    // containment existed): assignAll only records what it is given, so plant it.
    const [record] = registry.assignAll([{ path: join(outerDir, "secret.txt"), startLine: 1, endLine: 2 }]);
    registry.clear();
    registry.remember(record!);
    const result = await executeReadSpans({
      refs: [record!.ref],
      projectRoot: root,
      registry,
      ledger: new SeenRangeLedger(),
      tokenBudget: 4000,
    });
    assert.ok(!result.content[0]!.text.includes(SECRET));
    assert.equal(result.details.hits.length, 0);
    assert.match(result.content[0]!.text, /no known refs/);
  });
});
