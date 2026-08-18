import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIRECRAWL_API_KEY_FIELD, firecrawlPdfHasKey, readFirecrawlApiKey, writeFirecrawlApiKey } from "../src/firecrawl-pdf-key.js";
import { createPiHostBackend } from "../src/index.js";

describe("firecrawl pdf key store", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("atomically saves, reports hasKey only, preserves other fields, and clears", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-key-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "web-search.json"), `${JSON.stringify({ tavilyApiKey: "tvly-keep", workflow: "none" }, null, 2)}\n`);
    expect(await firecrawlPdfHasKey(agent)).toBe(false);
    expect(await writeFirecrawlApiKey(agent, " fc-secret ")).toBe(true);
    expect(await firecrawlPdfHasKey(agent)).toBe(true);
    expect(await readFirecrawlApiKey(agent)).toBe("fc-secret");
    const saved = JSON.parse(await readFile(join(agent, "web-search.json"), "utf8"));
    expect(saved).toMatchObject({ tavilyApiKey: "tvly-keep", workflow: "none", [FIRECRAWL_API_KEY_FIELD]: "fc-secret" });
    expect((await stat(join(agent, "web-search.json"))).mode & 0o777).toBe(0o600);
    expect(await writeFirecrawlApiKey(agent, null)).toBe(false);
    const cleared = JSON.parse(await readFile(join(agent, "web-search.json"), "utf8"));
    expect(cleared).toEqual({ tavilyApiKey: "tvly-keep", workflow: "none" });
    expect(cleared).not.toHaveProperty(FIRECRAWL_API_KEY_FIELD);
  });

  it("isolates keys per project and never returns the secret over the host API", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-host-"));
    const host = join(root, "host");
    const projectA = join(root, "proj-a");
    const projectB = join(root, "proj-b");
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    const backend = createPiHostBackend({
      agentDir: host,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const a = await backend.handle("addProject", [projectA]) as { id: string };
    const b = await backend.handle("addProject", [projectB]) as { id: string };
    expect(await backend.handle("getFirecrawlPdfStatus", [a.id])).toEqual({ hasKey: false });
    expect(await backend.handle("setFirecrawlPdfApiKey", [a.id, "fc-project-a"])).toEqual({ hasKey: true });
    expect(await backend.handle("getFirecrawlPdfStatus", [a.id])).toEqual({ hasKey: true });
    expect(await backend.handle("getFirecrawlPdfStatus", [b.id])).toEqual({ hasKey: false });
    const dumped = JSON.stringify(await backend.handle("getFirecrawlPdfStatus", [a.id]));
    expect(dumped).not.toContain("fc-project-a");
    await backend.handle("setFirecrawlPdfApiKey", [a.id, null]);
    expect(await backend.handle("getFirecrawlPdfStatus", [a.id])).toEqual({ hasKey: false });
    await backend.close();
  });
});
