import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeCodeSearch } from "./code-search.js";
import { RefRegistry } from "./protocol.js";
import {
  embedHash,
  rebuildZvecIndex,
  searchSemantic,
  setSemanticSearchForTests,
  zvecAvailable,
  zvecIndexDir,
} from "./zvec-semantic.js";

test("hash embedder is deterministic and unit-length", () => {
  const a = embedHash("theme preference persistence");
  const b = embedHash("theme preference persistence");
  assert.equal(a.length, 256);
  assert.deepEqual(a, b);
  const norm = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6);
});

test("zvec semantic finds a paraphrased fixture and misses garbage", async (t) => {
  if (!(await zvecAvailable())) {
    t.skip("@zvec/zvec native bindings are not installed");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "cr-zvec-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src", "theme.ts"),
      [
        "export function restoreThemePreference() {",
        "  const saved = localStorage.getItem('theme');",
        "  document.body.dataset.theme = saved ?? 'light';",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const rebuilt = await rebuildZvecIndex(root);
    assert.equal(rebuilt.ok, true, rebuilt.reason);
    const hit = await searchSemantic({
      query: "where theme preferences are restored on startup",
      projectRoot: root,
      topK: 5,
    });
    assert.equal(hit.available, true);
    assert.ok(hit.hits.some((row) => row.path.includes("theme.ts")), JSON.stringify(hit.hits));
    const miss = await searchSemantic({
      query: "zqglorb fizzbuzzwizzle",
      projectRoot: root,
      topK: 5,
    });
    assert.equal(miss.available, true);
    assert.equal(miss.hits.length, 0);
    assert.ok(zvecIndexDir(root).includes(".pi/agent/code-retrieval/zvec"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("code_search semantic mode reports zvec when the index hits", async (t) => {
  if (!(await zvecAvailable())) {
    t.skip("@zvec/zvec native bindings are not installed");
    return;
  }
  setSemanticSearchForTests(null);
  const root = await mkdtemp(join(tmpdir(), "cr-zvec-tool-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src", "auth.ts"),
      "/** Sign authentication tokens as JWTs. */\nexport function signToken() { return 'jwt'; }\n",
      "utf8",
    );
    const result = await executeCodeSearch({
      query: "where are authentication tokens signed",
      mode: "semantic",
      projectRoot: root,
      registry: new RefRegistry(),
      excludeGlobs: [],
      sidecar: undefined,
    });
    assert.ok(result.details.hits.length > 0, result.content[0]?.text);
    assert.equal(result.details.provider, "zvec");
    assert.match(result.content[0]!.text, /zvec/);
    assert.doesNotMatch(result.content[0]!.text, /not by meaning/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
