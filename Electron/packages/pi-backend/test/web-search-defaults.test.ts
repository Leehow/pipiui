import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_SEARCH_ROUTING,
  DEFAULT_SSRF,
  DEFAULT_WEB_SEARCH_WORKFLOW,
  WEB_SEARCH_DEFAULTS_MARKER,
  applyWebSearchDefaults,
  ensureWebSearchDefaults,
} from "../src/web-search-defaults.js";

const previousManaged = {
  workflow: DEFAULT_WEB_SEARCH_WORKFLOW,
  searchRouting: DEFAULT_SEARCH_ROUTING,
  ssrf: DEFAULT_SSRF,
};

describe("applyWebSearchDefaults", () => {
  it("seeds Exa keyless, no curator, and 429 fallback onto the previous auto chain", () => {
    const { next, managed } = applyWebSearchDefaults(undefined, undefined);
    expect(next.workflow).toBe("none");
    expect(next.firecrawlBaseUrl).toBeUndefined();
    expect(next.ssrf).toEqual(DEFAULT_SSRF);
    expect(next.searchRouting).toEqual(DEFAULT_SEARCH_ROUTING);
    expect(DEFAULT_SEARCH_ROUTING.providers[0]).toBe("exa");
    expect(DEFAULT_SEARCH_ROUTING.providers.slice(1, 5)).toEqual(["searxng", "openai", "firecrawl", "brave"]);
    expect(DEFAULT_SEARCH_ROUTING.fallbackOn).toContain("quota");
    expect(managed).toEqual(previousManaged);
    expect(next).not.toHaveProperty("firecrawlApiKey");
    expect(next).not.toHaveProperty("exaApiKey");
    expect(next).not.toHaveProperty("provider");
    expect(next).not.toHaveProperty("searchProvider");
  });

  it("leaves user keys, a pinned provider, and a custom workflow alone", () => {
    const current = {
      openaiApiKey: "sk-user",
      provider: "exa",
      workflow: "summary-review",
      firecrawlBaseUrl: "https://crawl.example.com",
    };
    const { next, managed } = applyWebSearchDefaults(current, undefined);
    expect(next).toEqual({ ...current, ssrf: DEFAULT_SSRF });
    expect(next.searchRouting).toBeUndefined();
    expect(managed).toEqual({ ssrf: DEFAULT_SSRF });
  });

  it("removes a still-managed searchRouting after the user pins a provider", () => {
    const current = {
      provider: "brave",
      workflow: "none",
      searchRouting: DEFAULT_SEARCH_ROUTING,
    };
    const { next } = applyWebSearchDefaults(current, previousManaged);
    expect(next.searchRouting).toBeUndefined();
    expect(next.provider).toBe("brave");
    expect(next.workflow).toBe("none");
  });

  it("drops a previously managed firecrawlBaseUrl but keeps a user URL", () => {
    const dropped = applyWebSearchDefaults(
      { firecrawlBaseUrl: "https://api.firecrawl.dev", workflow: "none" },
      { firecrawlBaseUrl: "https://api.firecrawl.dev", workflow: "none" },
    );
    expect(dropped.next.firecrawlBaseUrl).toBeUndefined();

    const kept = applyWebSearchDefaults(
      { firecrawlBaseUrl: "https://self-hosted.example", workflow: "none" },
      { firecrawlBaseUrl: "https://api.firecrawl.dev", workflow: "none" },
    );
    expect(kept.next.firecrawlBaseUrl).toBe("https://self-hosted.example");
  });

  it("refreshes only fields that still match the last managed snapshot", () => {
    const current = {
      workflow: "none",
      firecrawlBaseUrl: "https://self-hosted.example",
      searchRouting: { providers: ["exa"], fallbackOn: ["quota"] },
    };
    const { next } = applyWebSearchDefaults(current, {
      ...previousManaged,
      searchRouting: { providers: ["exa"], fallbackOn: ["quota"] },
    });
    expect(next.workflow).toBe("none");
    expect(next.firecrawlBaseUrl).toBe("https://self-hosted.example");
    expect(next.searchRouting).toEqual(DEFAULT_SEARCH_ROUTING);
  });
});

describe("ensureWebSearchDefaults", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "pipiui-web-search-"));
    dirs.push(dir);
    return dir;
  }

  it("writes web-search.json and a managed snapshot into an empty agent dir", async () => {
    const agentDir = await tempDir();
    expect(await ensureWebSearchDefaults(agentDir)).toBe("created");
    expect(await ensureWebSearchDefaults(agentDir)).toBe("unchanged");
    const config = JSON.parse(await readFile(join(agentDir, "web-search.json"), "utf8"));
    expect(config).toEqual({
      workflow: "none",
      searchRouting: DEFAULT_SEARCH_ROUTING,
      ssrf: DEFAULT_SSRF,
    });
    const marker = JSON.parse(await readFile(join(agentDir, WEB_SEARCH_DEFAULTS_MARKER), "utf8"));
    expect(marker).toEqual({ version: 1, managed: previousManaged });
  });

  it("keeps an existing user key while filling the missing host policy", async () => {
    const agentDir = await tempDir();
    await writeFile(join(agentDir, "web-search.json"), `${JSON.stringify({ tavilyApiKey: "tvly-user" }, null, 2)}\n`);
    expect(await ensureWebSearchDefaults(agentDir)).toBe("updated");
    const config = JSON.parse(await readFile(join(agentDir, "web-search.json"), "utf8"));
    expect(config.tavilyApiKey).toBe("tvly-user");
    expect(config.workflow).toBe(DEFAULT_WEB_SEARCH_WORKFLOW);
    expect(config.searchRouting.providers[0]).toBe("exa");
    expect(config.ssrf).toEqual(DEFAULT_SSRF);
  });

  it("leaves a user-authored ssrf block alone", async () => {
    const agentDir = await tempDir();
    const ssrf = { allowRanges: ["10.0.0.0/8"], trustEnvProxy: true };
    await writeFile(join(agentDir, "web-search.json"), `${JSON.stringify({ ssrf }, null, 2)}\n`);
    expect(await ensureWebSearchDefaults(agentDir)).toBe("updated");
    const config = JSON.parse(await readFile(join(agentDir, "web-search.json"), "utf8"));
    expect(config.ssrf).toEqual(ssrf);
  });
});
