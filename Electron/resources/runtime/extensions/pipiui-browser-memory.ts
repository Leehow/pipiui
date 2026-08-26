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
export type BrowserFlow = {
  schemaVersion: 1;
  name: string;
  description: string;
  trigger: FlowTrigger;
  params: Record<string, { shape: string; description?: string }>;
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
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
      response = await bridge(step.action, stepEvent(step, provided), options.signal, remaining);
    } catch (error) {
      return {
        ok: false as const,
        failedStep: { index: i, action: step.action, locator: step.locator },
        error: redact(error instanceof Error ? error.message : String(error)),
        hint: TAKEOVER_HINT,
        completed: results.length,
        total: flow.steps.length,
      };
    }
    if (!response || response.ok !== true) {
      return {
        ok: false as const,
        failedStep: { index: i, action: step.action, locator: step.locator },
        error: redact(String((response && response.error) || "bridge error")),
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
      ...(step.action === "navigate" && typeof response.url === "string" ? { url: redact(response.url) } : {}),
      ...(step.valueParam !== undefined ? { valueParam: step.valueParam } : {}),
      ...(step.note !== undefined ? { note: step.note } : {}),
    });
  }
  return { ok: true as const, steps: results, elapsedMs: Date.now() - startedAt };
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
      "Before replaying, action:\"list\" then action:\"show\" to confirm the flow still matches the page. " +
      "action:\"run\" replays steps in order, passing real values via params (they are never stored); it stops at the first failure with the failing step index, error and a hint — then observe the page with the browser tool and take over.",
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
          unlinkSync(flowPath(cwd, slug));
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
        const now = new Date().toISOString();
        const existing = loadFlow(cwd, slug);
        const flow: BrowserFlow = { ...validated.flow, createdAt: existing.ok ? existing.flow.createdAt : now, updatedAt: now };
        let file: string;
        try {
          file = writeFlowAtomic(cwd, slug, flow);
        } catch (error) {
          return failure(`failed to write flow file: ${error instanceof Error ? error.message : String(error)}`);
        }
        const paramNames = Object.keys(flow.params);
        const body = [
          `Saved flow "${flow.name}" (${slug}${existing.ok ? ", replaced previous version" : ""}).`,
          `${flow.steps.length} steps, ${paramNames.length} param(s)${paramNames.length ? `: ${paramNames.map((n) => `${n} (${flow.params[n].shape})`).join(", ")}` : ""}.`,
          `Stored at ${file} (values are never stored; pass them via params at run time).`,
        ].join("\n");
        return text(body, { slug, file, steps: flow.steps.length, params: paramNames });
      }

      // action === "run"
      const name = String(params.name ?? "").trim();
      if (!name) return failure('browser_flow run requires "name".');
      const slug = resolveSlug(cwd, name);
      if (!slug) return failure(`flow "${name}" not found. Use action:"list" to see saved flows.`);
      const loaded = loadFlow(cwd, slug);
      if (!loaded.ok) return failure(loaded.error);
      const provided: Record<string, string> = {};
      if (params.params !== undefined && isPlainObject(params.params)) {
        for (const [key, value] of Object.entries(params.params)) {
          if (typeof value === "string") provided[key] = value;
        }
      }
      const outcome = await runFlow(loaded.flow, provided, { timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined, signal });
      if (outcome.ok) {
        const lines = outcome.steps.map((s) => `${stepLabel(s.index, loaded.flow.steps[s.index], loaded.flow.steps.length)} → ok${s.url ? ` ${s.url}` : ""}${s.valueParam ? ` (value: ${s.valueParam})` : ""}`);
        lines.push("", `Flow completed: ${outcome.steps.length}/${loaded.flow.steps.length} steps.`);
        return text(lines.join("\n"), { slug, steps: outcome.steps });
      }
      const failing = outcome.failedStep.index >= 0 ? loaded.flow.steps[outcome.failedStep.index] : undefined;
      const header =
        outcome.failedStep.index >= 0
          ? `Flow "${loaded.flow.name}" failed at ${stepLabel(outcome.failedStep.index, failing!, loaded.flow.steps.length)}: ${outcome.error}`
          : `Flow "${loaded.flow.name}" could not start: ${outcome.error}`;
      const body = [header, `Completed: ${outcome.completed}/${outcome.total} steps.`, "", `Hint: ${outcome.hint}`].join("\n");
      return failure(body, { slug, ok: false, failedStep: outcome.failedStep, error: outcome.error, completed: outcome.completed, total: outcome.total });
    },
  });
}
