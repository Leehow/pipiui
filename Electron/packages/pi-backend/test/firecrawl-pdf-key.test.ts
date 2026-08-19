import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

describe("legacy firecrawlApiKey is left untouched", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("does not migrate or strip other web-search.json fields when saving PaddleOCR token", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-legacy-"));
    const host = join(root, "host");
    const project = join(root, "proj");
    await mkdir(project, { recursive: true });
    const backend = createPiHostBackend({
      agentDir: host,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const added = await backend.handle("addProject", [project]) as { id: string };
    const agent = join(project, ".pi", "agent");
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "web-search.json"), `${JSON.stringify({ tavilyApiKey: "tvly-keep", firecrawlApiKey: "fc-legacy" }, null, 2)}\n`);
    await backend.handle("setPaddleOcrAccessToken", [added.id, "ast-new"]);
    const leftover = JSON.parse(await readFile(join(agent, "web-search.json"), "utf8"));
    expect(leftover).toEqual({ tavilyApiKey: "tvly-keep", firecrawlApiKey: "fc-legacy" });
    expect(JSON.stringify(await backend.handle("getPaddleOcrStatus", [added.id]))).not.toContain("ast-new");
    expect(JSON.stringify(await backend.handle("getPaddleOcrStatus", [added.id]))).not.toContain("fc-legacy");
    await backend.close();
  });
});
