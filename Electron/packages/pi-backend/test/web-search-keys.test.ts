import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SEARCH_ROUTING } from "../src/web-search-defaults.js";
import {
  applyKeyedSearchRouting,
  readWebSearchApiKeys,
  restoreDefaultSearchRoutingProviders,
  writeWebSearchApiKeys,
} from "../src/web-search-keys.js";

describe("web-search-keys persistence", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("round-trips keys as presence booleans and never echoes values", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-web-keys-"));
    expect(await readWebSearchApiKeys(root)).toEqual({});
    const configured = await writeWebSearchApiKeys(root, { braveApiKey: "sk-secret-brave", tavilyApiKey: "tvly-secret" });
    expect(configured.sort()).toEqual(["braveApiKey", "tavilyApiKey"]);
    const presence = await readWebSearchApiKeys(root);
    expect(presence).toEqual({ braveApiKey: true, tavilyApiKey: true });
    expect(JSON.stringify(presence)).not.toMatch(/sk-secret|tvly-secret/);
    const saved = JSON.parse(await readFile(join(root, "web-search.json"), "utf8")) as Record<string, unknown>;
    expect(saved.braveApiKey).toBe("sk-secret-brave");
    expect(saved.tavilyApiKey).toBe("tvly-secret");
  });

  it("clears a key with an empty string and preserves unrelated config", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-web-keys-clear-"));
    await writeFile(join(root, "web-search.json"), `${JSON.stringify({
      workflow: "none",
      notes: "keep me",
      braveApiKey: "old",
    }, null, 2)}\n`);
    await writeWebSearchApiKeys(root, { braveApiKey: "", tavilyApiKey: "new-key" });
    const saved = JSON.parse(await readFile(join(root, "web-search.json"), "utf8")) as Record<string, unknown>;
    expect(saved.braveApiKey).toBeUndefined();
    expect(saved.tavilyApiKey).toBe("new-key");
    expect(saved.notes).toBe("keep me");
    expect(saved.workflow).toBe("none");
    expect(await readWebSearchApiKeys(root)).toEqual({ tavilyApiKey: true });
  });

  it("reorders searchRouting.providers so keyed providers come first", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-web-keys-order-"));
    await writeFile(join(root, "web-search.json"), `${JSON.stringify({
      searchRouting: { providers: [...DEFAULT_SEARCH_ROUTING.providers], fallbackOn: ["quota"] },
    }, null, 2)}\n`);
    await writeWebSearchApiKeys(root, { kagiApiKey: "kagi-secret" });
    const saved = JSON.parse(await readFile(join(root, "web-search.json"), "utf8")) as {
      searchRouting: { providers: string[] };
    };
    expect(saved.searchRouting.providers[0]).toBe("kagi");
    expect(saved.searchRouting.providers).toContain("exa");
  });

  it("skips reorder when asked and can restore default provider order without deleting keys", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-web-keys-noreorder-"));
    await mkdir(root, { recursive: true });
    await writeWebSearchApiKeys(root, { kagiApiKey: "kagi-secret" });
    const keyed = JSON.parse(await readFile(join(root, "web-search.json"), "utf8")) as {
      searchRouting: { providers: string[] };
    };
    expect(keyed.searchRouting.providers[0]).toBe("kagi");
    await restoreDefaultSearchRoutingProviders(root);
    const restored = JSON.parse(await readFile(join(root, "web-search.json"), "utf8")) as {
      kagiApiKey: string;
      searchRouting: { providers: string[] };
    };
    expect(restored.kagiApiKey).toBe("kagi-secret");
    expect(restored.searchRouting.providers).toEqual([...DEFAULT_SEARCH_ROUTING.providers]);
    await writeWebSearchApiKeys(root, { braveApiKey: "brave-secret" }, { reorder: false });
    const skipped = JSON.parse(await readFile(join(root, "web-search.json"), "utf8")) as {
      searchRouting: { providers: string[] };
    };
    expect(skipped.searchRouting.providers).toEqual([...DEFAULT_SEARCH_ROUTING.providers]);
    await applyKeyedSearchRouting(root);
    const reapplied = JSON.parse(await readFile(join(root, "web-search.json"), "utf8")) as {
      searchRouting: { providers: string[] };
    };
    expect(reapplied.searchRouting.providers[0]).toBe("brave");
    expect(reapplied.searchRouting.providers).toContain("kagi");
  });
});
