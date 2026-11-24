import { Type } from "typebox";
import { createHash, randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { probeContextAvailability, executeContextDecision } from "./context-decision.js";
import { contextCatalog, expandSelection, materializeLayer, LAYERS_REQUEST, SELECTION_REQUEST, SNAPSHOT_ENTRY, SUPPLEMENT_MESSAGE,
  type ContextBundle, type ContextLayer, type ContextTool } from "./context-catalog.js";
import type { JevDeps } from "./types.js";
import type { RerankGate } from "./rerank.js";

type Snapshot = {
  version: 1; epoch: string; model: string; task: string; authority: string[]; catalog: ContextBundle[];
  layers: ContextLayer[]; toolInfo: ContextTool[]; selected: string[]; active: string[];
  frozenPrompt?: string; supplements: string[]; bypassed?: boolean;
  diagnostic?: Record<string, unknown>;
  toolSignature: string;
};
const modelKey = (ctx: ExtensionContext) => `${ctx.model?.provider ?? ""}/${ctx.model?.id ?? ""}`;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
const toolSignature = (pi: ExtensionAPI, names: string[]) => createHash("sha256").update(JSON.stringify(
  names.map(name => { const tool = pi.getAllTools().find(t => t.name === name); return tool
    ? [name, tool.description, tool.parameters, tool.promptGuidelines] : [name]; }),
)).digest("hex");

function configured(env: NodeJS.Dict<string | undefined>) {
  if (env.PIPI_PHILOSOPHY_ROLE === "worker" || Number(env.PIPIUI_AGENT_DEPTH ?? 0) > 0) return false;
  try { return JSON.parse(env.PIPIUI_EXT_SETTINGS_JEV_OPTIMIZER ?? "{}")["ext.jev-optimizer.contextEnabled"] === true; }
  catch { return false; }
}

function recentContext(ctx: ExtensionContext, task: string): string {
  const texts: string[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "compaction") texts.push(`Retained task context: ${entry.summary}`);
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = typeof message.content === "string" ? message.content : message.content
      .filter(c => c.type === "text").map(c => (c as { text: string }).text).join("\n");
    if (content) texts.push(`${message.role}: ${content}`);
  }
  return `Original task: ${task.slice(0, 2500)}\n${texts.slice(-6).join("\n").slice(-6000)}`;
}

/** Runs only in main sessions, and only when explicitly enabled in the Jev settings. */
export function registerContextSelector(pi: ExtensionAPI, deps: JevDeps, gate: RerankGate): void {
  if (!configured(deps.env ?? process.env) || !pi.getActiveTools || !pi.getAllTools) return;
  let snapshot: Snapshot | undefined;
  let sessionId: string | undefined;
  let pending = new AbortController();
  let diagnostic: Record<string, unknown> = { status: "not-selected" };

  const save = () => { if (snapshot) { snapshot.diagnostic = diagnostic; pi.appendEntry(SNAPSHOT_ENTRY, structuredClone(snapshot)); } };
  const reset = () => { pending.abort(); pending = new AbortController(); snapshot = undefined; sessionId = undefined; };
  const restore = (ctx: ExtensionContext) => {
    const id = ctx.sessionManager.getSessionId();
    if (sessionId === id) return;
    reset(); sessionId = id;
    const entry = [...ctx.sessionManager.getBranch()].reverse().find(e => e.type === "custom" && e.customType === SNAPSHOT_ENTRY);
    const data = entry?.type === "custom" ? entry.data as Snapshot : undefined;
    if (data?.version === 1 && Array.isArray(data.authority) && Array.isArray(data.selected)
      && Array.isArray(data.active) && Array.isArray(data.catalog) && Array.isArray(data.layers)
      && Array.isArray(data.toolInfo) && Array.isArray(data.supplements)) {
      snapshot = structuredClone(data);
      // Restored sessions may have different enabled tools. Never resurrect disabled tools.
      // Check registration, not activation: Pi ≥1.4 restores the branch's recorded active
      // set on resume (the narrowed loadout), while excluded/disabled tools are never registered.
      const available = new Set(pi.getAllTools().map(tool => tool.name));
      if (snapshot.authority.some(name => !available.has(name)) || snapshot.model !== modelKey(ctx)
        || snapshot.toolSignature !== toolSignature(pi, snapshot.authority)) {
        snapshot = undefined;
      } else if (!snapshot.bypassed) pi.setActiveTools(snapshot.active);
    }
  };

  function initialize(ctx: ExtensionContext, task: string): Snapshot {
    const authority = pi.getActiveTools();
    const toolInfo = pi.getAllTools().filter(t => authority.includes(t.name))
      .map(({ name, description, promptGuidelines }) => ({ name, description, promptGuidelines }));
    let layers: ContextLayer[] = [];
    pi.events.emit(LAYERS_REQUEST, { ctx, tools: authority, reply: (value: ContextLayer[]) => { layers = value; } });
    return { version: 1, epoch: randomUUID(), model: modelKey(ctx), task, authority, toolInfo, layers,
      catalog: contextCatalog(toolInfo, layers), selected: [], active: [], supplements: [], toolSignature: toolSignature(pi, authority) };
  }

  function apply(ids: string[]): string {
    if (!snapshot) return "";
    const selected = expandSelection([...snapshot.selected, ...ids], snapshot.catalog, snapshot.layers);
    const previous = new Set(snapshot.selected);
    const additions = selected.filter(b => !previous.has(b.id));
    // Preserve insertion order; previously selected content is never regenerated.
    snapshot.selected.push(...additions.map(b => b.id));
    const allowed = new Set(snapshot.authority);
    for (const bundle of additions) for (const tool of bundle.tools) {
      if (allowed.has(tool) && !snapshot.active.includes(tool)) snapshot.active.push(tool);
    }
    const before = pi.getActiveTools();
    if (!same(before, snapshot.active)) pi.setActiveTools([...snapshot.active]);
    const newLayerIds = new Set(additions.flatMap(b => b.layers));
    for (const layer of snapshot.layers) if (newLayerIds.has(layer.id)) layer.body = materializeLayer(layer, snapshot.active);
    const newTools = new Set(additions.filter(b => b.id.startsWith("tools:")).flatMap(b => b.tools));
    const text = [
      ...snapshot.toolInfo.filter(t => newTools.has(t.name)).map(t => `${t.name}: ${t.description}\n${(t.promptGuidelines ?? []).join("\n")}`),
      ...snapshot.layers.filter(l => newLayerIds.has(l.id)).map(l => l.body),
    ].join("\n\n");
    if (snapshot.frozenPrompt !== undefined && text) snapshot.supplements.push(text);
    diagnostic = { ...diagnostic, selected: [...snapshot.selected], activeTools: snapshot.active.length,
      availableTools: snapshot.authority.length, nativeToolsChanged: !same(before, snapshot.active),
      cache: same(before, snapshot.active) ? "stable-system-and-tools" : "native-tool-change-may-rebuild-cache" };
    if (additions.length || !same(before, snapshot.active)) save();
    return text;
  }

  pi.events.on(SELECTION_REQUEST, (request: unknown) => {
    const reply = (request as { reply?: (value: unknown) => void })?.reply;
    if (!reply || !snapshot || snapshot.bypassed) return;
    const ids = new Set(snapshot.selected.filter(id => id.startsWith("layer:")).map(id => id.slice(6)));
    const layers = snapshot.layers.filter(l => ids.has(l.id));
    reply({ text: layers.map(l => l.body).join("\n\n"), layerIds: layers.map(l => l.id), diagnostic });
  });

  pi.on("input", async (event, ctx) => {
    // A steering input must not mutate tools under an in-flight tool loop. It is evaluated
    // at the next ordinary user boundary; explicit context_tools remains available.
    if (!ctx.isIdle() || event.streamingBehavior) return;
    restore(ctx);
    if (snapshot?.bypassed) return;
    if (snapshot && snapshot.active.length) {
      const live = pi.getActiveTools();
      const removed = snapshot.active.filter(name => !live.includes(name));
      if (removed.length || live.some(name => !snapshot!.active.includes(name)) || snapshot.model !== modelKey(ctx)) {
        // Explicit configuration/model changes define a new authority/cache epoch.
        // Restore only the still-authorized universe, never a removed active tool.
        pi.setActiveTools([...new Set([...snapshot.authority.filter(name => !removed.includes(name)), ...live])]);
        snapshot = undefined;
      }
    }
    const started = Date.now();
    const readiness = await probeContextAvailability(deps, ctx.signal ? AbortSignal.any([ctx.signal, pending.signal]) : pending.signal, gate);
    if (pending.signal.aborted || ctx.signal?.aborted) return;
    if (!readiness.ready) {
      if (snapshot) {
        // Revocation stops uploads immediately; restore access rather than strand a session.
        apply(snapshot.catalog.map(c => c.id));
      }
      diagnostic = { status: "bypassed", reason: readiness.reason };
      if (!snapshot) { snapshot = initialize(ctx, event.text); snapshot.bypassed = true; save(); }
      return;
    }
    snapshot ??= initialize(ctx, event.text);
    if (!snapshot.authority.includes("context_tools")) { snapshot.bypassed = true; save(); return; }
    const explicit = snapshot.catalog.filter(b => [b.id, ...b.tools].some(name =>
      event.text.split(/[^\w:-]+/).includes(name))).map(b => b.id);
    const candidates = snapshot.catalog.filter(b => !b.pinned && !snapshot!.selected.includes(b.id)
      && !explicit.includes(b.id)).map(({ id, summary }) => ({ id, summary }));
    const result = candidates.length ? await executeContextDecision({ task: event.text,
      recent: recentContext(ctx, snapshot.task), loaded: snapshot.selected, candidates,
      signal: ctx.signal ? AbortSignal.any([ctx.signal, pending.signal]) : pending.signal }, deps, gate)
      : { status: "applied" as const, selected: [] };
    if (pending.signal.aborted || ctx.signal?.aborted) return;
    diagnostic = { status: result.status, reason: result.reason, elapsedMs: Date.now() - started };
    if (result.status !== "applied" && snapshot.frozenPrompt === undefined) {
      snapshot.bypassed = true; save(); return;
    }
    apply([...explicit, ...(result.selected ?? [])]);
  });

  // The host mounts Jev last among registered extensions: freeze the fully composed
  // prompt, including skill-loader output. Subsequent guidance goes into messages.
  pi.on("before_agent_start", (event, ctx) => {
    restore(ctx);
    if (!snapshot || snapshot.bypassed || snapshot.active.length === 0) return;
    if (snapshot.frozenPrompt === undefined) { snapshot.frozenPrompt = event.systemPrompt; save(); }
    const seen = new Set(ctx.sessionManager.getBranch().flatMap(e => {
      if (e.type === "custom_message" && e.customType === SUPPLEMENT_MESSAGE) {
        const details = e.details as { count?: number; epoch?: string };
        return details?.epoch === snapshot!.epoch ? [details.count ?? 0] : [];
      }
      if (e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "context_tools") {
        const details = e.message.details as { count?: number; epoch?: string };
        return details?.epoch === snapshot!.epoch ? [details.count ?? 0] : [];
      }
      return [];
    }));
    const count = snapshot.supplements.length;
    return { systemPrompt: snapshot.frozenPrompt,
      ...(count && !seen.has(count) ? { message: { customType: SUPPLEMENT_MESSAGE,
        content: `Additional available capabilities and their instructions:\n\n${snapshot.supplements.slice(Math.max(0, ...seen)).join("\n\n")}`,
        display: false, details: { count, epoch: snapshot.epoch } } } : {}) };
  });

  pi.registerTool({ name: "context_tools", label: "Context capabilities",
    description: "Discover or load capabilities omitted from this session's initial context. Without load, returns the available capability IDs and purposes. With load, adds those capabilities and their original instructions for the rest of this session. IDs come from discover; loading is not permission to execute actions.",
    promptGuidelines: ["If a needed tool or workflow is missing, use context_tools to discover and load it before concluding the capability is unavailable."],
    parameters: Type.Object({ load: Type.Optional(Type.Array(Type.String())) }),
    async execute(_id, params, _signal, _update, ctx) {
      restore(ctx);
      if (!snapshot || snapshot.bypassed) return textResult("Context selection is inactive; the full configured tool set is available.");
      const ids = params.load ?? [];
      const unknown = ids.filter(id => !snapshot!.catalog.some(c => c.id === id));
      if (unknown.length) return textResult(`Unknown capabilities: ${unknown.join(", ")}. Discover without load first.`);
      if (!ids.length) return textResult(snapshot.catalog.map(c => `${c.id}${snapshot!.selected.includes(c.id) ? " (loaded)" : ""}: ${c.summary}`).join("\n"));
      const text = apply(ids);
      return { ...textResult(text || "These capabilities are already loaded."), details: { count: snapshot.supplements.length, epoch: snapshot.epoch } };
    },
  });

  pi.on("session_start", (_event, ctx) => { reset(); restore(ctx); });
  pi.on("session_tree", (_event, ctx) => {
    if (snapshot) {
      const live = pi.getActiveTools();
      const revoked = snapshot.active.filter(name => !live.includes(name));
      pi.setActiveTools(snapshot.authority.filter(name => !revoked.includes(name)));
    }
    reset(); restore(ctx);
  });
  pi.on("session_compact", () => {
    // A compaction starts a new cache epoch. Retain the union but rebase its full text.
    if (snapshot) { snapshot.frozenPrompt = undefined; snapshot.supplements = []; snapshot.epoch = randomUUID(); save(); }
  });
  pi.on("session_shutdown", reset);
}
