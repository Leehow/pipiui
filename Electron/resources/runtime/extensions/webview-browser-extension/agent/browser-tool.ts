// webview-browser-extension agent half — the `browser` tool.
// Migrated from the single-file `pipiui-electron-webview.ts` mount: tool name,
// schema, wire actions, watch protocol, and result rendering are unchanged;
// every WebContentsView/session call now travels through the versioned Host
// Capability API (`agent/capability-bridge.ts`) instead of raw bridge RPCs.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { capabilityCall } from "./capability-bridge.ts";
import { isTrivialBrowserEval } from "./browser-eval-guard.ts";
import { connectBrowserReranker, observeWithOptionalRerank, type BrowserRerankerConnection } from "./browser-reranker.ts";
import { connectBrowserChoice, runBrowserGoal, type BrowserChoiceConnection, type GoalDependencies } from "./browser-choice-loop.ts";
import { createGoalTextGenerator } from "./browser-choice-text.ts";
type BrowserOptimization = { connection: BrowserRerankerConnection; projectRoot: string; choice?: BrowserChoiceConnection; generateText?: GoalDependencies['generateText'] };
export const BROWSER_AGENT_TOOL_ACTIONS = ["goal"] as const;

const REQUEST_TIMEOUT_MS = 35_000;
// Whole-batch ceiling: per-item timeouts alone would allow 8 × 35s ≈ 280s, which
// can exceed the caller's tool-call deadline. Items not yet started when the budget
// runs out are reported as skipped with budgetExhaustedAt in details.
const BATCH_BUDGET_MS = 150_000;

export const BROWSER_TOOL_DECLARED_ACTIONS = [
  "navigate", "observe", "wait", "click", "input", "type", "select", "fill_form", "scroll",
  "content", "eval", "script", "console", "screenshot", "back", "forward", "reload", "help",
] as const;

/**
 * Watch actions ride a dedicated browser_watch RPC, not the DOM host dispatcher.
 * `watches` lists session watch-registry state (hosted on BrowserSessionHost, not
 * the per-viewport DOM host), and `help` is static text — both are fully served at
 * this extension layer and never forwarded to the DOM host, whose dispatcher
 * would answer `unknown_action`. The tool schema lists them truthfully as actions
 * of this tool; see the HELP/schema alignment test for the pinned contract.
 */
export const BROWSER_WATCH_TOOL_ACTIONS = ["watch", "unwatch", "watches"] as const;

const WATCH_MAX_TIMEOUT_SECS = 1800;

// One gated browser.session call. DOM-action RPCs ride `browser.action`; the
// watch protocol (register/unwatch/watches/subscribe) rides `browser.watch`.
// Envelope shaping, one-time-token redemption, timeout + best-effort disconnect
// cancel live in capability-bridge.ts, keeping this tool body byte-identical
// with the pre-migration implementation.
async function bridge(
  action: string,
  params: Record<string, unknown> = {},
  externalSignal?: AbortSignal,
  rpcAction: "browser_action" | "browser_watch" = "browser_action",
): Promise<any> {
  return capabilityCall(
    rpcAction === "browser_watch" ? "browser.watch" : "browser.action",
    { action, ...params },
    externalSignal,
    REQUEST_TIMEOUT_MS,
  );
}

function text(t: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text: t }], details };
}

// Parameter-validation failures carry isError: true so batch failure detection never
// depends on the rendered help text — a successful content/eval result may legitimately
// end with the full HELP string.
function usage(t: string) {
  return { ...text(t), isError: true as const };
}

function bridgeFailure(r: any) {
  const summary = {
    error: r?.error || "browser bridge action failed",
    code: r?.code,
    requiresObservation: r?.requiresObservation,
    requiresUserInput: r?.requiresUserInput,
    observation: r?.observation,
    ...(Array.isArray(r?.candidates) ? { candidates: r.candidates } : {}),
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
    details: r || {},
    isError: true,
  };
}

function formatObservation(r: any): string {
  if (r?.target === "both" && r.desktop && r.mobile) {
    return ["=== desktop ===", formatObservation({ ...r.desktop, target: undefined }), "", "=== mobile ===", formatObservation({ ...r.mobile, target: undefined })].join("\n");
  }
  const lines = [
    `URL: ${r.url || ""}`,
    `Title: ${r.title || ""}`,
    `Snapshot: ${r.snapshotID || ""}`,
    `Loading: ${r.loading === true}`,
    `Viewport: ${r.viewport?.width || 0}x${r.viewport?.height || 0}`,
    `Scroll: ${r.scroll?.pixelsAbove || 0}px above, ${r.scroll?.pixelsBelow || 0}px below (${r.scroll?.positionPercent || 0}%)`,
  ];
  if (Array.isArray(r.regions) && r.regions.length) {
    lines.push("Regions:");
    for (const region of r.regions) {
      lines.push(JSON.stringify({
        id: region.id,
        name: region.name,
        role: region.role,
        count: region.count,
        more: region.more,
        expanded: region.expanded,
      }));
      for (const element of region.preview || []) lines.push(`  ${JSON.stringify(element)}`);
    }
  }
  if (r.nextCursor) lines.push(`Next cursor: ${r.nextCursor}`);
  lines.push("Elements:");
  for (const element of r.elements || []) lines.push(JSON.stringify(element));
  if (r.observationOptimization) lines.push(`Observation optimization: ${JSON.stringify(r.observationOptimization)}`);
  if (r.truncated) lines.push("[observation truncated: refine region, role, name, cursor, or scroll]");
  if (Array.isArray(r.limitations) && r.limitations.length) {
    lines.push("Limitations:", ...r.limitations.map((item: string) => `- ${item}`));
  }
  if (r.action) lines.push(`Action: ${JSON.stringify(r.action)}`);
  if (typeof r.filled === "number" || Array.isArray(r.results)) {
    lines.push(`Fill form: filled=${r.filled ?? 0} failed=${r.failed ?? 0}`);
    for (const item of r.results || []) lines.push(`  ${JSON.stringify(item)}`);
  }
  if (r.relocated) lines.push("Relocated: true");
  if (r.mutation) lines.push(`Mutation: ${JSON.stringify(r.mutation)}`);
  if (Array.isArray(r.candidates) && r.candidates.length) lines.push(`Candidates: ${JSON.stringify(r.candidates)}`);
  if (r.note) lines.push(`Note: ${r.note}`);
  return lines.join("\n");
}

// Full parameter docs live here, not in the tool schema: help text is delivered as a
// tool result, which appends to the conversation instead of rewriting the cached
// prefix. See docs/progressive-disclosure.md.
const HELP = [
  "browser actions:",
  "",
  "Prefer actions[] (1..8) for consecutive steps that do not need an intermediate observation:",
  "  fill_form all fields then click submit; click then wait; type then Enter.",
  "Pass exactly one of action (single) or actions (batch).",
  "Stop and observe after navigate, after submitting a form, and when a dialog, captcha, or login wall may appear.",
  "A failed step stops the batch; remaining items are skipped. The result lists each index and outcome.",
  "observe/screenshot usually belong at the end of a batch: params are fixed when the batch",
  "starts, so later items cannot consume an earlier item's fresh observation. watch inside a",
  "batch only registers its non-blocking listener; the batch never waits for the condition.",
  "",
  "goal {goal, max_steps?, timeoutSecs?, target?}",
  "                        Standalone bounded Jev Choice control loop (not actions[]). Requires the",
  "                        enabled Jev extension, its saved key and browser-cloud permission.",
  "                        Jev chooses operation + observed target in one request; TYPE_TEXT uses",
  "                        the current session model/auth. Default 12 decisions/30s; caps 30/60s.",
  "                        Single viewport only. Stale targets are reobserved, never relocated.",
  "                        DONE returns needs_verification, NOT verified task success. Check the",
  "                        actual outcome independently. Consequential submissions hand back control.",
  "actions[]               Ordered batch (1..8). Each item is {action, ...same params as a single call}.",
  "                        Mutually exclusive with top-level action.",
  "navigate {url}          Open a URL in the panel and wait for load. Scheme optional;",
  "                        localhost defaults to http. Settles on didFinish + a short network-idle",
  "                        window (resource timing heuristic). Returns a fresh observation.",
  "observe {scope?,target?,region?,role?,name?,cursor?,intent?}",
  "                        intent: current lookup goal (1–512 characters); ranks bounded candidates",
  "                        before display. Local without Jev; cannot combine with cursor. Omit",
  "                        intent for ordinary paging. target=both stays local. Known locators",
  "                        and saved flows need no extra observation or scoring step.",
  "                        Snapshot interactive DOM. Default returns region summaries",
  "                        (region name, element count, first items). region expands one",
  "                        region; role/name filter elements; cursor pages the current view.",
  "                        scope='viewport' (default) or 'page'.",
  "                        target='active' (default), 'desktop', 'mobile', or 'both'.",
  "wait {mode?, selector?, timeout?, idle_ms?, snapshot_id?, element_index|element_token?}",
  "                        mode='selector' (default when selector/target given): wait until a CSS",
  "                        selector is visible, or a snapshot element target is valid again.",
  "                        mode='idle' (default otherwise): wait until document.readyState is",
  "                        complete and Performance resource timing stays quiet for idle_ms",
  "                        (default 400ms, capped below timeout so short waits can report",
  "                        idle). timeout is seconds (default 5, max 25). On success",
  "                        returns a fresh observation; on timeout code=timeout.",
  "                        For waits longer than 25s use watch — wait will not block past 25s.",
  "watch {timeoutSecs, selector? | idle? | url_matches? | expression?}",
  "                        Register a one-shot long wait and return immediately with watchId.",
  "                        timeoutSecs is required (1..1800). Optional intervalMs (min ~2s).",
  "                        Conditions (exactly one, or none = timer alarm at timeoutSecs):",
  "                          selector        CSS selector becomes visible",
  "                          idle / idle_ms  network idle",
  "                          url_matches     URL matches this JS regular expression",
  "                          expression      page JS evaluates strictly === true",
  "                        Use watch when the wait exceeds 25 seconds. After register, do other",
  "                        work or end the turn — you will receive a [browser-watch] message",
  "                        (watchId + reason + waitedMs + URL/title) when it fires.",
  "unwatch {watchId}      Cancel a watch. Missing ids still return ok.",
  "watches                 List active watches for this session.",
  "click {snapshot_id, element_index|element_token} | {locator}",
  "input {snapshot_id, element_index|element_token, text} | {locator, text}",
  "select {snapshot_id, element_index|element_token, option} | {locator, option}",
  "locator               Live query, no snapshot. Exactly one of:",
  "                        {role, name?}  ARIA role + accessible name",
  "                        {label}        label for/text, aria-label, aria-labelledby",
  "                        {text}         visible text",
  "                        {css}          CSS selector (structured selector path)",
  "                      Optional 0-based nth disambiguates. Zero match lists up to",
  "                      5 candidates (role/tag/name); multiple matches require name or nth.",
  "fill_form {fields, snapshot_id?}",
  "                        fields[] = {element_token|locator, value, type?}. locator is",
  "                        {role,name} / {label} / {text} / {css} plus optional nth.",
  "                        Each field is independent: one failure does not stop the rest.",
  "                        Password, OTP, and payment fields return user_handoff_required",
  "                        and are skipped; other fields continue. Result is",
  "                        {filled, failed, results[{index,ok,error?,relocated?}]} plus a",
  "                        batch mutation summary.",
  "scroll {direction?, amount?, selector? | locator? | snapshot_id?, element_index|element_token?}",
  "                        selector or locator scrolls the unique matched element or its nearest",
  "                        scrollable ancestor; 0 or multiple matches, or a hidden target, error",
  "                        instead of scrolling the page. locator uses the same {role,name} /",
  "                        {label} / {text} / {css} (+ optional nth) as click — not a CSS rewrite.",
  "                        amount is 0.1..10 viewport lengths (default 0.8). Mutating actions",
  "                        invalidate the prior snapshot and return a fresh observation plus",
  "                        a compressed mutation summary (DOM add/remove/attr, dialogs, URL).",
  "                        If the original node went stale on the same URL, a unique visible",
  "                        in-viewport match of DOM path+role+name+ordinal is relocated and",
  "                        marked relocated; zero or multiple matches, off-screen/obscured",
  "                        candidates, or any URL change, stay stale. Over-budget mutations",
  "                        report magnitude only (few/some/many), not exact counts.",
  "                        Password, OTP, and payment fields require user handoff in the panel.",
  "content {mode?}         Raw fallback. mode='text' (default) or 'html'; may be large.",
  "                        Output is sanitized with the same redaction as observe",
  "                        (sensitive values → [redacted], sensitive URL params cleaned).",
  "                        Over-capacity fails closed. Prefer observe/click/input.",
  "eval {js}               Page-DOM only. Never string literals / keep-alive; use observe then click/input.",
  "                        Return values are sanitized with the same redaction as observe.",
  "                        Over-capacity fails closed. Prefer observe/click/input.",
  "script {js}             Async page script with await/return, step(label), and el(token).",
  "                        25s deadline; results are JSON-safe and truncated (~20k). Failures",
  "                        include stack/line/steps; side effects are not rolled back.",
  "                        step()/el() return values are sanitized with the same redaction as observe.",
  "console {clear?, since_seq?, level?, limit?}",
  "                        Console output (log/info/warn/error) for the current virtual tab.",
  "                        Cursor is since_seq; limit caps at 200. clear=true empties the buffer.",
  "screenshot {target?}    Screenshot of the current page, returned as an image you can look at.",
  "                        target='active' (default), 'desktop', 'mobile', or 'both'. both returns",
  "                        two image parts labeled desktop/mobile. WARNING: pixels are not redacted",
  "                        — passwords/OTP/card numbers visible on screen will appear in the image.",
  "                        Avoid capturing auth/checkout UI unless the user explicitly needs a visual check.",
  "",
  "Structured DOM covers the main document, open shadow roots, and one same-origin iframe level.",
  "Use screenshot or Computer Use for cross-origin iframes, closed shadow roots, Canvas/WebGL.",
  "JS dialogs (alert/confirm/prompt) are suppressed and not controllable — if a page needs a",
  "dialog response, stop and use screenshot or ask the user (handoff).",
  "file inputs cannot receive local paths from this tool — use user handoff or Computer Use",
  "for uploads.",
  "Sensitive-field heuristics cover password/OTP/payment-ish controls but do NOT guarantee",
  "capture of SSN, ID numbers, cardholder name, or CAPTCHA fields; when unsure, hand off.",
  "target                  Optional viewport: active (default), desktop, mobile, both.",
  "                        observe/screenshot support both. click/input/type/select/fill_form/",
  "                        scroll/eval/content/console/wait reject both — specify desktop or mobile.",
  "                        Snapshot IDs and element tokens are viewport-scoped; do not mix them.",
  "For frontend/responsive-layout implementation or debugging, before claiming responsive visual acceptance, run observe target='both' for structured inspection, then screenshot target='both' and visually review the two labeled desktop/mobile images.",
  "Ordinary browsing may keep target='active' (default).",
  "This tool always controls the built-in WebView. For Chrome, use open_application then computer;",
  "the user selects the tab and you must re-observe title/URL/screenshot/AX before each write batch.",
  "back | forward | reload Navigate the built-in browser tab (keeps desktop/mobile in sync).",
  "help                    This text.",
].join("\n");

function formatWatchResult(r: any): string {
  if (!r?.ok) return JSON.stringify({ error: r?.error || "browser watch failed" }, null, 2);
  if (Array.isArray(r.watches)) {
    if (r.watches.length === 0) return "No active browser watches.";
    return r.watches.map((watch: any) => {
      const summary = watch.conditionSummary || JSON.stringify(watch.condition);
      return `${watch.watchId} ${summary} status=${watch.status || "active"}`;
    }).join("\n");
  }
  if (r.subscribed) return "browser watch callback subscribed";
  if (r.watchId) {
    return [
      `Registered watch ${r.watchId}`,
      `condition: ${r.conditionSummary || JSON.stringify(r.condition)}`,
      `timeoutSecs: ${typeof r.watch?.timeoutAt === "number" && typeof r.watch?.createdAt === "number" ? Math.round((r.watch.timeoutAt - r.watch.createdAt) / 1000) : "?"}`,
      `intervalMs: ${r.intervalMs ?? ""}`,
      "Watch is non-blocking. Continue other work or end the turn. You will receive a [browser-watch] message when it fires.",
    ].join("\n");
  }
  return "ok";
}

function isBrowserActionError(result: any): boolean {
  return result?.isError === true;
}

// Batch text budget: actions[] concatenates up to 8 results; repeated large outputs
// (e.g. content of the same page) must not re-expand toward the tool-result
// truncation cap (~100k chars). BATCH_TEXT_CHAR_BUDGET is a true global budget for
// the sum of all rendered entry bodies: the final substantial entry's evidence is
// allocated first, earlier entries share what is left. Only per-entry header lines,
// failure texts (reserved in full), and small duplicate markers sit on top.
// Labeled images in content stay full. details.results keep status/error fields;
// successful intermediate observations are summarized, and only the last
// substantial observation keeps its full structured evidence.
const BATCH_TEXT_CHAR_BUDGET = 48_000;
const BATCH_PER_ENTRY_MAX = 8_000;
const BATCH_FINAL_ENTRY_MAX = 40_000;
const BATCH_DEDUP_MIN = 400;
const BATCH_DETAILS_KEEP = [
  "error", "code", "requiresObservation", "requiresUserInput", "candidates",
  "ok", "action", "mutation", "relocated", "url", "title", "snapshotID",
  "loading", "viewport", "scroll", "note", "truncated", "deferObservation",
  "filled", "failed", "target", "nextCursor", "retryable", "limitations", "observationOptimization",
] as const;

/** UTF-16 surrogate-safe truncation: never splits an astral character pair. */
function safeTruncateText(t: string, max: number): string {
  if (t.length <= max) return t;
  let end = max;
  if (end > 0) {
    const prev = t.charCodeAt(end - 1);
    const next = t.charCodeAt(end);
    if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  }
  return t.slice(0, end);
}

function entryTextParts(result: any): string[] {
  return (result?.content || [])
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text);
}

// Parameter-validation failures embed the full HELP; inside a batch that repeats the
// whole manual for one wrong item. Keep the specific message plus a one-line pointer.
function withoutEmbeddedHelp(t: string): string {
  const i = t.indexOf(HELP);
  if (i < 0) return t;
  return `${t.slice(0, i).trimEnd()}\n(full parameter docs: run browser with action:"help")`;
}

// Lightweight DOM results (e.g. click with deferred observation) carry no page
// snapshot: printing their URL/Title/Viewport header fabricates empty metadata.
// Inside a batch they render as a compact action/mutation summary instead.
function isCompactDomResult(details: any): boolean {
  if (!details || typeof details !== "object") return false;
  if (details.deferObservation === true) return true;
  return !details.url && !details.snapshotID && typeof details.mutation === "object";
}

function formatCompactDomResult(details: any): string {
  const lines: string[] = [];
  if (details?.action && typeof details.action === "object") lines.push(`Action: ${JSON.stringify(details.action)}`);
  if (details?.relocated) lines.push("Relocated: true");
  if (details?.mutation) lines.push(`Mutation: ${JSON.stringify(details.mutation)}`);
  if (Array.isArray(details?.candidates) && details.candidates.length) lines.push(`Candidates: ${JSON.stringify(details.candidates)}`);
  if (details?.note) lines.push(`Note: ${details.note}`);
  if (details?.error) lines.push(`Note: ${details.error}`);
  return lines.length ? lines.join("\n") : "ok";
}

function hasIntentViewports(details: any): boolean {
  return details?.target === "both" && Boolean(details.desktop?.observationOptimization || details.mobile?.observationOptimization);
}

function isSubstantialObservationDetails(details: any): boolean {
  if (!details || typeof details !== "object") return false;
  if (details.deferObservation === true) return false;
  if (hasIntentViewports(details)) return isSubstantialObservationDetails(details.desktop) || isSubstantialObservationDetails(details.mobile);
  if (Array.isArray(details.elements) && details.elements.length > 0) return true;
  if (Array.isArray(details.regions) && details.regions.length > 0) return true;
  return Boolean(details.snapshotID && details.url);
}

function pickKeptDetailFields(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of BATCH_DETAILS_KEEP) {
    if (details[key] !== undefined) out[key] = details[key];
  }
  if (Array.isArray(details.results)) out.results = details.results;
  return out;
}

function summarizeObservationDetails(details: any, mode: "summary" | "final" | "error"): Record<string, unknown> {
  if (!details || typeof details !== "object") return {};
  const out = pickKeptDetailFields(details);
  // New intent metadata is pane-local. Do not change legacy no-intent batch shapes.
  if (hasIntentViewports(details)) {
    out.desktop = summarizeObservationDetails(details.desktop, mode);
    out.mobile = summarizeObservationDetails(details.mobile, mode);
  }
  if (Array.isArray(details.images)) out.imageCount = details.images.length;
  if (mode === "final") {
    if (Array.isArray(details.elements)) out.elements = details.elements;
    if (Array.isArray(details.regions)) out.regions = details.regions;
    return out;
  }
  if (Array.isArray(details.elements)) out.elementCount = details.elements.length;
  if (Array.isArray(details.regions)) {
    out.regionCount = details.regions.length;
    out.regions = details.regions.map((region: any) => ({
      id: region.id,
      name: region.name,
      role: region.role,
      count: region.count,
      more: region.more,
      expanded: region.expanded,
    }));
  }
  if (details.observation && typeof details.observation === "object") {
    out.observation = summarizeObservationDetails(details.observation, "summary");
  }
  if (mode === "summary") out.summarized = true;
  return out;
}

function compactBatchEntryDetails(
  entry: { index: number; status: "ok" | "failed" | "skipped"; result?: any },
  finalEvidenceIndex: number | null,
): Record<string, unknown> | undefined {
  const details = entry.result?.details;
  if (entry.status === "failed") {
    const compact = summarizeObservationDetails(details, "error");
    if (compact.error == null) {
      const message = withoutEmbeddedHelp(entryTextParts(entry.result).join("\n")).trim();
      if (message) compact.error = safeTruncateText(message, 2_000);
    }
    return compact;
  }
  if (!details || typeof details !== "object") return undefined;
  if (entry.index === finalEvidenceIndex) return summarizeObservationDetails(details, "final");
  return summarizeObservationDetails(details, "summary");
}

function formatBrowserActionBatch(
  entries: Array<{ index: number; action: string; status: "ok" | "failed" | "skipped"; reason?: string; result?: any }>,
  failedIndex: number | null,
  budgetExhaustedAt: number | null = null,
) {
  const incomplete = failedIndex != null || budgetExhaustedAt != null;
  const skipped = entries.filter((entry) => entry.status === "skipped");
  const header = failedIndex != null
    ? `browser batch: stopped at index ${failedIndex} (${entries[failedIndex]?.action || "?"}); ${skipped.length} skipped.`
    : budgetExhaustedAt != null
      ? `browser batch: time budget exhausted before index ${budgetExhaustedAt}; ${skipped.length} skipped.`
      : `browser batch: ${entries.length} executed, all ok.`;

  // Bodies of ok entries, deduplicated when a large output repeats verbatim.
  const okEntries = entries.filter((entry) => entry.status === "ok");
  const bodies = new Map<number, { text: string; duplicateOf: number | null }>();
  const seen = new Map<string, number>();
  for (const entry of okEntries) {
    const raw = isCompactDomResult(entry.result?.details)
      ? formatCompactDomResult(entry.result?.details)
      : entryTextParts(entry.result).join("\n");
    let duplicateOf: number | null = null;
    if (raw.length >= BATCH_DEDUP_MIN) {
      const first = seen.get(raw);
      if (first === undefined) seen.set(raw, entry.index);
      else duplicateOf = first;
    }
    bodies.set(entry.index, { text: raw, duplicateOf });
  }

  // Global budget: failure/skipped lines are reserved first and never trimmed; the
  // last substantial non-duplicate output is the batch's final page evidence and is
  // allocated its cap out of the same budget; earlier substantial outputs share
  // whatever is left, so the sum of all bodies stays within BATCH_TEXT_CHAR_BUDGET.
  const fixedLen = entries.reduce((total, entry) => {
    if (entry.status === "skipped") return total + 64;
    if (entry.status === "failed") return total + 32 + withoutEmbeddedHelp(entryTextParts(entry.result).join("\n")).length;
    return total + 32;
  }, header.length);
  const bodyBudget = Math.max(0, BATCH_TEXT_CHAR_BUDGET - fixedLen);

  const renderCapped = (raw: string, cap: number): { text: string; used: number } => {
    if (raw.length <= cap) return { text: raw, used: raw.length };
    const marker = `\n[... ${raw.length} chars omitted (batch text budget)]`;
    const room = cap - marker.length;
    if (room > 160) {
      const text = `${safeTruncateText(raw, room)}${marker}`;
      return { text, used: text.length };
    }
    const text = `[output omitted: ${raw.length} chars (batch text budget)]`;
    return { text, used: text.length };
  };

  const rendered = new Map<number, string>();
  let share = bodyBudget;
  const finalEntry = [...okEntries].reverse().find((entry) => {
    const body = bodies.get(entry.index)!;
    return body.text.length >= BATCH_DEDUP_MIN && body.duplicateOf === null;
  });
  if (finalEntry != null) {
    const { text, used } = renderCapped(
      bodies.get(finalEntry.index)!.text,
      Math.min(BATCH_FINAL_ENTRY_MAX, bodyBudget),
    );
    rendered.set(finalEntry.index, text);
    share = Math.max(0, share - used);
  }
  for (const entry of okEntries) {
    if (finalEntry != null && entry.index === finalEntry.index) continue;
    const body = bodies.get(entry.index)!;
    const text = body.duplicateOf !== null
      ? `[duplicate of index ${body.duplicateOf}: same ${body.text.length}-char output, not repeated]`
      : renderCapped(body.text, Math.min(BATCH_PER_ENTRY_MAX, share)).text;
    rendered.set(entry.index, text);
    share = Math.max(0, share - text.length);
  }

  const lines = [header, ""];
  const content: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (entry.status === "skipped") {
      lines.push(`[${entry.index}] ${entry.action || "?"} skipped${entry.reason ? ` (${entry.reason})` : ""}`);
      continue;
    }
    lines.push(`[${entry.index}] ${entry.action} ${entry.status}`);
    const body = entry.status === "failed"
      ? withoutEmbeddedHelp(entryTextParts(entry.result).join("\n"))
      : rendered.get(entry.index) || "";
    if (body) lines.push(body);
  }
  content.push({ type: "text", text: lines.join("\n") });
  for (const entry of entries) {
    for (const part of entry.result?.content || []) {
      // Label each image with its batch step so multiple screenshots stay attributable.
      if (part?.type === "image") {
        const viewport = typeof part.viewport === "string" ? ` ${part.viewport}` : "";
        content.push({ type: "text", text: `[${entry.index}] ${entry.action || "?"}${viewport}` });
        content.push(part);
      }
    }
  }
  const finalEvidenceIndex = [...okEntries].reverse().find((entry) => (
    isSubstantialObservationDetails(entry.result?.details)
  ))?.index ?? null;
  return {
    content,
    details: {
      batch: true,
      ok: !incomplete,
      failedIndex,
      ...(budgetExhaustedAt != null ? { budgetExhaustedAt } : {}),
      skipped: skipped.map((entry) => entry.index),
      results: entries.map((entry) => {
        const details = compactBatchEntryDetails(entry, finalEvidenceIndex);
        return {
          index: entry.index,
          action: entry.action,
          status: entry.status,
          ...(details ? { details } : {}),
          ...(entry.result?.isError ? { isError: true } : {}),
        };
      }),
    },
    ...(incomplete ? { isError: true } : {}),
  };
}

async function executeBrowserActionBatch(items: any[], signal?: AbortSignal, optimization?: BrowserOptimization) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 8) {
    return usage("browser actions must be an array of 1..8 items.\n\n" + HELP);
  }
  const entries: Array<{ index: number; action: string; status: "ok" | "failed" | "skipped"; reason?: string; result?: any }> = [];
  let failedIndex: number | null = null;
  let budgetExhaustedAt: number | null = null;
  const deadline = Date.now() + BATCH_BUDGET_MS;
  const markSkipped = (from: number, reason?: string) => {
    for (let j = from; j < items.length; j++) {
      entries.push({
        index: j,
        action: typeof items[j]?.action === "string" ? items[j].action : "",
        status: "skipped",
        ...(reason ? { reason } : {}),
      });
    }
  };
  for (let i = 0; i < items.length; i++) {
    if (Date.now() > deadline) {
      budgetExhaustedAt = i;
      markSkipped(i, "batch time budget exhausted");
      break;
    }
    // The whole batch shares one outer AbortSignal. Once it has fired, no further
    // bridge RPC (and no disconnect cancel for a request that never started) may be
    // issued: this item is reported failed and the rest are skipped.
    if (signal?.aborted) {
      entries.push({
        index: i,
        action: typeof items[i]?.action === "string" ? items[i].action : "",
        status: "failed",
        result: bridgeFailure({ error: "browser request timed out or was cancelled", code: "cancelled" }),
      });
      failedIndex = i;
      markSkipped(i + 1, "browser tool call was cancelled before this item started");
      break;
    }
    const item = items[i] && typeof items[i] === "object" && !Array.isArray(items[i]) ? items[i] : {};
    if (typeof item.action !== "string") {
      entries.push({
        index: i,
        action: "",
        status: "failed",
        result: usage(`browser actions[${i}] requires "action".\n\n` + HELP),
      });
      failedIndex = i;
      markSkipped(i + 1);
      break;
    }
    let result;
    try {
      result = await executeBrowserAction(item, signal, optimization);
    } catch (error) {
      // bridge() throws instead of returning isError on timeout, external cancellation,
      // connection failure, or JSON parse failure. The batch contract still owes the model
      // a per-index report, so the throw becomes this item's failure and the rest are
      // skipped. An external AbortSignal cancel is deliberately NOT re-thrown: the tool
      // result is the only channel that says which steps actually ran before the cancel,
      // and the caller does not need the rejection to finish an aborted tool call.
      result = bridgeFailure({ error: error instanceof Error ? error.message : String(error) });
    }
    const failed = isBrowserActionError(result);
    entries.push({ index: i, action: item.action, status: failed ? "failed" : "ok", result });
    if (failed) {
      failedIndex = i;
      markSkipped(i + 1);
      break;
    }
  }
  return formatBrowserActionBatch(entries, failedIndex, budgetExhaustedAt);
}

/**
 * Registers the single `browser` tool. Session lifecycle (watch delivery,
 * callback-server subscribe) belongs to the package entry `index.ts`.
 */
export default function (pi: ExtensionAPI) {
  const connection = connectBrowserReranker(pi.events);
  const choice = connectBrowserChoice(pi.events);
  if (typeof pi.on === "function") pi.on("session_shutdown", () => { connection.dispose(); choice.dispose(); });
  // One stable tool instead of five browser_* tools. The tool set never changes, so the
  // prompt prefix stays cached, and the per-request schema cost drops ~400 tokens.
  pi.registerTool({
    name: "browser",
    label: "Browser",
    description:
      "Drive the built-in WebView with structured observations and typed DOM actions. " +
      "actions: navigate, observe, goal, wait, watch, unwatch, watches, click, input, type, select, fill_form, scroll, content, eval, script, console, screenshot, back, forward, reload, help. " +
      "goal runs a bounded Jev Choice action loop using the extension's saved key; standalone only, single viewport. TYPE_TEXT reuses the current model. DONE requires independent outcome verification. " +
      "Prefer packing consecutive actions that do not need an intermediate observation into one actions[] call (1..8 items), e.g. fill_form then submit click, click then wait, type then Enter. Pass exactly one of action or actions. Stop and observe after navigate, after submitting a form, and when a dialog, captcha, or login wall may appear. " +
      "observe/screenshot are best as the final step of a batch (later items cannot consume an earlier item's observation), and watch in a batch only registers its non-blocking listener without waiting. " +
      "watch/unwatch/watches register a long wait (use watch when waiting more than 25s): watch returns watchId immediately; a [browser-watch] follow-up arrives when the condition matches, times out, or the page is disposed. " +
      "eval is page-DOM only (no literals/keep-alive). content/eval/script output is sanitized with the same redaction as observe. screenshot pixels are not redacted — avoid capturing auth/checkout UI. " +
      "observe defaults to region summaries; pass region/role/name/cursor to expand or page. " +
      "For a complex page, observe intent names the current lookup goal and prioritizes bounded candidates; omit it for ordinary paging, and never combine it with cursor. Known locators/flows need no scoring. " +
      "click/input/select/scroll accept locator {role,name}|{label}|{text}|{css} without a snapshot. " +
      "scroll locator targets the matched element or its nearest scrollable ancestor; 0/ambiguous/hidden matches error instead of scrolling the page. " +
      "Same-page stale refs relocate on a unique in-viewport DOM path+role+name+ordinal match. Actions include a mutation summary. " +
      "Optional target selects active (default), desktop, mobile, or both (observe/screenshot only). " +
      "Ordinary browsing may use target=active (default). For frontend or responsive-layout implementation/debugging, before claiming responsive visual acceptance, call observe with target=both for structured inspection, then screenshot with target=both and visually review both labeled desktop/mobile images. " +
      'Call with action:"help" for full parameter docs.',
    parameters: Type.Object({
      action: Type.Optional(Type.String({
        description: "navigate | observe | goal | wait | watch | unwatch | watches | click | input | type | select | fill_form | scroll | content | eval | script | console | screenshot | back | forward | reload | help",
      })),
      goal: Type.Optional(Type.String({ minLength: 1, maxLength: 512, description: "action=goal only: bounded browser task for Jev Choice; not observation scoring." })),
      max_steps: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, description: "goal decision limit, default 12; timeoutSecs limits the whole goal to 1–60 seconds (default 30)." })),
      actions: Type.Optional(Type.Array(Type.Object({
        action: Type.String({
          description: "navigate | observe | wait | watch | unwatch | watches | click | input | type | select | fill_form | scroll | content | eval | script | console | screenshot | back | forward | reload | help",
        }),
        url: Type.Optional(Type.String()),
        js: Type.Optional(Type.String()),
        mode: Type.Optional(Type.Union([
          Type.Literal("text"), Type.Literal("html"), Type.Literal("selector"), Type.Literal("idle"),
        ])),
        clear: Type.Optional(Type.Boolean()),
        scope: Type.Optional(Type.Union([Type.Literal("viewport"), Type.Literal("page")])),
        snapshot_id: Type.Optional(Type.String()),
        element_index: Type.Optional(Type.Number()),
        element_token: Type.Optional(Type.String()),
        locator: Type.Optional(Type.Object({
          role: Type.Optional(Type.String()),
          name: Type.Optional(Type.String()),
          label: Type.Optional(Type.String()),
          text: Type.Optional(Type.String()),
          css: Type.Optional(Type.String()),
          nth: Type.Optional(Type.Number()),
        })),
        text: Type.Optional(Type.String()),
        option: Type.Optional(Type.String()),
        direction: Type.Optional(Type.Union([
          Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right"),
        ])),
        amount: Type.Optional(Type.Number({ minimum: 0.1, maximum: 10 })),
        selector: Type.Optional(Type.String()),
        timeout: Type.Optional(Type.Number({ minimum: 0.05, maximum: 25 })),
        timeoutSecs: Type.Optional(Type.Number({
          minimum: 1,
          maximum: 1800,
          description: "Required for action=watch (1..1800). Do not use watch for waits ≤25s.",
        })),
        intervalMs: Type.Optional(Type.Number({ minimum: 50 })),
        url_matches: Type.Optional(Type.String()),
        expression: Type.Optional(Type.String()),
        idle: Type.Optional(Type.Union([Type.Boolean(), Type.Number({ minimum: 50, maximum: 5000 })])),
        watchId: Type.Optional(Type.String()),
        idle_ms: Type.Optional(Type.Number({ minimum: 50, maximum: 5000 })),
        since_seq: Type.Optional(Type.Number()),
        level: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
        target: Type.Optional(Type.Union([
          Type.Literal("active"), Type.Literal("desktop"), Type.Literal("mobile"), Type.Literal("both"),
        ])),
        region: Type.Optional(Type.String()),
        role: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        cursor: Type.Optional(Type.Union([Type.String(), Type.Number()])),
        intent: Type.Optional(Type.String({ minLength: 1, maxLength: 512, description: "observe only: current lookup goal; incompatible with cursor. target=both stays local." })),
        fields: Type.Optional(Type.Array(Type.Object({
          value: Type.String(),
          element_token: Type.Optional(Type.String()),
          element_index: Type.Optional(Type.Number()),
          locator: Type.Optional(Type.Object({
            role: Type.Optional(Type.String()),
            name: Type.Optional(Type.String()),
            label: Type.Optional(Type.String()),
            text: Type.Optional(Type.String()),
            css: Type.Optional(Type.String()),
            nth: Type.Optional(Type.Number()),
          })),
          role: Type.Optional(Type.String()),
          name: Type.Optional(Type.String()),
          label: Type.Optional(Type.String()),
          text: Type.Optional(Type.String()),
          css: Type.Optional(Type.String()),
          type: Type.Optional(Type.String()),
        }))),
      }), {
        minItems: 1,
        maxItems: 8,
        description: "Ordered batch of 1..8 browser actions, each shaped like a single call. Mutually exclusive with action.",
      })),
      url: Type.Optional(Type.String()),
      js: Type.Optional(Type.String()),
      mode: Type.Optional(Type.Union([
        Type.Literal("text"), Type.Literal("html"), Type.Literal("selector"), Type.Literal("idle"),
      ])),
      clear: Type.Optional(Type.Boolean()),
      scope: Type.Optional(Type.Union([Type.Literal("viewport"), Type.Literal("page")])),
      snapshot_id: Type.Optional(Type.String()),
      element_index: Type.Optional(Type.Number()),
      element_token: Type.Optional(Type.String()),
      locator: Type.Optional(Type.Object({
        role: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        label: Type.Optional(Type.String()),
        text: Type.Optional(Type.String()),
        css: Type.Optional(Type.String()),
        nth: Type.Optional(Type.Number()),
      })),
      text: Type.Optional(Type.String()),
      option: Type.Optional(Type.String()),
      direction: Type.Optional(Type.Union([
        Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right"),
      ])),
      amount: Type.Optional(Type.Number({ minimum: 0.1, maximum: 10 })),
      selector: Type.Optional(Type.String()),
      timeout: Type.Optional(Type.Number({ minimum: 0.05, maximum: 25 })),
      timeoutSecs: Type.Optional(Type.Number({
        minimum: 1,
        maximum: 1800,
        description: "Required for action=watch (1..1800). Do not use watch for waits ≤25s.",
      })),
      intervalMs: Type.Optional(Type.Number({ minimum: 50 })),
      url_matches: Type.Optional(Type.String()),
      expression: Type.Optional(Type.String()),
      idle: Type.Optional(Type.Union([Type.Boolean(), Type.Number({ minimum: 50, maximum: 5000 })])),
      watchId: Type.Optional(Type.String()),
      idle_ms: Type.Optional(Type.Number({ minimum: 50, maximum: 5000 })),
      since_seq: Type.Optional(Type.Number()),
      level: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
      target: Type.Optional(Type.Union([
        Type.Literal("active"), Type.Literal("desktop"), Type.Literal("mobile"), Type.Literal("both"),
      ])),
      region: Type.Optional(Type.String()),
      role: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      cursor: Type.Optional(Type.Union([Type.String(), Type.Number()])),
      intent: Type.Optional(Type.String({ minLength: 1, maxLength: 512, description: "observe only: current lookup goal; incompatible with cursor. target=both stays local." })),
      fields: Type.Optional(Type.Array(Type.Object({
        value: Type.String(),
        element_token: Type.Optional(Type.String()),
        element_index: Type.Optional(Type.Number()),
        locator: Type.Optional(Type.Object({
          role: Type.Optional(Type.String()),
          name: Type.Optional(Type.String()),
          label: Type.Optional(Type.String()),
          text: Type.Optional(Type.String()),
          css: Type.Optional(Type.String()),
          nth: Type.Optional(Type.Number()),
        })),
        role: Type.Optional(Type.String()),
        name: Type.Optional(Type.String()),
        label: Type.Optional(Type.String()),
        text: Type.Optional(Type.String()),
        css: Type.Optional(Type.String()),
        type: Type.Optional(Type.String()),
      }))),
    }),
    async execute(_id, params, signal, _update, ctx) {
      return executeBrowserTool(params, signal, { connection, choice, projectRoot: ctx?.cwd ?? process.cwd(), generateText: createGoalTextGenerator(ctx as any) });
    },
  });
}

// Tool entry point, exported for behavioral tests. Kept below the registerTool call so
// the first `actions: ...` text in this file stays the tool description (browser-host
// contract tests parse it positionally).
export async function executeBrowserTool(params: any, signal?: AbortSignal, optimization?: BrowserOptimization) {
  const hasAction = typeof params.action === "string";
  const hasActions = Array.isArray((params as { actions?: unknown }).actions);
  if (hasAction === hasActions) {
    return usage('browser requires exactly one of "action" or "actions".\n\n' + HELP);
  }
  if (hasActions) {
    if (params.actions.some((item: any) => item?.action === "goal")) return usage('goal is a standalone action and cannot appear inside actions[].');
    return executeBrowserActionBatch((params as { actions: unknown[] }).actions, signal, optimization);
  }
  return executeBrowserAction(params, signal, optimization);
}

async function executeBrowserAction(params: any, signal?: AbortSignal, optimization?: BrowserOptimization) {
      if (signal?.aborted && params.intent !== undefined) return usage("Browser action cancelled.");
      if (params.intent !== undefined && (params.action !== "observe"
        || typeof params.intent !== "string" || !params.intent.trim()
        || Array.from(params.intent.trim()).length > 512
        || (params.cursor !== undefined && params.cursor !== null && params.cursor !== ""))) {
        return usage("intent requires observe, a 1–512 character lookup goal, and no cursor; omit intent for ordinary paging.");
      }
      const target = params.target;
      const targetParams = target ? { target } : {};
      if (target === "both" && ["click", "input", "type", "select", "fill_form", "scroll", "eval", "content", "console", "wait"].includes(params.action)) {
        return usage(`browser ${params.action} cannot target both viewports; specify target=desktop or target=mobile.\n\n${HELP}`);
      }
      switch (params.action) {
        case "goal": {
          const r = await runBrowserGoal(params, {
            projectRoot: optimization?.projectRoot ?? process.cwd(), connection: optimization?.choice,
            generateText: optimization?.generateText, bridge, signal,
          });
          return { ...text(JSON.stringify(r), r), ...(r.ok ? {} : { isError: true }) };
        }
        case "navigate": {
          if (!params.url) return usage('browser navigate requires "url".\n\n' + HELP);
          const r = await bridge("navigate", { url: params.url, scope: params.scope ?? "viewport", ...targetParams }, signal);
          return r.ok ? text(formatObservation(r), r) : bridgeFailure(r);
        }
        case "observe": {
          const observeParams = {
            scope: params.scope ?? "viewport",
            ...targetParams,
            ...(typeof params.region === "string" ? { region: params.region } : {}),
            ...(typeof params.role === "string" ? { role: params.role } : {}),
            ...(typeof params.name === "string" ? { name: params.name } : {}),
            ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
            ...(params.intent !== undefined ? { intent: params.intent.trim() } : {}),
          };
          const r = params.intent !== undefined
            ? await observeWithOptionalRerank(observeParams, optimization?.projectRoot ?? process.cwd(), signal, optimization?.connection, bridge)
            : await bridge("observe", observeParams, signal);
          return r.ok ? text(formatObservation(r), r) : bridgeFailure(r);
        }
        case "wait": {
          const mode = params.mode === "idle" || params.mode === "selector"
            ? params.mode
            : (typeof params.selector === "string" && params.selector.trim()
              || typeof params.element_index === "number"
              || (typeof params.element_token === "string" && params.element_token.length > 0)
                ? "selector"
                : "idle");
          if (mode === "selector") {
            const hasSelector = typeof params.selector === "string" && params.selector.trim().length > 0;
            const hasIndex = typeof params.element_index === "number";
            const hasToken = typeof params.element_token === "string" && params.element_token.length > 0;
            if (!hasSelector && hasIndex === hasToken) {
              return usage(`browser wait selector mode requires selector or exactly one of element_index or element_token.\n\n${HELP}`);
            }
            if (hasSelector && (hasIndex || hasToken || params.snapshot_id)) {
              return usage(`browser wait selector mode accepts selector or a snapshot element target, not both.\n\n${HELP}`);
            }
            if (!hasSelector && !params.snapshot_id) {
              return usage(`browser wait with an element target requires snapshot_id.\n\n${HELP}`);
            }
          } else if (params.mode && params.mode !== "idle" && params.mode !== "selector"
            && params.mode !== "text" && params.mode !== "html") {
            return usage(`browser wait mode must be "selector" or "idle".\n\n${HELP}`);
          }
          const r = await bridge("wait", {
            mode,
            scope: params.scope ?? "viewport",
            ...targetParams,
            ...(typeof params.selector === "string" ? { selector: params.selector } : {}),
            ...(typeof params.timeout === "number" ? { timeout: params.timeout } : {}),
            ...(typeof params.idle_ms === "number" ? { idle_ms: params.idle_ms } : {}),
            ...(typeof params.snapshot_id === "string" ? { snapshot_id: params.snapshot_id } : {}),
            ...(typeof params.element_index === "number" ? { element_index: params.element_index } : {}),
            ...(typeof params.element_token === "string" ? { element_token: params.element_token } : {}),
          }, signal);
          return r.ok ? text(formatObservation(r), r) : bridgeFailure(r);
        }
        case "type": {
          if (!params.selector || typeof params.text !== "string") return usage("browser type requires selector and text.\n\n" + HELP);
          const r = await bridge("type", { selector: params.selector, text: params.text, scope: params.scope ?? "viewport", ...targetParams }, signal);
          return r.ok ? text(formatObservation(r), r) : bridgeFailure(r);
        }
        case "click":
        case "input":
        case "select": {
          const hasIndex = typeof params.element_index === "number";
          const hasToken = typeof params.element_token === "string" && params.element_token.length > 0;
          const locator = params.locator && typeof params.locator === "object" && !Array.isArray(params.locator)
            ? params.locator
            : undefined;
          const targets = [hasIndex, hasToken, Boolean(locator)].filter(Boolean).length;
          if (targets !== 1 || (!locator && !params.snapshot_id)) {
            return usage(`browser ${params.action} requires snapshot_id and exactly one of element_index or element_token, or a locator.\n\n${HELP}`);
          }
          if (params.action === "input" && typeof params.text !== "string") {
            return usage(`browser input requires text.\n\n${HELP}`);
          }
          if (params.action === "select" && typeof params.option !== "string") {
            return usage(`browser select requires option.\n\n${HELP}`);
          }
          const r = await bridge(params.action, {
            scope: params.scope ?? "viewport",
            ...targetParams,
            ...(locator ? { locator } : {
              snapshot_id: params.snapshot_id,
              ...(hasIndex ? { element_index: params.element_index } : { element_token: params.element_token }),
            }),
            ...(params.action === "input" ? { text: params.text } : {}),
            ...(params.action === "select" ? { option: params.option } : {}),
          }, signal);
          return r.ok ? text(formatObservation(r), r) : bridgeFailure(r);
        }
        case "fill_form": {
          if (!Array.isArray(params.fields) || params.fields.length === 0) {
            return usage(`browser fill_form requires a non-empty fields array.\n\n${HELP}`);
          }
          const r = await bridge("fill_form", {
            scope: params.scope ?? "viewport",
            ...targetParams,
            ...(typeof params.snapshot_id === "string" ? { snapshot_id: params.snapshot_id } : {}),
            fields: params.fields,
          }, signal);
          return r.ok ? text(formatObservation(r), r) : bridgeFailure(r);
        }
        case "scroll": {
          const hasIndex = typeof params.element_index === "number";
          const hasToken = typeof params.element_token === "string" && params.element_token.length > 0;
          const hasSelector = typeof params.selector === "string" && params.selector.trim().length > 0;
          const locator = params.locator && typeof params.locator === "object" && !Array.isArray(params.locator)
            ? params.locator
            : undefined;
          const hasTarget = Boolean(params.snapshot_id || hasIndex || hasToken);
          if (hasSelector && hasTarget) {
            return usage(`browser scroll accepts selector or a snapshot element target, not both.\n\n${HELP}`);
          }
          if (hasSelector && locator) {
            return usage(`browser scroll accepts selector or locator, not both.\n\n${HELP}`);
          }
          if (locator && hasTarget) {
            return usage(`browser scroll accepts locator or a snapshot element target, not both.\n\n${HELP}`);
          }
          if (hasTarget && (!params.snapshot_id || hasIndex === hasToken)) {
            return usage(`targeted browser scroll requires snapshot_id and exactly one of element_index or element_token.\n\n${HELP}`);
          }
          const r = await bridge("scroll", {
            scope: params.scope ?? "viewport",
            ...targetParams,
            direction: params.direction ?? "down",
            amount: params.amount ?? 0.8,
            ...(hasSelector ? { selector: params.selector } : {}),
            ...(locator ? { locator } : {}),
            ...(hasTarget ? {
              snapshot_id: params.snapshot_id,
              ...(hasIndex ? { element_index: params.element_index } : { element_token: params.element_token }),
            } : {}),
          }, signal);
          return r.ok ? text(formatObservation(r), r) : bridgeFailure(r);
        }
        case "content": {
          const r = await bridge("content", { mode: params.mode ?? "text", ...targetParams }, signal);
          if (!r.ok) return bridgeFailure(r);
          const suffix = r.truncated ? "\n\n[content truncated at 100000 chars]" : "";
          return text((r.content || "(empty page)") + suffix);
        }
        case "eval": {
          if (!params.js) return usage('browser eval requires "js".\n\n' + HELP);
          if (isTrivialBrowserEval(params.js)) {
            return usage(
              "eval rejected because js does not read or change the page. " +
                "do not use eval to return string literals / count / keep-alive / print progress. " +
                "to click/type: observe then snapshot_id + element_index or element_token.\n\n" +
                HELP,
            );
          }
          const r = await bridge("eval", { js: params.js, ...targetParams }, signal);
          if (!r.ok) return bridgeFailure(r);
          return text(String(r.result ?? "undefined"));
        }
        case "script": {
          if (!params.js) return usage('browser script requires "js".\n\n' + HELP);
          const r = await bridge("script", { js: params.js, ...targetParams }, signal);
          if (!r.ok) return bridgeFailure(r);
          return text(JSON.stringify(r, null, 2), r);
        }
        case "console": {
          const r = await bridge("console", {
            clear: params.clear ?? false,
            ...targetParams,
            ...(typeof (params as { since_seq?: number }).since_seq === "number" ? { since_seq: (params as { since_seq?: number }).since_seq } : {}),
            ...(typeof (params as { level?: string }).level === "string" ? { level: (params as { level?: string }).level } : {}),
            ...(typeof (params as { limit?: number }).limit === "number" ? { limit: (params as { limit?: number }).limit } : {}),
          }, signal);
          if (!r.ok) return bridgeFailure(r);
          const logs: string[] = r.logs || [];
          return text(logs.length ? logs.join("\n") : "(console is empty)");
        }
        case "screenshot": {
          const r = await bridge("screenshot", { ...targetParams }, signal);
          if (!r.ok) return bridgeFailure(r);
          if (Array.isArray(r.images) && r.images.length > 0) {
            const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string; viewport?: string }> = [];
            for (const image of r.images) {
              const viewport = typeof image.viewport === "string" ? image.viewport : "page";
              const size = typeof image.width === "number" && typeof image.height === "number" ? ` ${image.width}x${image.height}` : "";
              content.push({ type: "text", text: `${viewport}${size}` });
              content.push({ type: "image", data: image.base64, mimeType: image.mimeType || "image/png", viewport });
            }
            return { content, details: { target: r.target || "both", images: r.images } };
          }
          return {
            content: [{ type: "image" as const, data: r.base64, mimeType: r.mimeType || "image/png", ...(r.viewport ? { viewport: r.viewport } : {}) }],
            details: r.viewport ? { viewport: r.viewport } : {},
          };
        }
        case "back":
        case "forward":
        case "reload": {
          const r = await bridge(params.action, { scope: params.scope ?? "viewport", ...targetParams }, signal);
          return r.ok ? text(formatObservation(r), r) : bridgeFailure(r);
        }
        case "watch": {
          const timeoutSecs = typeof params.timeoutSecs === "number" ? params.timeoutSecs : undefined;
          if (timeoutSecs == null) {
            return usage(`browser watch requires timeoutSecs (1..${WATCH_MAX_TIMEOUT_SECS}). Use watch for waits longer than 25s; it returns immediately with a watchId.\n\n${HELP}`);
          }
          if (timeoutSecs < 1 || timeoutSecs > WATCH_MAX_TIMEOUT_SECS) {
            return usage(`browser watch timeoutSecs must be between 1 and ${WATCH_MAX_TIMEOUT_SECS}.\n\n${HELP}`);
          }
          const r = await bridge("watch", {
            op: "register",
            timeoutSecs,
            ...targetParams,
            ...(typeof params.selector === "string" ? { selector: params.selector } : {}),
            ...(typeof params.idle !== "undefined" ? { idle: params.idle } : {}),
            ...(typeof params.idle_ms === "number" ? { idle_ms: params.idle_ms } : {}),
            ...(typeof params.url_matches === "string" ? { url_matches: params.url_matches } : {}),
            ...(typeof params.expression === "string" ? { expression: params.expression } : {}),
            ...(typeof params.intervalMs === "number" ? { intervalMs: params.intervalMs } : {}),
            ...(typeof params.snapshot_id === "string" ? { snapshot_id: params.snapshot_id } : {}),
            ...(typeof params.element_index === "number" ? { element_index: params.element_index } : {}),
            ...(typeof params.element_token === "string" ? { element_token: params.element_token } : {}),
          }, signal, "browser_watch");
          return r.ok ? text(formatWatchResult(r), r) : bridgeFailure(r);
        }
        case "unwatch": {
          const watchId = typeof params.watchId === "string" ? params.watchId : undefined;
          if (!watchId) return usage(`browser unwatch requires watchId.\n\n${HELP}`);
          const r = await bridge("unwatch", { op: "unwatch", watchId }, signal, "browser_watch");
          return r.ok ? text("ok", r) : bridgeFailure(r);
        }
        case "watches": {
          const r = await bridge("watches", { op: "list" }, signal, "browser_watch");
          return r.ok ? text(formatWatchResult(r), r) : bridgeFailure(r);
        }
        case "help":
          return text(HELP);
        default:
          return usage(`Unknown browser action "${params.action}".\n\n${HELP}`);
      }
}
