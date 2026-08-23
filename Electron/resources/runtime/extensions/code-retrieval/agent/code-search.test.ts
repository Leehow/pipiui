import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeCodeSearch } from "./code-search.js";
import { symbolLayer } from "./hooks.js";
import { RefRegistry } from "./protocol.js";
import { routeQuery, SEMANTIC_UNAVAILABLE_NOTE } from "./route.js";

const FIXTURE = [
  "export function registeredExtensionsForSpawn() {",
  "  return mergedExtensionOverlay();",
  "}",
  "export function mergedExtensionOverlay() {",
  "  // skip a disabled extension so mounted tools are not attached",
  "  return {};",
  "}",
  "",
].join("\n");

async function withFixture<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "cr-search-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "spawn.ts"), FIXTURE, "utf8");
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("short symbol stays exact and finds the identifier", async () => {
  assert.equal(routeQuery("validateSession"), "exact");
  await withFixture(async (root) => {
    await writeFile(join(root, "src", "auth.ts"), "export function validateSession() { return 1; }\n", "utf8");
    const result = await executeCodeSearch({
      query: "validateSession",
      mode: "auto",
      projectRoot: root,
      registry: new RefRegistry(),
      excludeGlobs: [],
      sidecar: undefined,
    });
    assert.ok(result.details.hits.length > 0);
    assert.ok(result.details.hits.some((hit) => hit.path.includes("auth.ts")));
    assert.ok(!result.content[0]!.text.includes(SEMANTIC_UNAVAILABLE_NOTE));
    assert.ok(!result.content[0]!.text.includes("lexical+symbol fallback (terms:"));
  });
});

test("natural-language auto queries take the hybrid path", async () => {
  assert.equal(routeQuery("哪个模块负责扩展禁用后不挂载 agent 工具"), "hybrid");
  assert.equal(routeQuery("哪个模块负责 extension disabled mounted tools"), "hybrid");
  await withFixture(async (root) => {
    const result = await executeCodeSearch({
      query: "哪个模块负责 extension disabled mounted tools",
      mode: "auto",
      projectRoot: root,
      registry: new RefRegistry(),
      excludeGlobs: [],
      sidecar: undefined,
    });
    assert.match(result.content[0]!.text, /lexical\+symbol fallback/);
    assert.ok(result.details.hits.length > 0);
  });
});

test("multi-term hybrid finds registeredExtensionsForSpawn / mergedExtensionOverlay", async () => {
  await withFixture(async (root) => {
    const prev = symbolLayer.searchSymbols;
    symbolLayer.searchSymbols = async ({ query }) => {
      if (!/registeredExtensionsForSpawn|mergedExtensionOverlay/.test(query)) return [];
      return [
        {
          path: "src/spawn.ts",
          startLine: query.includes("merged") ? 4 : 1,
          endLine: query.includes("merged") ? 7 : 3,
          symbol: query.includes("merged") ? "mergedExtensionOverlay" : "registeredExtensionsForSpawn",
          score: 3,
        },
      ];
    };
    try {
      const byIdent = await executeCodeSearch({
        query: "扩展禁用 registeredExtensionsForSpawn",
        mode: "auto",
        projectRoot: root,
        registry: new RefRegistry(),
        excludeGlobs: [],
        sidecar: undefined,
      });
      const byWords = await executeCodeSearch({
        query: "哪个模块负责 extension disabled mounted tools",
        mode: "auto",
        projectRoot: root,
        registry: new RefRegistry(),
        excludeGlobs: [],
        sidecar: undefined,
      });
      const identText = byIdent.content[0]!.text;
      const wordText = byWords.content[0]!.text;
      const identHits = byIdent.details.hits.map((hit) => hit.symbol ?? hit.path).join(" ");
      assert.match(identText, /registeredExtensionsForSpawn|mergedExtensionOverlay|spawn\.ts/);
      assert.ok(
        /registeredExtensionsForSpawn|mergedExtensionOverlay/.test(identHits) ||
          /registeredExtensionsForSpawn|mergedExtensionOverlay/.test(identText),
      );
      assert.ok(byWords.details.hits.some((hit) => hit.path.includes("spawn.ts")));
      assert.match(wordText, /spawn\.ts|disabled|mounted|extension/);
    } finally {
      if (prev) symbolLayer.searchSymbols = prev;
      else delete symbolLayer.searchSymbols;
    }
  });
});

test("empty open query is honest degraded, not a silent miss", async () => {
  await withFixture(async (root) => {
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
  });
});
