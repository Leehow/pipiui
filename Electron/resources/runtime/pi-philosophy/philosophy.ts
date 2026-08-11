/**
 * pipi-philosophy — a layered working philosophy that lives in pi, not in any one frontend.
 *
 * Installed as a pi package, so a bare TUI session, a GUI frontend, and every dispatched
 * worker load the same four layers from the same config. The only pi surface this file
 * touches is `before_agent_start` (+ `getActiveTools` for capability truth) — everything
 * else lives in `compose.ts`, which imports nothing and is fully testable with plain node.
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
  resolveRole,
} from "./compose.ts";

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const CONFIG_FILE = path.join(AGENT_DIR, "philosophy.json");
const USER_LAYERS_DIR = path.join(AGENT_DIR, "philosophy-user");

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
  for (const dir of [path.join(PACKAGE_DIR, "layers"), USER_LAYERS_DIR]) {
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
      readLayerDir(USER_LAYERS_DIR, "user"),
    );
    cachedSignature = signature;
  }
  return { layers: cachedLayers, capabilities: cachedCapabilities };
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

function buildReport(activeTools: string[] | null): string {
  const { layers, capabilities } = loadLayers();
  const config = readConfig();
  const role = resolveRole(process.env);
  const result = composePhilosophy({ layers, config, capabilities, role, activeTools });

  const lines: string[] = [
    `# Philosophy — ${config.enabled ? "on" : "off"} (role: ${role})`,
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
  pi.on("before_agent_start", (event) => {
    if (event.systemPrompt.includes(MARKER)) return; // already injected by another copy
    const { layers, capabilities } = loadLayers();
    const result = composePhilosophy({
      layers,
      config: readConfig(),
      capabilities,
      role: resolveRole(process.env),
      activeTools: pi.getActiveTools(),
    });
    // Published before the turn runs, so any tool called during it sees this turn's truth.
    publishState(result.included.map((l) => l.id));
    if (!result.text) return;
    return { systemPrompt: `${event.systemPrompt.trimEnd()}\n\n${MARKER}\n${result.text}` };
  });

  // Leave no state behind for a future process that happens to reuse this pid.
  pi.on("session_shutdown", () => {
    try {
      fs.unlinkSync(STATE_FILE);
    } catch {
      // Already gone, or never written.
    }
  });

  pi.registerCommand("philosophy", {
    description: "Show or toggle the working philosophy layers loaded into this session",
    handler: async (args, ctx) => {
      const [verb, target] = args.trim().split(/\s+/).filter(Boolean);
      const activeTools = pi.getActiveTools();

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
          activeTools,
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
        content: buildReport(activeTools),
        display: true,
      });
    },
  });
}
