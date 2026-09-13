import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCatalogCache, writeCatalogCache } from "../agent/catalog-cache.js";
import { floorCatalog, type FetchLike } from "../agent/catalog.js";
import {
  effectiveCatalog,
  refreshDeepSeekCatalog,
  resolveRefreshApiKey,
} from "../agent/catalog-runtime.js";

const SETTINGS_ENV = "PIPIUI_EXT_SETTINGS_DEEPSEEK";
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const BASE = "https://api.deepseek.com";

let root = "";
const cachePath = (): string => join(root, "catalog.json");

function agentDirWith(auth: unknown): string {
  const dir = join(root, "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "auth.json"), JSON.stringify(auth), "utf8");
  return dir;
}

function fetchReturning(ids: string[], calls?: string[]): FetchLike {
  return async (url) => {
    calls?.push(url);
    return { ok: true, status: 200, json: async () => ({ data: ids.map((id) => ({ id })) }) };
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deepseek-runtime-"));
  delete process.env[SETTINGS_ENV];
  delete process.env[AGENT_DIR_ENV];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env[SETTINGS_ENV];
  delete process.env[AGENT_DIR_ENV];
});

describe("credential resolution for the background refresh", () => {
  it("prefers the settings key over the credential store", () => {
    process.env[SETTINGS_ENV] = JSON.stringify({ "ext.deepseek.apiKey": "sk-settings" });
    const agentDir = agentDirWith({ "deepseek-extended": { type: "api_key", key: "sk-stored" } });
    expect(resolveRefreshApiKey({ agentDir })).toBe("sk-settings");
  });

  it("reads auth.json under the extension's own provider id", () => {
    const agentDir = agentDirWith({ "deepseek-extended": { type: "api_key", key: "sk-extended" } });
    expect(resolveRefreshApiKey({ agentDir })).toBe("sk-extended");
  });

  it("falls back to a key filed under the bare `deepseek` id", () => {
    // What a user who logged in before the provider split actually has on disk.
    const agentDir = agentDirWith({ deepseek: { type: "api_key", key: "sk-legacy" } });
    expect(resolveRefreshApiKey({ agentDir })).toBe("sk-legacy");
  });

  it("returns nothing rather than throwing when there is no usable key", () => {
    expect(resolveRefreshApiKey({ agentDir: join(root, "missing") })).toBeUndefined();
    expect(resolveRefreshApiKey({ agentDir: agentDirWith({ deepseek: {} }) })).toBeUndefined();
    expect(resolveRefreshApiKey({ agentDir: agentDirWith("not an object") })).toBeUndefined();
  });

  it("locates the store from the env the host sets on every pi process", () => {
    process.env[AGENT_DIR_ENV] = agentDirWith({ deepseek: { key: "sk-from-env" } });
    expect(resolveRefreshApiKey()).toBe("sk-from-env");
  });
});

describe("effective catalog", () => {
  it("falls back to the shipped floor when nothing is cached", () => {
    expect(effectiveCatalog({ baseUrl: BASE, cachePath: cachePath() }).map((model) => model.id))
      .toEqual(floorCatalog().map((model) => model.id));
  });

  it("prefers a stale cache over the floor — age gates refreshing, not using", () => {
    writeCatalogCache({
      fetchedAt: 0,
      baseUrl: BASE,
      models: [{ ...floorCatalog()[0]!, id: "deepseek-v9", name: "V9" }],
    }, cachePath());
    expect(effectiveCatalog({ baseUrl: BASE, cachePath: cachePath() }).map((model) => model.id))
      .toEqual(["deepseek-v9"]);
  });

  it("ignores a cache built against a different base URL", () => {
    writeCatalogCache({
      fetchedAt: Date.now(),
      baseUrl: "https://proxy.internal",
      models: [{ ...floorCatalog()[0]!, id: "deepseek-v9", name: "V9" }],
    }, cachePath());
    expect(effectiveCatalog({ baseUrl: BASE, cachePath: cachePath() }).map((model) => model.id))
      .toEqual(floorCatalog().map((model) => model.id));
  });
});

describe("background refresh", () => {
  it("writes a catalog the next registration will read", async () => {
    const agentDir = agentDirWith({ deepseek: { key: "sk-1" } });
    const outcome = await refreshDeepSeekCatalog({
      baseUrl: BASE,
      cachePath: cachePath(),
      agentDir,
      now: 5_000,
      fetchImpl: fetchReturning(["deepseek-flash", "deepseek-v9"]),
    });
    expect(outcome.status).toBe("written");
    const cached = readCatalogCache(cachePath());
    expect(cached?.fetchedAt).toBe(5_000);
    expect(cached?.baseUrl).toBe(BASE);
    expect(cached?.models.map((model) => model.id)).toEqual(["deepseek-flash", "deepseek-v9"]);
    expect(effectiveCatalog({ baseUrl: BASE, cachePath: cachePath() }).map((model) => model.id))
      .toEqual(["deepseek-flash", "deepseek-v9"]);
  });

  it("skips the network while the cache is still fresh, and honours force", async () => {
    const agentDir = agentDirWith({ deepseek: { key: "sk-1" } });
    writeCatalogCache({ fetchedAt: 1_000, baseUrl: BASE, models: floorCatalog() }, cachePath());
    const calls: string[] = [];
    const args = {
      baseUrl: BASE,
      cachePath: cachePath(),
      agentDir,
      now: 2_000,
      maxAgeMs: 60_000,
      fetchImpl: fetchReturning(["deepseek-flash"], calls),
    };
    expect(await refreshDeepSeekCatalog(args)).toEqual({ status: "skipped", reason: "fresh" });
    expect(calls).toEqual([]);
    expect((await refreshDeepSeekCatalog({ ...args, force: true })).status).toBe("written");
    expect(calls).toHaveLength(1);
  });

  it("does nothing without a key instead of calling out unauthenticated", async () => {
    const calls: string[] = [];
    const outcome = await refreshDeepSeekCatalog({
      baseUrl: BASE,
      cachePath: cachePath(),
      agentDir: join(root, "missing"),
      fetchImpl: fetchReturning(["deepseek-flash"], calls),
    });
    expect(outcome).toEqual({ status: "skipped", reason: "no-key" });
    expect(calls).toEqual([]);
  });

  it("leaves the previous catalog in place when the refresh fails", async () => {
    const agentDir = agentDirWith({ deepseek: { key: "sk-1" } });
    writeCatalogCache({ fetchedAt: 1_000, baseUrl: BASE, models: floorCatalog() }, cachePath());
    const outcome = await refreshDeepSeekCatalog({
      baseUrl: BASE,
      cachePath: cachePath(),
      agentDir,
      now: 999_000,
      maxAgeMs: 1,
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    });
    expect(outcome.status).toBe("failed");
    expect((outcome as { reason: string }).reason).toContain("401");
    // The old catalog survives: a failed refresh degrades to staleness, not to
    // an empty picker.
    expect(readCatalogCache(cachePath())?.models.map((model) => model.id))
      .toEqual(floorCatalog().map((model) => model.id));
  });

  it("never puts the key in the failure it reports", async () => {
    const agentDir = agentDirWith({ deepseek: { key: "sk-super-secret" } });
    const outcome = await refreshDeepSeekCatalog({
      baseUrl: BASE,
      cachePath: cachePath(),
      agentDir,
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("sk-super-secret");
  });
});
