import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";

describe("listSessions session model metadata", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  // Canonical project source pinned to undefined + explicit setProjectPaths so
  // the test never picks up a real machine's Swift plist project list.
  it("reads the latest model_change entry from the session JSONL", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-model-"));
    const projectCwd = join(root, "project");
    const dir = join(root, "sessions", "--project--");
    await mkdir(dir, { recursive: true });
    const rows = [
      { type: "session", version: 3, id: "model-session", timestamp: "2026-08-10T00:00:00.000Z", cwd: projectCwd },
      { type: "model_change", id: "m1", parentId: null, timestamp: "2026-08-10T00:00:05.000Z", provider: "anthropic", modelId: "claude-sonnet-4" },
      { type: "model_change", id: "m2", parentId: "m1", timestamp: "2026-08-10T00:00:06.000Z", provider: "openai", modelId: "gpt-5" }
    ];
    await writeFile(join(dir, "model-session.jsonl"), rows.map(JSON.stringify).join("\n") + "\n");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("setProjectPaths", [[projectCwd]]);
    const [project] = await backend.handle("listProjects", []) as any[];
    const [session] = await backend.handle("listSessions", [project.id]) as any[];
    expect(session.id).toBe("model-session");
    // The latest model_change wins (pi persists every model switch as an entry).
    expect(session.model).toEqual({ provider: "openai", modelId: "gpt-5" });
  });

  it("returns null model for a session with no model_change entries", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-nomodel-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "--project--");
    await mkdir(dir, { recursive: true });
    const rows = [
      { type: "session", version: 3, id: "plain", timestamp: "2026-08-10T00:00:00.000Z", cwd },
      { type: "message", id: "u1", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "hello" } }
    ];
    await writeFile(join(dir, "plain.jsonl"), rows.map(JSON.stringify).join("\n") + "\n");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("setProjectPaths", [[cwd]]);
    const [project] = await backend.handle("listProjects", []) as any[];
    const [session] = await backend.handle("listSessions", [project.id]) as any[];
    expect(session.model).toBeNull();
  });

  it("cold-start getModelState restores the session JSONL model; only sessions without a model record inherit the global default", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-coldrestore-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "--project--");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "relay", defaultModel: "fast", defaultThinkingLevel: "medium" }));
    await writeFile(join(agent, "models.json"), JSON.stringify({ providers: { relay: { apiKey: "$RELAY_KEY", models: [{ id: "fast", name: "Fast", reasoning: true }, { id: "cheap", name: "Cheap", reasoning: true }] } } }));
    // Cold session carrying its own model_change (per-session binding).
    await writeFile(join(dir, "bound.jsonl"), JSON.stringify({ type: "session", version: 3, id: "bound", timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n" +
      JSON.stringify({ type: "model_change", id: "m1", parentId: null, timestamp: "2026-08-10T00:00:05.000Z", provider: "relay", modelId: "cheap" }) + "\n");
    // Fresh session with no model record → the global default applies.
    await writeFile(join(dir, "plain.jsonl"), JSON.stringify({ type: "session", version: 3, id: "plain", timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      env: { RELAY_KEY: "present" },
      piPath: "node",
      spawn: (_bin: any, _args: any, options: any) => spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } }) as any,
      authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
    });
    // A cold read restores the session's own JSONL model from metadata, never the default, and does not spawn Pi.
    const bound = await backend.handle("getModelState", ["bound"]) as any;
    expect(bound.model).toMatchObject({ provider: "relay", id: "cheap" });
    expect(bound.model.name).toBe("Cheap");
    // A session with no model record inherits the configured default.
    const plain = await backend.handle("getModelState", ["plain"]) as any;
    expect(plain.model).toMatchObject({ provider: "relay", id: "fast" });
    // Switching bound to a different model keeps it per-session: plain stays default.
    await backend.handle("setModel", ["bound", "relay", "fast"]);
    expect((await backend.handle("getModelState", ["bound"]))).toMatchObject({ model: { provider: "relay", id: "fast" } });
    expect((await backend.handle("getModelState", ["plain"]))).toMatchObject({ model: { provider: "relay", id: "fast" } });
  });

  it("does not spawn Pi when switching the model of a cold session", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-cold-setmodel-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "--project--");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "relay", defaultModel: "cheap" }));
    await writeFile(join(agent, "models.json"), JSON.stringify({ providers: { relay: { apiKey: "$RELAY_KEY", models: [{ id: "fast", name: "Fast", reasoning: true }, { id: "cheap", name: "Cheap", reasoning: true }] } } }));
    await writeFile(join(dir, "bound.jsonl"), JSON.stringify({ type: "session", version: 3, id: "bound", timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
    const spawnSpy = vi.fn((_bin: any, _args: any, options: any) =>
      spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } }) as any,
    );
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      env: { RELAY_KEY: "present" },
      piPath: "node",
      spawn: spawnSpy,
      authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
    });
    await backend.handle("setProjectPaths", [[cwd]]);
    const state = await backend.handle("setModel", ["bound", "relay", "fast"]) as any;
    expect(spawnSpy).toHaveBeenCalledTimes(0);
    expect(state.model).toMatchObject({ provider: "relay", id: "fast", name: "Fast" });
    expect(await backend.handle("getModelState", ["bound"])).toMatchObject({ model: { provider: "relay", id: "fast" } });
    const jsonl = await readFile(join(dir, "bound.jsonl"), "utf8");
    expect(jsonl).toContain('"type":"model_change"');
    expect(jsonl).toContain('"modelId":"fast"');
    await backend.close();
  });
});

describe("remembered manual model selection", () => {
  let root = "";
  const backends: ReturnType<typeof createPiHostBackend>[] = [];

  afterEach(async () => {
    await Promise.all(backends.map((backend) => backend.close().catch(() => undefined)));
    backends.length = 0;
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("uses manually selected A for new sessions after viewing B, persists it, and preserves unrelated settings", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-remembered-model-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(agent, "settings.json"), JSON.stringify({
      defaultProvider: "relay",
      defaultModel: "fallback",
      defaultThinkingLevel: "medium",
    }));
    await writeFile(join(agent, "models.json"), JSON.stringify({
      providers: {
        relay: {
          apiKey: "$RELAY_KEY",
          models: [
            { id: "fallback", name: "Fallback", reasoning: true },
            { id: "model-a", name: "Model A", reasoning: true },
            { id: "model-b", name: "Model B", reasoning: true },
          ],
        },
      },
    }));
    await writeFile(join(agent, "pipiui-settings.json"), JSON.stringify({
      hiddenModelIds: ["relay/hidden"],
      futureField: { keep: true },
    }));
    await writeFile(
      join(dir, "session-1.jsonl"),
      JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-11T00:00:00.000Z", cwd }) + "\n",
    );
    await writeFile(
      join(dir, "session-2.jsonl"),
      JSON.stringify({ type: "session", version: 3, id: "session-2", timestamp: "2026-08-11T00:00:00.000Z", cwd }) + "\n" +
        JSON.stringify({ type: "model_change", id: "m2", parentId: null, timestamp: "2026-08-11T00:00:01.000Z", provider: "relay", modelId: "model-b" }) + "\n",
    );

    const makeBackend = () => {
      const backend = createPiHostBackend({
        agentDir: agent,
        sessionsRoot: join(root, "sessions"),
        runtimeRoot: join(root, "runtime"),
        canonicalProjectPaths: async () => undefined,
        env: { RELAY_KEY: "present" },
        piPath: "node",
        spawn: (_bin: any, _args: any, options: any) => spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } }) as any,
        authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
      });
      backends.push(backend);
      return backend;
    };

    const first = makeBackend();
    await first.handle("setProjectPaths", [[cwd]]);
    const [project] = await first.handle("listProjects", []) as any[];

    // Explicit user action: session 1 selects A.
    await first.handle("setModel", ["session-1", "relay", "model-a"]);
    // Navigation only: session 2 is already bound to B and must not replace A.
    expect(await first.handle("getModelState", ["session-2"])).toMatchObject({
      model: { provider: "relay", id: "model-b" },
    });

    const session3 = await first.handle("newSession", [project.id, "Session 3"]) as any;
    expect(await first.handle("getModelState", [session3.id])).toMatchObject({
      model: { provider: "relay", id: "model-a" },
    });
    expect(JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"))).toMatchObject({
      manualModelSelection: { provider: "relay", modelId: "model-a" },
      hiddenModelIds: ["relay/hidden"],
      futureField: { keep: true },
    });

    await first.close();
    backends.splice(backends.indexOf(first), 1);

    // A fresh host must restore A as the new-session default from disk.
    const fresh = makeBackend();
    const session4 = await fresh.handle("newSession", [project.id, "Session 4"]) as any;
    expect(await fresh.handle("getModelState", [session4.id])).toMatchObject({
      model: { provider: "relay", id: "model-a" },
    });
  });

  it("falls back to the configured default when the remembered model is unavailable", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-unavailable-remembered-model-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(agent, "settings.json"), JSON.stringify({
      defaultProvider: "relay",
      defaultModel: "configured-default",
    }));
    await writeFile(join(agent, "models.json"), JSON.stringify({
      providers: {
        relay: {
          apiKey: "$RELAY_KEY",
          models: [
            { id: "catalog-first", name: "Catalog First", reasoning: true },
            { id: "configured-default", name: "Configured Default", reasoning: true },
          ],
        },
      },
    }));
    await writeFile(join(agent, "pipiui-settings.json"), JSON.stringify({
      manualModelSelection: { provider: "relay", modelId: "no-longer-available" },
    }));
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      env: { RELAY_KEY: "present" },
      piPath: "node",
      spawn: (_bin: any, _args: any, options: any) => spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } }) as any,
      authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
    });
    backends.push(backend);
    await backend.handle("setProjectPaths", [[cwd]]);
    const [project] = await backend.handle("listProjects", []) as any[];
    const session = await backend.handle("newSession", [project.id]) as any;

    expect(await backend.handle("getModelState", [session.id])).toMatchObject({
      model: { provider: "relay", id: "configured-default" },
    });
  });
});

describe("remembered manual thinking level", () => {
  let root = "";
  const backends: ReturnType<typeof createPiHostBackend>[] = [];

  afterEach(async () => {
    await Promise.all(backends.map((backend) => backend.close().catch(() => undefined)));
    backends.length = 0;
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("uses the last chosen thinking档 for new sessions after viewing another session, persists it, and keeps old sessions", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-remembered-thinking-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(agent, "settings.json"), JSON.stringify({
      defaultProvider: "relay",
      defaultModel: "model-a",
      defaultThinkingLevel: "medium",
    }));
    await writeFile(join(agent, "models.json"), JSON.stringify({
      providers: {
        relay: {
          apiKey: "$RELAY_KEY",
          models: [
            { id: "model-a", name: "Model A", reasoning: true },
            { id: "model-b", name: "Model B", reasoning: true },
          ],
        },
      },
    }));
    await writeFile(join(agent, "pipiui-settings.json"), JSON.stringify({
      hiddenModelIds: ["relay/hidden"],
      futureField: { keep: true },
    }));
    await writeFile(
      join(dir, "session-1.jsonl"),
      JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-11T00:00:00.000Z", cwd }) + "\n",
    );
    await writeFile(
      join(dir, "session-2.jsonl"),
      JSON.stringify({ type: "session", version: 3, id: "session-2", timestamp: "2026-08-11T00:00:00.000Z", cwd }) + "\n" +
        JSON.stringify({ type: "thinking_level_change", id: "t2", parentId: null, timestamp: "2026-08-11T00:00:01.000Z", thinkingLevel: "low" }) + "\n",
    );

    const makeBackend = () => {
      const backend = createPiHostBackend({
        agentDir: agent,
        sessionsRoot: join(root, "sessions"),
        runtimeRoot: join(root, "runtime"),
        canonicalProjectPaths: async () => undefined,
        env: { RELAY_KEY: "present" },
        piPath: "node",
        spawn: (_bin: any, _args: any, options: any) => spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } }) as any,
        authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
      });
      backends.push(backend);
      return backend;
    };

    const first = makeBackend();
    await first.handle("setProjectPaths", [[cwd]]);
    const [project] = await first.handle("listProjects", []) as any[];

    await first.handle("setThinkingLevel", ["session-1", "high"]);
    expect(await first.handle("getModelState", ["session-2"])).toMatchObject({
      thinkingLevel: "low",
    });

    const session3 = await first.handle("newSession", [project.id, "Session 3"]) as any;
    expect(await first.handle("getModelState", [session3.id])).toMatchObject({
      thinkingLevel: "high",
    });
    expect(JSON.parse(await readFile(join(agent, "pipiui-settings.json"), "utf8"))).toMatchObject({
      manualThinkingLevel: "high",
      hiddenModelIds: ["relay/hidden"],
      futureField: { keep: true },
    });

    await first.close();
    backends.splice(backends.indexOf(first), 1);

    const fresh = makeBackend();
    const session4 = await fresh.handle("newSession", [project.id, "Session 4"]) as any;
    expect(await fresh.handle("getModelState", [session4.id])).toMatchObject({
      thinkingLevel: "high",
    });
    expect(await fresh.handle("getModelState", [session3.id])).toMatchObject({
      thinkingLevel: "high",
    });
    expect(await fresh.handle("getModelState", ["session-2"])).toMatchObject({
      thinkingLevel: "low",
    });
  });

  it("clamps a remembered thinking档 to the new session model's available levels", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-unavailable-remembered-thinking-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(agent, "settings.json"), JSON.stringify({
      defaultProvider: "relay",
      defaultModel: "narrow",
      defaultThinkingLevel: "medium",
    }));
    await writeFile(join(agent, "models.json"), JSON.stringify({
      providers: {
        relay: {
          apiKey: "$RELAY_KEY",
          models: [
            {
              id: "narrow",
              name: "Narrow",
              reasoning: true,
              thinkingLevelMap: { off: null, low: "low", medium: "medium" },
            },
          ],
        },
      },
    }));
    await writeFile(join(agent, "pipiui-settings.json"), JSON.stringify({
      manualThinkingLevel: "xhigh",
    }));
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      env: { RELAY_KEY: "present" },
      piPath: "node",
      spawn: (_bin: any, _args: any, options: any) => spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } }) as any,
      authRuntime: { getProviders: async () => [], getAvailable: async () => [], login: async () => undefined, logout: async () => undefined },
    });
    backends.push(backend);
    await backend.handle("setProjectPaths", [[cwd]]);
    const [project] = await backend.handle("listProjects", []) as any[];
    const session = await backend.handle("newSession", [project.id]) as any;

    expect(await backend.handle("getModelState", [session.id])).toMatchObject({
      thinkingLevel: "medium",
      availableThinkingLevels: ["low", "medium"],
    });
  });
});

describe("session model recovery after Pi exits", () => {
  let root = "";
  let backend: ReturnType<typeof createPiHostBackend> | undefined;

  afterEach(async () => {
    await backend?.close().catch(() => undefined);
    backend = undefined;
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function makeBackend(exitPolicy: (spawnIndex: number) => boolean) {
    root = await mkdtemp(join(tmpdir(), "pipi-model-exit-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "--project--");
    await mkdir(cwd, { recursive: true });
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "session.jsonl"),
      JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-11T00:00:00.000Z", cwd }) + "\n",
    );
    let spawnCount = 0;
    backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      piPath: process.execPath,
      spawn: (_bin: any, _args: any, options: any) => {
        spawnCount += 1;
        return spawn(process.execPath, [new URL("./fake-pi-model-exit.mjs", import.meta.url).pathname], {
          ...options,
          env: {
            ...options.env,
            PIPIUI_TEST_EXIT_ON_SET_MODEL: exitPolicy(spawnCount) ? "1" : "0",
          },
        }) as any;
      },
    });
    await (backend as any).ensure("session-1");
    return { backend, spawnCount: () => spawnCount };
  }

  it("re-establishes the session once when Pi exits during setModel", async () => {
    const fixture = await makeBackend((spawnIndex) => spawnIndex === 1);

    const state = await fixture.backend.handle("setModel", ["session-1", "relay", "recovered"]);

    expect(state).toMatchObject({ model: { provider: "relay", id: "recovered" } });
    expect(fixture.spawnCount()).toBe(2);
  });

  it("reports code and drained stderr after the single recovery attempt also exits", async () => {
    const fixture = await makeBackend(() => true);

    await expect(
      fixture.backend.handle("setModel", ["session-1", "relay", "still-broken"]),
    ).rejects.toThrow(/pi exited \(code 23\).*model runtime was replaced/s);
    expect(fixture.spawnCount()).toBe(2);
  });
});
