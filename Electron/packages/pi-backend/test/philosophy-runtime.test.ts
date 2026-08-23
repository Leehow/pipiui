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
      "retrieval",
      "research",
      "planning",
      "craft",
      "debugloop",
      "domain",
      "orchestration",
      "same-turn",
      "fanout",
      "toolcall",
      "thinking",
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
    // `thinking` rides along on every route it is not excluded from, this one included:
    // a fan-out multiplies thinking sprawl by the width of the wave, so the worker is
    // exactly where the correction pays for itself.
    // `retrieval` rides along on every code-reading role for the same reason: choosing the
    // exact matcher for a semantic question is a drift the recon tier pays for most.
    expect(workerIds("explore")).toEqual(["retrieval", "research", "thinking"]);
    expect(workerIds("plan")).toEqual(["retrieval", "planning", "thinking"]);
    expect(workerIds("general-purpose")).toEqual(["retrieval", "craft", "thinking"]);
  });

  it("gives an unaddressed worker only model-scoped corrections while bulk distribution is off", () => {
    // The switch declines the ~1.6k judgement prefix per worker. It has never governed
    // model-scoped corrections, and `thinking` is one — now by exclusion rather than by
    // an allowlist, which is why it reaches an unnamed model here.
    expect(workerIds()).toEqual(["thinking"]);
  });

  it("delivers a model-scoped layer to a worker regardless of the bulk switch", () => {
    const result = compose({ role: "worker", agent: "general-purpose", model: SCOPED_MODEL });
    expect(result.included.map((l) => l.id)).toEqual(["retrieval", "craft", "toolcall", "thinking"]);
  });

  it("keeps deepseek worker toolcall when the dispatch tool is absent", () => {
    const result = compose({
      role: "worker",
      agent: "general-purpose",
      model: SCOPED_MODEL,
      activeTools: [],
    });
    expect(result.included.map((l) => l.id)).toEqual(["craft", "toolcall", "thinking"]);
    expect(result.text).not.toContain("{{");
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
      "debugloop",
      "domain",
      "orchestration",
      "same-turn",
      "fanout",
      "thinking",
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

  it("treats an approved plan as a per-task dispatch manifest", () => {
    const planning = layers.find((l) => l.id === "planning")!.body;
    const orchestration = layers.find((l) => l.id === "orchestration")!.body;
    expect(planning).toMatch(/dispatch manifest/);
    expect(planning).toMatch(/one worker per independent task/);
    expect(planning).toMatch(/fan-out violation/);
    expect(orchestration).toMatch(/Two unrelated changes are two workers in one dispatch/);
    // The approve call moved to `planning` with the rest of the lifecycle. Orchestration is
    // skipped without a dispatch tool while planning still ships, so the layer that always
    // reaches a planning session is the one that has to carry it.
    expect(planning).toMatch(/plan_approve` with the stable `plan\.id`/);
  });

  it("requires the published plan to cover the whole spec on one plan.id", () => {
    const planning = layers.find((l) => l.id === "planning")!.body;
    const orchestration = layers.find((l) => l.id === "orchestration")!.body;
    expect(planning).toMatch(/entire scope/);
    expect(planning).toMatch(/stage2\/stage3/);
    expect(planning).toMatch(/not Adjust/);
    expect(planning).toMatch(/worker briefs and dependencies, not a new stage plan/);
    expect(orchestration).toMatch(/same approved plan through later phases/);
    expect(orchestration).toMatch(/do not replace it with a new stage plan/);
    expect(orchestration).not.toMatch(/plan_publish/);
  });

  it("states the plan lifecycle in exactly one layer", () => {
    // Two copies drifted before this guard existed: orchestration required `plan_cancel` plus
    // a fresh `plan.id` on Adjust, while planning said only "revises and republishes". A
    // session with no dispatch tool drops orchestration and kept the incomplete half.
    const owners = (pattern: RegExp) => layers.filter((l) => pattern.test(l.body)).map((l) => l.id);
    expect(owners(/plan_approve/)).toEqual(["planning"]);
    expect(owners(/plan_cancel/)).toEqual(["planning"]);
    expect(owners(/plan_publish/)).toEqual(["planning"]);
    // Every branch of the lifecycle is spelled out where it now lives.
    const planning = layers.find((l) => l.id === "planning")!.body;
    for (const rule of [/plan_cancel` for the current plan/, /new\*\* `plan.id`/, /same `planId` and task id/])
      expect(planning, String(rule)).toMatch(rule);
  });

  it("skips retrieval discipline in a project that mounts no retrieval", () => {
    // The layer is advice about choosing between two kinds of search. Where the second kind
    // does not exist it is not merely unnecessary, it is false — so it is gated on the tool
    // rather than shipped with an `absent` fallback.
    const withoutIndex = ALL_TOOLS.filter((t) => t !== capabilities.capabilities.code_search.tool);
    const result = compose({ activeTools: withoutIndex });
    expect(result.included.map((l) => l.id)).not.toContain("retrieval");
    expect(result.skipped.find((s) => s.id === "retrieval")?.reason).toMatch(
      /needs a tool this session does not have/,
    );
    expect(result.text).not.toContain("{{");
  });

  it("promises only the retrieval this build actually has", () => {
    // The first version of this layer told workers `code_search` was for questions they
    // "cannot spell" — semantic retrieval, which is not enabled here. They obeyed, sent it the
    // one shape it cannot answer, got "No hits", and went back to grep 22:1. Prose that
    // oversells a tool trains the model out of using it, so the layer has to state the ranking
    // it really does and what an empty result means.
    const retrieval = layers.find((l) => l.id === "retrieval")!.body;
    expect(retrieval).toMatch(/does not read your\s*\n?mind/);
    expect(retrieval).toMatch(/no semantic index/);
    expect(retrieval).toMatch(/Change vocabulary, not tool/);
    expect(retrieval).not.toMatch(/what that question has always needed/);
    // A route note and a failure are different claims; conflating them is what discarded
    // correct spans.
    expect(retrieval).toMatch(/not a verdict on the answer/);
  });

  it("names the tell that an exact search was the wrong question", () => {
    // The drift is one-directional and the correction has to be actionable mid-search, not a
    // taxonomy: the trigger is the boss's own second keyword guess.
    const retrieval = layers.find((l) => l.id === "retrieval")!.body;
    expect(retrieval).toMatch(/second keyword is the tell/);
    expect(retrieval).toMatch(/Refs before bodies/);
    // Nothing else may re-define searching as the exact matcher alone; that framing in
    // `toolcall` is what kept the index unused after it shipped.
    expect(layers.find((l) => l.id === "toolcall")!.body).toMatch(
      /Searching for a string you can name/,
    );
  });

  it("makes review and empirical acceptance concurrent rather than sequential", () => {
    // A reviewer at high effort is one of the longest wall-clock workers in the system, and
    // the boss holds the only observation surfaces. Serializing them idles the one role that
    // cannot be delegated for the duration of the one worker that takes longest.
    const orchestration = layers.find((l) => l.id === "orchestration")!.body;
    expect(orchestration).toMatch(/two evidence streams, not two stages/);
    expect(orchestration).toMatch(/belongs there, never on the test/);
    const debugloop = layers.find((l) => l.id === "debugloop")!.body;
    expect(debugloop).toMatch(/A running reviewer is a window, not a queue/);
    expect(layers.find((l) => l.id === "fanout")!.body).toMatch(
      /sitting out a long review or other read-only worker/,
    );
  });

  it("delivers last-resort terminal discipline in debugloop and orchestration", () => {
    expect(layers.find((l) => l.id === "debugloop")!.body).toMatch(/Last-resort only/);
    expect(layers.find((l) => l.id === "orchestration")!.body).toMatch(
      /do not look for another route to the same edit/,
    );
  });

  it("delivers same-turn independent-call discipline to boss and lead on every model", () => {
    const sameTurn = layers.find((l) => l.id === "same-turn");
    expect(sameTurn, "Electron-only same-turn layer must exist").toBeTruthy();
    expect(sameTurn!.body).toMatch(/Issue every tool call whose arguments you already know/);
    expect(sameTurn!.body).toMatch(/Cross a turn only when the next call/);
    expect(sameTurn!.body).toMatch(/Do not batch desktop \/ computer actions/);
    expect(layers.find((l) => l.id === "orchestration")!.body).not.toMatch(
      /Issue every tool call whose arguments you already know/,
    );

    for (const role of ["main", "lead"] as const) {
      for (const model of ["openai/gpt-5", SCOPED_MODEL]) {
        const result = compose({ role, model });
        expect(result.included.map((l) => l.id)).toContain("same-turn");
        expect(result.text).toMatch(/Issue every tool call whose arguments you already know/);
        expect(result.text).toMatch(/Cross a turn only when the next call/);
        expect(result.text).toMatch(/Do not batch desktop \/ computer actions/);
      }
    }
    expect(
      compose({ role: "worker", agent: "general-purpose" }).included.map((l) => l.id),
    ).not.toContain("same-turn");
  });

  it("delivers thinking discipline to the routes that actually drift", () => {
    // The regression this pins: `requires-models: deepseek/deepseek-v4-*` meant the layer
    // written to stop thinking sprawl was inactive on the host's own default route, and on
    // every other relay serving the same drifting families. Measured p90 thinking on this
    // host: kimi-coding/k3 6.4k chars, jellytoken/kimi-k3 8.5k, opencode-go/hy3 8.1k,
    // zai-coding-cn/glm-5.3 5.9k — none of which the allowlist named.
    for (const model of [
      "kimi-coding/k3-256k",
      "kimi-coding/k3",
      "jellytoken/kimi-k3",
      "opencode-go/hy3",
      "zai-coding-cn/glm-5.3",
      SCOPED_MODEL,
    ]) {
      expect(compose({ model }).included.map((l) => l.id), model).toContain("thinking");
    }
  });

  it("withholds thinking discipline from the models measured not to sprawl", () => {
    // p90 259 chars and 843 chars respectively: telling these two that their thinking
    // sprawls is false, and a correction aimed at nobody's drift is prompt weight at best.
    for (const model of ["openai-codex/gpt-5.6-sol", "xai/grok-4.6"]) {
      const result = compose({ model });
      expect(result.included.map((l) => l.id), model).not.toContain("thinking");
      expect(result.skipped.find((s) => s.id === "thinking")?.reason).toMatch(/excluded for model/);
    }
  });

  it("keeps the discipline when the route is unknown", () => {
    // Exclusion fails closed: an unnamed model is assumed to need the correction, so a
    // provider added tomorrow inherits it instead of silently opting out.
    expect(compose({ model: undefined }).included.map((l) => l.id)).toContain("thinking");
    expect(compose({ model: "some-relay/whatever-v9" }).included.map((l) => l.id)).toContain("thinking");
  });

  it("delivers an excludes-scoped layer to a worker regardless of the bulk switch", () => {
    // Same bypass `requires-models` layers get: the bulk switch declines to buy judgement
    // prefix, not a correction that keeps the worker's own model from misbehaving.
    const result = compose({ role: "worker", agent: "general-purpose", model: "kimi-coding/k3-256k" });
    expect(result.included.map((l) => l.id)).toEqual(["retrieval", "craft", "thinking"]);
  });

  it("keeps the boss's whole prefix inside budget", () => {
    // The standalone package capped this at 11500; the vendored tree also carries the
    // host-policy sections (tool withholding, computer_task routing, status persistence,
    // session recall) and the thinking-discipline layer, which are
    // load-bearing here and cost the difference. Raised again for the domain-memory layer
    // (CONTEXT.md vocabulary + ADR gate), which pays for itself in re-derived terminology.
    // Raised again (~1k) for the debug-loop layer: the boss is the only holder of the
    // in-app browser and the visible terminal, so the browser/terminal/dispatch round trip
    // has no other place to live — a worker that cannot see the screen cannot be told the
    // rule, and the evidence-verbatim discipline is what stops a blind worker guessing.
    // Raised again (~640) for the document-handoff rules: findings artifacts and shared
    // context are what stop three roles re-running one search, and only the boss can act on
    // them — it is the one that forwards a findings path into the next brief and the only
    // writer of shared context. A worker told to read a document nobody points it at reads
    // nothing, so this rule cannot be pushed down into the agent definitions.
    // Briefly raised to 15600 for the recon-tier rule in 9bd33dd3, then put back: that raise
    // would have been the seventh in a ledger running 11500 → 15600, every one justified in
    // isolation. A cap that only ratchets up measures growth instead of bounding it, so the
    // raise was paid for by compression instead — the plan lifecycle had been written out in
    // full in both `planning` and `orchestration`, and consolidating it into `planning`
    // returned more room than the recon-tier rule spent. The recon rule keeps its place; the
    // budget keeps its meaning. Prefer that trade to another entry in this list.
    // Raised to 16700 for the retrieval layer plus the review/acceptance concurrency rule:
    // both correct a drift that was costing more than their prose does — an unused index and
    // a boss idling through the longest worker in the system.
    // Raised again to 16900: the retrieval layer's first version promised semantic search the
    // build does not have, so workers sent it the one question shape it cannot answer, got
    // nothing, and learned to distrust it. Saying what the tool actually ranks on — and what
    // an empty result means — costs the difference.
    const result = compose({ model: SCOPED_MODEL });
    expect(Math.round(result.text.length / 4)).toBeLessThan(16900);
  });
});
