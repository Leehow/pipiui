import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  composePhilosophy,
  parseLayer,
  placeholdersIn,
  scannableBody,
  type CapabilityTable,
  type Layer,
} from "../../../resources/runtime/pi-philosophy/compose.ts";

/**
 * The philosophy tree under resources/runtime is what every packaged session actually loads.
 * It is vendored, not installed from npm, so nothing upstream flags drift — these tests are
 * the tripwire. The failure they guard against is real and has shipped: the runtime injected
 * `PIPI_PHILOSOPHY_AGENT` while the vendored composer predated it, so agent-addressed layers
 * were silently never delivered.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime", "pi-philosophy");
const capabilities = JSON.parse(readFileSync(join(ROOT, "capabilities.json"), "utf8")) as CapabilityTable;
const ALL_TOOLS = Object.values(capabilities.capabilities).map((c) => c.tool);
const SCOPED_MODEL = "deepseek/deepseek-v4-flash";

const layers: Layer[] = readdirSync(join(ROOT, "layers"))
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => {
    const parsed = parseLayer(readFileSync(join(ROOT, "layers", name), "utf8"), name);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.layer;
  });

const config = () => structuredClone(DEFAULT_CONFIG);
const compose = (overrides: Partial<Parameters<typeof composePhilosophy>[0]> = {}) =>
  composePhilosophy({
    layers,
    config: config(),
    capabilities,
    role: "main",
    activeTools: ALL_TOOLS,
    ...overrides,
  });
const workerIds = (agent?: string) => compose({ role: "worker", agent }).included.map((l) => l.id);

describe("vendored philosophy: structure", () => {
  it("ships the audience-split layers the agent-name scoping depends on", () => {
    // 22/24/26 exist because method's sections had different audiences; losing the split
    // restores the old failure where craft rules reached nobody who writes code.
    expect(layers.map((l) => l.id)).toEqual([
      "foundation",
      "method",
      "research",
      "planning",
      "craft",
      "orchestration",
      "fanout",
      "toolcall",
    ]);
  });

  it("names no pi tool directly — renames stay a one-line edit in capabilities.json", () => {
    for (const layer of layers) {
      const body = scannableBody(layer.body);
      for (const tool of ALL_TOOLS) {
        const bare = new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        expect(bare.test(body), `${layer.file} names "${tool}" directly`).toBe(false);
      }
    }
  });

  it("uses only placeholders the capability table knows", () => {
    const known = new Set([...Object.keys(capabilities.capabilities), "agents"]);
    for (const layer of layers)
      for (const key of placeholdersIn(layer.body))
        expect(known.has(key), `${layer.file}: unknown placeholder {{${key}}}`).toBe(true);
  });
});

describe("vendored philosophy: delivery", () => {
  it("addresses each dispatched agent only the layers written for it", () => {
    expect(workerIds("explore")).toEqual(["research"]);
    expect(workerIds("plan")).toEqual(["planning"]);
    expect(workerIds("general-purpose")).toEqual(["craft"]);
  });

  it("gives an unaddressed worker nothing while bulk distribution is off", () => {
    expect(workerIds()).toEqual([]);
  });

  it("delivers a model-scoped layer to a worker regardless of the bulk switch", () => {
    const result = compose({ role: "worker", agent: "general-purpose", model: SCOPED_MODEL });
    expect(result.included.map((l) => l.id)).toEqual(["craft", "toolcall"]);
  });

  it("survives a runtime that has only the single dispatch tool", () => {
    // pi's own subagent extension registers dispatch but no parallel/status tools; the
    // judgement layers must degrade to prose, not disappear or leak dead tool names.
    const result = compose({ activeTools: [capabilities.capabilities.delegate.tool] });
    expect(result.included.map((l) => l.id)).toEqual([
      "foundation",
      "method",
      "research",
      "planning",
      "craft",
      "orchestration",
      "fanout",
    ]);
    expect(result.text).not.toContain("{{");
    expect(result.text).not.toMatch(/\bsubagent_status\b/);
  });

  it("reports a scope naming nobody instead of silently never delivering it", () => {
    const [typo, ...rest] = layers;
    const broken: Layer[] = [
      { ...typo, id: "typo", scope: ["explorr"] },
      ...rest.filter((l) => l.id !== "toolcall"),
    ];
    const result = composePhilosophy({
      layers: broken,
      config: config(),
      capabilities,
      role: "worker",
      agent: "explorer",
      activeTools: ALL_TOOLS,
    });
    expect(result.skipped.find((s) => s.id === "typo")?.reason).toMatch(/names nobody that exists/);
  });

  it("keeps the boss's whole prefix inside budget", () => {
    // The standalone package capped this at 11500; the vendored tree also carries the
    // host-policy sections (tool withholding, computer_task routing, status persistence,
    // session recall), which are load-bearing here and cost the difference.
    const result = compose({ model: SCOPED_MODEL });
    expect(Math.round(result.text.length / 4)).toBeLessThan(12000);
  });
});
