import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetInMemoryVault } from "../src/secret-vault.js";
import { createPiHostBackend } from "../src/index.js";

describe("legacy firecrawlApiKey is left untouched", () => {
  let root = "";
  let backend: Awaited<ReturnType<typeof createPiHostBackend>> | undefined;
  const repoRuntime = new URL("../../../resources/runtime/", import.meta.url).pathname;
  afterEach(async () => {
    await backend?.close().catch(() => undefined);
    backend = undefined;
    resetInMemoryVault();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("does not migrate or strip other web-search.json fields when saving the pdf-extension token", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-legacy-"));
    const host = join(root, "host");
    const project = join(root, "proj");
    await mkdir(project, { recursive: true });
    backend = createPiHostBackend({
      agentDir: host,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      vaultDir: host,
      runtimeRoot: repoRuntime,
    });
    const added = await backend.handle("addProject", [project]) as { id: string };
    const agent = join(project, ".pi", "agent");
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "web-search.json"), `${JSON.stringify({ tavilyApiKey: "tvly-keep", firecrawlApiKey: "fc-legacy" }, null, 2)}\n`);
    const saved = (await backend.handle("updateExtensionSettings", [
      "pdf-extension",
      { "ext.pdf-extension.aistudioAccessToken": "ast-new-value" },
      added.id,
    ])) as { ok: boolean };
    expect(saved.ok).toBe(true);
    const leftover = JSON.parse(await readFile(join(agent, "web-search.json"), "utf8"));
    expect(leftover).toEqual({ tavilyApiKey: "tvly-keep", firecrawlApiKey: "fc-legacy" });
    // Firecrawl keys are never inferred as PaddleOCR credentials.
    expect(JSON.stringify(await backend.handle("getExtensionSettings", ["pdf-extension", added.id]))).not.toContain("fc-legacy");
    expect(JSON.stringify(await backend.handle("getExtensionSettings", ["pdf-extension", added.id]))).not.toContain("ast-new-value");
    await backend.close();
  });
});
