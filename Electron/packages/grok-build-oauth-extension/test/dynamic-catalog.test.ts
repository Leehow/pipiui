import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { CATALOG_MAX_AGE_MS, GROK_BUILD_CATALOG_URL, loadGrokBuildCatalog, parseGrokBuildCatalog } from "../agent/catalog.js";
import { createAuthProvider } from "../agent/provider.js";

const row = (id = "grok-4.7-build-fast") => ({
  model: id, name: "Grok 4.7 Fast", api_backend: "responses", context_window: 500000,
  supports_reasoning_effort: true, supports_backend_search: true,
  reasoning_efforts: ["low", "medium", "high", "xhigh"].map((id) => ({ id, value: id })),
});
const wire = (id?: string) => ({ data: [row(id)] });
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "grok-catalog-")); dirs.push(dir);
  const authPath = join(dir, "auth.json");
  await writeFile(authPath, JSON.stringify({ "grok-build": { type: "oauth", access: "fixture-access", expires: Date.now() + 3_600_000 } }));
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(wire()));
  return { dir, authPath, cacheDir: dir, fetchImpl };
}

describe("official Grok Build model synchronization", () => {
  it("accepts future model ids and maps official effort choices without trusting transport fields", () => {
    const [model] = parseGrokBuildCatalog({ data: [{ ...row("grok-next"), base_url: "https://evil.invalid", api_key: "secret" }, { ...row("grok-hidden"), hidden: true }] });
    expect(model.id).toBe("grok-next");
    expect(model.thinkingLevelMap).toEqual({ off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null });
    expect(model.contextWindow).toBe(500000);
    expect(JSON.stringify(model)).not.toMatch(/evil|secret/);
    expect(() => parseGrokBuildCatalog({ data: [{ id: "grok-bad" }] })).toThrow();
  });

  it("fetches the official CLI catalog once across concurrent callers and honors freshness", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([loadGrokBuildCatalog(f), loadGrokBuildCatalog(f)]);
    expect(a.map((m) => m.id)).toEqual(["grok-4.7-build-fast"]); expect(b).toEqual(a);
    await loadGrokBuildCatalog(f);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl).toHaveBeenCalledWith(GROK_BUILD_CATALOG_URL, expect.objectContaining({
      redirect: "error", headers: expect.objectContaining({ authorization: "Bearer fixture-access", "X-XAI-Token-Auth": "xai-grok-cli" }),
    }));
    const cache = await readFile(join(f.dir, "grok-build-models.json"), "utf8");
    expect(cache).not.toContain("fixture-access");
    expect(cache).not.toContain("authorization");
  });

  it("refreshes expired metadata and keeps the last successful catalog on outages or malformed replies", async () => {
    const f = await fixture();
    await loadGrokBuildCatalog(f);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + CATALOG_MAX_AGE_MS + 1);
    f.fetchImpl.mockResolvedValueOnce(Response.json(wire("grok-next")));
    expect((await loadGrokBuildCatalog(f))[0].id).toBe("grok-next");
    f.fetchImpl.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    expect((await loadGrokBuildCatalog({ ...f, force: true }))[0].id).toBe("grok-next");
    f.fetchImpl.mockResolvedValueOnce(Response.json({ data: [] }));
    expect((await loadGrokBuildCatalog({ ...f, force: true }))[0].id).toBe("grok-next");
  });

  it("restores disk metadata offline without accepting cached endpoint overrides", async () => {
    const f = await fixture();
    await loadGrokBuildCatalog(f);
    const otherAuth = join(f.dir, "second-auth.json");
    await writeFile(otherAuth, await readFile(f.authPath));
    const cachePath = join(f.dir, "grok-build-models.json");
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    cache.fetchedAt = 1; cache.data.data[0].base_url = "https://evil.invalid";
    await writeFile(cachePath, JSON.stringify(cache));
    f.fetchImpl.mockRejectedValue(new Error("offline"));
    const models = await loadGrokBuildCatalog({ ...f, authPath: otherAuth });
    expect(models[0].id).toBe("grok-4.7-build-fast");
    expect(JSON.stringify(models)).not.toContain("evil");
  });

  it("does not reuse another account's cached catalog or publish a reply after logout", async () => {
    const f = await fixture(); await loadGrokBuildCatalog(f);
    await writeFile(f.authPath, JSON.stringify({ "grok-build": { type: "oauth", access: "another-user", expires: Date.now() + 3_600_000 } }));
    f.fetchImpl.mockRejectedValueOnce(new Error("offline"));
    expect((await loadGrokBuildCatalog(f)).some((m) => m.id === "grok-4.7-build-fast")).toBe(false);
    f.fetchImpl.mockImplementationOnce(async () => { await writeFile(f.authPath, "{}"); return Response.json(wire("grok-next")); });
    expect((await loadGrokBuildCatalog({ ...f, force: true })).some((m) => m.id === "grok-next")).toBe(false);
  });

  it("honors Pi offline mode and bounds an unresponsive catalog request", async () => {
    const f = await fixture(); await loadGrokBuildCatalog(f);
    vi.stubEnv("PI_OFFLINE", "1");
    expect((await loadGrokBuildCatalog({ ...f, force: true }))[0].id).toBe("grok-4.7-build-fast");
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
    f.fetchImpl.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    expect((await loadGrokBuildCatalog({ ...f, force: true }))[0].id).toBe("grok-4.7-build-fast");
  });

  it("registers the refreshed model in a real Pi runtime on the first load", async () => {
    const f = await fixture();
    const provider = await createAuthProvider(f);
    const runtime = await ModelRuntime.create({ authPath: f.authPath, modelsPath: join(f.dir, "models.json"), allowModelNetwork: false });
    runtime.registerProvider("grok-build", provider);
    await runtime.refresh({ allowNetwork: false });
    const available = (await runtime.getAvailable()).filter((m) => m.provider === "grok-build");
    expect(available.map((m) => m.id)).toEqual(["grok-4.7-build-fast"]);
    expect(available[0]).toMatchObject({ api: "openai-responses", baseUrl: "https://api.x.ai/v1", thinkingLevelMap: { minimal: null, xhigh: "xhigh" } });
  });
});
