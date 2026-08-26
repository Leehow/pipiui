// Offline tests for the multi-engine browser_search extension. No network: the bridge
// fetch is stubbed with fixture HTML, and the page-world extractor JS is executed inside
// jsdom windows loaded from those fixtures — so the exact string injected into the real
// browser panel is what gets tested.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

const EXTENSION = "../../../resources/runtime/extensions/pipiui-browser-search.ts";

type Tool = {
  name: string;
  execute: (id: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<any>;
};

// The extension reads the bridge env at module load, so it must be set before each
// resetModules import. The port is never dialed — fetch is stubbed below.
process.env.PIPIUI_BRIDGE_PORT = "1";
process.env.PIPIUI_SESSION_KEY = "browser-search-test-session";
process.env.PIPIUI_SESSION_CAPABILITY = "browser-search-test-cap";

async function loadSearchTool(): Promise<Tool> {
  vi.resetModules();
  let tool: Tool | undefined;
  const pi = {
    exec: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
    registerTool: vi.fn((definition: Tool) => {
      if (definition.name === "browser_search") tool = definition;
    }),
  };
  const extension = (await import(EXTENSION)).default;
  extension(pi as never);
  if (!tool) throw new Error("browser_search was not registered");
  return tool;
}

/** Bridges every engine fetch to fixture pages; `pages` maps page URL -> html (or envelope). */
function stubBridge(pages: Record<string, string | { ok: false; error: string }>) {
  const navigations: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const event = JSON.parse(String(init?.body ?? "{}")).event ?? {};
    if (event.action === "navigate") {
      navigations.push(String(event.url));
      return { json: async () => ({ ok: true, url: event.url }) };
    }
    if (event.action === "eval") {
      const page = pages[navigations[navigations.length - 1] ?? ""];
      if (page && typeof page !== "string") return { json: async () => page };
      // runScripts:"outside-only" lets window.eval run in the jsdom realm without
      // executing any <script> the fixture might carry.
      const dom = new JSDOM(String(page ?? ""), { url: navigations[navigations.length - 1], runScripts: "outside-only" });
      // Run the real injected extractor against the fixture DOM.
      return { json: async () => ({ ok: true, result: dom.window.eval(String(event.js)) }) };
    }
    return { json: async () => ({ ok: false, error: `unexpected action ${String(event.action)}` }) };
  }));
  return { navigations };
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Fixtures, shaped like the markup each engine actually serves.
// ---------------------------------------------------------------------------

const DDG_HTML_URL = "https://html.duckduckgo.com/html/?q=test%20query";
const DDG_LITE_URL = "https://lite.duckduckgo.com/lite/?q=test%20query";
const BING_URL = "https://www.bing.com/search?q=test%20query";

const ddgHtmlClassic = `<!DOCTYPE html><html><body>
<div class="result result--ad">
  <a class="result__a" href="https://ads.example.com/buy-now">Sponsored: Buy Things</a>
  <a class="result__snippet" href="https://ads.example.com/buy-now">Discounts on things</a>
</div>
<div class="result">
  <a class="result__a" href="/l/?uddg=${enc("https://example.com/ddg-first")}&rut=abc123">First DDG Result</a>
  <a class="result__snippet" href="/l/?uddg=${enc("https://example.com/ddg-first")}">  First   snippet
  text </a>
</div>
<div class="result">
  <a class="result__a" href="/y.js?u3=${enc("https://example.com/legacy-redirect")}&click">Legacy Redirect Result</a>
  <a class="result__snippet" href="/y.js?u3=${enc("https://example.com/legacy-redirect")}">Legacy snippet</a>
</div>
<div class="result">
  <a class="result__a" href="/l/?uddg=${enc("https://example.com/ddg-duplicate#section")}">Duplicate URL Result</a>
  <a class="result__snippet" href="/l/?uddg=${enc("https://example.com/ddg-duplicate#section")}">Snippet with fragment</a>
</div>
<div class="result">
  <a class="result__a" href="/l/?uddg=${enc("https://example.com/ddg-duplicate")}">Dropped Duplicate Entry</a>
  <a class="result__snippet" href="/l/?uddg=${enc("https://example.com/ddg-duplicate")}">Should be deduped away</a>
</div>
</body></html>`;

const ddgHtmlWebResult = `<!DOCTYPE html><html><body>
<div class="web-result">
  <a class="result__a" href="/l/?uddg=${enc("https://example.com/web-result")}">Web Result Container</a>
  <div class="result__snippet">Web result snippet</div>
</div>
</body></html>`;

const ddgHtmlBareAnchors = `<!DOCTYPE html><html><body>
<div class="brand-new-serp">
  <a class="result__a" href="/l/?uddg=${enc("https://example.com/bare-anchor")}">Bare Anchor Result</a>
</div>
</body></html>`;

const ddgHtmlRedesigned = `<!DOCTYPE html><html><body>
<div class="next-gen-layout"><span>Results rendered by a future redesign our selectors do not know.</span></div>
</body></html>`;

const ddgChallenge = `<!DOCTYPE html><html><body>
<form id="challenge-form"><input type="hidden" name="x"></form>
<p>If this persists, please check your connectivity.</p>
</body></html>`;

const ddgLite = `<!DOCTYPE html><html><body>
<table>
  <tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=${enc("https://example.com/lite-first")}&rut=x">Lite First Result</a></td></tr>
  <tr><td class="result-snippet">Lite first snippet</td></tr>
  <tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=${enc("https://example.com/lite-second")}">Lite Second Result</a></td></tr>
  <tr><td class="result-snippet">Lite second snippet</td></tr>
</table>
</body></html>`;

const bingHtml = `<!DOCTYPE html><html><body>
<ul>
<li class="b_algo b_ad"><h2><a href="https://www.bing.com/ck/a?u=a1${Buffer.from("https://ads.example.org/bing-ad").toString("base64url")}">Sponsored Bing</a></h2></li>
<li class="b_algo">
  <h2><a href="https://www.bing.com/ck/a?!&&p=deadbeef&u=a1${Buffer.from("https://example.org/bing-target").toString("base64url")}&ntb=1">Bing Result Title</a></h2>
  <div class="b_caption"><p>Bing caption snippet</p></div>
</li>
<li class="b_algo">
  <h2><a href="https://www.bing.com/ck/a?u=a1${Buffer.from("https://example.org/bing-second").toString("base64url")}">Second Bing Result</a></h2>
  <div class="b_caption"><p>Second bing caption</p></div>
</li>
</ul>
</body></html>`;

const emptyPage = `<!DOCTYPE html><html><body><div>No results at all.</div></body></html>`;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  // The env stays set for the whole file (the module snapshots it at import time;
  // deleting it per test would silently load the extension in its dormant form).
  delete process.env.PIPIUI_BRIDGE_PORT;
  delete process.env.PIPIUI_SESSION_KEY;
  delete process.env.PIPIUI_SESSION_CAPABILITY;
});

describe("browser_search multi-engine fallback", () => {
  it("succeeds on the primary DuckDuckGo HTML engine with redirect decoding and ad skipping", async () => {
    const tool = await loadSearchTool();
    const { navigations } = stubBridge({ [DDG_HTML_URL]: ddgHtmlClassic });
    const result = await tool.execute("t1", { query: "test query" });
    expect(result.isError).toBeUndefined();
    expect(result.details.engine).toBe("duckduckgo-html");
    expect(navigations).toEqual([DDG_HTML_URL]);
    const body: string = result.content[0].text;
    expect(body).toContain("[1] First DDG Result");
    expect(body).toContain("https://example.com/ddg-first");
    expect(body).toContain("First snippet text");
    // /y.js?u3= legacy redirects decode too.
    expect(body).toContain("https://example.com/legacy-redirect");
    // The ad is skipped; the duplicate destination (fragment differs) is deduped.
    expect(body).not.toContain("ads.example.com");
    expect(body).not.toContain("Dropped Duplicate Entry");
    expect(result.details.count).toBe(3);
  });

  it("falls back to DuckDuckGo Lite when the primary engine parses 0 results", async () => {
    const tool = await loadSearchTool();
    const { navigations } = stubBridge({ [DDG_HTML_URL]: ddgHtmlRedesigned, [DDG_LITE_URL]: ddgLite });
    const result = await tool.execute("t2", { query: "test query" });
    expect(result.isError).toBeUndefined();
    expect(result.details.engine).toBe("duckduckgo-lite");
    expect(result.details.fallbackFrom).toEqual(["duckduckgo-html"]);
    expect(navigations).toEqual([DDG_HTML_URL, DDG_LITE_URL]);
    const body: string = result.content[0].text;
    expect(body).toContain("Lite First Result");
    expect(body).toContain("https://example.com/lite-first");
    expect(body).toContain("Lite Second Result");
    expect(body).toContain("https://example.com/lite-second");
    // Snippet pairing: each Lite entry's snippet sits between its own title and the next
    // entry. A container-wide snippet lookup would hand result 2 the table's first
    // snippet and drop "Lite second snippet" entirely (indexOf would then be -1).
    const firstEntry = body.indexOf("[1] Lite First Result");
    const secondEntry = body.indexOf("[2] Lite Second Result");
    expect(firstEntry).toBeGreaterThanOrEqual(0);
    expect(secondEntry).toBeGreaterThan(firstEntry);
    expect(body.indexOf("Lite first snippet")).toBeGreaterThan(firstEntry);
    expect(body.indexOf("Lite first snippet")).toBeLessThan(secondEntry);
    expect(body.indexOf("Lite second snippet")).toBeGreaterThan(secondEntry);
    expect(body).toContain("fell back to duckduckgo-lite after: duckduckgo-html (0 results parsed");
  });

  it("cascades past a bot-check and a bridge failure to Bing and decodes its ck/a redirects", async () => {
    const tool = await loadSearchTool();
    const { navigations } = stubBridge({
      [DDG_HTML_URL]: ddgChallenge,
      [DDG_LITE_URL]: { ok: false, error: "browser page is unavailable" },
      [BING_URL]: bingHtml,
    });
    const result = await tool.execute("t3", { query: "test query" });
    expect(result.isError).toBeUndefined();
    expect(result.details.engine).toBe("bing");
    expect(result.details.fallbackFrom).toEqual(["duckduckgo-html", "duckduckgo-lite"]);
    expect(navigations).toEqual([DDG_HTML_URL, DDG_LITE_URL, BING_URL]);
    const body: string = result.content[0].text;
    expect(body).toContain("Bing Result Title");
    expect(body).toContain("https://example.org/bing-target");
    expect(body).toContain("Bing caption snippet");
    // Each b_algo entry carries its own caption, in entry order (same pairing class of
    // bug the Lite assertions guard against).
    const firstEntry = body.indexOf("[1] Bing Result Title");
    const secondEntry = body.indexOf("[2] Second Bing Result");
    expect(firstEntry).toBeGreaterThanOrEqual(0);
    expect(secondEntry).toBeGreaterThan(firstEntry);
    expect(body.indexOf("Bing caption snippet")).toBeGreaterThan(firstEntry);
    expect(body.indexOf("Bing caption snippet")).toBeLessThan(secondEntry);
    expect(body.indexOf("Second bing caption")).toBeGreaterThan(secondEntry);
    // The b_ad entry is skipped, not decoded to ads.example.org.
    expect(body).not.toContain("ads.example.org");
  });

  it("returns a structured per-engine error when every engine fails", async () => {
    const tool = await loadSearchTool();
    const { navigations } = stubBridge({
      [DDG_HTML_URL]: ddgChallenge,
      [DDG_LITE_URL]: emptyPage,
      [BING_URL]: emptyPage,
    });
    const result = await tool.execute("t4", { query: "test query" });
    expect(result.isError).toBe(true);
    expect(navigations).toEqual([DDG_HTML_URL, DDG_LITE_URL, BING_URL]);
    expect(result.details.attempts).toEqual([
      { engine: "duckduckgo-html", url: DDG_HTML_URL, error: expect.stringContaining("bot-check") },
      { engine: "duckduckgo-lite", url: DDG_LITE_URL, error: expect.stringContaining("0 results parsed") },
      { engine: "bing", url: BING_URL, error: expect.stringContaining("0 results parsed") },
    ]);
    const body: string = result.content[0].text;
    expect(body).toContain("- duckduckgo-html:");
    expect(body).toContain("- duckduckgo-lite:");
    expect(body).toContain("- bing:");
    // A detected bot-check must steer the next action: wait and retry / web_search.
    expect(body).toMatch(/bot-check.*wait|wait.*bot-check/s);
  });

  it("surfaces bridge/network errors per engine and still reports all of them", async () => {
    const tool = await loadSearchTool();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("dial tcp: connection refused"); }));
    const result = await tool.execute("t5", { query: "test query" });
    expect(result.isError).toBe(true);
    expect(result.details.attempts).toHaveLength(3);
    for (const attempt of result.details.attempts) {
      expect(attempt.error).toContain("connection refused");
    }
  });
});

describe("browser_search selector strategy fallback", () => {
  it("tries the .web-result container strategy when .result containers disappear", async () => {
    const tool = await loadSearchTool();
    stubBridge({ [DDG_HTML_URL]: ddgHtmlWebResult });
    const result = await tool.execute("t6", { query: "test query" });
    expect(result.isError).toBeUndefined();
    expect(result.details.engine).toBe("duckduckgo-html");
    const body: string = result.content[0].text;
    expect(body).toContain("Web Result Container");
    expect(body).toContain("https://example.com/web-result");
    expect(body).toContain("Web result snippet");
  });

  it("degrades to the anchor-only strategy (no containers, no snippets) instead of failing", async () => {
    const tool = await loadSearchTool();
    stubBridge({ [DDG_HTML_URL]: ddgHtmlBareAnchors });
    const result = await tool.execute("t7", { query: "test query" });
    expect(result.isError).toBeUndefined();
    expect(result.details.count).toBe(1);
    const body: string = result.content[0].text;
    expect(body).toContain("Bare Anchor Result");
    expect(body).toContain("https://example.com/bare-anchor");
  });

  it("rejects an empty query without touching the bridge", async () => {
    const tool = await loadSearchTool();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await tool.execute("t8", { query: "   " });
    expect(result.content[0].text).toContain("non-empty query");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("browser_search timeout budget", () => {
  it("times engines out at their tightened budgets and clamps the chain to the global deadline", async () => {
    const tool = await loadSearchTool();
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      // A bridge that hangs until its request signal aborts: the per-engine timers are
      // the only clock, so the budgets are asserted exactly — still fully offline.
      vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      ));
      const pending = tool.execute("t10", { query: "test query" });
      // Drive the whole chain: primary 12s + lite 10s leaves 8s of the 30s global
      // budget, so bing runs clamped below its own 10s ceiling.
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(Date.now() - startedAt).toBeLessThanOrEqual(30_000);
      expect(result.details.attempts).toEqual([
        { engine: "duckduckgo-html", url: DDG_HTML_URL, error: "timed out after 12000ms" },
        { engine: "duckduckgo-lite", url: DDG_LITE_URL, error: "timed out after 10000ms" },
        { engine: "bing", url: BING_URL, error: "timed out after 8000ms" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("browser_search cancellation", () => {
  it("stops trying further engines once the caller's signal aborts", async () => {
    const tool = await loadSearchTool();
    const controller = new AbortController();
    const navigations: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const event = JSON.parse(String(init?.body ?? "{}")).event ?? {};
      if (event.action === "navigate") {
        navigations.push(String(event.url));
        return { json: async () => ({ ok: true, url: event.url }) };
      }
      // Abort right after the primary engine's extractor ran, before any fallback starts.
      controller.abort();
      const dom = new JSDOM(ddgHtmlRedesigned, { url: navigations[navigations.length - 1], runScripts: "outside-only" });
      const evaluated = dom.window.eval(String(event.js));
      return { json: async () => ({ ok: true, result: evaluated }) };
    }));
    const result = await tool.execute("t9", { query: "test query" }, controller.signal);
    expect(result.isError).toBe(true);
    expect(navigations).toEqual([DDG_HTML_URL]);
    expect(result.details.attempts).toEqual([
      { engine: "duckduckgo-html", url: DDG_HTML_URL, error: "0 results parsed from the rendered page" },
    ]);
    expect(result.content[0].text).toContain("(cancelled)");
  });
});
