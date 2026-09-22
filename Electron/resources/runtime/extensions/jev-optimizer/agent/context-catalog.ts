export const LAYERS_REQUEST = "pipiui.context-layers.request.v1";
export const SELECTION_REQUEST = "pipiui.context-selection.request.v1";
export const SNAPSHOT_ENTRY = "jev-context-selection-v1";
export const SUPPLEMENT_MESSAGE = "jev-context-supplement-v1";

export type ContextLayer = {
  id: string; summary: string; body: string; requires: string[]; tools: string[]; pinned: boolean;
  template?: string;
  bindings?: Record<string, { tool: string; absent?: string }>;
};
export type ContextTool = { name: string; description: string; promptGuidelines?: string[] };
export type ContextBundle = { id: string; summary: string; tools: string[]; layers: string[]; pinned: boolean };

/** Optional tool references are resolved when a layer first enters the context, then frozen. */
export function materializeLayer(layer: ContextLayer, active: string[]): string {
  if (layer.template === undefined) return layer.body;
  return layer.template.replace(/\{\{([\w-]+)\}\}/g, (token, key) => {
    const binding = layer.bindings?.[key];
    return binding ? (active.includes(binding.tool) ? binding.tool : binding.absent ?? "an unavailable capability") : token;
  });
}

const CORE_TOOLS = new Set(["read", "skill_search", "skill_load", "context_tools", "pipiui_runtime_info"]);
const GROUPS: Array<[string, RegExp]> = [
  ["files", /^(bash|edit|write|grep|ls|terminal)$/],
  ["code", /^(code_search|code_nav|repo_map|read_spans)$/],
  ["agents", /^(subagent(?:_|$)|secretary_commit$|context_doc$|context_manage$|ledger_note$)/],
  ["planning", /^plan_/], ["memory", /^(memory_|session_recall$|session_search$)/],
  ["browser", /^browser(?:_|$)/], ["computer", /^(computer|open_application)$/],
  ["web", /^(web_search|fetch_content|get_search_content|source_check|arxiv_fetch)$/],
  ["images", /^image_(gen|edit)$/], ["secrets", /^secret_vault_/],
  ["office", /^(pipiui_office|pipiui_firecrawl|list_open_documents)/],
  ["experiments", /^(init_experiment|run_experiment|log_experiment)$/],
  ["context-recovery", /^(recall_folded|unfold|headroom_retrieve)$/],
];

export function contextCatalog(tools: ContextTool[], layers: ContextLayer[]): ContextBundle[] {
  const groups = new Map<string, ContextTool[]>();
  for (const tool of tools) {
    const id = CORE_TOOLS.has(tool.name) ? "core" : GROUPS.find(([, re]) => re.test(tool.name))?.[0] ?? tool.name;
    groups.set(id, [...(groups.get(id) ?? []), tool]);
  }
  return [
    ...[...groups].map(([id, entries]) => ({ id: `tools:${id}`,
      summary: entries.map(t => `${t.name}: ${t.description.slice(0, 240)}`).join("\n"),
      tools: entries.map(t => t.name), layers: [], pinned: id === "core" || id === "context-recovery" })),
    ...layers.map(l => ({ id: `layer:${l.id}`, summary: l.summary, tools: l.tools, layers: [l.id], pinned: l.pinned })),
  ];
}

/** Dependency closure only within the eligible catalog; Jev never grants tool authority. */
export function expandSelection(ids: string[], catalog: ContextBundle[], layers: ContextLayer[]) {
  const selected = new Set(ids);
  for (const bundle of catalog) if (bundle.pinned) selected.add(bundle.id);
  let changed = true;
  while (changed) {
    const size = selected.size;
    for (const bundle of catalog) if (selected.has(bundle.id)) {
      for (const id of bundle.layers) {
        const layer = layers.find(l => l.id === id);
        for (const dependency of layer?.requires ?? []) selected.add(`layer:${dependency}`);
      }
      for (const name of bundle.tools) {
        const owner = catalog.find(b => b.id.startsWith("tools:") && b.tools.includes(name));
        if (owner) selected.add(owner.id);
      }
    }
    // Guidance tied to an activated tool must travel with it; cross-cutting workflow
    // layers without tool dependencies remain independently selectable.
    const toolNames = new Set(catalog.filter(b => selected.has(b.id)).flatMap(b => b.tools));
    for (const layer of layers) if (layer.tools.length && layer.tools.some(t => toolNames.has(t))) selected.add(`layer:${layer.id}`);
    changed = selected.size !== size;
  }
  return catalog.filter(b => selected.has(b.id));
}
