// Pipi UI — built-in browser search & fetch.
// Searches and reads web pages through the app's own browser panel instead of direct HTTP
// requests, so JS-rendered pages render fully and the session's own login state applies.
// Uses the same local HTTP bridge as pipiui-electron-webview.ts; stays dormant without it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { wrapExecForCurator } from "./web-search-curator.mjs";

const PORT = process.env.PIPIUI_BRIDGE_PORT;
const KEY = process.env.PIPIUI_SESSION_KEY;
const CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;

const REQUEST_TIMEOUT_MS = 45_000;
// Wall-clock ceiling for one whole browser_search call (all engines, worst case). The
// per-engine budgets below sum to slightly more than this on purpose: the deadline, not
// the per-engine guesses, is the authoritative budget — the last engine gets clamped to
// whatever is left. 30s keeps three real attempts inside the point where an agent waiting
// on this tool still cares about the answer; beyond that, a fast "all engines failed"
// report the model can act on beats stalling the conversation.
const SEARCH_TOTAL_BUDGET_MS = 30_000;
const MAX_RESULTS = 20;
const MAX_FETCH_CHARS = 60_000;

async function bridge(
  action: string,
  params: Record<string, unknown> = {},
  externalSignal?: AbortSignal,
): Promise<any> {
  const requestID = randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ schemaVersion: 1, sessionCapability: CAPABILITY, action: "browser_action", event: { action, requestID, ...params } }),
    });
    return await res.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("browser request timed out or was cancelled");
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}

function text(t: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text: t }], details };
}

function bridgeFailure(r: any) {
  return {
    content: [{ type: "text" as const, text: `browser bridge action failed: ${r?.error || "unknown error"}` }],
    details: r || {},
    isError: true,
  };
}

function clampChars(value: string, max: number): { body: string; truncated: boolean } {
  if (value.length <= max) return { body: value, truncated: false };
  return { body: value.slice(0, max), truncated: true };
}

type SearchResult = { title: string; url: string; snippet: string };

/**
 * One way to find results on an engine's page: anchors are located globally, then each
 * anchor's `container` ancestor scopes the snippet lookup and the ad `skip` check. Strategies
 * are tried in order until one yields results, so a single renamed class no longer breaks the
 * engine — it just falls through to a looser strategy (the last one drops snippets entirely).
 */
type EngineStrategy = {
  container: string;
  anchor: string;
  snippet: string;
  skip?: string;
  /** Row-paired snippet (DuckDuckGo Lite): the engine serves every result as a run of
   * adjacent <tr>s inside one shared table, so the snippet is a nearby row of this
   * result rather than a descendant of a per-result container. A container-scoped
   * querySelector would pair every anchor with the table's first snippet. */
  snippetInSiblingRows?: boolean;
};

type EngineSpec = {
  name: string;
  buildUrl: (query: string) => string;
  /** Per-engine wall-clock ceiling (navigate + extract). Further clamped by the
   * chain-level deadline to whatever budget remains when the engine starts. */
  timeoutMs: number;
  /** Selectors that mean "the engine answered with a bot-check instead of results". */
  challenge: string[];
  strategies: EngineStrategy[];
};

/**
 * Engine chain, in fallback order:
 * - duckduckgo-html: the classic no-JS endpoint, historically the lightest to parse.
 * - duckduckgo-lite: separate DDG endpoint with a table markup that has been stable for
 *   ~a decade — survives html.duckduckgo.com redesigns, though not DDG-wide rate limits.
 * - bing: a different provider entirely, so provider-wide DDG blocks/outages stop
 *   cascading; its server-rendered li.b_algo markup has also been stable for years.
 */
const SEARCH_ENGINES: EngineSpec[] = [
  {
    name: "duckduckgo-html",
    buildUrl: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    // 12s: a healthy navigate+extract over the local bridge lands in single-digit
    // seconds even on a cold load; 12s is ~4x that while still reserving most of the
    // chain budget for the fallbacks (the old 25s let one stalled engine eat it all).
    timeoutMs: 12_000,
    challenge: ["#challenge-form"],
    strategies: [
      { container: ".result", anchor: "a.result__a", snippet: ".result__snippet", skip: ".result--ad, .result--ad-wrap" },
      { container: ".web-result", anchor: "a.result__a", snippet: ".result__snippet", skip: ".result--ad" },
      { container: "", anchor: "a.result__a", snippet: "" },
    ],
  },
  {
    name: "duckduckgo-lite",
    buildUrl: (query) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    // 10s: fallbacks run only after the primary already failed, so they get a real but
    // leaner shot (the lite page is small and renders without JS).
    timeoutMs: 10_000,
    challenge: ["#challenge-form"],
    strategies: [
      { container: "table", anchor: "a.result-link", snippet: "td.result-snippet", snippetInSiblingRows: true },
      { container: "tr", anchor: "a.result-link", snippet: ".result-snippet", snippetInSiblingRows: true },
      { container: "", anchor: "a.result-link", snippet: "" },
    ],
  },
  {
    name: "bing",
    buildUrl: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    // 10s: same fallback reasoning as lite — different provider, similar page weight.
    timeoutMs: 10_000,
    challenge: [".b_captcha"],
    strategies: [
      { container: "li.b_algo", anchor: "h2 a", snippet: ".b_caption p", skip: ".b_ad" },
      { container: "li.b_algo", anchor: "h2 a", snippet: ".b_algoSlug, .b_caption p, p", skip: ".b_ad" },
      { container: "", anchor: "li.b_algo h2 a", snippet: "" },
    ],
  },
];

/**
 * Builds the page-world extractor for one engine. Kept as a plain function body (no template
 * interpolation of user input) — the only interpolated values are the static strategy /
 * challenge literals (via JSON) and the already-validated integer count, so the query itself
 * never enters the injected string; it only ever travels inside the navigation URL.
 *
 * Result links are engine redirects — DuckDuckGo wraps destinations as `/l/?uddg=<encoded>`
 * (current) or `/y.js?u3=<encoded>` (older); Bing wraps them as
 * `bing.com/ck/a?...&u=a1<base64url>`. All decode to the real destination; anything else
 * passes through as-is.
 */
function buildExtractorJs(spec: EngineSpec, count: number): string {
  return `(() => {
  const strategies = ${JSON.stringify(spec.strategies)};
  const challengeSelectors = ${JSON.stringify(spec.challenge)};
  const max = ${Math.max(1, Math.trunc(count))};
  const decode = (href) => {
    try {
      const link = new URL(href, location.href);
      if (link.hostname.endsWith("duckduckgo.com") && (link.pathname === "/l/" || link.pathname.startsWith("/y.js"))) {
        const target = link.searchParams.get("uddg") ?? link.searchParams.get("u3");
        if (target) return target;
      }
      if (link.hostname.endsWith("bing.com") && link.pathname === "/ck/a") {
        const u = link.searchParams.get("u");
        if (u && u.startsWith("a1")) {
          try {
            let b64 = u.slice(2).replace(/-/g, "+").replace(/_/g, "/");
            b64 += "=".repeat((4 - (b64.length % 4)) % 4);
            const decoded = atob(b64);
            if (/^https?:\\/\\//i.test(decoded)) return decoded;
          } catch (err) {}
        }
      }
      return link.href;
    } catch (err) { return href; }
  };
  const trim = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  let challenge = false;
  for (const selector of challengeSelectors) {
    try { if (document.querySelector(selector)) { challenge = true; break; } } catch (err) {}
  }
  let out = [];
  for (const st of strategies) {
    out = [];
    const seen = new Set();
    let anchors = [];
    try { anchors = Array.from(document.querySelectorAll(st.anchor)); } catch (err) { anchors = []; }
    for (const anchor of anchors) {
      const raw = anchor.getAttribute ? anchor.getAttribute("href") : null;
      if (!raw) continue;
      const container = st.container ? anchor.closest(st.container) : null;
      if (st.container && !container) continue;
      if (st.skip && container && container.matches(st.skip)) continue;
      const url = decode(raw);
      if (!/^https?:/i.test(url)) continue;
      const key = url.replace(/#[^#]*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      let snippet = "";
      if (st.snippet && container) {
        try {
          let node = null;
          if (st.snippetInSiblingRows) {
            // Row pairing (DuckDuckGo Lite): scan this anchor's own row, then the rows
            // that follow, and stop at the next result's anchor row — the snippet must
            // come from this result's row run, never from a table-wide lookup.
            let row = anchor.closest("tr");
            for (let hops = 0; row && hops < 3; hops++) {
              node = row.querySelector(st.snippet);
              if (node) break;
              row = row.nextElementSibling;
              if (!row || row.querySelector(st.anchor)) break;
            }
          } else {
            node = container.querySelector(st.snippet);
          }
          if (node) snippet = trim(node.textContent);
        } catch (err) {}
      }
      out.push({ title: trim(anchor.textContent), url, snippet });
      if (out.length >= max) break;
    }
    if (out.length > 0) break;
  }
  return JSON.stringify({ results: out, challenge });
})()`;
}

function parseSearchResponse(raw: unknown): { results: SearchResult[]; challenge: boolean } {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return { results: [], challenge: false }; }
  }
  const record = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const items = Array.isArray(record.results) ? record.results : [];
  const results: SearchResult[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!url.startsWith("http")) continue;
    results.push({
      title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : url,
      url,
      snippet: typeof entry.snippet === "string" ? entry.snippet.trim() : "",
    });
  }
  return { results, challenge: record.challenge === true };
}

type EngineOutcome =
  | { ok: true; engine: string; url: string; results: SearchResult[] }
  | { ok: false; engine: string; url: string; error: string };

/**
 * Runs one engine end to end (navigate + extract) under its own deadline. Any failure mode —
 * bridge/network error, non-ok host envelope, bot-check page, or 0 parsed results — is
 * returned as data so the caller can fall through to the next engine.
 */
async function runSearchEngine(
  spec: EngineSpec,
  query: string,
  count: number,
  remainingMs: number,
  signal?: AbortSignal,
): Promise<EngineOutcome> {
  const url = spec.buildUrl(query);
  const timeoutMs = Math.min(spec.timeoutMs, Math.max(1, remainingMs));
  const engineAbort = new AbortController();
  const timer = setTimeout(() => engineAbort.abort(), timeoutMs);
  const forwardAbort = () => engineAbort.abort();
  if (signal?.aborted) engineAbort.abort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const nav = await bridge("navigate", { url, scope: "viewport" }, engineAbort.signal);
    if (!nav || nav.ok !== true) {
      return { ok: false, engine: spec.name, url, error: `navigate failed: ${nav?.error || "bridge error"}` };
    }
    const r = await bridge("eval", { js: buildExtractorJs(spec, count) }, engineAbort.signal);
    if (!r || r.ok !== true) {
      return { ok: false, engine: spec.name, url, error: `result extraction failed: ${r?.error || "bridge error"}` };
    }
    const payload = parseSearchResponse(r.result);
    if (payload.results.length === 0) {
      return {
        ok: false,
        engine: spec.name,
        url,
        error: payload.challenge
          ? "served a bot-check page instead of results (rate limit or fingerprint suspicion)"
          : "0 results parsed from the rendered page",
      };
    }
    return { ok: true, engine: spec.name, url, results: payload.results.slice(0, count) };
  } catch (error) {
    if (signal?.aborted) return { ok: false, engine: spec.name, url, error: "cancelled" };
    if (engineAbort.signal.aborted) return { ok: false, engine: spec.name, url, error: `timed out after ${timeoutMs}ms` };
    return { ok: false, engine: spec.name, url, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

function formatSearchResults(query: string, url: string, results: SearchResult[]): string {
  const lines = [`Search: ${query}`, `Source: ${url}`, `Results: ${results.length}`, ""];
  results.forEach((result, index) => {
    lines.push(`[${index + 1}] ${result.title}`);
    lines.push(`    ${result.url}`);
    if (result.snippet) lines.push(`    ${result.snippet}`);
  });
  lines.push("", "Open any result with fetch_content, or with browser_fetch when it needs JS rendering.");
  return lines.join("\n");
}

function installCuratorOpenIntercept(pi: ExtensionAPI) {
  pi.exec = wrapExecForCurator(pi.exec.bind(pi)) as typeof pi.exec;
}

export default function (pi: ExtensionAPI) {
  if (!PORT || !KEY) return; // Not running inside Pipi UI; stay dormant.
  installCuratorOpenIntercept(pi);

  pi.registerTool({
    name: "browser_search",
    label: "Browser Search",
    description:
      "Web search executed in the built-in browser panel: opens the search page there and extracts results from the rendered DOM. " +
      "Tries DuckDuckGo HTML, then DuckDuckGo Lite, then Bing automatically whenever an engine fails, times out, or serves a bot-check. " +
      "Use it when results need the app's real rendering/login state, or when web_search results look thin. Returns ranked title/url/snippet entries.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      count: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_RESULTS, description: "Max results (default 8)" })),
    }),
    async execute(_id, params, signal) {
      const query = String(params.query ?? "").trim();
      if (!query) return text("browser_search requires a non-empty query.");
      const count = Math.max(1, Math.min(MAX_RESULTS, Math.trunc(Number(params.count ?? 8))));
      const attempts: Array<{ engine: string; url: string; error: string }> = [];
      const deadline = Date.now() + SEARCH_TOTAL_BUDGET_MS;
      for (const spec of SEARCH_ENGINES) {
        if (signal?.aborted) break;
        const remaining = deadline - Date.now();
        if (remaining < 1_000) {
          // Too little budget left for a navigate+extract to be worth starting; record
          // the skip so the failure report still accounts for every engine.
          attempts.push({ engine: spec.name, url: spec.buildUrl(query), error: "skipped: global search budget exhausted" });
          continue;
        }
        const outcome = await runSearchEngine(spec, query, count, remaining, signal);
        if (outcome.ok) {
          let body = formatSearchResults(query, outcome.url, outcome.results);
          if (attempts.length > 0) {
            const skipped = attempts.map((a) => `${a.engine} (${a.error})`).join("; ");
            body += `\n\nNote: fell back to ${outcome.engine} after: ${skipped}.`;
          }
          const details: Record<string, unknown> = { url: outcome.url, engine: outcome.engine, count: outcome.results.length };
          if (attempts.length > 0) details.fallbackFrom = attempts.map((a) => a.engine);
          return text(body, details);
        }
        attempts.push({ engine: outcome.engine, url: outcome.url, error: outcome.error });
      }
      // Every engine failed: report each one's concrete reason so the model can decide
      // between waiting out a bot-check, retrying with other keywords, or web_search.
      const detailLines = attempts.map((a) => `- ${a.engine}: ${a.error} (${a.url})`).join("\n");
      const advice = attempts.some((a) => a.error.includes("bot-check"))
        ? "A bot-check was detected: wait about a minute and retry, or fall back to web_search."
        : "Retry with different keywords, inspect the page with browser {action:\"observe\"}, or use web_search.";
      return {
        content: [{
          type: "text" as const,
          text: `Search: ${query}\nResults: 0 — all ${SEARCH_ENGINES.length} engines failed${signal?.aborted ? " (cancelled)" : ""}.\n\n${detailLines}\n\n${advice}`,
        }],
        details: { query, attempts },
        isError: true,
      };
    },
  });

  pi.registerTool({
    name: "browser_fetch",
    label: "Browser Fetch",
    description:
      "Fetch a URL through the built-in browser panel and return the rendered page text (JS executes, unlike fetch_content). " +
      "Use when fetch_content returns empty/JS-rendered content or a site blocks plain HTTP. mode='text' (default) or 'html'.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to open (scheme optional; localhost defaults to http)" }),
      mode: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("html")])),
    }),
    async execute(_id, params, signal) {
      const url = String(params.url ?? "").trim();
      if (!url) return text("browser_fetch requires a non-empty url.");
      const nav = await bridge("navigate", { url, scope: "viewport" }, signal);
      if (!nav.ok) return bridgeFailure(nav);
      const r = await bridge("content", { mode: params.mode === "html" ? "html" : "text" }, signal);
      if (!r.ok) return bridgeFailure(r);
      const raw = typeof r.content === "string" ? r.content : "";
      if (!raw.trim()) return text(`Page loaded but returned no content: ${nav.url || url}`, { url: nav.url || url });
      const { body, truncated } = clampChars(raw, MAX_FETCH_CHARS);
      const suffix = truncated ? `\n\n[content truncated at ${MAX_FETCH_CHARS} chars]` : "";
      return text(body + suffix, { url: nav.url || url, truncated });
    },
  });
}
