import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PADDLEOCR_TOKEN_FIELD, paddleocrHasKey, paddleocrMcpEnv, readPaddleocrAccessToken, writePaddleocrAccessToken } from "../src/paddleocr-key.js";
import { createPiHostBackend } from "../src/index.js";

describe("paddleocr token store", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("atomically saves, reports hasKey only, does not touch web-search.json, and clears", async () => {
    root = await mkdtemp(join(tmpdir(), "paddle-key-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "web-search.json"), `${JSON.stringify({ tavilyApiKey: "tvly-keep", firecrawlApiKey: "fc-legacy", workflow: "none" }, null, 2)}\n`);
    expect(await paddleocrHasKey(agent)).toBe(false);
    expect(await writePaddleocrAccessToken(agent, "  token-secret  ")).toBe(true);
    expect(await paddleocrHasKey(agent)).toBe(true);
    expect(await readPaddleocrAccessToken(agent)).toBe("token-secret");
    const saved = JSON.parse(await readFile(join(agent, "paddleocr.json"), "utf8"));
    expect(saved).toEqual({ [PADDLEOCR_TOKEN_FIELD]: "token-secret" });
    expect((await stat(join(agent, "paddleocr.json"))).mode & 0o777).toBe(0o600);
    const search = JSON.parse(await readFile(join(agent, "web-search.json"), "utf8"));
    expect(search).toMatchObject({ tavilyApiKey: "tvly-keep", firecrawlApiKey: "fc-legacy", workflow: "none" });
    expect(await writePaddleocrAccessToken(agent, null)).toBe(false);
    const cleared = JSON.parse(await readFile(join(agent, "paddleocr.json"), "utf8"));
    expect(cleared).not.toHaveProperty(PADDLEOCR_TOKEN_FIELD);
    expect(paddleocrMcpEnv("abc")).toEqual({
      PADDLEOCR_MCP_MODEL: "PaddleOCR-VL-1.6",
      PADDLEOCR_MCP_PPOCR_SOURCE: "aistudio",
      PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN: "abc",
    });
    expect(paddleocrMcpEnv()).not.toHaveProperty("PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN");
  });

  it("isolates tokens per project and never returns the secret over the host API", async () => {
    root = await mkdtemp(join(tmpdir(), "paddle-host-"));
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
    expect(await backend.handle("getPaddleOcrStatus", [a.id])).toEqual({ hasKey: false });
    expect(await backend.handle("setPaddleOcrAccessToken", [a.id, "ast-project-a"])).toEqual({ hasKey: true });
    expect(await backend.handle("getPaddleOcrStatus", [a.id])).toEqual({ hasKey: true });
    expect(await backend.handle("getPaddleOcrStatus", [b.id])).toEqual({ hasKey: false });
    const dumped = JSON.stringify(await backend.handle("getPaddleOcrStatus", [a.id]));
    expect(dumped).not.toContain("ast-project-a");
    await backend.handle("setPaddleOcrAccessToken", [a.id, null]);
    expect(await backend.handle("getPaddleOcrStatus", [a.id])).toEqual({ hasKey: false });
    await backend.close();
  });
});
