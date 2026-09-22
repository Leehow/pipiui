/**
 * pipi-philosophy — a layered working philosophy that lives in pi, not in any one frontend.
 *
 * Installed as a pi package, so a bare TUI session, a GUI frontend, and every dispatched
 * worker load the same four layers from the same config. The only pi surfaces this file
 * touches are `before_agent_start` (+ `getActiveTools` for capability truth), a real-turn
 * id from `turn_start`, and best-effort `tool_call` / `tool_result` observers that never
 * block or mutate. Composition lives in `compose.ts`; attribution lives in
 * `retrieval-attribution.ts`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type CapabilityTable,
  type Layer,
  type PhilosophyConfig,
  composePhilosophy,
  estimateTokens,
  mergeLayers,
  normalizeConfig,
  parseLayer,
  resolveAgent,
  resolveRole,
  resolvePlaceholders,
  renderAgents,
} from "./compose.ts";
import {
  createRetrievalAttribution,
  hashPrompt,
} from "./retrieval-attribution.ts";

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(process.cwd(), ".pi", "agent");
const CONFIG_FILE = path.join(AGENT_DIR, "philosophy.json");
const USER_LAYERS_DIR = path.join(AGENT_DIR, "philosophy-user");

/**
 * Layer directories contributed by other extensions, path-delimited, set by whoever spawned
 * this process (the host for the main session, the dispatcher for a worker). An extension that
 * owns a capability ships the layers that are only true while it is mounted; disable it and its
 * prose leaves with it, instead of surviving as prose about a tool nobody has.
 *
 * Read fresh rather than cached at import: the same reload path that picks up an edited layer
 * file should pick up a newly mounted extension.
 */
const LAYER_DIRS_ENV = "PIPI_PHILOSOPHY_LAYER_DIRS";

function extensionLayerDirs(): string[] {
  const raw = process.env[LAYER_DIRS_ENV];
  if (!raw) return [];
  const seen = new Set<string>();
  for (const entry of raw.split(path.delimiter)) {
    const dir = entry.trim();
    if (dir) seen.add(dir);
  }
  return [...seen];
}

/**
 * Idempotence marker. pi treats duplicate *tools* as a hard failure but says nothing about a
 * duplicate extension, so a copy reached both through `packages` and through an explicit `-e`
 * would silently append the whole philosophy twice. The marker makes the second pass a no-op.
 */
const MARKER = "<!-- pipi-philosophy -->";

/**
 * Runtime state for other extensions in this same pi process.
 *
 * A layer is only advice until something enforces it. `fanout` in particular claims workers
 * run in the background — a dispatch runtime that lets a caller turn that off is running a
 * fake fan-out. So the composed result is published here, keyed by pid, and a dispatcher can
 * read exactly what this process actually resolved: capability guards, role scope and layer
 * dependencies all already applied.
 *
 * A file rather than `globalThis` on purpose: whether extensions share a realm is an
 * implementation detail of pi's module loader, while "same pid" is not.
 */
const STATE_FILE = path.join(os.tmpdir(), `pipi-philosophy-${process.pid}.json`);

function readPublishedLayers(): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as { layers?: unknown };
    return Array.isArray(raw.layers) ? raw.layers.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function publishState(activeLayerIds: string[]): void {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ pid: process.pid, layers: activeLayerIds, at: Date.now() }),
      "utf-8",
    );
  } catch {
    // Advisory only: a dispatcher that cannot read it falls back to caller-decides.
  }
}

const loadErrors: string[] = [];

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function readCapabilities(): CapabilityTable {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_DIR, "capabilities.json"), "utf-8"),
    ) as Partial<CapabilityTable>;
    return { capabilities: raw.capabilities ?? {}, agents: raw.agents ?? [] };
  } catch (err) {
    loadErrors.push(`capabilities.json: ${err instanceof Error ? err.message : String(err)}`);
    return { capabilities: {}, agents: [] };
  }
}

function readLayerDir(dir: string, source: "bundled" | "user"): Layer[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return []; // A missing user dir is the normal case, not an error.
  }
  const layers: Layer[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf-8");
    } catch (err) {
      loadErrors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const parsed = parseLayer(text, file, source);
    if (parsed.ok) layers.push(parsed.layer);
    else loadErrors.push(parsed.error);
  }
  return layers;
}

/** Signature of everything on disk, so an edited layer needs no session restart. */
function diskSignature(): string {
  const parts: string[] = [];
  for (const dir of [path.join(PACKAGE_DIR, "layers"), ...extensionLayerDirs(), USER_LAYERS_DIR]) {
    let names: string[];
    try {
      names = fs.readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const st = fs.statSync(path.join(dir, name));
        parts.push(`${dir}/${name}#${st.size}#${st.mtimeMs}`);
      } catch {
        // Raced with an edit; the next turn picks it up.
      }
    }
  }
  return parts.join(";");
}

let cachedLayers: Layer[] = [];
let cachedCapabilities: CapabilityTable | undefined;
let cachedSignature: string | undefined;

function loadLayers(): { layers: Layer[]; capabilities: CapabilityTable } {
  const signature = diskSignature();
  if (signature !== cachedSignature || !cachedCapabilities) {
    loadErrors.length = 0;
    cachedCapabilities = readCapabilities();
    cachedLayers = mergeLayers(
      readLayerDir(path.join(PACKAGE_DIR, "layers"), "bundled"),
      ...extensionLayerDirs().map((dir) => readLayerDir(dir, "extension")),
      readLayerDir(USER_LAYERS_DIR, "user"),
    );
    cachedSignature = signature;
  }
  return { layers: cachedLayers, capabilities: cachedCapabilities };
}

/**
 * `ctx.model` → the `provider/id` ref a layer's `requires-models` is written against.
 *
 * Typed structurally rather than against pi's `Model`: this is the only shape the
 * philosophy needs, and a pi version that widens that type should not break the build.
 */
function formatModel(model: { provider?: string; id?: string } | undefined | null): string | undefined {
  if (!model?.provider || !model?.id) return undefined;
  return `${model.provider}/${model.id}`;
}

function modelCapabilitiesOf(model: unknown): unknown | null {
  if (!model || typeof model !== "object") return null;
  return "capabilities" in model
    ? (model as { capabilities?: unknown }).capabilities ?? {}
    : {};
}

/** Hot-read on every turn: a toggle applies without restarting the session. */
function readConfig(): PhilosophyConfig {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")));
  } catch {
    return normalizeConfig(undefined);
  }
}

function writeConfig(config: PhilosophyConfig): void {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify({ version: 1, ...config }, null, 2)}\n`, "utf-8");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function buildReport(
  activeTools: string[] | null,
  model: string | undefined,
  modelCapabilities: unknown | null = null,
): string {
  const { layers, capabilities } = loadLayers();
  const config = readConfig();
  const role = resolveRole(process.env);
  const result = composePhilosophy({
    layers,
    config,
    capabilities,
    role,
    activeTools,
    model,
    modelCapabilities,
  });

  const lines: string[] = [
    `# Philosophy — ${config.enabled ? "on" : "off"} (role: ${role}, model: ${model ?? "unknown"})`,
    `Package: ${PACKAGE_DIR}`,
    `Config:  ${fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : `${CONFIG_FILE} (not written yet, using defaults)`}`,
    "",
    `Active (${estimateTokens(result.text)} est. tokens):`,
  ];
  if (result.included.length === 0) lines.push("  (none)");
  for (const layer of result.included) {
    const mark = layer.source === "user" ? " [user override]" : "";
    lines.push(`  - ${layer.id} · ${layer.name}${mark} — ~${estimateTokens(layer.body)} tokens`);
  }
  if (result.skipped.length > 0) {
    lines.push("", "Inactive:");
    for (const s of result.skipped) lines.push(`  - ${s.id} · ${s.name} — ${s.reason}`);
  }

  // The capability differential is the answer to "did a pi upgrade break this?".
  const missing = Object.entries(capabilities.capabilities)
    .filter(([, cap]) => activeTools !== null && !activeTools.includes(cap.tool))
    .map(([key, cap]) => `${key} → ${cap.tool}`);
  lines.push("", missing.length === 0 ? "Capabilities: all mapped tools present." : `Capabilities MISSING: ${missing.join(", ")}`);
  if (loadErrors.length > 0) lines.push("", "Load errors:", ...loadErrors.map((e) => `  - ${e}`));
  lines.push("", "Commands: /philosophy [on|off] · /philosophy toggle <layer> · /philosophy show");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // Publish structured, eligible contributions to an optional context selector. The
  // philosophy owns role/model/config gates and exact text; the selector owns relevance.
  pi.events.on("pipiui.context-layers.request.v1", (request: any) => {
    if (!request || typeof request.reply !== "function") return;
    const { layers, capabilities } = loadLayers();
    const result = composePhilosophy({ layers, capabilities, config: readConfig(),
      role: resolveRole(process.env), agent: resolveAgent(process.env), activeTools: request.tools,
      model: formatModel(request.ctx?.model), modelCapabilities: modelCapabilitiesOf(request.ctx?.model) });
    request.reply(result.included.map(layer => ({ id: layer.id, summary: `${layer.name}: ${layer.summary}`,
      body: (() => { const resolved = resolvePlaceholders(layer, capabilities, request.tools); return resolved.ok ? resolved.body : ""; })(),
      template: layer.body.replace(/\{\{agents\}\}/g, renderAgents(capabilities.agents)),
      bindings: Object.fromEntries(Object.entries(capabilities.capabilities).map(([key, cap]) => [key, { tool: cap.tool, absent: cap.absent }])),
      requires: layer.requires,
      tools: layer.requiresCapabilities.map(key => capabilities.capabilities[key]?.tool).filter(Boolean),
      pinned: layer.source === "user" || ["foundation", "method", "thinking", "toolcall"].includes(layer.id)
        || layer.requiresModels.length > 0 || layer.excludesModels.length > 0 || layer.requiresModelCapabilities.length > 0,
    })));
  });
  let attribution: ReturnType<typeof createRetrievalAttribution> | undefined;
  try {
    attribution = createRetrievalAttribution({ agentDir: AGENT_DIR });
  } catch {
    attribution = undefined;
  }

  pi.on("before_agent_start", (event, ctx) => {
    const role = resolveRole(process.env);
    const agent = resolveAgent(process.env);
    const model = formatModel(ctx.model);
    let nextPrompt = event.systemPrompt;
    let layerIds = readPublishedLayers();
    let injected = false;
    let activeTools: string[] | null = null;
    if (!event.systemPrompt.includes(MARKER)) {
      activeTools = pi.getActiveTools();
      const { layers, capabilities } = loadLayers();
      const result = composePhilosophy({
        layers,
        config: readConfig(),
        capabilities,
        role,
        agent,
        activeTools,
        // Read per turn, not per session: `/model` mid-session must re-decide which
        // model-scoped layers apply, exactly as an edited layer file does.
        model,
        modelCapabilities: modelCapabilitiesOf(ctx.model),
      });
      // Published before the turn runs, so any tool called during it sees this turn's truth.
      let selection: { text: string; layerIds: string[] } | undefined;
      pi.events.emit("pipiui.context-selection.request.v1", { reply: (value: typeof selection) => { selection = value; } });
      layerIds = selection?.layerIds ?? result.included.map((l) => l.id);
      publishState(layerIds);
      const selectedText = selection?.text ?? result.text;
      if (selectedText) {
        nextPrompt = `${event.systemPrompt.trimEnd()}\n\n${MARKER}\n${selectedText}`;
        injected = true;
      }
    } else {
      try {
        activeTools = pi.getActiveTools();
      } catch {
        activeTools = null;
      }
    }
    try {
      attribution?.noteTurn({
        promptHash: hashPrompt(nextPrompt),
        layerIds,
        role,
        agent,
        model,
        sessionId: ctx.sessionManager?.getSessionId?.(),
        availableTools: activeTools ?? undefined,
      });
    } catch {
      // Attribution must never change prompt assembly.
    }
    if (injected) return { systemPrompt: nextPrompt };
  });

  // Real turn correlation id: pi already numbers turns per agent run via `turn_start`.
  pi.on("turn_start", (event) => {
    try {
      attribution?.noteTurnIndex((event as { turnIndex?: unknown }).turnIndex);
    } catch {
      // Best-effort.
    }
  });

  pi.on("tool_call", (event, ctx) => {
    try {
      const prompt = typeof ctx.getSystemPrompt === "function" ? ctx.getSystemPrompt() : undefined;
      attribution?.observeToolCall({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        input: event.input,
        sessionId: ctx.sessionManager?.getSessionId?.(),
        role: resolveRole(process.env),
        agent: resolveAgent(process.env),
        model: formatModel(ctx.model),
        prompt,
      });
    } catch {
      // Best-effort: never block or mutate a tool call.
    }
  });

  // Post-result observer: returns nothing, mutates nothing. Reads only structured
  // details fields (kind / degraded / hits / resultsPath), never result bodies or
  // messages; fields the runtime does not expose stay absent from the record.
  pi.on("tool_result", (event, ctx) => {
    try {
      attribution?.observeToolResult({
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        isError: event.isError,
        details: event.details,
        sessionId: ctx.sessionManager?.getSessionId?.(),
        role: resolveRole(process.env),
        agent: resolveAgent(process.env),
        model: formatModel(ctx.model),
      });
    } catch {
      // Best-effort: observing a result must never change one.
    }
  });

  // Leave no state behind for a future process that happens to reuse this pid.
  pi.on("session_shutdown", () => {
    try {
      fs.unlinkSync(STATE_FILE);
    } catch {
      // Already gone, or never written.
    }
    void attribution?.close();
  });

  pi.registerCommand("philosophy", {
    description: "Show or toggle the working philosophy layers loaded into this session",
    handler: async (args, ctx) => {
      const [verb, target] = args.trim().split(/\s+/).filter(Boolean);
      const activeTools = pi.getActiveTools();
      const model = formatModel(ctx.model);

      if (verb === "on" || verb === "off") {
        const config = readConfig();
        config.enabled = verb === "on";
        writeConfig(config);
        ctx.ui.notify(`Philosophy ${verb}. Applies from the next turn.`, "info");
        return;
      }

      if (verb === "toggle") {
        const { layers } = loadLayers();
        const layer = layers.find((l) => l.id === target);
        if (!layer) {
          ctx.ui.notify(`Unknown layer ${JSON.stringify(target ?? "")}. Known: ${layers.map((l) => l.id).join(", ")}`, "error");
          return;
        }
        const config = readConfig();
        const next = config.layers[layer.id] === false;
        config.layers[layer.id] = next;
        writeConfig(config);
        ctx.ui.notify(`${layer.id} ${next ? "enabled" : "disabled"}. Applies from the next turn.`, "info");
        return;
      }

      if (verb === "show") {
        const { layers, capabilities } = loadLayers();
        const result = composePhilosophy({
          layers,
          config: readConfig(),
          capabilities,
          role: resolveRole(process.env),
      agent: resolveAgent(process.env),
          activeTools,
          model,
          modelCapabilities: modelCapabilitiesOf(ctx.model),
        });
        pi.sendMessage({
          customType: "philosophy_text",
          content: result.text || "(nothing active)",
          display: true,
        });
        return;
      }

      pi.sendMessage({
        customType: "philosophy_status",
        content: buildReport(activeTools, model, modelCapabilitiesOf(ctx.model)),
        display: true,
      });
    },
  });
}
