import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The worker half of prompt observability.
 *
 * A dispatched worker is a separate pi process whose argv the subagent builds itself, so it
 * is the half where the base prompt or a philosophy layer can go missing without anything
 * saying so — and the half `pipiui-runtime-info` cannot cover, because that extension
 * registers a tool and a worker's tool set is a curated allowlist.
 */
const EXTENSION = "../../../resources/runtime/extensions/pipiui-prompt-observer.ts";

type Handler = (event: any, ctx: any) => unknown;

async function loadObserver(env: Record<string, string | undefined>) {
  vi.resetModules();
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerTool: vi.fn(),
  };
  const module = await import(EXTENSION);
  module.default(pi as never);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return { pi, handlers };
}

const ctx = { model: { provider: "anthropic", id: "claude-opus-5" } };
const BASE = "<!-- pipiui-system-base v2 -->\nbase";
const PHILOSOPHY = "<!-- pipi-philosophy -->\nlayers";

function outputFile() {
  return join(mkdtempSync(join(tmpdir(), "pipiui-prompt-obs-")), "nested", "quota-pill.run-1.json");
}

describe("worker prompt observer", () => {
  it("registers no tool — a worker's allowlist is not a debugging surface", async () => {
    const { pi } = await loadObserver({ PIPIUI_PROMPT_DEBUG_FILE: outputFile() });
    expect(pi.registerTool).not.toHaveBeenCalled();
  });

  it("records the worker's assembled prompt with its identity", async () => {
    const file = outputFile();
    const { handlers } = await loadObserver({
      PIPIUI_PROMPT_DEBUG_FILE: file,
      PIPI_PHILOSOPHY_AGENT: "general-purpose",
      PIPIUI_AGENT_ID: "quota-pill",
      PIPIUI_AGENT_DEPTH: "1",
    });
    await handlers.get("before_agent_start")![0]({ systemPrompt: `frame\n${BASE}\n${PHILOSOPHY}` }, ctx);

    const record = JSON.parse(readFileSync(file, "utf8"));
    expect(record).toMatchObject({
      version: 1,
      role: "worker",
      agent: "general-purpose",
      agentId: "quota-pill",
      depth: 1,
      model: "anthropic/claude-opus-5",
    });
    // The question this exists to answer: did the locked base reach this worker?
    expect(record.systemPrompt.segments.map((s: any) => s.id)).toEqual([
      "pi-frame",
      "pipiui-base",
      "philosophy",
    ]);
  });

  it("shows a worker that never received the base as a missing segment, not as silence", async () => {
    const file = outputFile();
    const { handlers } = await loadObserver({ PIPIUI_PROMPT_DEBUG_FILE: file });
    await handlers.get("before_agent_start")![0]({ systemPrompt: `frame\n${PHILOSOPHY}` }, ctx);

    const record = JSON.parse(readFileSync(file, "utf8"));
    expect(record.systemPrompt.segments.map((s: any) => s.id)).not.toContain("pipiui-base");
  });

  it("does nothing at all when the dispatcher gave it no output file", async () => {
    const { pi } = await loadObserver({ PIPIUI_PROMPT_DEBUG_FILE: undefined });
    expect(pi.on).not.toHaveBeenCalled();
  });

  it("rewrites only when the composition actually changed", async () => {
    const file = outputFile();
    const { handlers } = await loadObserver({ PIPIUI_PROMPT_DEBUG_FILE: file });
    const handler = handlers.get("before_agent_start")![0];

    await handler({ systemPrompt: `frame\n${BASE}` }, ctx);
    const first = JSON.parse(readFileSync(file, "utf8")).capturedAt;
    await handler({ systemPrompt: `frame\n${BASE}` }, ctx);
    expect(JSON.parse(readFileSync(file, "utf8")).capturedAt).toBe(first);

    await handler({ systemPrompt: `frame\n${BASE}\n${PHILOSOPHY}` }, ctx);
    const changed = JSON.parse(readFileSync(file, "utf8"));
    expect(changed.systemPrompt.segments.map((s: any) => s.id)).toContain("philosophy");
  });

  it("survives an unwritable destination rather than taking the dispatch down", async () => {
    const { handlers } = await loadObserver({ PIPIUI_PROMPT_DEBUG_FILE: "/proc/nope/report.json" });
    expect(() => handlers.get("before_agent_start")![0]({ systemPrompt: BASE }, ctx)).not.toThrow();
  });

  it("keeps the report directory bounded and never sweeps the run it just wrote", async () => {
    const file = outputFile();
    const { handlers } = await loadObserver({ PIPIUI_PROMPT_DEBUG_FILE: file });
    await handlers.get("before_agent_start")![0]({ systemPrompt: BASE }, ctx);

    const dir = join(file, "..");
    for (let i = 0; i < 260; i += 1) writeFileSync(join(dir, `old-${i}.json`), "{}", "utf8");
    await handlers.get("before_agent_start")![0]({ systemPrompt: `${BASE}\n${PHILOSOPHY}` }, ctx);

    const remaining = readdirSync(dir).filter((name) => name.endsWith(".json"));
    expect(remaining.length).toBeLessThanOrEqual(200);
    expect(remaining).toContain("quota-pill.run-1.json");
  });
});
