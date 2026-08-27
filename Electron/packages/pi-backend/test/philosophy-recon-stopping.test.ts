import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  composePhilosophy,
  parseLayer,
  scannableBody,
  type CapabilityTable,
  type Layer,
} from "../../../resources/runtime/pi-philosophy/compose.ts";

/**
 * Coverage-driven stopping protocol (`recon-stopping`) plus the shared stopping section of
 * `retrieval`. Evidence base: measured worker trajectories showed 136/377 workers with
 * >=5-read bursts and 58 with synonym loops, concentrated in explore/reviewer roles while
 * implementers rarely repeat recon — so the bound is coverage-driven with a soft checkpoint,
 * never a blind call-count cap, and exact known-token grep stays valid.
 *
 * Lives beside philosophy-runtime.test.ts (the vendored-tree tripwire) because it composes
 * the same real tree the packaged session loads.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime", "pi-philosophy");
const capabilities = JSON.parse(readFileSync(join(ROOT, "capabilities.json"), "utf8")) as CapabilityTable;
const ALL_TOOLS = Object.values(capabilities.capabilities).map((c) => c.tool);

const layers: Layer[] = readdirSync(join(ROOT, "layers"))
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => {
    const parsed = parseLayer(readFileSync(join(ROOT, "layers", name), "utf8"), name);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.layer;
  });

const retrieval = layers.find((l) => l.id === "retrieval")!;
const stopping = layers.find((l) => l.id === "recon-stopping");
const compose = (overrides: Partial<Parameters<typeof composePhilosophy>[0]> = {}) =>
  composePhilosophy({
    layers,
    config: { enabled: true, layers: {}, scopes: { worker: false } },
    capabilities,
    role: "main",
    activeTools: ALL_TOOLS,
    ...overrides,
  });
const workerIds = (agent?: string) => compose({ role: "worker", agent }).included.map((l) => l.id);

describe("recon-stopping layer: structure", () => {
  it("exists, is addressed to exactly the sweeping roles, and ranks as retrieval's refinement", () => {
    expect(stopping, "23-recon-stopping.md must ship").toBeTruthy();
    expect(stopping!.scope.sort()).toEqual(["explore", "reviewer"]);
    expect(stopping!.order).toBeGreaterThan(retrieval.order);
    // Independent of the index: stopping discipline applies even where code_search is absent,
    // so it declares no required capability.
    expect(stopping!.requiresCapabilities).toEqual([]);
  });

  it("names no pi tool directly", () => {
    const body = scannableBody(stopping!.body);
    for (const tool of ALL_TOOLS) {
      expect(new RegExp(`\\b${tool}\\b`, "i").test(body), `${tool} appears bare`).toBe(false);
    }
  });
});

describe("recon-stopping layer: delivery", () => {
  it("reaches explore and reviewer even though worker bulk distribution is off", () => {
    // Agent-named scopes bypass the bulk switch by design; these are exactly the roles whose
    // trajectories produced the read bursts.
    expect(workerIds("explore")).toContain("recon-stopping");
    expect(workerIds("reviewer")).toContain("recon-stopping");
    const reviewerAfterExploreIds = compose({ role: "worker", agent: "explore" }).included.map((l) => l.id);
    expect(reviewerAfterExploreIds.indexOf("recon-stopping")).toBeGreaterThan(
      reviewerAfterExploreIds.indexOf("retrieval"),
    );
  });

  it("stays out of sessions that do not sweep: general-purpose, plan, unnamed workers, main", () => {
    // Requirement: implementer continuity and findings handoff are untouched — the guidance
    // must not broaden onto the editing role.
    expect(workerIds("general-purpose")).not.toContain("recon-stopping");
    expect(workerIds("plan")).not.toContain("recon-stopping");
    expect(workerIds()).not.toContain("recon-stopping");
    expect(compose({ role: "main" }).included.map((l) => l.id)).not.toContain("recon-stopping");
    expect(compose({ role: "main" }).text).not.toMatch(/soft checkpoint/i);
  });

  it("survives a runtime with no retrieval tools at all", () => {
    const result = compose({ role: "worker", agent: "explore", activeTools: [] });
    expect(result.included.map((l) => l.id)).toEqual(["research", "recon-stopping", "toolcall", "thinking"]);
    expect(result.text).not.toContain("{{");
  });
});

describe("shared retrieval layer: coverage-driven stopping", () => {
  it("defines dimensions-first coverage with one anchor per required dimension", () => {
    expect(retrieval.body).toMatch(/## Coverage decides when searching ends/);
    expect(retrieval.body).toMatch(/coverage, not stamina/);
    expect(retrieval.body).toMatch(/three to seven claims the deliverable needs\s+anchored/);
    expect(retrieval.body).toMatch(/one reliable file:line anchor carry each/);
    expect(retrieval.body).toMatch(/name the\s+question it answers or the finding it would falsify/);
  });

  it("does not retire exact known-token grep nor mandate indexed retrieval first", () => {
    expect(retrieval.body).toMatch(/None of this retires exact\s+matching for a string you already know/);
    expect(retrieval.body).toMatch(/nothing makes a map or a weighted search a\s+prerequisite for starting/);
  });

  it("lands in the composed boss prompt alongside delivery to every code reader", () => {
    const main = compose({ role: "main" });
    expect(main.text).toMatch(/Coverage decides when searching ends/);
    expect(main.text).toMatch(/one reliable file:line anchor/);
    expect(workerIds("general-purpose")).toContain("retrieval");
  });
});

describe("recon-stopping layer: rule content", () => {
  it("pins the checkpoint inventory the evidence demanded", () => {
    expect(stopping!.body).toMatch(/roughly\s+ten retrievals without a newly covered dimension/);
    expect(stopping!.body).toMatch(/Covered dimensions so far, each with its best file:line anchor/);
    expect(stopping!.body).toMatch(/Known file families you could now navigate on demand/);
    expect(stopping!.body).toMatch(/Remaining unknowns, phrased as questions/);
    expect(stopping!.body).toMatch(/Whether one more search can change the verdict/);
    expect(stopping!.body).toMatch(/Continue only when that fourth line names something open/);
  });

  it("keeps the anti-early-stopping rule for open questions and forbids ritual search past coverage", () => {
    // Reconciliation cuts both ways: strategies remain required while a material question is
    // unresolved, and continuing to search after coverage is drift, not diligence.
    expect(stopping!.body).toMatch(/While a material question stays unresolved, multiple strategies\s+remain required/);
    expect(stopping!.body).toMatch(/ritual\s+search after coverage was already complete/);
    expect(retrieval.body).toMatch(/only while a material question stays unresolved, never as ritual after coverage is done/);
  });

  it("scales breadth with the brief instead of imposing a cap", () => {
    expect(stopping!.body).toMatch(/[Aa] brief that genuinely spans many layers justifies sweep\s+after sweep/);
    expect(stopping!.body).toMatch(/is no hard cap on calls/);
    expect(retrieval.body).toMatch(/no call-count cap stands in for an uncovered dimension/);
  });

  it("leaves implementation continuity alone", () => {
    expect(stopping!.body).not.toMatch(/general-purpose/i);
    expect(stopping!.body).not.toMatch(/implementation continuity/i);
    expect(stopping!.body).not.toMatch(/verify command|worktree/i);
  });
});
