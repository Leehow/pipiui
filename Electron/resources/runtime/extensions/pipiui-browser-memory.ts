// Pipi UI — browser flow memory (v1: semantic flows).
// Explicit teaching: when the user says "记住这个流程 / remember this flow", the agent
// converts the action sequence it just performed successfully into semantic-locator steps
// and saves them with action:"save". Replay (action:"run") re-sends the same bridge events
// the live browser tool uses, one step at a time, stopping at the first failure so the
// agent can observe the page and take over.
//
// Red line (hard): step values are NEVER stored. input/select steps carry a
// valueParam NAME (+ valueShape, e.g. "password"/"otp"); real values only ever travel in
// the run call's params and are scrubbed from every error/result string this tool emits.
//
// Storage is project-isolated: {projectRoot}/.pi/agent/browser-flows/<slug>.json — one
// file per flow, written atomically (tmp + rename). Never global ~/.pi, never another
// project.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = process.env.PIPIUI_BRIDGE_PORT;
const KEY = process.env.PIPIUI_SESSION_KEY;
const CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;

const REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_RUN_DEADLINE_MS = 60_000;
const MIN_RUN_DEADLINE_MS = 1_000;
const MAX_RUN_DEADLINE_MS = 600_000;
// Below this much remaining budget a step is not worth starting: a navigate+render alone
// can eat a few seconds, and starting one that cannot finish just adds a confusing
// timeout error on top of the real "deadline exceeded" signal.
const STEP_START_FLOOR_MS = 500;

/** Actions a flow may record, with the locator contract the browser bridge actually
 * implements (host: tabs-host toolAction + controller dispatch — click/input/select are
 * locator-targeted, scroll takes an optional locator, wait/back/forward/reload carry no
 * target). "type" is deliberately absent: the bridge maps type only onto CSS-selector
 * append input and has no focused-element path, so a stored type step can never replay
 * — teach "input" with a locator instead. observe/eval/content/... are absent too:
 * replay must be pure side effects the agent already verified live, never new
 * observations. */
const ALLOWED_STEP_ACTIONS = ["navigate", "wait", "click", "input", "select", "scroll", "fill_form", "back", "forward", "reload"] as const;
const ALLOWED_STEP_ACTION_SET = new Set<string>(ALLOWED_STEP_ACTIONS);
/** Strict step shape: anything outside this key set is rejected at save time, which is
 * what guarantees a literal `value` can never sneak into a stored flow. */
const STEP_KEYS = new Set(["action", "locator", "url", "valueParam", "valueShape", "note", "fields"]);
const FIELD_KEYS = new Set(["locator", "valueParam", "valueShape"]);
const LOCATOR_KEYS = ["role", "name", "label", "text", "css"];
const VALUE_PARAM_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export type SemanticLocator = { role?: string; name?: string; label?: string; text?: string; css?: string };
export type FlowField = { locator: SemanticLocator; valueParam: string; valueShape?: string };
export type FlowStep = {
  action: string;
  locator?: SemanticLocator;
  url?: string;
  valueParam?: string;
  valueShape?: string;
  fields?: FlowField[];
  note?: string;
};
export type FlowTrigger = { urlContains?: string; domains?: string[] };
/** Optional for legacy session episodes and saved files. New runs always write the
 * complete bounded counter set; no input values ever enter these fields. */
export type FlowRunStats = {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastRunAt?: string;
  lastFailureAt?: string;
};
export type BrowserFlow = {
  schemaVersion: 1;
  name: string;
  description: string;
  trigger: FlowTrigger;
  params: Record<string, { shape: string; description?: string }>;
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
  stats?: FlowRunStats;
};

// Same loopback contract as pipiui-browser-search.ts / pipiui-electron-webview.ts: the
// bridge is module-private by convention (both existing extensions carry their own copy),
// so replay shares the exact envelope the live browser tool sends.
async function bridge(
  action: string,
  params: Record<string, unknown> = {},
  externalSignal?: AbortSignal,
  budgetMs: number = REQUEST_TIMEOUT_MS,
): Promise<any> {
  const requestID = randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(REQUEST_TIMEOUT_MS, budgetMs)));
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

function failure(t: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text: t }], details, isError: true as const };
}

// ---------------------------------------------------------------------------
// Storage — project-isolated, one file per flow, atomic writes.
// ---------------------------------------------------------------------------

export function flowsDir(cwd: string): string {
  return join(cwd, ".pi", "agent", "browser-flows");
}

export function slugify(name: string): string {
  // Unicode-aware so Chinese flow names (the primary audience) stay usable as file names;
  // APFS/ext4 both accept them and the slug is only ever a file-name key, never a shell token.
  return name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function flowPath(cwd: string, slug: string): string {
  return join(flowsDir(cwd), `${slug}.json`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Atomic write: a crash mid-save leaves at most a hidden tmp file, never a half flow.
 * renameSync within one directory is atomic on APFS/ext4, so readers see old or new. */
function writeFlowAtomic(cwd: string, slug: string, flow: BrowserFlow): string {
  const file = flowPath(cwd, slug);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${slug}.${randomUUID()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(flow, null, 2)}\n`, "utf-8");
  renameSync(tmp, file);
  return file;
}

function statCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function nextRunStats(previous: FlowRunStats | undefined, succeeded: boolean, now = new Date().toISOString()): FlowRunStats {
  const successes = statCount(previous?.successes);
  const failures = statCount(previous?.failures);
  return {
    successes: successes + (succeeded ? 1 : 0),
    failures: failures + (succeeded ? 0 : 1),
    consecutiveFailures: succeeded ? 0 : statCount(previous?.consecutiveFailures) + 1,
    lastRunAt: now,
    ...(succeeded ? (typeof previous?.lastFailureAt === "string" ? { lastFailureAt: previous.lastFailureAt } : {}) : { lastFailureAt: now }),
  };
}

/** A completed replay must remain completed even if its bookkeeping write fails. */
const STATS_WRITE_WARNING = "Flow completed, but run statistics could not be saved.";

/** Serializes mutations per project flow store. Atomic rename protects individual files;
 * this queue also makes read-modify-write stats updates and slug allocation deterministic. */
const flowStoreTails = new Map<string, Promise<void>>();

async function withFlowStoreLock<T>(cwd: string, operation: () => T | Promise<T>): Promise<T> {
  const previous = flowStoreTails.get(cwd) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => done);
  flowStoreTails.set(cwd, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (flowStoreTails.get(cwd) === queued) flowStoreTails.delete(cwd);
  }
}

async function updateSavedFlowStats(cwd: string, slug: string, succeeded: boolean): Promise<BrowserFlow> {
  return withFlowStoreLock(cwd, () => {
    // A replay holds an old flow while it awaits bridge calls. Re-read inside the
    // critical section so only stats are merged onto the latest user-authored flow.
    const latest = loadFlow(cwd, slug);
    if (!latest.ok) throw new Error(latest.error);
    const updated: BrowserFlow = { ...latest.flow, stats: nextRunStats(latest.flow.stats, succeeded), updatedAt: new Date().toISOString() };
    writeFlowAtomic(cwd, slug, updated);
    return updated;
  });
}

export function loadFlow(cwd: string, slug: string): { ok: true; flow: BrowserFlow } | { ok: false; error: string } {
  let raw: string;
  try {
    raw = readFileSync(flowPath(cwd, slug), "utf-8");
  } catch {
    return { ok: false, error: `flow "${slug}" not found` };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed) || !Array.isArray(parsed.steps)) return { ok: false, error: `flow file for "${slug}" is corrupt (unexpected shape)` };
    return { ok: true, flow: parsed as unknown as BrowserFlow };
  } catch {
    return { ok: false, error: `flow file for "${slug}" is corrupt (invalid JSON)` };
  }
}

export function listFlowSlugs(cwd: string): string[] {
  try {
    return readdirSync(flowsDir(cwd))
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .map((name) => name.slice(0, -".json".length))
      .sort();
  } catch {
    return [];
  }
}

/** Resolve a user/agent-supplied name to a stored flow: exact slug first, then exact
 * flow-name match. A slug whose FILE exists but is unreadable still resolves, so show/run
 * surface the corruption instead of a misleading "not found". */
function resolveSlug(cwd: string, nameOrSlug: string): string | undefined {
  const direct = slugify(nameOrSlug);
  if (direct && existsSync(flowPath(cwd, direct))) return direct;
  for (const slug of listFlowSlugs(cwd)) {
    const loaded = loadFlow(cwd, slug);
    if (loaded.ok && loaded.flow.name === nameOrSlug) return slug;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Save-time validation — the security boundary for what may be persisted.
// ---------------------------------------------------------------------------

function validateLocator(value: unknown, where: string, errors: string[]): SemanticLocator | undefined {
  if (!isPlainObject(value)) {
    errors.push(`${where}: locator must be an object`);
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!LOCATOR_KEYS.includes(key)) errors.push(`${where}: unknown locator key "${key}" (allowed: ${LOCATOR_KEYS.join(", ")})`);
  }
  const locator: SemanticLocator = {};
  for (const key of LOCATOR_KEYS) {
    const v = value[key];
    if (v === undefined) continue;
    if (typeof v !== "string" || !v.trim()) {
      errors.push(`${where}: locator.${key} must be a non-empty string`);
      continue;
    }
    locator[key as keyof SemanticLocator] = v;
  }
  const hasRolePair = locator.role !== undefined || locator.name !== undefined;
  const single = (["label", "text", "css"] as const).filter((key) => locator[key] !== undefined);
  // Exactly one form: {role,name} (both present) | {label} | {text} | {css}.
  if (hasRolePair) {
    if (locator.role === undefined || locator.name === undefined) errors.push(`${where}: {role,name} locator requires both role and name`);
    if (single.length > 0) errors.push(`${where}: locator combines {role,name} with ${single.join("/")}`);
  } else if (single.length !== 1) {
    errors.push(`${where}: locator must be exactly one of {role,name} | {label} | {text} | {css}`);
  }
  return Object.keys(locator).length > 0 || errors.length > 0 ? locator : undefined;
}

function validateValueParam(value: unknown, where: string, errors: string[]): string | undefined {
  if (typeof value !== "string" || !VALUE_PARAM_PATTERN.test(value)) {
    errors.push(`${where}: valueParam must be an identifier like "password" or "otp_code"`);
    return undefined;
  }
  return value;
}

function validateValueShape(value: unknown, where: string, errors: string[]): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 40) {
    errors.push(`${where}: valueShape must be a short non-empty string (e.g. text, password, otp)`);
    return undefined;
  }
  return value;
}

export function validateFlowInput(input: {
  name: unknown;
  description: unknown;
  trigger: unknown;
  params: unknown;
  steps: unknown;
}): { ok: true; flow: Omit<BrowserFlow, "createdAt" | "updatedAt"> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) errors.push("name must be a non-empty string");
  else if (name.length > 80) errors.push("name must be at most 80 characters");
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (input.description !== undefined && typeof input.description !== "string") errors.push("description must be a string");

  let trigger: FlowTrigger = {};
  if (input.trigger !== undefined) {
    if (!isPlainObject(input.trigger)) errors.push("trigger must be an object {urlContains?, domains?}");
    else {
      for (const key of Object.keys(input.trigger)) {
        if (key !== "urlContains" && key !== "domains") errors.push(`trigger: unknown key "${key}" (allowed: urlContains, domains)`);
      }
      const urlContains = input.trigger.urlContains;
      if (urlContains !== undefined && (typeof urlContains !== "string" || !urlContains.trim())) errors.push("trigger.urlContains must be a non-empty string");
      const domains = input.trigger.domains;
      if (domains !== undefined) {
        if (!Array.isArray(domains) || domains.length === 0 || domains.some((d) => typeof d !== "string" || !d.trim())) {
          errors.push("trigger.domains must be a non-empty array of non-empty strings");
        }
      }
      trigger = { ...(urlContains !== undefined ? { urlContains: String(urlContains) } : {}), ...(Array.isArray(domains) ? { domains: domains.map(String) } : {}) };
    }
  }

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    return { ok: false, errors: [...errors, "steps must be a non-empty array"] };
  }

  // params declarations are DERIVED from the steps (valueParam → shape) so the store can
  // never disagree with what replay actually substitutes. The save input carries no params:
  // the run call is the only channel values (or per-run docs) ever travel through.
  if (input.params !== undefined) {
    return { ok: false, errors: [...errors, "params must not be passed to save — they are derived from the steps' valueParam/valueShape; values are only ever passed to run"] };
  }
  const derived = new Map<string, { shape: string; description?: string }>();
  const steps: FlowStep[] = [];

  input.steps.forEach((rawStep, i) => {
    const where = `steps[${i}]`;
    if (!isPlainObject(rawStep)) {
      errors.push(`${where}: must be an object`);
      return;
    }
    for (const key of Object.keys(rawStep)) {
      if (!STEP_KEYS.has(key)) errors.push(`${where}: unknown key "${key}" (allowed: ${[...STEP_KEYS].join(", ")}; literal values are never stored — use valueParam)`);
    }
    const action = rawStep.action;
    if (typeof action !== "string" || !ALLOWED_STEP_ACTION_SET.has(action)) {
      if (action === "type") {
        // Actionable, not generic: "type" is the one action the live browser tool offers
        // that the bridge cannot replay from a stored flow (host maps type only onto
        // CSS-selector append input and has no focused-element typing path).
        errors.push(`${where}: action "type" cannot be replayed — use "input" with a locator (its value comes from valueParam), or "fill_form" for multi-field forms`);
      } else {
        errors.push(`${where}: action "${String(action)}" is not allowed (allowed: ${ALLOWED_STEP_ACTIONS.join(", ")})`);
      }
      return;
    }
    const step: FlowStep = { action };
    if (rawStep.note !== undefined) {
      if (typeof rawStep.note !== "string" || rawStep.note.length > 200) errors.push(`${where}: note must be a string of at most 200 characters`);
      else step.note = rawStep.note;
    }
    const locator = rawStep.locator !== undefined ? validateLocator(rawStep.locator, `${where}.locator`, errors) : undefined;
    if (locator !== undefined && Object.keys(locator).length > 0) step.locator = locator;

    // Action × locator matrix, mirroring the host bridge contract exactly: only
    // click/input/select/scroll treat a locator as the action target; on any other
    // action the bridge would silently ignore it, so save rejects it instead of
    // storing a step that misleads re-teaching.
    const actionSupportsLocator = action === "click" || action === "input" || action === "select" || action === "scroll";
    const usesValueParam = action === "input" || action === "select";
    if (rawStep.url !== undefined && action !== "navigate") errors.push(`${where}: url is only allowed on navigate steps`);
    if (rawStep.locator !== undefined && !actionSupportsLocator) errors.push(`${where}: locator is not allowed on ${action} steps (locator-targeted actions: click, input, select, scroll)`);
    if (rawStep.fields !== undefined && action !== "fill_form") errors.push(`${where}: fields is only allowed on fill_form steps`);
    if (rawStep.valueParam !== undefined && !usesValueParam) errors.push(`${where}: valueParam is only allowed on input/select steps (fill_form fields carry their own valueParam)`);
    if (rawStep.valueShape !== undefined && !usesValueParam) errors.push(`${where}: valueShape is only allowed on input/select steps`);

    switch (action) {
      case "navigate": {
        if (typeof rawStep.url !== "string" || !rawStep.url.trim()) errors.push(`${where}: navigate requires a non-empty url`);
        else step.url = rawStep.url;
        break;
      }
      case "click": {
        if (locator === undefined || Object.keys(locator).length === 0) errors.push(`${where}: click requires a locator`);
        break;
      }
      case "input": {
        if (locator === undefined || Object.keys(locator).length === 0) errors.push(`${where}: input requires a locator`);
        const valueParam = validateValueParam(rawStep.valueParam, `${where}`, errors);
        const valueShape = validateValueShape(rawStep.valueShape, `${where}`, errors);
        if (valueParam !== undefined && valueShape !== undefined) {
          step.valueParam = valueParam;
          step.valueShape = valueShape;
          derived.set(valueParam, { shape: valueShape, ...(derived.get(valueParam)?.description ? { description: derived.get(valueParam)!.description } : {}) });
        }
        break;
      }
      case "select": {
        if (locator === undefined || Object.keys(locator).length === 0) errors.push(`${where}: select requires a locator`);
        const valueParam = validateValueParam(rawStep.valueParam, `${where}`, errors);
        if (rawStep.valueShape !== undefined) {
          const valueShape = validateValueShape(rawStep.valueShape, `${where}`, errors);
          if (valueShape !== undefined) step.valueShape = valueShape;
        }
        if (valueParam !== undefined) {
          step.valueParam = valueParam;
          if (!derived.has(valueParam)) derived.set(valueParam, { shape: step.valueShape ?? "option" });
        }
        break;
      }
      case "scroll": {
        // Page scroll by default; a locator scopes it to an element.
        break;
      }
      case "fill_form": {
        if (locator !== undefined && Object.keys(locator).length > 0) errors.push(`${where}: fill_form addresses fields individually, not via a step locator`);
        if (!Array.isArray(rawStep.fields) || rawStep.fields.length === 0) {
          errors.push(`${where}: fill_form requires a non-empty fields array`);
          break;
        }
        const fields: FlowField[] = [];
        rawStep.fields.forEach((rawField, j) => {
          const fieldWhere = `${where}.fields[${j}]`;
          if (!isPlainObject(rawField)) {
            errors.push(`${fieldWhere}: must be an object`);
            return;
          }
          for (const key of Object.keys(rawField)) {
            if (!FIELD_KEYS.has(key)) errors.push(`${fieldWhere}: unknown key "${key}" (allowed: locator, valueParam, valueShape; literal values are never stored)`);
          }
          const fieldLocator = validateLocator(rawField.locator, `${fieldWhere}.locator`, errors);
          const valueParam = validateValueParam(rawField.valueParam, `${fieldWhere}`, errors);
          let fieldShape: string | undefined;
          if (rawField.valueShape !== undefined) fieldShape = validateValueShape(rawField.valueShape, `${fieldWhere}`, errors);
          if (fieldLocator !== undefined && Object.keys(fieldLocator).length > 0 && valueParam !== undefined) {
            fields.push({ locator: fieldLocator, valueParam, ...(fieldShape !== undefined ? { valueShape: fieldShape } : {}) });
            if (!derived.has(valueParam)) derived.set(valueParam, { shape: fieldShape ?? "text" });
          }
        });
        if (fields.length > 0) step.fields = fields;
        break;
      }
      // wait/back/forward/reload carry no flow-specific payload in v1.
    }
    steps.push(step);
  });

  const params: Record<string, { shape: string; description?: string }> = {};
  for (const [key, value] of derived) params[key] = value;

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, flow: { schemaVersion: 1, name: name!, description, trigger, params, steps } };
}

// ---------------------------------------------------------------------------
// Replay engine.
// ---------------------------------------------------------------------------

/** Every param name a run must be given, in first-use order. */
export function requiredParams(steps: FlowStep[]): string[] {
  const names: string[] = [];
  const add = (name: string | undefined) => {
    if (name && !names.includes(name)) names.push(name);
  };
  for (const step of steps) {
    add(step.valueParam);
    for (const field of step.fields ?? []) add(field.valueParam);
  }
  return names;
}

/** Replaces literal param values in any string this tool emits. The host redacts secret
 * values from its own observations, but the extension guarantees it independently: a
 * value must never reach the model through an error echo or a redirect URL either. */
function makeRedactor(provided: Record<string, string>) {
  const pairs = Object.entries(provided)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, value]) => ({ name, value }));
  return (input: string): string => {
    let out = input;
    for (const { name, value } of pairs) out = out.split(value).join(`‹redacted:${name}›`);
    return out;
  };
}

/** Removes credentials, query and fragments from HTTP(S) URLs that the bridge may
 * introduce in redirects or diagnostics. A malformed URL is replaced entirely so an
 * unparseable authority cannot become a new leak. */
function sanitizeBridgeUrls(input: string): string {
  return input.replace(/https?:\/\/[^\s\x00-\x1F\x7F-\x9F]+/giu, (raw) => {
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return "[redacted URL]";
    }
  });
}

function safeBridgeText(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.message;
    return String(value);
  } catch {
    return "bridge error";
  }
}

/** Sanitizes a bridge response before it can cross the browser_flow result boundary.
 * Bridge JSON is normally acyclic, but mocked/hostile values must not make redaction
 * itself fail a successful replay. */
function sanitizeBridgeValue(value: unknown, redact: (input: string) => string, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redact(sanitizeBridgeUrls(value));
  if (value === null || typeof value !== "object") return value;
  try {
    if (seen.has(value)) return "[circular bridge value]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((entry) => sanitizeBridgeValue(entry, redact, seen));
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      try {
        output[key] = sanitizeBridgeValue((value as Record<string, unknown>)[key], redact, seen);
      } catch {
        output[key] = "[unavailable bridge value]";
      }
    }
    return output;
  } catch {
    return "[unavailable bridge value]";
  }
}

function sanitizeBridgeText(value: unknown, redact: (input: string) => string): string {
  return redact(sanitizeBridgeUrls(safeBridgeText(value)));
}

function stepEvent(step: FlowStep, provided: Record<string, string>): Record<string, unknown> {
  const scope = "viewport";
  switch (step.action) {
    case "navigate":
      return { action: "navigate", url: step.url, scope };
    case "input":
      // The host resolves the semantic locator and replaces the field content; type
      // semantics (append) have no bridge path and are rejected at save time.
      return { action: "input", locator: step.locator, text: provided[step.valueParam!], scope };
    case "select":
      return { action: "select", locator: step.locator, option: provided[step.valueParam!], scope };
    case "click":
      return { action: "click", locator: step.locator, scope };
    case "fill_form":
      return {
        action: "fill_form",
        fields: (step.fields ?? []).map((field) => ({ locator: field.locator, value: provided[field.valueParam] })),
        scope,
      };
    case "scroll":
      return { action: "scroll", ...(step.locator ? { locator: step.locator } : {}), scope };
    default:
      // wait (idle), back, forward, reload: no flow-specific payload in v1.
      return { action: step.action, ...(step.action === "wait" ? { mode: "idle" } : {}), scope };
  }
}

function stepLabel(index: number, step: FlowStep, total: number): string {
  return `[${index + 1}/${total}] ${step.action}${step.note ? ` (${step.note})` : ""}`;
}

/** A fill_form field the host could not write, mapped back onto the taught field so
 * the failure names locators and param NAMES — never values. */
export type FlowFieldFailure = { field: number; locator?: SemanticLocator; valueParam?: string; error: string };

const TAKEOVER_HINT =
  "The page may have changed since this flow was taught. Observe the current page with the browser tool, take over from this step manually, then re-teach the flow if the flow is still wanted.";

export async function runFlow(
  flow: BrowserFlow,
  provided: Record<string, string>,
  options: { timeoutMs?: number; signal?: AbortSignal },
): Promise<
  | { ok: true; steps: Array<{ index: number; action: string; url?: string; valueParam?: string; note?: string }>; elapsedMs: number }
  | { ok: false; failedStep: { index: number; action: string; locator?: SemanticLocator; failedFields?: FlowFieldFailure[] }; error: string; hint: string; completed: number; total: number }
> {
  const redact = makeRedactor(provided);
  const required = requiredParams(flow.steps);
  const missing = required.filter((name) => typeof provided[name] !== "string" || provided[name] === "");
  if (missing.length > 0) {
    // Missing names only — provided values must never be echoed, even here.
    return {
      ok: false as const,
      failedStep: { index: -1, action: "run" },
      error: `missing required params: ${missing.join(", ")}`,
      hint: `Pass them in this run call's params. Declared: ${Object.entries(flow.params).map(([n, p]) => `${n} (${p.shape})`).join(", ") || "(none)"}.`,
      completed: 0,
      total: flow.steps.length,
    };
  }
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(MIN_RUN_DEADLINE_MS, Math.min(MAX_RUN_DEADLINE_MS, options.timeoutMs ?? DEFAULT_RUN_DEADLINE_MS));
  const results: Array<{ index: number; action: string; url?: string; valueParam?: string; note?: string }> = [];
  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    if (options.signal?.aborted) {
      return { ok: false as const, failedStep: { index: i, action: step.action, locator: step.locator }, error: "cancelled", hint: TAKEOVER_HINT, completed: results.length, total: flow.steps.length };
    }
    const remaining = deadline - Date.now();
    if (remaining < STEP_START_FLOOR_MS) {
      return { ok: false as const, failedStep: { index: i, action: step.action, locator: step.locator }, error: `run deadline exceeded before step ${i + 1} could start`, hint: TAKEOVER_HINT, completed: results.length, total: flow.steps.length };
    }
    let response: any;
    try {
      response = sanitizeBridgeValue(await bridge(step.action, stepEvent(step, provided), options.signal, remaining), redact);
    } catch (error) {
      return {
        ok: false as const,
        failedStep: { index: i, action: step.action, locator: step.locator },
        error: sanitizeBridgeText(error, redact),
        hint: TAKEOVER_HINT,
        completed: results.length,
        total: flow.steps.length,
      };
    }
    if (!response || response.ok !== true) {
      return {
        ok: false as const,
        failedStep: { index: i, action: step.action, locator: step.locator },
        error: sanitizeBridgeText((response && response.error) || "bridge error", redact),
        hint: TAKEOVER_HINT,
        completed: results.length,
        total: flow.steps.length,
      };
    }
    // fill_form is the one bridge action whose ok:true does not mean "every field
    // written": the host reports per-field outcomes ({filled, failed, results}) and
    // stays ok:true on partial failure. Continuing would run the follow-up submit step
    // against a half-filled page, so a single failed field stops the run here.
    if (step.action === "fill_form" && typeof response.failed === "number" && response.failed > 0) {
      const fieldResults: unknown[] = Array.isArray(response.results) ? response.results : [];
      const failedFields: FlowFieldFailure[] = fieldResults
        .filter((r): r is Record<string, unknown> => isPlainObject(r) && r.ok !== true)
        .map((r) => {
          const fieldIndex = typeof r.index === "number" && Number.isInteger(r.index) ? r.index : -1;
          const field = fieldIndex >= 0 ? (step.fields ?? [])[fieldIndex] : undefined;
          const code = typeof r.error === "string" && r.error ? r.error : "field failed";
          const message = typeof r.message === "string" && r.message ? r.message : "";
          return {
            field: fieldIndex,
            ...(field ? { locator: field.locator, valueParam: field.valueParam } : {}),
            error: redact(message ? `${code} — ${message}` : code),
          };
        });
      const filled = typeof response.filled === "number" ? response.filled : 0;
      const error = failedFields.length
        ? `fill_form wrote ${filled} field(s) but ${response.failed} failed — ${failedFields.map((f) => `field #${f.field + 1}${f.valueParam ? ` (${f.valueParam})` : ""}: ${f.error}`).join("; ")}`
        : `fill_form reported ${response.failed} failed field(s)`;
      return {
        ok: false as const,
        failedStep: { index: i, action: step.action, ...(step.locator ? { locator: step.locator } : {}), failedFields },
        error: redact(error),
        hint: TAKEOVER_HINT,
        completed: results.length,
        total: flow.steps.length,
      };
    }
    // Success echo: parameter names only. A value's length is the host's business; this
    // tool never reflects what was typed.
    results.push({
      index: i,
      action: step.action,
      ...(step.action === "navigate" && typeof response.url === "string" ? { url: sanitizeBridgeText(response.url, redact) } : {}),
      ...(step.valueParam !== undefined ? { valueParam: step.valueParam } : {}),
      ...(step.note !== undefined ? { note: step.note } : {}),
    });
  }
  return { ok: true as const, steps: results, elapsedMs: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// Session episode & candidate contract — pure functions for the auto-capture
// loop (the hooks that feed them arrive in a later slice). No bridge, no fs,
// no network here, and no literal input values anywhere: values are consumed
// by normalization and replaced with deterministic valueParam names derived
// from locator semantics.
// ---------------------------------------------------------------------------

/** A sealed same-session episode: the replayable trace of ONE Pi session's successful
 * browsing, kept in memory only (never written to browser-flows/). Contract: sealed
 * only from successful browser results, at least two replayable steps; `id` is a
 * semantic slug (see uniqueSlug) so the model can pass it straight to browser_flow run. */
export type SessionEpisode = {
  schemaVersion: 1;
  id: string;
  title: string;
  /** Most recent successful navigate URL — the episode's trigger fallback. */
  url?: string;
  steps: FlowStep[];
  sealedAt: string;
  /** Replay outcomes: sealing one verified trace counts as one success, and every
   * direct replay adds one more. Drives promotion and candidate suppression. */
  stats: FlowRunStats;
  /** Set once this episode was written into browser-flows/ under this slug —
   * candidates then surface only the episode, never both copies. */
  promotedSlug?: string;
};

export type CandidateSource = "episode" | "flow";

/** What the matcher ranks: a saved flow (trigger as taught) or a session episode
 * (empty trigger — it matches via its first navigate host). */
export type CandidateInput = {
  /** Semantic slug — a saved-flow slug or an episode id. Passed through as-is. */
  id: string;
  name: string;
  source: CandidateSource;
  trigger: FlowTrigger;
  steps: FlowStep[];
};

/** How a candidate matched the current URL, best first: a pinned path substring
 * beats a domain match, which beats the inferred same-host-as-first-navigate fallback. */
export type TriggerMatch = "urlContains" | "domain" | "firstNavigate";

/** One surfaced candidate for the current page — everything browser_flow run needs,
 * nothing that leaks: no trigger echo, no values, only param NAMES. */
export type FlowCandidate = {
  id: string;
  name: string;
  source: CandidateSource;
  steps: FlowStep[];
  /** Param names replay must be given, in first-use order (requiredParams). */
  params: string[];
  match: TriggerMatch;
};

/** Deterministic unique semantic slug: slugify(base), with readable _N ordinals on
 * conflicts. Returns "" when the base has no slug material — callers choose a name. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const slug = slugify(base);
  if (!slug) return "";
  const seen = new Set(taken);
  if (!seen.has(slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug}_${n}`;
    if (!seen.has(candidate)) return candidate;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** Automatic traces may replay a URL, but must never retain query, fragment or
 * credentials from the live navigation. Explicitly taught flows keep their existing
 * validation contract; this boundary applies only to automatic capture. */
function sanitizeCapturedNavigateUrl(raw: string): string | undefined {
  const withoutQueryOrFragment = raw.split(/[?#]/, 1)[0];
  if (!withoutQueryOrFragment) return undefined;
  try {
    const parsed = new URL(withoutQueryOrFragment);
    if (!parsed.username && !parsed.password) return withoutQueryOrFragment;
    // URL serialization is needed only to remove embedded credentials; ordinary
    // captures preserve their existing origin spelling and trailing-slash behavior.
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return withoutQueryOrFragment;
  }
}

function normalizeDomain(entry: string): string {
  return entry.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split("/")[0].replace(/\.$/, "");
}

function firstNavigateStepUrl(steps: FlowStep[]): string | undefined {
  for (const step of steps) {
    if (step.action === "navigate" && typeof step.url === "string") return step.url;
  }
  return undefined;
}

/** Pure URL trigger match. urlContains is a substring of the whole URL; domains match
 * the hostname exactly (no subdomain widening); the firstNavigate fallback applies only
 * to an EMPTY trigger (neither urlContains nor domains) so legacy flows without a
 * trigger still surface on the site they were taught on. A non-empty trigger that
 * misses never falls back. */
export function matchFlowTrigger(trigger: FlowTrigger, currentUrl: string, firstNavigateStepUrl?: string): TriggerMatch | undefined {
  const urlContains = typeof trigger.urlContains === "string" && trigger.urlContains.trim() ? trigger.urlContains : undefined;
  const domains = (Array.isArray(trigger.domains) ? trigger.domains : []).filter((d): d is string => typeof d === "string" && d.trim().length > 0);
  const pathMatches = urlContains === undefined || currentUrl.includes(urlContains);
  const host = hostOf(currentUrl);
  const domainMatches = domains.length === 0 || (host !== "" && domains.some((d) => normalizeDomain(d) === host));
  // A trigger that declares both constraints is intentionally conjunctive: a matching
  // path on the wrong host must never clear the replay side-effect guard.
  if (urlContains !== undefined || domains.length > 0) {
    if (!pathMatches || !domainMatches) return undefined;
    return urlContains !== undefined ? "urlContains" : "domain";
  }
  if (firstNavigateStepUrl !== undefined && host !== "" && hostOf(firstNavigateStepUrl) === host) return "firstNavigate";
  return undefined;
}

const TRIGGER_MATCH_SCORE: Record<TriggerMatch, number> = { urlContains: 3, domain: 2, firstNavigate: 1 };

/** Rank candidates for the current page without touching network or bridge: best match
 * kind first (urlContains > domain > firstNavigate); on equal match the session episode
 * precedes the saved flow; otherwise input order is preserved (stable sort). */
export function rankCandidates(currentUrl: string, candidates: CandidateInput[]): FlowCandidate[] {
  const scored = candidates
    .map((candidate, order) => {
      const match = matchFlowTrigger(candidate.trigger, currentUrl, firstNavigateStepUrl(candidate.steps));
      if (match === undefined) return undefined;
      return {
        id: candidate.id,
        name: candidate.name,
        source: candidate.source,
        steps: candidate.steps,
        params: requiredParams(candidate.steps),
        match,
        score: TRIGGER_MATCH_SCORE[match],
        order,
      };
    })
    .filter((c): c is FlowCandidate & { score: number; order: number } => c !== undefined);
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.source === "episode" ? 0 : 1) - (b.source === "episode" ? 0 : 1) ||
      a.order - b.order,
  );
  return scored.map(({ score: _score, order: _order, ...candidate }) => candidate);
}

/** The intentionally narrow candidate projection attached to browser results. FlowCandidate
 * retains steps for internal replay; this is the only shape exposed to the model. */
type PublicFlowCandidate = {
  id: string;
  name: string;
  source: CandidateSource;
  match: TriggerMatch;
  steps: number;
  paramNames: string[];
};

function candidateInputsFor(cwd: string): CandidateInput[] {
  const stored = listSessionEpisodes(cwd);
  // A flow promoted from a same-session episode dedups behind that episode: one
  // candidate, not two, for what is semantically the same flow.
  const promoted = new Set(stored.map((episode) => episode.promotedSlug).filter((slug): slug is string => slug !== undefined));
  const flowSlugs = listFlowSlugs(cwd).filter((slug) => !promoted.has(slug));
  const flowIds = new Set(flowSlugs);
  const episodeIds = new Set(stored.map((episode) => episode.id));
  const episodes: CandidateInput[] = stored
    // An episode whose direct replays keep failing stops being recommended.
    .filter((episode) => statCount(episode.stats?.consecutiveFailures) < REPLAY_SUPPRESSION_THRESHOLD)
    .map((episode) => ({
      // An unqualified collision resolves legacy-first to the episode, so candidates
      // qualify both sources only when needed to make direct replay unambiguous.
      id: flowIds.has(episode.id) ? `episode:${episode.id}` : episode.id,
      name: episode.title,
      source: "episode",
      trigger: {},
      steps: episode.steps,
    }));
  const flows: CandidateInput[] = [];
  for (const slug of flowSlugs) {
    const loaded = loadFlow(cwd, slug);
    // A damaged saved file must never suppress usable episode/flow suggestions.
    if (!loaded.ok) continue;
    flows.push({ id: episodeIds.has(slug) ? `saved:${slug}` : slug, name: loaded.flow.name, source: "flow", trigger: loaded.flow.trigger, steps: loaded.flow.steps });
  }
  return [...episodes, ...flows];
}

function publicCandidate(candidate: FlowCandidate): PublicFlowCandidate {
  return {
    id: candidate.id,
    name: candidate.name,
    source: candidate.source,
    match: candidate.match,
    steps: candidate.steps.length,
    paramNames: candidate.params,
  };
}

/** Gets a result URL only from the successful navigate/observe operation that produced
 * it. Batch result entries are inspected from last to first, so a trailing observe wins. */
function candidateUrl(input: unknown, details: unknown, isError: boolean): string | undefined {
  if (isError || !isPlainObject(details) || details.ok === false) return undefined;
  const actions = browserCallActions(input);
  const relevant = actions.map((action, index) => ({ action, index })).filter(({ action }) => action === "navigate" || action === "observe");
  if (relevant.length === 0) return undefined;
  const urlOf = (value: unknown): string | undefined => isPlainObject(value) && typeof value.url === "string" && value.url ? value.url : undefined;
  const results = Array.isArray(details.results) ? details.results : [];
  for (let i = relevant.length - 1; i >= 0; i--) {
    const entry = results[relevant[i].index];
    const url = urlOf(isPlainObject(entry) ? entry.details : undefined) ?? urlOf(entry);
    if (url !== undefined) return url;
  }
  return urlOf(details);
}

function browserCandidatePatch(event: { input: unknown; details: unknown; isError: boolean }, cwd: string): Record<string, unknown> | undefined {
  const url = candidateUrl(event.input, event.details, event.isError);
  if (url === undefined || !isPlainObject(event.details)) return undefined;
  const candidates = rankCandidates(url, candidateInputsFor(cwd)).slice(0, 3);
  if (candidates.length === 0) return undefined;
  const surfaced = candidates.map(publicCandidate);
  const recommended = candidates[0];
  const paramHint = recommended.params.length ? ` Required params: ${recommended.params.join(", ")}.` : "";
  return {
    content: [
      ...(Array.isArray((event as { content?: unknown }).content) ? (event as { content: unknown[] }).content : []),
      { type: "text", text: `Browser flow suggestion: ${recommended.name} (${recommended.steps.length} steps). Run browser_flow directly with action:\"run\" and name:\"${recommended.id}\".${paramHint}` },
    ],
    details: {
      ...event.details,
      browserFlowCandidates: surfaced,
      recommendedBrowserFlow: { action: "run", name: recommended.id, missingParams: recommended.params },
    },
  };
}

/** valueParam → shape map for an episode's steps — param NAMES only, never values. */
function episodeParams(steps: FlowStep[]): BrowserFlow["params"] {
  const params: BrowserFlow["params"] = {};
  for (const step of steps) {
    if (step.valueParam !== undefined) params[step.valueParam] = { shape: step.valueShape ?? "text" };
    for (const field of step.fields ?? []) params[field.valueParam] = { shape: field.valueShape ?? "text" };
  }
  return params;
}

function episodeAsFlow(episode: SessionEpisode): BrowserFlow {
  return {
    schemaVersion: 1,
    name: episode.title,
    description: "",
    trigger: {},
    params: episodeParams(episode.steps),
    steps: episode.steps,
    createdAt: episode.sealedAt,
    updatedAt: episode.sealedAt,
  };
}

// --- normalization: one live browser call → replayable FlowSteps -------------

const SNAPSHOT_TARGET_KEYS = ["snapshot_id", "element_index", "element_token"] as const;

/** Actions that only observe page state — they never become steps. Inside a batch a
 * read-only item is filtered out (the host recommends trailing observe/screenshot for
 * confirmation, which must not void the replayable prefix before it). The capture
 * pipeline ignores all-read-only calls outright — appending nothing — and even a FAILED
 * read-only call breaks nothing there: an observation cannot change page state, so the
 * replayable prefix stays verified (the read-only carve-out from the isError/ok:false
 * invalidation rule). */
const READ_ONLY_BROWSER_ACTIONS = new Set(["observe", "screenshot", "content", "console", "watch", "unwatch", "watches", "help"]);

function isReadOnlyBrowserAction(raw: unknown): boolean {
  return isPlainObject(raw) && typeof raw.action === "string" && READ_ONLY_BROWSER_ACTIONS.has(raw.action);
}

export type BrowserCallNormalization = { ok: true; steps: FlowStep[] } | { ok: false; error: string };

/** Normalizes ONE successful `browser` tool call — `{action, ...}` or `{actions: [...]}` —
 * into the FlowSteps a stored flow or session episode could deterministically replay.
 * Rejected: snapshot/index/token targeting (and locator `nth` disambiguation — a stored
 * step cannot be positional), selector/snapshot waits, direction/amount scrolls, and
 * every side-effecting action no stored flow can replay (eval, script, type). Read-only
 * observations are not steps: inside a batch they are filtered out — a trailing
 * observe/screenshot must not void the replayable prefix before it — so an all-read-only
 * batch normalizes to zero steps (the capture pipeline ignores those calls outright). A
 * batch's remaining items are accepted whole or not at all, mirroring the host's own
 * stop-at-first-failure discipline.
 *
 * Literal values (input text, select option, fill_form values) are consumed here and
 * NEVER appear in the result or the error: each becomes a deterministic valueParam name
 * derived from the locator's semantics (readable _N ordinals on conflicts within the
 * call) plus a fixed valueShape (text | option). Callers must only feed calls that
 * actually succeeded at the host. */
export function normalizeBrowserCall(input: unknown): BrowserCallNormalization {
  if (!isPlainObject(input)) return { ok: false, error: "browser call input must be an object" };
  const hasSingle = input.action !== undefined;
  const hasBatch = input.actions !== undefined;
  if (hasSingle === hasBatch) {
    return { ok: false, error: "pass exactly one of action (single call) or actions (batch of 1..8)" };
  }
  // Param-name uniqueness is per CALL: two same-named fields in one call are one
  // replay unit, so their values must stay independently addressable. Collisions
  // ACROSS the calls of one episode are renamed at trace-append time instead (see
  // appendTraceSteps).
  const taken = new Set<string>();
  if (hasBatch) {
    const batch = input.actions;
    if (!Array.isArray(batch) || batch.length < 1 || batch.length > 8) {
      return { ok: false, error: "actions must be an array of 1..8 items" };
    }
    const steps: FlowStep[] = [];
    for (let i = 0; i < batch.length; i++) {
      // Read-only observation inside a batch: skip it, keep the replayable rest.
      if (isReadOnlyBrowserAction(batch[i])) continue;
      const one = normalizeBrowserAction(batch[i], `actions[${i}]`, taken);
      if (!one.ok) return one;
      steps.push(one.step);
    }
    return { ok: true, steps };
  }
  const one = normalizeBrowserAction(input, "action", taken);
  return one.ok ? { ok: true, steps: [one.step] } : one;
}

function normalizeLocatorTarget(raw: Record<string, unknown>, where: string): { ok: true; locator: SemanticLocator } | { ok: false; error: string } {
  if (raw.locator === undefined) {
    return { ok: false, error: `${where}: requires a semantic locator ({role,name}|{label}|{text}|{css}) — snapshot/index/token targeting does not replay` };
  }
  // Reuse the save-time locator contract verbatim, so a normalized step can always be
  // saved unchanged; unknown locator keys (element_token, nth, ...) are rejected there.
  const errors: string[] = [];
  const locator = validateLocator(raw.locator, `${where}.locator`, errors);
  if (errors.length > 0 || !locator || Object.keys(locator).length === 0) {
    return { ok: false, error: errors.length > 0 ? errors.join("; ") : `${where}: requires a semantic locator` };
  }
  return { ok: true, locator };
}

function normalizeBrowserAction(raw: unknown, where: string, taken: Set<string>): { ok: true; step: FlowStep } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: `${where}: must be an object` };
  const action = raw.action;
  if (typeof action !== "string" || action === "") return { ok: false, error: `${where}: requires an "action" string` };
  if (action === "type") {
    return { ok: false, error: `${where}: action "type" cannot be replayed — use "input" with a locator` };
  }
  if (!ALLOWED_STEP_ACTION_SET.has(action)) {
    return { ok: false, error: `${where}: action "${action}" is not replayable and cannot be captured (replayable actions: ${ALLOWED_STEP_ACTIONS.join(", ")})` };
  }
  // Snapshot-targeted calls can never replay: name the offending key, never its value.
  // (fill_form's optional snapshot_id is live context only — its fields target
  // individually, so it is simply not copied; see the fill_form case.)
  if (action !== "fill_form") {
    for (const key of SNAPSHOT_TARGET_KEYS) {
      if (raw[key] !== undefined) {
        return { ok: false, error: `${where}: "${key}" targets a snapshot element, which does not replay — use a semantic locator ({role,name}|{label}|{text}|{css})` };
      }
    }
  }
  switch (action) {
    case "navigate": {
      if (typeof raw.url !== "string" || !raw.url.trim()) return { ok: false, error: `${where}: navigate requires a non-empty url` };
      const url = sanitizeCapturedNavigateUrl(raw.url);
      if (url === undefined) return { ok: false, error: `${where}: navigate requires a URL with a safe origin or path` };
      return { ok: true, step: { action, url } };
    }
    case "wait": {
      if ((raw.mode !== undefined && raw.mode !== "idle") || raw.selector !== undefined || raw.target !== undefined) {
        return { ok: false, error: `${where}: only an idle wait replays — selector/snapshot waits observe live page state and are not captured` };
      }
      // Live tuning params (timeout, idle_ms) only say how long; the stored step is the
      // semantic "wait for idle" the replay engine already sends.
      return { ok: true, step: { action: "wait" } };
    }
    case "click": {
      const located = normalizeLocatorTarget(raw, where);
      if (!located.ok) return located;
      return { ok: true, step: { action: "click", locator: located.locator } };
    }
    case "input":
    case "select": {
      const valueKey = action === "input" ? "text" : "option";
      if (typeof raw[valueKey] !== "string") {
        return { ok: false, error: `${where}: ${action} requires "${valueKey}" (the live value is captured only as a valueParam name)` };
      }
      const located = normalizeLocatorTarget(raw, where);
      if (!located.ok) return located;
      return { ok: true, step: { action, locator: located.locator, valueParam: deriveParamName(located.locator, taken), valueShape: action === "input" ? "text" : "option" } };
    }
    case "fill_form": {
      const rawFields = raw.fields;
      if (!Array.isArray(rawFields) || rawFields.length === 0) {
        return { ok: false, error: `${where}: fill_form requires a non-empty fields array` };
      }
      const fields: FlowField[] = [];
      for (let j = 0; j < rawFields.length; j++) {
        const rawField = rawFields[j];
        const fieldWhere = `${where}.fields[${j}]`;
        if (!isPlainObject(rawField)) return { ok: false, error: `${fieldWhere}: must be an object` };
        if (typeof rawField.value !== "string") {
          return { ok: false, error: `${fieldWhere}: fill_form requires "value" (captured only as a valueParam name)` };
        }
        const located = normalizeLocatorTarget(rawField, fieldWhere);
        if (!located.ok) return located;
        fields.push({ locator: located.locator, valueParam: deriveParamName(located.locator, taken), valueShape: "text" });
      }
      return { ok: true, step: { action: "fill_form", fields } };
    }
    case "scroll": {
      if (raw.direction !== undefined || raw.amount !== undefined) {
        return { ok: false, error: `${where}: scroll direction/amount are not part of the stored step contract — only a bare page scroll or a locator-scoped scroll replays` };
      }
      if (raw.locator !== undefined) {
        const located = normalizeLocatorTarget(raw, where);
        if (!located.ok) return located;
        return { ok: true, step: { action: "scroll", locator: located.locator } };
      }
      // A live CSS selector is exactly the stored {css} locator — same structured path.
      if (typeof raw.selector === "string" && raw.selector.trim()) {
        return { ok: true, step: { action: "scroll", locator: { css: raw.selector } } };
      }
      return { ok: true, step: { action: "scroll" } };
    }
    default:
      // back / forward / reload carry no capture-relevant payload.
      return { ok: true, step: { action } };
  }
}

/** Deterministic param name from a locator's semantics, tried in order: name, label,
 * text, the css id/class hint, the role — ASCII-slugged to VALUE_PARAM_PATTERN — then a
 * plain "value" fallback. Conflicts within one call get readable _N ordinals. */
function deriveParamName(locator: SemanticLocator, taken: Set<string>): string {
  const cssHint =
    typeof locator.css === "string"
      ? (locator.css.match(/#([A-Za-z][\w-]*)/) ?? locator.css.match(/\.([A-Za-z][\w-]*)/))?.[1]
      : undefined;
  for (const candidate of [locator.name, locator.label, locator.text, cssHint, locator.role]) {
    if (typeof candidate !== "string") continue;
    const base = asciiParamSlug(candidate);
    if (base) return allocateParamName(base, taken);
  }
  return allocateParamName("value", taken);
}

function asciiParamSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
    .slice(0, 64)
    .replace(/_+$/, "");
  return VALUE_PARAM_PATTERN.test(slug) ? slug : "";
}

function allocateParamName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const name = `${base}_${n}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-capture: the live per-run trace + the same-session episode store. The
// lifecycle hooks that feed these live in the registration section below.
// Memory only — nothing here touches fs or the bridge, and nothing stores
// literal input values, snapshot ids, tokens or indexes: steps reach this code
// only through normalizeBrowserCall, and invalidation reasons/errors are dropped
// (a failed host message can echo values, so it is never retained).
// ---------------------------------------------------------------------------

const MAX_SESSION_EPISODES = 12;

/** Actions whose SUCCESS still changes page state in ways no stored flow can
 * deterministically replay, so they void the trace even though the host succeeded. */
const SIDE_EFFECT_BROWSER_ACTIONS = new Set(["eval", "script", "type"]);

/** The trace of the current agent run: replayable steps so far, and whether some
 * failure or non-replayable side effect has voided it for this run's settle. */
type LiveTrace = { steps: FlowStep[]; invalid: boolean };

let liveTrace: LiveTrace | undefined;
/** cwd → sealed episodes, oldest first. Same-session by construction: the runtime
 * owns one extension instance per session and session_start clears everything. */
const episodeStores = new Map<string, SessionEpisode[]>();

function episodesFor(cwd: string): SessionEpisode[] {
  let store = episodeStores.get(cwd);
  if (!store) {
    store = [];
    episodeStores.set(cwd, store);
  }
  return store;
}

/** Read-only listing of the current cwd's sealed session episodes — the matcher
 * input for candidate surfacing. Defensive deep copies: callers can never
 * mutate the store through what this returns. */
export function listSessionEpisodes(cwd: string): SessionEpisode[] {
  return (episodeStores.get(cwd) ?? []).map((episode) => JSON.parse(JSON.stringify(episode)) as SessionEpisode);
}

function resetEpisodeSessionState(): void {
  liveTrace = undefined;
  episodeStores.clear();
}

function browserCallActions(input: unknown): string[] {
  if (!isPlainObject(input)) return [];
  if (typeof input.action === "string") return [input.action];
  if (Array.isArray(input.actions)) {
    return input.actions
      .filter((item): item is Record<string, unknown> => isPlainObject(item) && typeof item.action === "string")
      .map((item) => item.action as string);
  }
  return [];
}

/** The batch envelope's per-entry outcomes: any status other than ok, any entry
 * error, or a fill_form entry that stayed status:ok while fields failed voids the trace. */
function batchReportFailed(details: Record<string, unknown>): boolean {
  if (!Array.isArray(details.results)) return false;
  return details.results.some((entry) => {
    if (!isPlainObject(entry)) return true;
    if (entry.status !== undefined && entry.status !== "ok") return true;
    if (entry.isError === true) return true;
    const entryDetails = isPlainObject(entry.details) ? entry.details : undefined;
    return entryDetails !== undefined && typeof entryDetails.failed === "number" && entryDetails.failed > 0;
  });
}

/** Feeds ONE `browser` tool_result into the live trace. Read-only calls are ignored
 * outright; any failure (isError, ok:false, partial fill_form, failed/skipped batch
 * entry) voids the trace; so does a SUCCESSFUL call that cannot replay (eval/script/
 * type, or a state change normalization rejects — snapshot-targeted clicks, directed
 * scrolls, selector waits). A successful MIXED batch keeps its replayable steps:
 * normalizeBrowserCall filters the read-only items out. Steps go through
 * appendTraceSteps so valueParams stay unique across the whole episode. */
function recordBrowserResult(event: { input: Record<string, unknown>; isError: boolean; details: unknown }): void {
  const actions = browserCallActions(event.input);
  if (actions.length > 0 && actions.every((name) => READ_ONLY_BROWSER_ACTIONS.has(name))) return;
  if (!liveTrace) liveTrace = { steps: [], invalid: false };
  const details = isPlainObject(event.details) ? event.details : undefined;
  const failed =
    event.isError ||
    details?.ok === false ||
    (details?.batch === true && batchReportFailed(details)) ||
    // fill_form is the one action whose ok:true hides partial failure.
    (typeof details?.failed === "number" && details.failed > 0);
  if (failed) {
    liveTrace.invalid = true;
    return;
  }
  if (actions.some((name) => SIDE_EFFECT_BROWSER_ACTIONS.has(name))) {
    liveTrace.invalid = true;
    return;
  }
  const normalized = normalizeBrowserCall(event.input);
  if (!normalized.ok) {
    liveTrace.invalid = true;
    return;
  }
  appendTraceSteps(liveTrace, normalized.steps);
}

/** Appends fresh steps to the live trace, renaming valueParams that an earlier call of
 * the SAME episode already used into readable _2/_3 ordinals — the cross-call twin of
 * the per-call uniqueness normalizeBrowserCall enforces. One episode's params must stay
 * independently addressable at replay, and only param NAMES are compared or rewritten:
 * literal values never reach a FlowStep. */
function appendTraceSteps(trace: LiveTrace, steps: FlowStep[]): void {
  const taken = new Set<string>();
  for (const step of trace.steps) {
    if (step.valueParam !== undefined) taken.add(step.valueParam);
    for (const field of step.fields ?? []) taken.add(field.valueParam);
  }
  for (const step of steps) {
    if (step.valueParam !== undefined) step.valueParam = allocateParamName(step.valueParam, taken);
    for (const field of step.fields ?? []) field.valueParam = allocateParamName(field.valueParam, taken);
    trace.steps.push(step);
  }
}

/** Most recent successful navigate URL — the episode's trigger fallback. */
function mostRecentNavigateUrl(steps: FlowStep[]): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.action === "navigate" && typeof step.url === "string") return step.url;
  }
  return undefined;
}

/** Deterministic semantic title, hence id (uniqueSlug slugifies it): first navigate
 * host/path + a readable phrase for the LAST step's action/locator. No random
 * values, no user input — locator text is page semantics, never a typed value. */
function episodeTitle(steps: FlowStep[]): string {
  let hostPath = "";
  const firstUrl = firstNavigateStepUrl(steps);
  if (firstUrl !== undefined) {
    try {
      const parsed = new URL(firstUrl);
      const path = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean).join("-");
      hostPath = [parsed.hostname.toLowerCase(), path].filter(Boolean).join("/");
    } catch {
      hostPath = "";
    }
  }
  const last = steps[steps.length - 1];
  let tail = "";
  if (last.action !== "navigate") {
    const locator = last.locator ?? (last.fields !== undefined ? last.fields[0]?.locator : undefined);
    const readable = locator?.name ?? locator?.label ?? locator?.text ?? locator?.css ?? locator?.role ?? "";
    tail = [last.action, readable].filter(Boolean).join(" ");
  }
  return [hostPath, tail].filter(Boolean).join(" — ");
}

/** Seals one trace into the cwd's store. Byte-identical normalized steps update the
 * existing episode in place (refresh title/sealedAt, move to most-recent) instead of
 * stacking a duplicate; genuinely new traces get a unique semantic slug id. */
async function sealEpisode(cwd: string, steps: FlowStep[]): Promise<void> {
  const store = episodesFor(cwd);
  const title = episodeTitle(steps);
  const stored: FlowStep[] = JSON.parse(JSON.stringify(steps)) as FlowStep[];
  const key = JSON.stringify(stored);
  const url = mostRecentNavigateUrl(stored);
  const sealedAt = new Date().toISOString();
  const existingIndex = store.findIndex((episode) => JSON.stringify(episode.steps) === key);
  let episode: SessionEpisode;
  if (existingIndex >= 0) {
    [episode] = store.splice(existingIndex, 1);
    episode.title = title;
    if (url !== undefined) episode.url = url;
    episode.sealedAt = sealedAt;
    // One verified human trace = one success, new episode or recurring one alike.
    episode.stats = nextRunStats(episode.stats, true, sealedAt);
    store.push(episode);
  } else {
    episode = {
      schemaVersion: 1,
      id: uniqueSlug(title, store.map((episode) => episode.id)),
      title,
      ...(url !== undefined ? { url } : {}),
      steps: stored,
      sealedAt,
      stats: nextRunStats(undefined, true, sealedAt),
    };
    store.push(episode);
  }
  await maybePromoteEpisode(cwd, episode);
  while (store.length > MAX_SESSION_EPISODES) store.shift();
}

/** One agent run, one trace: at the settle it is sealed (when it stayed a verified
 * ≥2-step replayable sequence) or discarded — invalidation never outlives the run. */
async function settleEpisodeTrace(cwd: string): Promise<void> {
  const trace = liveTrace;
  liveTrace = undefined;
  if (!trace || trace.invalid || trace.steps.length < 2) return;
  await sealEpisode(cwd, trace.steps);
}

// ---------------------------------------------------------------------------
// Replay promotion — a twice-successful episode becomes a saved flow.
// ---------------------------------------------------------------------------

/** Successes an episode needs before it graduates into browser-flows/: taught by
 * hand twice, or taught once and then replayed successfully once. */
const PROMOTION_MIN_SUCCESS = 2;

/** Consecutive failed direct replays after which an episode stops being surfaced as
 * an automatic candidate — a flow that misfires twice should be re-taught, not
 * re-recommended. Direct runs still work; suppression limits suggestion only. */
const REPLAY_SUPPRESSION_THRESHOLD = 2;

/** Writes a twice-successful episode into browser-flows/ under its own slug. The
 * trigger derives from the episode's first navigate, sanitized to host + path only
 * (never query or fragment); an episode without any navigate step is never promoted;
 * an existing flow with the same slug is never overwritten — the promotion takes a
 * readable _N ordinal instead. Best-effort bookkeeping: any write failure leaves the
 * episode as it is, still directly runnable. */
async function maybePromoteEpisode(cwd: string, episode: SessionEpisode): Promise<void> {
  if (episode.promotedSlug !== undefined || statCount(episode.stats?.successes) < PROMOTION_MIN_SUCCESS) return;
  const firstUrl = firstNavigateStepUrl(episode.steps);
  if (firstUrl === undefined) return;
  let host = "";
  let urlContains: string | undefined;
  try {
    const parsed = new URL(firstUrl);
    host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");
    if (path !== "") urlContains = path;
  } catch {
    return; // an unparseable navigate URL cannot yield a sanitized trigger
  }
  if (host === "" && urlContains === undefined) return;
  try {
    await withFlowStoreLock(cwd, () => {
      if (episode.promotedSlug !== undefined || statCount(episode.stats?.successes) < PROMOTION_MIN_SUCCESS) return;
      // Slug allocation and its atomic write share this project-local sequence, so a
      // concurrent save/promotion cannot claim the same readable ordinal between them.
      const slug = uniqueSlug(episode.id, listFlowSlugs(cwd));
      if (slug === "") return;
      const now = new Date().toISOString();
      const flow: BrowserFlow = {
        schemaVersion: 1,
        name: episode.title,
        description: "Auto-promoted: this sequence replayed successfully twice in this session.",
        trigger: { ...(host !== "" ? { domains: [host] } : {}), ...(urlContains !== undefined ? { urlContains } : {}) },
        params: episodeParams(episode.steps),
        steps: JSON.parse(JSON.stringify(episode.steps)) as FlowStep[],
        createdAt: now,
        updatedAt: now,
        stats: { ...episode.stats },
      };
      writeFlowAtomic(cwd, slug, flow);
      episode.promotedSlug = slug;
    });
  } catch {
    return;
  }
}

// ---------------------------------------------------------------------------
// Tool registration.
// ---------------------------------------------------------------------------

const LocatorSchema = Type.Object(
  {
    role: Type.Optional(Type.String({ description: "ARIA role (paired with name), e.g. button, link, textbox" })),
    name: Type.Optional(Type.String({ description: "Accessible name (paired with role)" })),
    label: Type.Optional(Type.String({ description: "Label text / for-text / aria-label" })),
    text: Type.Optional(Type.String({ description: "Visible text content" })),
    css: Type.Optional(Type.String({ description: "CSS selector" })),
  },
  { description: "Semantic locator — exactly one of {role,name} | {label} | {text} | {css}. Never snapshot ids." },
);

const StepSchema = Type.Object(
  {
    action: Type.String({
      description:
        `One of: ${ALLOWED_STEP_ACTIONS.join(" | ")}. Locator contract (must match the host bridge): ` +
        "click/input/select require a locator; scroll takes an optional locator (page scroll without); navigate uses url (no locator); wait/back/forward/reload carry no target; fill_form addresses fields individually via fields[]. " +
        '"type" is rejected — the bridge cannot replay it; use input with a locator.',
    }),
    locator: Type.Optional(LocatorSchema),
    url: Type.Optional(Type.String({ description: "navigate only: URL to open" })),
    valueParam: Type.Optional(Type.String({ description: "input/select: params key that supplies the value at run time (values are never stored)" })),
    valueShape: Type.Optional(Type.String({ description: "input: value kind, e.g. text | password | otp (required on input, optional on select)" })),
    fields: Type.Optional(
      Type.Array(
        Type.Object({
          locator: LocatorSchema,
          valueParam: Type.String({ description: "params key for this field's value" }),
          valueShape: Type.Optional(Type.String()),
        }),
        { description: "fill_form only: every field value is parameterized" },
      ),
    ),
    note: Type.Optional(Type.String({ description: "Why this step exists (shown on replay)" })),
  },
  { description: "One replayable step. locator-only: snapshot_id/element_token are v2 and rejected here." },
);

function cwdOf(ctx: { cwd?: string } | undefined): string {
  return ctx?.cwd || process.env.PIPIUI_MAIN_CWD || process.cwd();
}

export default function (pi: ExtensionAPI) {
  if (!PORT || !KEY) return; // Not running inside Pipi UI; stay dormant.

  pi.registerTool({
    name: "browser_flow",
    label: "Browser Flow",
    description:
      "Browser flow memory (v1, semantic): save / list / show / delete / run taught web flows, replayed in the built-in browser panel. " +
      "Teaching convention: when the user says \"记住这个流程 / remember this flow\", convert the action sequence you JUST executed successfully into steps with semantic locators ({role,name}|{label}|{text}|{css}) and action:\"save\" it — describe typed values as valueParam names (valueShape e.g. password/otp), never literal values. " +
      "Step actions must match what the browser bridge can replay: click/input/select target a locator, scroll optionally takes one, navigate uses url, fill_form fills fields[] individually; \"type\" cannot be replayed — teach \"input\" with a locator instead. " +
      "When a browser result includes recommendedBrowserFlow, run that candidate directly with action:\"run\" and its id; do not call list/show first unless the user asks to inspect or edit it. " +
      "action:\"run\" replays steps in order, passing real values via params (they are never stored); it stops at the first failure with the failing step index, error and a hint — then observe the page with the browser tool and take over.",
    promptGuidelines: [
      "When browser details provide recommendedBrowserFlow, default to its direct browser_flow action:\"run\" call; only list/show first when the user asks to inspect or edit it.",
      "When a browser flow candidate id is already available, do not call list or show before running it.",
    ],
    parameters: Type.Object({
      action: Type.Union([Type.Literal("save"), Type.Literal("list"), Type.Literal("show"), Type.Literal("delete"), Type.Literal("run")]),
      name: Type.Optional(Type.String({ description: "Flow name (save/show/delete/run)" })),
      description: Type.Optional(Type.String({ description: "save: what this flow accomplishes" })),
      trigger: Type.Optional(
        Type.Object({
          urlContains: Type.Optional(Type.String({ description: "URL substring that suggests this flow applies" })),
          domains: Type.Optional(Type.Array(Type.String(), { description: "Domains this flow applies to" })),
        }),
      ),
      params: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "run only: runtime values keyed by valueParam name (passwords/OTP/emails — never persisted, never echoed). Never pass to save; params are derived from steps.",
        }),
      ),
      steps: Type.Optional(Type.Array(StepSchema, { description: "save: the taught steps, in order" })),
      timeoutMs: Type.Optional(Type.Number({ description: "run: whole-run deadline in ms (default 60000, max 600000)" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const cwd = cwdOf(ctx);
      const action = params.action as string;

      if (action === "list") {
        const entries: Array<Record<string, unknown>> = [];
        const unreadable: string[] = [];
        for (const slug of listFlowSlugs(cwd)) {
          const loaded = loadFlow(cwd, slug);
          if (!loaded.ok) {
            unreadable.push(slug);
            continue;
          }
          entries.push({
            slug,
            name: loaded.flow.name,
            description: loaded.flow.description,
            trigger: loaded.flow.trigger,
            steps: loaded.flow.steps.length,
            params: Object.keys(loaded.flow.params ?? {}),
            updatedAt: loaded.flow.updatedAt,
          });
        }
        const lines = entries.length
          ? entries.map((e) => `[${e.slug}] ${e.name}${e.description ? ` — ${e.description}` : ""} (${e.steps} steps${(e.params as string[]).length ? `, params: ${(e.params as string[]).join(", ")}` : ""})`)
          : ["No saved flows yet."];
        if (unreadable.length) lines.push(`Unreadable (corrupt) flow files skipped: ${unreadable.join(", ")}`);
        lines.push("", 'Teach a new flow with action:"save", inspect one with action:"show".');
        return text(lines.join("\n"), { flows: entries, ...(unreadable.length ? { unreadable } : {}) });
      }

      if (action === "show") {
        const name = String(params.name ?? "").trim();
        if (!name) return failure('browser_flow show requires "name".');
        const slug = resolveSlug(cwd, name);
        if (!slug) return failure(`flow "${name}" not found. Use action:"list" to see saved flows.`);
        const loaded = loadFlow(cwd, slug);
        if (!loaded.ok) return failure(loaded.error);
        // No values exist in a stored flow by construction; show is safe as-is.
        return text(JSON.stringify(loaded.flow, null, 2), { slug, flow: loaded.flow });
      }

      if (action === "delete") {
        const name = String(params.name ?? "").trim();
        if (!name) return failure('browser_flow delete requires "name".');
        const slug = resolveSlug(cwd, name);
        if (!slug) return failure(`flow "${name}" not found. Use action:"list" to see saved flows.`);
        try {
          await withFlowStoreLock(cwd, () => unlinkSync(flowPath(cwd, slug)));
        } catch (error) {
          return failure(`failed to delete flow "${slug}": ${error instanceof Error ? error.message : String(error)}`);
        }
        return text(`Deleted flow "${slug}".`, { slug, deleted: true });
      }

      if (action === "save") {
        const validated = validateFlowInput({
          name: params.name,
          description: params.description,
          trigger: params.trigger,
          params: params.params,
          steps: params.steps,
        });
        if (!validated.ok) {
          return failure(`Flow rejected — fix these and save again:\n${validated.errors.map((e) => `- ${e}`).join("\n")}`, { errors: validated.errors });
        }
        const slug = slugify(validated.flow.name);
        if (!slug) return failure("Flow name must contain letters or digits to produce a file name.");
        let flow!: BrowserFlow;
        let file: string;
        let replaced = false;
        try {
          const saved = await withFlowStoreLock(cwd, () => {
            // Saving is in the same sequence as stats/promotion, so a new definition
            // never drops a completed replay's latest counters (or vice versa).
            const existing = loadFlow(cwd, slug);
            const now = new Date().toISOString();
            const next: BrowserFlow = {
              ...validated.flow,
              createdAt: existing.ok ? existing.flow.createdAt : now,
              updatedAt: now,
              ...(existing.ok && existing.flow.stats !== undefined ? { stats: existing.flow.stats } : {}),
            };
            return { flow: next, file: writeFlowAtomic(cwd, slug, next), replaced: existing.ok };
          });
          flow = saved.flow;
          file = saved.file;
          replaced = saved.replaced;
        } catch (error) {
          return failure(`failed to write flow file: ${error instanceof Error ? error.message : String(error)}`);
        }
        const paramNames = Object.keys(flow.params);
        const body = [
          `Saved flow "${flow.name}" (${slug}${replaced ? ", replaced previous version" : ""}).`,
          `${flow.steps.length} steps, ${paramNames.length} param(s)${paramNames.length ? `: ${paramNames.map((n) => `${n} (${flow.params[n].shape})`).join(", ")}` : ""}.`,
          `Stored at ${file} (values are never stored; pass them via params at run time).`,
        ].join("\n");
        return text(body, { slug, file, steps: flow.steps.length, params: paramNames });
      }

      // action === "run": unqualified legacy names retain episode-first resolution.
      // Candidate collisions surface episode:/saved: references so a recommendation
      // always resolves back to the same source it displayed.
      const name = String(params.name ?? "").trim();
      if (!name) return failure('browser_flow run requires "name".');
      const reference = name.startsWith("episode:")
        ? { source: "episode" as const, id: name.slice("episode:".length) }
        : name.startsWith("saved:")
          ? { source: "flow" as const, id: name.slice("saved:".length) }
          : { source: undefined, id: name };
      const episode = reference.source === "flow"
        ? undefined
        : listSessionEpisodes(cwd).find((entry) => entry.id === reference.id || (reference.source === undefined && entry.title === name));
      const source: CandidateSource = episode ? "episode" : "flow";
      let slug: string;
      let flow: BrowserFlow;
      if (episode) {
        slug = episode.id;
        flow = episodeAsFlow(episode);
      } else {
        if (reference.source === "episode") return failure(`episode "${reference.id}" not found.`);
        const resolved = resolveSlug(cwd, reference.id);
        if (!resolved) return failure(`flow "${name}" not found.`);
        const loaded = loadFlow(cwd, resolved);
        if (!loaded.ok) return failure(loaded.error);
        slug = resolved;
        flow = loaded.flow;
      }
      const provided: Record<string, string> = {};
      if (params.params !== undefined && isPlainObject(params.params)) {
        for (const [key, value] of Object.entries(params.params)) {
          if (typeof value === "string") provided[key] = value;
        }
      }
      // Trigger guard: a flow whose FIRST step is a side effect gets one read-only
      // observe BEFORE that side effect, and is refused on trigger mismatch — a stale
      // flow must never click into the wrong page. Navigate-first flows establish
      // their own URL and skip the observation; empty-trigger episode replays have
      // nothing to check and run as-is.
      const trigger = flow.trigger;
      const hasTrigger =
        (typeof trigger?.urlContains === "string" && trigger.urlContains.trim() !== "") ||
        (Array.isArray(trigger?.domains) && trigger.domains.some((domain) => typeof domain === "string" && domain.trim() !== ""));
      if (hasTrigger && flow.steps[0]?.action !== "navigate") {
        let currentUrl: string | undefined;
        try {
          const observed = await bridge("observe", {}, signal);
          if (observed && observed.ok === true && typeof observed.url === "string") currentUrl = observed.url;
        } catch {
          currentUrl = undefined;
        }
        if (currentUrl === undefined || matchFlowTrigger(trigger, currentUrl) === undefined) {
          return failure(
            `Flow "${flow.name}" was not run: the current page does not match this flow's trigger, so its side effects were not executed. Observe the page or navigate first, then run the flow.`,
            { slug, source, ok: false, guard: { reason: "triggerMismatch" } },
          );
        }
      }
      let statsWriteFailed = false;
      const outcome = await runFlow(flow, provided, { timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined, signal });
      // One run, one stats entry — the saved file (atomic rewrite) or the same-session
      // episode (in-memory, then the promotion check). Bookkeeping failure never turns
      // a finished replay into a failure.
      try {
        if (episode) {
          const stored = episodesFor(cwd).find((entry) => entry.id === episode.id);
          if (stored) {
            stored.stats = nextRunStats(stored.stats, outcome.ok);
            if (outcome.ok) await maybePromoteEpisode(cwd, stored);
          }
        } else {
          await updateSavedFlowStats(cwd, slug, outcome.ok);
        }
      } catch {
        statsWriteFailed = true;
      }
      if (outcome.ok) {
        const lines = outcome.steps.map((s) => `${stepLabel(s.index, flow.steps[s.index], flow.steps.length)} → ok${s.url ? ` ${s.url}` : ""}${s.valueParam ? ` (value: ${s.valueParam})` : ""}`);
        lines.push("", `Flow completed: ${outcome.steps.length}/${flow.steps.length} steps.`);
        if (statsWriteFailed) lines.push("", STATS_WRITE_WARNING);
        return text(lines.join("\n"), { slug, source, steps: outcome.steps });
      }
      const failing = outcome.failedStep.index >= 0 ? flow.steps[outcome.failedStep.index] : undefined;
      const header =
        outcome.failedStep.index >= 0
          ? `Flow "${flow.name}" failed at ${stepLabel(outcome.failedStep.index, failing!, flow.steps.length)}: ${outcome.error}`
          : `Flow "${flow.name}" could not start: ${outcome.error}`;
      const body = [header, `Completed: ${outcome.completed}/${outcome.total} steps.`, "", `Hint: ${outcome.hint}`].join("\n");
      return failure(body, { slug, source, ok: false, failedStep: outcome.failedStep, error: outcome.error, completed: outcome.completed, total: outcome.total });
    },
  });

  // A successful navigate/observe also receives a bounded result patch containing
  // directly-runnable candidates. Capture still sees the original result envelope.
  pi.on("session_start", () => resetEpisodeSessionState());
  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "browser") return;
    recordBrowserResult(event);
    return browserCandidatePatch(event, cwdOf(ctx));
  });
  pi.on("agent_settled", (_event, ctx) => settleEpisodeTrace(cwdOf(ctx)));
}
