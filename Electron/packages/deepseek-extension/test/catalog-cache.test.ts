import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_CACHE_PATH_ENV,
  CATALOG_CACHE_VERSION,
  defaultCatalogCachePath,
  isCatalogFresh,
  readCatalogCache,
  writeCatalogCache,
} from "../agent/catalog-cache.js";
import { floorCatalog } from "../agent/catalog.js";

let root = "";
function cachePath(): string {
  root = mkdtempSync(join(tmpdir(), "deepseek-catalog-"));
  return join(root, "nested", "catalog.json");
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("catalog cache", () => {
  it("round-trips a catalog through a directory it creates", () => {
    const path = cachePath();
    const models = floorCatalog();
    writeCatalogCache({ fetchedAt: 1_000, baseUrl: "https://api.deepseek.com", models }, path);
    const read = readCatalogCache(path);
    expect(read?.version).toBe(CATALOG_CACHE_VERSION);
    expect(read?.fetchedAt).toBe(1_000);
    expect(read?.models.map((model) => model.id)).toEqual(models.map((model) => model.id));
  });

  it("reads a missing, corrupt or stale-schema file as no cache at all", () => {
    const path = cachePath();
    expect(readCatalogCache(path)).toBeUndefined();
    writeFileSync(path.replace("/nested", ""), "not json", "utf8");
    expect(readCatalogCache(path.replace("/nested", ""))).toBeUndefined();
    const versioned = join(root, "old.json");
    writeFileSync(versioned, JSON.stringify({ version: 0, models: floorCatalog() }), "utf8");
    expect(readCatalogCache(versioned)).toBeUndefined();
  });

  it("re-stamps transport fields from the build, never from the file", () => {
    const path = cachePath();
    writeCatalogCache({ fetchedAt: 1, baseUrl: "https://api.deepseek.com", models: floorCatalog() }, path);
    // Simulate a tampered or older-format cache claiming a different transport.
    const poisoned = {
      version: CATALOG_CACHE_VERSION,
      fetchedAt: 1,
      baseUrl: "https://api.deepseek.com",
      models: [{
        id: "deepseek-flash",
        name: "Flash",
        api: "openai-completions",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
        compat: { thinkingFormat: "openai", supportsStore: true },
        capabilities: { hostedTools: { tools: [] }, nativeSearch: { tools: [] } },
      }],
    };
    writeFileSync(path, JSON.stringify(poisoned), "utf8");
    const read = readCatalogCache(path);
    expect(read?.models[0]?.api).toBe("openai-responses");
    expect(read?.models[0]?.compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    });
    expect(read?.models[0]?.capabilities?.hostedTools.tools).toEqual(["web_search"]);
  });

  it("drops a row with no usable cost instead of inventing one", () => {
    const path = cachePath();
    writeCatalogCache({ fetchedAt: 1, baseUrl: "b", models: floorCatalog() }, path);
    writeFileSync(path, JSON.stringify({
      version: CATALOG_CACHE_VERSION,
      fetchedAt: 1,
      baseUrl: "b",
      models: [
        { id: "priced", cost: { input: 1, output: 2 } },
        { id: "unpriced" },
        { name: "no id", cost: { input: 1, output: 2 } },
      ],
    }), "utf8");
    expect(readCatalogCache(path)?.models.map((model) => model.id)).toEqual(["priced"]);
  });

  it("treats a cache for another account or an expired one as not fresh", () => {
    const cache = {
      version: CATALOG_CACHE_VERSION,
      fetchedAt: 1_000,
      baseUrl: "https://api.deepseek.com",
      models: floorCatalog(),
    };
    expect(isCatalogFresh(cache, { baseUrl: "https://api.deepseek.com", now: 2_000, maxAgeMs: 5_000 })).toBe(true);
    expect(isCatalogFresh(cache, { baseUrl: "https://proxy.internal", now: 2_000, maxAgeMs: 5_000 })).toBe(false);
    expect(isCatalogFresh(cache, { baseUrl: "https://api.deepseek.com", now: 90_000, maxAgeMs: 5_000 })).toBe(false);
    // A clock that moved backwards must not read as permanently fresh.
    expect(isCatalogFresh(cache, { baseUrl: "https://api.deepseek.com", now: 0, maxAgeMs: 5_000 })).toBe(false);
    expect(isCatalogFresh(undefined, { baseUrl: "https://api.deepseek.com" })).toBe(false);
  });

  it("keeps each install's catalog separate instead of sharing one home file", () => {
    // Both halves of the extension load out of the same installed directory, so
    // the path is derived from this module's own location: a PipiUI install and
    // a PipiCOC profile resolve to different roots rather than one shared file.
    delete process.env[CATALOG_CACHE_PATH_ENV];
    const derived = defaultCatalogCachePath();
    expect(derived.endsWith(join("ext-cache", "deepseek-catalog-v1.json"))).toBe(true);
    // Never inside the managed `extensions/` tree — a runtime re-install
    // stage-swaps that directory and would delete the cache with it.
    expect(derived).not.toContain(`${sep}extensions${sep}`);

    process.env[CATALOG_CACHE_PATH_ENV] = join(tmpdir(), "explicit-catalog.json");
    expect(defaultCatalogCachePath()).toBe(join(tmpdir(), "explicit-catalog.json"));
    delete process.env[CATALOG_CACHE_PATH_ENV];
  });
});
