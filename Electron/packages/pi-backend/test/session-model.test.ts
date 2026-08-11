import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";

describe("listSessions session model metadata", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
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

  it("cold-start ensure() restores the session JSONL model; only sessions without a model record inherit the global default", async () => {
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
    // A cold spawn restores the session's own JSONL model, never the default.
    const bound = await backend.handle("getModelState", ["bound"]) as any;
    expect(bound.model).toMatchObject({ provider: "relay", id: "cheap" });
    // fake-pi echoes the modelId as its name after set_model (real pi returns the catalog name).
    expect(bound.model.name).toBe("cheap");
    // A session with no model record inherits the configured default.
    const plain = await backend.handle("getModelState", ["plain"]) as any;
    expect(plain.model).toMatchObject({ provider: "relay", id: "fast" });
    // Switching bound to a different model keeps it per-session: plain stays default.
    await backend.handle("setModel", ["bound", "relay", "fast"]);
    expect((await backend.handle("getModelState", ["bound"]))).toMatchObject({ model: { provider: "relay", id: "fast" } });
    expect((await backend.handle("getModelState", ["plain"]))).toMatchObject({ model: { provider: "relay", id: "fast" } });
  });
});
