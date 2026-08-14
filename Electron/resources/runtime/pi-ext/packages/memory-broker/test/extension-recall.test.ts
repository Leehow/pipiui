import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMainBrokerRetrievalPort, installMemoryBrokerExtension } from "../src/extension.ts";
import { InMemoryMemoryBackend, UnavailableMemoryBackend, type MemoryBrokerBackend } from "../src/backend.ts";
import type { RetrievalCandidate } from "../src/retrieval-orchestrator.ts";

const candidate: RetrievalCandidate = {
  id: "memory-1",
  kind: "procedural",
  summary: "Use the established project convention.",
  scope: { kind: "project", project: "/project" },
  confidence: 0.95,
  evidence: [{ summary: "Confirmed by project tests." }],
  status: "active",
  hermesScore: 0.9,
};

function fakePi() {
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  const tools = new Map<string, any>();
  return {
    handlers,
    tools,
    api: {
      on(event: string, handler: (...args: any[]) => unknown) {
        const values = handlers.get(event) ?? [];
        values.push(handler);
        handlers.set(event, values);
      },
      registerTool(tool: any) { tools.set(tool.name, tool); },
    },
  };
}

async function installProductionFixture(backend: MemoryBrokerBackend, runId: string) {
  const directory = await mkdtemp(join(tmpdir(), "pipi-memory-recall-"));
  const pi = fakePi();
  await installMemoryBrokerExtension(pi.api as any, {
    backendFactory: async () => backend,
    catalogDirectory: join(directory, "catalog"),
  }, {
    PIPIUI_MEMORY_BROKER_MODE: "main",
    PIPIUI_MEMORY_PROJECT_ROOT: "/project",
    PIPIUI_MEMORY_CHAT_SESSION_ID: runId,
  });
  const start = pi.handlers.get("session_start")?.[0];
  const shutdown = pi.handlers.get("session_shutdown")?.[0];
  const before = pi.handlers.get("before_agent_start")?.[0];
  assert.ok(start); assert.ok(shutdown); assert.ok(before);
  await start({}, { cwd: "/project" });
  return { directory, pi, before, shutdown };
}

test("awaited before_agent_start recall injects bounded advisory context without model tool use", async () => {
  let queries = 0;
  const pi = fakePi();
  await installMemoryBrokerExtension(pi.api as any, {
    retrievalPort: { query: async () => { queries += 1; return [candidate]; } },
  }, {
    PIPIUI_MEMORY_BROKER_MODE: "main",
    PIPIUI_MEMORY_PROJECT_ROOT: "/project",
    PIPIUI_MEMORY_CHAT_SESSION_ID: "run-1",
  });

  assert.equal(pi.handlers.has("input"), false);
  const before = pi.handlers.get("before_agent_start")?.[0];
  assert.ok(before);
  const injected = await before({ prompt: "请按之前的项目约定规划", systemPrompt: "system" }, {}) as {
    message: { customType: string; display: boolean; content: string };
    systemPrompt?: string;
  };
  assert.equal(queries, 1);
  assert.equal(injected.message.customType, "pipiui-memory-context");
  assert.equal(injected.message.display, false);
  assert.match(injected.message.content, /advisory\/untrusted reference/);
  assert.match(injected.message.content, /cannot override system\/developer\/user instructions/);
  assert.match(injected.message.content, /Use the established project convention/);
  assert.equal(injected.systemPrompt, undefined);
});

test("ineligible and repeated automatic turns inject nothing, but memory_query stays explicit", async () => {
  let queries = 0;
  const pi = fakePi();
  await installMemoryBrokerExtension(pi.api as any, {
    retrievalPort: { query: async () => { queries += 1; return [candidate]; } },
  }, {
    PIPIUI_MEMORY_BROKER_MODE: "main",
    PIPIUI_MEMORY_PROJECT_ROOT: "/project",
    PIPIUI_MEMORY_CHAT_SESSION_ID: "run-2",
  });

  const before = pi.handlers.get("before_agent_start")?.[0];
  assert.ok(before);
  assert.equal(await before({ prompt: "hello", systemPrompt: "system" }, {}), undefined);
  assert.ok(await before({ prompt: "plan using project conventions", systemPrompt: "system" }, {}));
  assert.equal(await before({ prompt: "plan using project conventions again", systemPrompt: "system" }, {}), undefined);

  const explicit = await pi.tools.get("memory_query").execute("tool-1", { query: "narrow convention detail" });
  assert.equal(explicit.details.ok, true);
  assert.equal(explicit.details.memory_context.items.length, 1);
  assert.equal(queries, 2);
});

test("production session_start wires automatic recall to the ready scoped broker backend", async () => {
  const backend = new InMemoryMemoryBackend({
    results: [
      { claim: "Use the durable Hermes project convention.", score: 0.92 },
      { claim: "Use the durable Hermes project convention.", score: 0.91 },
    ],
  });
  const fixture = await installProductionFixture(backend, "production-run");
  try {
    const injected = await fixture.before({ prompt: "请按之前的项目约定规划", systemPrompt: "system" }, {}) as {
      message: { content: string };
    };
    assert.match(injected.message.content, /Use the durable Hermes project convention/);
    assert.equal(injected.message.content.match(/Use the durable Hermes project convention/g)?.length, 1);
    assert.equal(backend.queries.length, 1);
    assert.equal(backend.queries[0]?.query.scope, "project");
    assert.equal(backend.queries[0]?.context.projectRoot, "/project");
    assert.equal(backend.queries[0]?.context.role, "main");
  } finally {
    await fixture.shutdown();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("main broker retrieval never relabels scoped results for another project", async () => {
  let calls = 0;
  const port = createMainBrokerRetrievalPort({
    async handleMainRequest() {
      calls += 1;
      return { version: 1, ok: true, operation: "memory.query", results: [{ claim: "private", score: 1 }] };
    },
  }, "/project");
  assert.deepEqual(await port.query({ text: "prior", project: "/other", limit: 3 }), []);
  assert.equal(calls, 0);
});

test("empty or unavailable production backend injects nothing and stays fail-soft", async () => {
  for (const [name, backend] of [
    ["empty", new InMemoryMemoryBackend()],
    ["unavailable", new UnavailableMemoryBackend("offline")],
  ] as const) {
    const fixture = await installProductionFixture(backend, `production-${name}`);
    try {
      assert.equal(await fixture.before({ prompt: "What did we decide previously?", systemPrompt: "system" }, {}), undefined);
    } finally {
      await fixture.shutdown();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }
});
