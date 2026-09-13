import { describe, expect, it } from "vitest";
import {
  fetchDeepSeekModelIds,
  fetchModelsDevMetadata,
  mergeCatalog,
  refreshCatalog,
  uncuratedIds,
  type FetchLike,
} from "../agent/catalog.js";
import { DEEPSEEK_CURATED_MODELS } from "../agent/models.js";

function jsonFetch(routes: Record<string, unknown>, seen?: string[]): FetchLike {
  return async (url, init) => {
    seen?.push(url);
    if (!(url in routes)) return { ok: false, status: 404, json: async () => ({}) };
    const body = routes[url];
    if (body instanceof Error) throw body;
    void init;
    return { ok: true, status: 200, json: async () => body };
  };
}

const MODELS_URL = "https://api.deepseek.com/models";
const DEV_URL = "https://models.dev/api.json";

describe("DeepSeek model discovery", () => {
  it("reads ids from GET /models with a bearer token, in upstream order", async () => {
    const headers: Array<Record<string, string> | undefined> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      expect(url).toBe(MODELS_URL);
      headers.push(init?.headers);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          object: "list",
          data: [
            { id: "deepseek-flash", object: "model", owned_by: "deepseek" },
            { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
            { id: "deepseek-flash", object: "model", owned_by: "deepseek" },
          ],
        }),
      };
    };
    const ids = await fetchDeepSeekModelIds({
      baseUrl: "https://api.deepseek.com/",
      apiKey: "sk-secret",
      fetchImpl,
    });
    expect(ids).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    expect(headers[0]?.Authorization).toBe("Bearer sk-secret");
  });

  it("refuses to invent a catalog from an unusable response", async () => {
    await expect(
      fetchDeepSeekModelIds({
        baseUrl: "https://api.deepseek.com",
        apiKey: "k",
        fetchImpl: jsonFetch({ [MODELS_URL]: { object: "list" } }),
      }),
    ).rejects.toThrow(/unexpected shape/);
    await expect(
      fetchDeepSeekModelIds({
        baseUrl: "https://api.deepseek.com",
        apiKey: "k",
        fetchImpl: jsonFetch({ [MODELS_URL]: { object: "list", data: [] } }),
      }),
    ).rejects.toThrow(/no ids/);
  });
});

describe("catalog merge precedence", () => {
  const modelsDevSaysFlashIsCheap = new Map([
    ["deepseek-flash", { name: "Wrong Name", cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 } }],
    ["deepseek-v9", { name: "DeepSeek V9", reasoning: false, input: ["text", "image"] as Array<"text" | "image">, contextWindow: 2_000_000, maxTokens: 128_000, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } }],
  ]);

  it("keeps curated pricing when models.dev disagrees", () => {
    const merged = mergeCatalog({
      ids: ["deepseek-flash"],
      metadata: modelsDevSaysFlashIsCheap,
    });
    const flash = merged.find((model) => model.id === "deepseek-flash");
    // models.dev has published DeepSeek costs matching neither the peak nor the
    // off-peak table, so it must never overwrite a curated row.
    expect(flash?.cost).toEqual({ input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 });
    expect(flash?.name).toBe("DeepSeek Flash");
    expect(flash?.metadataSource).toBe("curated");
  });

  it("describes an uncurated id from models.dev and says so", () => {
    const merged = mergeCatalog({ ids: ["deepseek-v9"], metadata: modelsDevSaysFlashIsCheap });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "deepseek-v9",
      name: "DeepSeek V9",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 2_000_000,
      maxTokens: 128_000,
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
      metadataSource: "models.dev",
    });
  });

  it("still ships an unknown id, flagged, rather than hiding it", () => {
    const merged = mergeCatalog({ ids: ["deepseek-brand-new"] });
    expect(merged[0]?.id).toBe("deepseek-brand-new");
    expect(merged[0]?.name).toBe("deepseek-brand-new");
    // The guess is the family rate, and `metadataSource` is what keeps it a
    // visible guess rather than a number presented as verified.
    expect(merged[0]?.metadataSource).toBe("family-default");
    expect(merged[0]?.cost).toEqual(DEEPSEEK_CURATED_MODELS[0]?.cost);
  });

  it("never lets the network move a transport field", () => {
    const merged = mergeCatalog({
      ids: ["deepseek-v9"],
      metadata: new Map([[
        "deepseek-v9",
        { name: "V9", cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } },
      ]]),
    });
    expect(merged[0]?.api).toBe("openai-responses");
    expect(merged[0]?.compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    });
  });

  it("drops ids the account can no longer call, keeping curated order", () => {
    const merged = mergeCatalog({ ids: ["deepseek-v4-pro", "zzz-new", "deepseek-flash"] });
    // Curated first in curated order so the default model does not move when a
    // refresh reorders upstream; discovered ids follow in upstream order.
    expect(merged.map((model) => model.id)).toEqual(["deepseek-flash", "deepseek-v4-pro", "zzz-new"]);
    expect(merged.some((model) => model.id === "deepseek-v4-flash")).toBe(false);
  });
});

describe("models.dev parsing", () => {
  it("reads only DeepSeek's slice and only fields it actually carries", async () => {
    const metadata = await fetchModelsDevMetadata({
      fetchImpl: jsonFetch({
        [DEV_URL]: {
          openai: { models: { "gpt-x": { name: "Not ours" } } },
          deepseek: {
            models: {
              "deepseek-v9": {
                name: "DeepSeek V9",
                reasoning: true,
                modalities: { input: ["text", "image", "audio"], output: ["text"] },
                limit: { context: 900, output: 100 },
                cost: { input: 1, output: 2, cache_read: 0.5 },
              },
              "no-cost": { name: "Metadata only" },
            },
          },
        },
      }),
      url: DEV_URL,
    });
    expect(metadata.get("gpt-x")).toBeUndefined();
    expect(metadata.get("deepseek-v9")).toEqual({
      name: "DeepSeek V9",
      reasoning: true,
      // An unsupported modality is dropped rather than passed through.
      input: ["text", "image"],
      contextWindow: 900,
      maxTokens: 100,
      cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 },
    });
    expect(metadata.get("no-cost")?.cost).toBeUndefined();
  });
});

describe("refresh", () => {
  it("does not call models.dev when every live id is curated", async () => {
    const seen: string[] = [];
    const result = await refreshCatalog({
      baseUrl: "https://api.deepseek.com",
      apiKey: "k",
      fetchImpl: jsonFetch({ [MODELS_URL]: { data: [{ id: "deepseek-flash" }] } }, seen),
    });
    expect(result.usedModelsDev).toBe(false);
    expect(seen).toEqual([MODELS_URL]);
    expect(uncuratedIds(["deepseek-flash"])).toEqual([]);
  });

  it("keeps the refresh when models.dev is down, degrading to family defaults", async () => {
    const warnings: string[] = [];
    const result = await refreshCatalog({
      baseUrl: "https://api.deepseek.com",
      apiKey: "k",
      fetchImpl: jsonFetch({
        [MODELS_URL]: { data: [{ id: "deepseek-flash" }, { id: "deepseek-v9" }] },
        [DEV_URL]: new Error("network down"),
      }),
      onWarn: (message) => warnings.push(message),
    });
    expect(result.usedModelsDev).toBe(true);
    expect(result.models.map((model) => model.id)).toEqual(["deepseek-flash", "deepseek-v9"]);
    expect(result.models[1]?.metadataSource).toBe("family-default");
    expect(warnings[0]).toContain("models.dev");
  });

  it("fails the whole refresh when DeepSeek itself is unreachable", async () => {
    await expect(
      refreshCatalog({
        baseUrl: "https://api.deepseek.com",
        apiKey: "k",
        fetchImpl: jsonFetch({ [MODELS_URL]: new Error("ECONNREFUSED") }),
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
