import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG,
  composePhilosophy,
  isModelScoped,
  modelDeclaresCapability,
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
      "recon-stopping",
      "planning",
      "craft",
      "debugloop",
      "domain",
      "orchestration",
      "same-turn",
      "fanout",
      "nested-dispatch",
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
    // `toolcall` names the code-reading agents directly: session-log measurement showed
    // every model family rebuilding grep/ls/cat in bash, so the correction is addressed to
    // whoever searches, not gated on a model allowlist.
    expect(workerIds("explore")).toEqual(["retrieval", "research", "recon-stopping", "toolcall", "thinking"]);
    expect(workerIds("plan")).toEqual(["retrieval", "planning", "toolcall", "thinking"]);
    expect(workerIds("general-purpose")).toEqual(["retrieval", "craft", "same-turn", "nested-dispatch", "toolcall", "thinking"]);
  });

  it("gives an unaddressed worker the corrections that name an audience while bulk distribution is off", () => {
    // The switch declines the ~1.6k judgement prefix per worker. It has never governed
    // layers that name their audience: `thinking` reaches an unnamed model by exclusion
    // rather than by an allowlist, and `toolcall` names the roster's code-reading agents,
    // which marks the whole layer as addressed — so it rides along even for an unnamed
    // worker. Tool-selection drift costs every dispatch; the bulk switch saves prose, not
    // this correction.
    expect(workerIds()).toEqual(["toolcall", "thinking"]);
  });

  it("delivers toolcall to a named worker regardless of the bulk switch", () => {
    // The layer names general-purpose in its scope, so the bulk gate — which only governs
    // role-only scopes — cannot withhold it. The old deepseek allowlist was removed after
    // session-log measurement showed the drift on every model family, grok included.
    const result = compose({ role: "worker", agent: "general-purpose", model: SCOPED_MODEL });
    expect(result.included.map((l) => l.id)).toEqual(["retrieval", "craft", "same-turn", "nested-dispatch", "toolcall", "thinking"]);
    const grok = compose({ role: "worker", agent: "general-purpose", model: "xai/grok-4.6" });
    expect(grok.included.map((l) => l.id)).toContain("toolcall");
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

  it("applies deepseek toolcall corrections to the independent deepseek-extended provider", () => {
    const result = compose({
      role: "worker",
      agent: "general-purpose",
      model: "deepseek-extended/deepseek-v4-flash-vision-exp",
    });
    expect(result.included.map((l) => l.id)).toContain("toolcall");
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
      "toolcall",
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

  it("treats a same-region write conflict as a cut to make, not a reason to serialize", () => {
    // The boss kept single-threading separable work because two tasks named the same file.
    // File identity was already ruled out as a reason; this closes the last excuse — a real
    // same-region collision between two concerns is a cohesion defect the boss can remove.
    const fanout = layers.find((l) => l.id === "fanout")!.body;
    expect(fanout).toMatch(/Cut the file instead of serializing the wave/);
    expect(fanout).toMatch(/name it in one\s+noun phrase with its own reason to change/);
    // The cut must not cost a turn, and must not smuggle in design work.
    expect(fanout).toMatch(/Dispatch the cut as the head of the wave, never as its own turn/);
    expect(fanout).toMatch(/pure move — same behavior, same exported names/);
    // ...and must not become a habit of carving up cohesive files for fake width.
    expect(fanout).toMatch(/serialization wearing a wave's costume/);
    expect(fanout).toMatch(/accepting a same-region collision/);
  });

  it("delivers last-resort terminal discipline in debugloop and orchestration", () => {
    expect(layers.find((l) => l.id === "debugloop")!.body).toMatch(/Last-resort only/);
    expect(layers.find((l) => l.id === "orchestration")!.body).toMatch(
      /do not look for another route to the same edit/,
    );
  });

  it("delivers same-turn independent-call discipline to the boss and the worker that dispatches", () => {
    const sameTurn = layers.find((l) => l.id === "same-turn");
    expect(sameTurn, "Electron-only same-turn layer must exist").toBeTruthy();
    expect(sameTurn!.body).toMatch(/Issue every tool call whose arguments you already know/);
    expect(sameTurn!.body).toMatch(/Cross a turn only when the next call/);
    expect(sameTurn!.body).toMatch(/Do not batch desktop \/ computer actions/);
    expect(layers.find((l) => l.id === "orchestration")!.body).not.toMatch(
      /Issue every tool call whose arguments you already know/,
    );

    for (const target of [
      { role: "main" as const },
      { role: "worker" as const, agent: "general-purpose" },
    ]) {
      for (const model of ["openai/gpt-5", SCOPED_MODEL]) {
        const result = compose({ ...target, model });
        expect(result.included.map((l) => l.id)).toContain("same-turn");
        expect(result.text).toMatch(/Issue every tool call whose arguments you already know/);
        expect(result.text).toMatch(/Cross a turn only when the next call/);
        expect(result.text).toMatch(/Do not batch desktop \/ computer actions/);
      }
    }
    // A dispatched agent that cannot delegate has no wave to batch, so the discipline
    // that governs firing several dispatches at once is not addressed to it.
    expect(workerIds("explore")).not.toContain("same-turn");
    expect(workerIds("plan")).not.toContain("same-turn");
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
    expect(result.included.map((l) => l.id)).toEqual(["retrieval", "craft", "same-turn", "nested-dispatch", "toolcall", "thinking"]);
  });

  it("keeps the boss's whole prefix inside budget", () => {
    // The standalone package capped this at 11500; the vendored tree also carries the
    // host-policy sections (tool withholding, main-session desktop routing, status persistence,
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
    // Raised to 17000 for the commit default: the closeout was optional and commit-on-request,
    // so every finished goal left a dirty tree for the user to commit by hand.
    // Raised to 17200 for the worker read-only skill/memory contract: the old absolute
    // "never invoke a skill" line had to grow into a gated permit without restoring bootstrap.
    // Raised to 17500 for the composite-search section of toolcall: session logs showed
    // workers assembling `cd X && grep` chains the tools could already answer, so the
    // layer now maps each chain shape to the parameter that absorbs it. The section pays
    // for itself the first time it replaces a five-grep bash script with one call.
    // The semantic-slug identity section rode in under the same cap: it compresses the
    // agentId brief bullet it supersedes, so the rule pays for its own prose instead of
    // adding an entry to this ledger.
    // Raised to 18100 for fanout's "cut the file" section: file identity had already been
    // ruled out as a reason to serialize, but a same-region collision was still accepted as
    // one, so separable work kept running single-threaded behind a cohesion defect the boss
    // could have removed in one extraction. The section buys back wall-clock on every wave
    // that would otherwise have queued.
    // Raised to 18600 for orchestration's "silence is a measurement" section: a worker
    // blocked in a long test run is silent by construction, the stall report on that
    // silence is correct, and the boss was reading the pair as a verdict and aborting
    // healthy runs. The section names the cheap correction — move where the runtime
    // looks — and fences it, so it cannot become a way to keep a wedged worker alive.
    // Raised to 18800 for orchestration's [subagent-recovery] routing bullet: one reviewer
    // run replayed four resumed episodes (~384 calls / 212 reads) into the same provider/
    // context death because nothing at the boundary told the boss that continuing that
    // conversation was itself the failure mode. The runtime now classifies ordinary vs
    // poisoned-context deaths and persists an evidence-derived checkpoint; the bullet names
    // the two routes so the fresh-episode dispatch reads it instead of blind-resuming.
    // Raised to 19300 for the plan-ceiling / fanout width-boundary / cheapest-verify and
    // no-unprompted-packaging rules: the drift they pin (sessions self-expanding scope
    // mid-plan, packaging the app unprompted to "verify") was user-reported and costs more
    // per turn than the ~380 tokens of prefix the four insertions spend.
    const result = compose({ model: SCOPED_MODEL });
    expect(Math.round(result.text.length / 4)).toBeLessThan(19300);
  });

  it("delivers the semantic-slug identity rule into the composed boss prompt", () => {
    // The shipped defect: stable worker identity fell back to `agent-<random>` — an id no
    // model can read, repeat, or retype to continue, abort, or resolve. The contract now
    // lives in the orchestration layer and splits by who mints the id: caller-chosen
    // identities (agentId, plan id) the model supplies explicitly;
    // runtime-allocated model-visible identities (a goal id) the runtime may mint but must
    // keep readable and semantic; randomness only for ids no model ever names. The first
    // wording overreached — "every stable id the model must generate" — and contradicted
    // the runtime-allocated goal ids, so the negative pin below keeps that regression out.
    const orchestration = layers.find((l) => l.id === "orchestration")!.body;
    expect(orchestration).toMatch(/## Stable identity is a semantic slug/);
    // Tier A: caller-chosen identities are the model's to mint, as readable slugs.
    expect(orchestration).toMatch(/Every stable id you name/);
    expect(orchestration).toMatch(/`quota-pill`, not a UUID, random hex, or `agent-<random>`/);
    // The over-broad first wording is gone: not every model-visible id is model-minted.
    expect(orchestration).not.toMatch(/Every stable id you must generate/);
    // Tier B: runtime-allocated ids stay readable and semantic, just not caller-supplied.
    expect(orchestration).toMatch(/Runtime-allocated ids \(a goal id\) stay\s+readable and semantic, not yours to mint/);
    // Tier C: randomness belongs only where no model names the id.
    expect(orchestration).toMatch(/Randomness belongs only where no model names it/);
    expect(orchestration).toMatch(/one-shot\s+runId\/eventId\/waveId\/requestId/);
    // The browser token stays capability-addressed; a bare tool name would fail the scan.
    expect(orchestration).toMatch(/\{\{browser\}\} snapshot\/element\s+tokens/);
    for (const role of ["main"] as const) {
      const result = compose({ role });
      expect(result.included.map((l) => l.id)).toContain("orchestration");
      // The composed prompt — what the session actually loads — carries all three tiers
      // verbatim, with the capability placeholder resolved to the live tool name.
      expect(result.text).toMatch(/Stable identity is a semantic slug/);
      expect(result.text).toMatch(/Every stable id you name/);
      expect(result.text).toMatch(/`quota-pill`, not a UUID, random hex, or `agent-<random>`/);
      expect(result.text).toMatch(/Runtime-allocated ids \(a goal id\) stay\s+readable and semantic/);
      expect(result.text).toMatch(/runId\/eventId\/waveId\/requestId/);
      expect(result.text).toMatch(/browser snapshot\/element\s+tokens/);
    }
    // The rule rides the orchestration layer only; a dispatched worker never pays for it.
    const worker = compose({ role: "worker", agent: "general-purpose" });
    expect(worker.included.map((l) => l.id)).not.toContain("orchestration");
    expect(worker.text).not.toMatch(/Stable identity is a semantic slug/);
  });

  it("delivers the stall-is-a-measurement rule with a live progress-channel tool name", () => {
    // The shipped defect: a worker blocked in a long test run is silent on its own stream by
    // construction, so the runtime reported a stall on silence that carried no information
    // about the work — and the boss read that pair as a verdict and aborted healthy runs.
    // The correction is capability-addressed, so a rename of the progress tool stays a
    // one-line edit in capabilities.json rather than a stale tool name in prose.
    const orchestration = layers.find((l) => l.id === "orchestration")!.body;
    expect(orchestration).toMatch(/## Silence is a measurement, not a verdict/);
    expect(orchestration).toMatch(/silent on its own\s+stream by construction/);
    expect(orchestration).toMatch(/\{\{delegate_progress\}\}/);
    // Both fences ride with the rule: aborting is the expensive mistake, and re-pointing a
    // wedged worker is the dishonest one.
    expect(orchestration).toMatch(/pays for the same run twice/);
    expect(orchestration).toMatch(/no CPU and no\s+growing log is genuinely wedged/);

    const result = compose({ role: "main" });
    expect(result.included.map((l) => l.id)).toContain("orchestration");
    expect(result.text).toMatch(/Silence is a measurement, not a verdict/);
    // The placeholder resolves to the tool the session really has; no dead name survives.
    expect(result.text).toMatch(
      new RegExp(`move where\\s+the runtime is looking with ${capabilities.capabilities.delegate_progress.tool}\\b`),
    );
    expect(result.text).not.toMatch(/\{\{delegate_progress\}\}/);

    // A session whose runtime lacks the tool degrades to prose instead of naming a dead one.
    const withoutProgress = compose({
      role: "main",
      activeTools: ALL_TOOLS.filter((t) => t !== capabilities.capabilities.delegate_progress.tool),
    });
    expect(withoutProgress.text).toMatch(/Silence is a measurement, not a verdict/);
    expect(withoutProgress.text).not.toMatch(
      new RegExp(`\\b${capabilities.capabilities.delegate_progress.tool}\\b`),
    );

    // Supervision is the boss's job; a worker never pays for this prose.
    const worker = compose({ role: "worker", agent: "general-purpose" });
    expect(worker.text).not.toMatch(/Silence is a measurement, not a verdict/);
  });

  it("permits worker skill_search/load and memory_query without automatic bootstrap", () => {
    // The old orchestration line said dispatched workers never have or invoke skills.
    // That contradicts the read-only grant: bootstrap stays off, but present tools may be used.
    const orchestration = layers.find((l) => l.id === "orchestration")!.body;
    expect(orchestration).toMatch(/automatic skill bootstrap/);
    expect(orchestration).toMatch(/skill_search/);
    expect(orchestration).toMatch(/skill_load/);
    expect(orchestration).toMatch(/search then load/);
    expect(orchestration).toMatch(/never a mandatory gate/);
    expect(orchestration).toMatch(/must not add approvals or artifacts/);
    expect(orchestration).toMatch(/memory_query/);
    expect(orchestration).toMatch(/durable prior project decisions/);
    expect(orchestration).toMatch(/not temporary task state/);
    expect(orchestration).toMatch(/Do not mention tools the\s*\n?\s*role does not have as guaranteed/);
    expect(orchestration).not.toMatch(/skill library switched off/);
    expect(orchestration).not.toMatch(/never tell a worker to invoke/);
    expect(orchestration).not.toMatch(/never tell a worker to invoke\s+a skill/);
  });
});

describe("vendored philosophy: model-capability gating",
  () => {
    function hostedLayer() {
      const parsed = parseLayer(
        [
          "---",
          "id: grok-hosted",
          "name: Hosted Grok",
          "summary: only when the model declares hosted features",
          "order: 90",
          "scope: [main, worker]",
          "requires-model-capabilities: [hostedTools.code_interpreter, structuredOutputs]",
          "---",
          "Use hosted code and structured output only when the model declares them.",
          "",
        ].join("\n"),
        "grok-hosted.md",
      );
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.layer;
    }

    it("parses requires-model-capabilities and treats it as model-scoped",
      () => {
        const layer = hostedLayer();
        expect(layer.requiresModelCapabilities).toEqual([
          "hostedTools.code_interpreter",
          "structuredOutputs",
        ]);
        expect(isModelScoped(layer)).toBe(true);
      });

    it("drops the layer when the model or its capabilities are unknown",
      () => {
        const layer = hostedLayer();
        const unknown = composePhilosophy({
          layers: [layer],
          config: config(),
          capabilities,
          role: "main",
          activeTools: ALL_TOOLS,
          model: "grok-build/grok-4.6",
        });
        expect(unknown.included.map((item) => item.id)).not.toContain("grok-hosted");
        expect(unknown.skipped.find((item) => item.id === "grok-hosted")?.reason).toMatch(/unknown/);

        const empty = composePhilosophy({
          layers: [layer],
          config: config(),
          capabilities,
          role: "main",
          activeTools: ALL_TOOLS,
          model: "grok-build/grok-4.6",
          modelCapabilities: {},
        });
        expect(empty.included.map((item) => item.id)).not.toContain("grok-hosted");
        expect(empty.skipped.find((item) => item.id === "grok-hosted")?.reason).toMatch(/does not declare/);
      });

    it("includes the layer only when every required key is declared",
      () => {
        const layer = hostedLayer();
        const declared = {
          hostedTools: { tools: ["web_search", "x_search", "code_interpreter"] },
          structuredOutputs: true,
          inputFiles: true,
        };
        const result = composePhilosophy({
          layers: [layer],
          config: config(),
          capabilities,
          role: "main",
          activeTools: ALL_TOOLS,
          model: "grok-build/grok-4.6",
          modelCapabilities: declared,
        });
        expect(result.included.map((item) => item.id)).toContain("grok-hosted");
        expect(modelDeclaresCapability(declared, "hostedTools.code_interpreter")).toBe(true);
        expect(modelDeclaresCapability({ nativeSearch: { tools: ["web_search"] } }, "hostedTools.web_search")).toBe(true);
        expect(modelDeclaresCapability({ nativeSearch: { tools: ["web_search"] } }, "hostedTools.code_interpreter")).toBe(false);

        const worker = composePhilosophy({
          layers: [layer],
          config: config(),
          capabilities,
          role: "worker",
          agent: "general-purpose",
          activeTools: ALL_TOOLS,
          model: "grok-build/grok-4.6",
          modelCapabilities: declared,
        });
        expect(worker.included.map((item) => item.id)).toContain("grok-hosted");
      });
  });
