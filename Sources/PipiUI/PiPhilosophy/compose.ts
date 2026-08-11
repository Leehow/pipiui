/**
 * Pure composition core: frontmatter parsing, layer selection, placeholder resolution.
 *
 * Deliberately imports nothing from pi. The extension (`philosophy.ts`) is the only file
 * that touches the runtime, so every rule that matters can be tested with plain `node`.
 */

export type Role = "main" | "lead" | "worker";

export const ROLES: readonly Role[] = ["main", "lead", "worker"];

export interface Capability {
  /** The pi tool name this capability currently maps to. */
  tool: string;
  /** A layer that lists this in `requires-capabilities` is dropped when the tool is absent. */
  required: boolean;
  /** Substituted when an optional capability's tool is absent, so no dead name survives. */
  absent?: string;
}

/**
 * One entry of the roster rendered as `{{agents}}`. `use` is written for the boss deciding
 * where to send a task — when to reach for this agent — not for the agent describing itself.
 * A bare string still works and renders without a description.
 */
export type AgentEntry = string | { name: string; use: string };

export interface CapabilityTable {
  capabilities: Record<string, Capability>;
  /** Rendered as `{{agents}}`. The roster is a property of the dispatch runtime, not of pi. */
  agents: AgentEntry[];
}

export interface Layer {
  id: string;
  name: string;
  summary: string;
  order: number;
  requires: string[];
  requiresCapabilities: string[];
  /**
   * `provider/id` patterns this layer is written for. Empty means every model — the
   * normal case. A non-empty list marks a layer that exists to correct one model
   * family's behavior, which is advice that would be wrong to give any other model.
   */
  requiresModels: string[];
  scope: Role[];
  body: string;
  /** Where it came from; user layers shadow bundled ones with the same id. */
  file: string;
  source: "bundled" | "user";
}

export interface PhilosophyConfig {
  enabled: boolean;
  layers: Record<string, boolean>;
  scopes: { worker: boolean };
}

export const DEFAULT_CONFIG: PhilosophyConfig = {
  enabled: true,
  layers: { foundation: true, method: true, orchestration: true, fanout: true },
  scopes: { worker: false },
};

export interface SkippedLayer {
  id: string;
  name: string;
  reason: string;
}

export interface ComposeResult {
  text: string;
  included: Layer[];
  skipped: SkippedLayer[];
}

export interface ComposeInput {
  layers: Layer[];
  config: PhilosophyConfig;
  capabilities: CapabilityTable;
  role: Role;
  /**
   * Live tool names from `pi.getActiveTools()`. `null` means "unknown" (composing outside a
   * session, e.g. in a test or a preview) and every capability is treated as present.
   */
  activeTools: string[] | null;
  /**
   * This session's model as `provider/id` (`ctx.model`). Absent means "unknown", and a
   * model-scoped layer is then dropped rather than guessed in.
   *
   * The opposite default from `activeTools` on purpose: an optional capability that turns
   * out to be missing costs a slightly over-optimistic sentence, while telling the wrong
   * model it has a known failure mode is simply false.
   */
  model?: string | null;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseInlineList(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "[]") return [];
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  return inner
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

export type ParseResult = { ok: true; layer: Layer } | { ok: false; error: string };

export function parseLayer(
  text: string,
  file: string,
  source: "bundled" | "user" = "bundled",
): ParseResult {
  const match = text.match(FRONTMATTER);
  if (!match) return { ok: false, error: `${file}: missing frontmatter` };

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }

  const id = fields.id ?? "";
  if (!id) return { ok: false, error: `${file}: frontmatter has no id` };
  if (!fields.name) return { ok: false, error: `${file}: layer ${id} has no name` };

  const order = Number.parseInt(fields.order ?? "", 10);
  if (!Number.isFinite(order)) return { ok: false, error: `${file}: layer ${id} has no numeric order` };

  const scope = parseInlineList(fields.scope ?? "").filter((s): s is Role =>
    (ROLES as readonly string[]).includes(s),
  );
  if (scope.length === 0) return { ok: false, error: `${file}: layer ${id} has an empty or invalid scope` };

  const body = match[2].trim();
  if (!body) return { ok: false, error: `${file}: layer ${id} has an empty body` };

  return {
    ok: true,
    layer: {
      id,
      name: fields.name,
      summary: fields.summary ?? "",
      order,
      requires: parseInlineList(fields.requires ?? ""),
      requiresCapabilities: parseInlineList(fields["requires-capabilities"] ?? ""),
      requiresModels: parseInlineList(fields["requires-models"] ?? ""),
      scope,
      body,
      file,
      source,
    },
  };
}

// ---------------------------------------------------------------------------
// Model scope
// ---------------------------------------------------------------------------

/**
 * Does a `provider/id` model ref match one `requires-models` entry?
 *
 * Exact match, or one trailing `*` as a prefix (`deepseek/*`). Case-insensitive.
 *
 * Deliberately literal: model ids are a closed, enumerable set that the author is
 * naming on purpose, so nothing here tries to infer a family from a name it was not
 * told about. A pattern that stops matching after a provider renames a model shows up
 * as the layer going inactive in `/philosophy`, which is the honest failure.
 */
export function modelMatches(model: string, pattern: string): boolean {
  const m = model.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (!m || !p) return false;
  return p.endsWith("*") ? m.startsWith(p.slice(0, -1)) : m === p;
}

/** User layers shadow bundled layers with the same id; that is how a user edits a philosophy. */
export function mergeLayers(bundled: Layer[], user: Layer[]): Layer[] {
  const byId = new Map<string, Layer>();
  for (const layer of bundled) byId.set(layer.id, layer);
  for (const layer of user) byId.set(layer.id, layer);
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;

/** Protocol message names such as `[subagent-done]` are this runtime's own assets, not pi's. */
export function stripProtocolTokens(body: string): string {
  return body.replace(/\[[^\]\n]*\]/g, "[]");
}

/**
 * A body with everything that is *by definition* not a bare tool name masked out:
 * protocol tokens (ours) and placeholders (whose key may coincide with a tool name).
 * This is what the "no bare tool names" rule is checked against.
 */
export function scannableBody(body: string): string {
  return stripProtocolTokens(body).replace(PLACEHOLDER, "{}");
}

export function placeholdersIn(body: string): string[] {
  return [...body.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/**
 * A bare name list left the boss guessing what `plan` and `lead` were for, and a guess about
 * an unfamiliar name resolves as "do it myself". One line each, so the roster answers "who
 * takes this?" without a lookup the boss has no way to perform.
 */
export function renderAgents(agents: AgentEntry[]): string {
  return agents
    .map((a) => (typeof a === "string" ? `- \`${a}\`` : `- \`${a.name}\` — ${a.use}`))
    .join("\n");
}

export type ResolveResult = { ok: true; body: string } | { ok: false; error: string };

export function resolvePlaceholders(
  layer: Layer,
  capabilities: CapabilityTable,
  activeTools: string[] | null,
): ResolveResult {
  let failure: string | undefined;
  const body = layer.body.replace(PLACEHOLDER, (_whole, key: string) => {
    if (key === "agents") return renderAgents(capabilities.agents);
    const capability = capabilities.capabilities[key];
    if (!capability) {
      failure ??= `${layer.file}: unknown placeholder {{${key}}}`;
      return _whole;
    }
    const present = activeTools === null || activeTools.includes(capability.tool);
    if (present) return capability.tool;
    if (capability.absent) return capability.absent;
    failure ??= `${layer.file}: {{${key}}} is unavailable and the table gives it no \`absent\` text`;
    return _whole;
  });
  return failure ? { ok: false, error: failure } : { ok: true, body };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export function composePhilosophy(input: ComposeInput): ComposeResult {
  const { layers, config, capabilities, role, activeTools } = input;
  const model = input.model?.trim() ?? "";
  const skipped: SkippedLayer[] = [];
  const skip = (layer: Layer, reason: string) => {
    skipped.push({ id: layer.id, name: layer.name, reason });
  };

  if (!config.enabled) {
    return { text: "", included: [], skipped: layers.map((l) => ({ id: l.id, name: l.name, reason: "philosophy is off" })) };
  }
  /**
   * `scopes.worker` decides whether *judgement* philosophy propagates to dispatched
   * workers — a taste-and-tokens call the user owns. A model-scoped layer is not
   * judgement: it is a compatibility correction for a model that misbehaves, and the
   * worker is where that misbehavior costs most, because a boss reads a worker's
   * "I can't" as a finding rather than as a dropped turn. So the switch does not gate it.
   */
  const workerDistributionOff = role === "worker" && !config.scopes.worker;

  let candidates: Layer[] = [];
  for (const layer of layers) {
    if (workerDistributionOff && layer.requiresModels.length === 0) {
      skip(layer, "worker distribution is off");
      continue;
    }
    if (config.layers[layer.id] === false) {
      skip(layer, "turned off");
      continue;
    }
    if (!layer.scope.includes(role)) {
      skip(layer, `not in scope for role "${role}"`);
      continue;
    }
    if (layer.requiresModels.length > 0) {
      if (!model) {
        skip(layer, `written for ${layer.requiresModels.join(", ")}, and this session's model is unknown`);
        continue;
      }
      if (!layer.requiresModels.some((pattern) => modelMatches(model, pattern))) {
        skip(layer, `not in scope for model "${model}"`);
        continue;
      }
    }
    const missing = layer.requiresCapabilities.filter((key) => {
      const capability = capabilities.capabilities[key];
      if (!capability) return true;
      return activeTools !== null && !activeTools.includes(capability.tool);
    });
    if (missing.length > 0) {
      const names = missing.map((k) => capabilities.capabilities[k]?.tool ?? k);
      skip(layer, `needs a tool this session does not have: ${names.join(", ")}`);
      continue;
    }
    candidates.push(layer);
  }

  // `requires` to a fixpoint: dropping a layer can strand whatever depended on it.
  for (;;) {
    const present = new Set(candidates.map((l) => l.id));
    const survivors = candidates.filter((layer) => {
      const unmet = layer.requires.filter((id) => !present.has(id));
      if (unmet.length === 0) return true;
      skip(layer, `depends on a layer that is not active: ${unmet.join(", ")}`);
      return false;
    });
    if (survivors.length === candidates.length) break;
    candidates = survivors;
  }

  candidates.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const included: Layer[] = [];
  const bodies: string[] = [];
  for (const layer of candidates) {
    const resolved = resolvePlaceholders(layer, capabilities, activeTools);
    if (!resolved.ok) {
      skip(layer, resolved.error);
      continue;
    }
    included.push(layer);
    bodies.push(resolved.body);
  }

  return { text: bodies.join("\n\n"), included, skipped };
}

/** Same rough estimate the surrounding tooling uses; only ever shown to a human. */
export function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

export function normalizeConfig(raw: unknown): PhilosophyConfig {
  const parsed = (raw ?? {}) as Partial<PhilosophyConfig>;
  const layers: Record<string, boolean> = { ...DEFAULT_CONFIG.layers };
  if (parsed.layers && typeof parsed.layers === "object") {
    for (const [id, value] of Object.entries(parsed.layers)) {
      if (typeof value === "boolean") layers[id] = value;
    }
  }
  return {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
    layers,
    scopes: {
      worker:
        typeof parsed.scopes?.worker === "boolean"
          ? parsed.scopes.worker
          : DEFAULT_CONFIG.scopes.worker,
    },
  };
}

/**
 * Role resolution. An explicit marker wins; otherwise a nested dispatch depth means this
 * process is a worker. Frontends that set neither are treated as the main session.
 */
export function resolveRole(env: Record<string, string | undefined>): Role {
  const explicit = (env.PIPI_PHILOSOPHY_ROLE ?? "").trim().toLowerCase();
  if ((ROLES as readonly string[]).includes(explicit)) return explicit as Role;
  const depth = Number.parseInt(env.PIPIUI_AGENT_DEPTH ?? "", 10);
  if (Number.isFinite(depth) && depth > 0) return "worker";
  return "main";
}
