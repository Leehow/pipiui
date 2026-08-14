// Pipi UI — built-in browser search & fetch.
// Searches and reads web pages through the app's own browser panel instead of direct HTTP
// requests, so JS-rendered pages render fully and the session's own login state applies.
// Uses the same local HTTP bridge as pipiui-electron-webview.ts; stays dormant without it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";

const PORT = process.env.PIPIUI_BRIDGE_PORT;
const KEY = process.env.PIPIUI_SESSION_KEY;
const CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;

const REQUEST_TIMEOUT_MS = 45_000;
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

/**
 * Page-world extractor for the DuckDuckGo HTML endpoint. Kept as a plain function body (no
 * template interpolation) so the injected string can never carry user input; the count is
 * appended as a literal number after validation.
 */
const DDG_EXTRACT_JS = `(() => {
  const decode = (href) => {
    try {
      const link = new URL(href, location.href);
      if (link.hostname.endsWith("duckduckgo.com") && link.pathname.startsWith("/y.js")) {
        const target = link.searchParams.get("uddg");
        if (target) return decodeURIComponent(target);
      }
      return link.href;
    } catch { return href; }
  };
  const trim = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const count = `;

type SearchResult = { title: string; url: string; snippet: string };

function parseSearchResults(raw: unknown): SearchResult[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const results: SearchResult[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!url.startsWith("http")) continue;
    results.push({
      title: typeof record.title === "string" ? record.title.trim() : url,
      url,
      snippet: typeof record.snippet === "string" ? record.snippet.trim() : "",
    });
  }
  return results;
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

export default function (pi: ExtensionAPI) {
  if (!PORT || !KEY) return; // Not running inside Pipi UI; stay dormant.

  pi.registerTool({
    name: "browser_search",
    label: "Browser Search",
    description:
      "Web search executed in the built-in browser panel: opens the search page there and extracts results from the rendered DOM. " +
      "Use it when results need the app's real rendering/login state, or when web_search results look thin. Returns ranked title/url/snippet entries.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      count: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_RESULTS, description: "Max results (default 8)" })),
    }),
    async execute(_id, params, signal) {
      const query = String(params.query ?? "").trim();
      if (!query) return text("browser_search requires a non-empty query.");
      const count = Math.max(1, Math.min(MAX_RESULTS, Math.trunc(Number(params.count ?? 8))));
      const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const nav = await bridge("navigate", { url: target, scope: "viewport" }, signal);
      if (!nav.ok) return bridgeFailure(nav);
      const js = `${DDG_EXTRACT_JS}${count};\n  const out = [];\n  for (const result of document.querySelectorAll(".result")) {\n    const anchor = result.querySelector("a.result__a");\n    if (!anchor || !anchor.getAttribute("href")) continue;\n    out.push({ title: trim(anchor.textContent), url: decode(anchor.getAttribute("href")), snippet: trim(result.querySelector(".result__snippet") ? result.querySelector(".result__snippet").textContent : "") });\n    if (out.length >= count) break;\n  }\n  return JSON.stringify(out);\n})()`;
      const r = await bridge("eval", { js }, signal);
      if (!r.ok) return bridgeFailure(r);
      const results = parseSearchResults(r.result);
      if (results.length === 0) {
        return text(
          `Search: ${query}\nSource: ${target}\nResults: 0\n\nNo results parsed. Use browser {action:"observe"} on the current page to inspect it, or retry with different keywords.`,
          { url: target },
        );
      }
      return text(formatSearchResults(query, target, results), { url: target, count: results.length });
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
