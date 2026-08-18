import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanonicalModelsWriteQueue, createPiHostBackend } from "../src/index.js";
import { projectPiAgentDir, projectPiSessionsDir } from "../src/project-pi-home.js";

describe("isolated project Pi homes", () => {
  let root = "";
  let backend: ReturnType<typeof createPiHostBackend> | undefined;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await backend?.close().catch(() => undefined);
    backend = undefined;
    if (!root) return;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    root = "";
  });

  it("batches saved paths deterministically after the App-profile initialization gate", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-model-gate-"));
    const host = join(root, "host-profile");
    const alpha = join(root, "alpha");
    const zeta = join(root, "zeta");
    await mkdir(host, { recursive: true });
    await mkdir(projectPiAgentDir(alpha), { recursive: true });
    await mkdir(projectPiAgentDir(zeta), { recursive: true });
    await writeFile(join(host, "pipiui-settings.json"), JSON.stringify({
      projectPathsVersion: 1,
      projectPathsCanonicalMigrationVersion: 1,
      projectPaths: [zeta, alpha],
    }));
    await writeFile(join(host, "models.json"), '{"providers":{}}');
    await writeFile(join(projectPiAgentDir(alpha), "models.json"), '{"winner":"alpha"}');
    await writeFile(join(projectPiAgentDir(zeta), "models.json"), '{"winner":"zeta"}');
    let release!: () => Promise<void>;
    const profileInitialization = new Promise<void>((resolve) => {
      release = async () => {
        await writeFile(join(host, "models.json"), '{"capabilityInstalled":true,"providers":{}}');
        resolve();
      };
    });
    backend = createPiHostBackend({
      agentDir: host,
      profileMode: "isolated",
      profileInitialization,
      canonicalProjectPaths: async () => undefined,
    });

    let listed = false;
    const listing = backend.handle("listProjects", []).then((value) => { listed = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listed).toBe(false);
    await release();
    await listing;
    expect(JSON.parse(await readFile(join(host, "models.json"), "utf8"))).toMatchObject({
      capabilityInstalled: true,
      winner: "alpha",
    });
    expect((await lstat(join(host, "models.json"))).mode & 0o777).toBe(0o600);
    expect((await lstat(join(projectPiAgentDir(alpha), "models.json"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(projectPiAgentDir(zeta), "models.json"))).isSymbolicLink()).toBe(true);
  });

  it("keeps project migration moving when the optional capability job fails", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-model-degrade-"));
    const host = join(root, "host-profile");
    const alpha = join(root, "alpha");
    await mkdir(host, { recursive: true });
    await mkdir(projectPiAgentDir(alpha), { recursive: true });
    await writeFile(join(host, "pipiui-settings.json"), JSON.stringify({
      projectPathsVersion: 1,
      projectPathsCanonicalMigrationVersion: 1,
      projectPaths: [alpha],
    }));
    await writeFile(join(host, "models.json"), '{"providers":{}}');
    await writeFile(join(projectPiAgentDir(alpha), "models.json"), '{"winner":"alpha"}');
    const profileInitialization = Promise.reject(new Error("capability exploded"));
    void profileInitialization.catch(() => undefined);
    backend = createPiHostBackend({
      agentDir: host,
      profileMode: "isolated",
      profileInitialization,
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("listProjects", []);
    expect(JSON.parse(await readFile(join(host, "models.json"), "utf8"))).toMatchObject({
      winner: "alpha",
    });
    expect((await lstat(join(projectPiAgentDir(alpha), "models.json"))).isSymbolicLink()).toBe(true);
  });

  it("exposes a migrated project provider on the first catalog read", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-model-catalog-"));
    const host = join(root, "host-profile");
    const project = join(root, "project");
    await mkdir(host, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(host, "pipiui-settings.json"), JSON.stringify({
      projectPathsVersion: 1,
      projectPathsCanonicalMigrationVersion: 1,
      projectPaths: [project],
    }));
    await writeFile(join(host, "models.json"), JSON.stringify({ providers: {} }));
    await writeFile(join(projectPiAgentDir(project), "models.json"), JSON.stringify({
      providers: {
        slab: {
          apiKey: "sk-project",
          models: [{ id: "only", name: "Only", reasoning: true }],
        },
      },
    }));
    backend = createPiHostBackend({
      agentDir: host,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => [],
        login: async () => undefined,
        logout: async () => undefined,
      },
    });
    const models = await backend.handle("listModels", []) as Array<{ provider: string; id: string }>;
    expect(models.map((model) => `${model.provider}/${model.id}`)).toContain("slab/only");
  });

  it("refreshes the catalog after adding a project with new providers", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-model-refresh-"));
    const host = join(root, "host-profile");
    const project = join(root, "project");
    await mkdir(host, { recursive: true });
    await mkdir(project, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(host, "models.json"), JSON.stringify({ providers: {} }));
    await writeFile(join(projectPiAgentDir(project), "models.json"), JSON.stringify({
      providers: {
        slab: {
          apiKey: "sk-project",
          models: [{ id: "only", name: "Only", reasoning: true }],
        },
      },
    }));
    backend = createPiHostBackend({
      agentDir: host,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => [],
        login: async () => undefined,
        logout: async () => undefined,
      },
    });
    const before = await backend.handle("listModels", []) as Array<{ provider: string; id: string }>;
    expect(before.map((model) => `${model.provider}/${model.id}`)).not.toContain("slab/only");
    await backend.handle("addProject", [project]);
    const after = await backend.handle("listModels", []) as Array<{ provider: string; id: string }>;
    expect(after.map((model) => `${model.provider}/${model.id}`)).toContain("slab/only");
  });

  it("writes new sessions and spawns Pi inside the opened project, not a shared host profile", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-isolation-"));
    const host = join(root, "host-profile");
    const project = join(root, "pipiui");
    const leftoverDir = join(root, "host-sessions", encodeURIComponent(project));
    await mkdir(project, { recursive: true });
    await mkdir(host, { recursive: true });
    await mkdir(leftoverDir, { recursive: true });
    await writeFile(join(host, "settings.json"), `${JSON.stringify({
      defaultProvider: "xai",
      packages: ["/Users/me/code/chatrpgv4"],
    })}\n`);
    await writeFile(join(host, "models.json"), '{"providers":{"xai":{"models":[{"id":"grok"}]}}}\n');
    await writeFile(join(host, "models-store.json"), '{"host":true}\n');
    await writeFile(join(host, "trust.json"), '{"trusted":true}\n');
    await writeFile(join(leftoverDir, "old.jsonl"), `${JSON.stringify({
      type: "session",
      version: 3,
      id: "legacy-host-session",
      timestamp: "2026-08-10T00:00:00.000Z",
      cwd: project,
    })}\n`);

    const captured: Array<{ env: NodeJS.ProcessEnv }> = [];
    backend = createPiHostBackend({
      agentDir: host,
      sessionsRoot: join(root, "host-sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      spawn: (_bin, _args, options) => {
        captured.push({ env: options.env });
        return spawn(
          process.execPath,
          [new URL("./fake-pi.mjs", import.meta.url).pathname],
          options,
        ) as any;
      },
    });

    const added = await backend.handle("addProject", [project]) as { id: string };
    const created = await backend.handle("newSession", [added.id, "Project local"]) as { id: string };
    const listed = await backend.handle("listSessions", [added.id]) as Array<{ id: string }>;
    expect(listed.map((session) => session.id).sort()).toEqual(["legacy-host-session", created.id].sort());

    const projectSessions = projectPiSessionsDir(project);
    const files = (await readdir(projectSessions)).filter((name) => name.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const firstLine = (await readFile(join(projectSessions, files[0]), "utf8")).split("\n")[0];
    expect(JSON.parse(firstLine)).toEqual(expect.objectContaining({ id: created.id, cwd: project }));

    const projectAgent = projectPiAgentDir(project);
    const projectSettings = JSON.parse(await readFile(join(projectAgent, "settings.json"), "utf8"));
    expect(projectSettings).not.toHaveProperty("packages");
    expect(await readlink(join(projectAgent, "models.json"))).toBe(join(await realpath(host), "models.json"));
    expect(await readFile(join(projectAgent, "models.json"), "utf8")).toContain('"grok"');
    expect((await lstat(join(projectAgent, "models-store.json"))).isFile()).toBe(true);
    await expect(readFile(join(projectAgent, "trust.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await backend.handle("sendPrompt", [created.id, "go"]);
    const env = captured.find((item) => item.env.PIPIUI_SESSION_KEY === created.id)?.env ?? captured.at(-1)?.env;
    const realProject = await realpath(project);
    expect(env?.PI_CODING_AGENT_DIR).toBe(join(realProject, ".pi", "agent"));
    expect(env?.PI_CODING_AGENT_SESSION_DIR).toBe(join(realProject, ".pi", "agent", "sessions"));
    expect(env?.PI_CODING_AGENT_DIR).not.toBe(host);
  });

  it("keeps the ensured real project home after the projectRoot alias is retargeted", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-alias-home-"));
    const host = join(root, "host-profile");
    const realProject = join(root, "real-project");
    const otherProject = join(root, "other-project");
    const alias = join(root, "alias-project");
    await mkdir(realProject, { recursive: true });
    await mkdir(otherProject, { recursive: true });
    await mkdir(host, { recursive: true });
    await symlink(realProject, alias);
    await writeFile(join(otherProject, "SENTINEL"), "external-sentinel\n");
    const captured: Array<{ env: NodeJS.ProcessEnv; cwd?: string }> = [];
    const revealed: string[] = [];
    backend = createPiHostBackend({
      agentDir: host,
      sessionsRoot: join(root, "host-sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      revealPath: async (path) => {
        revealed.push(path);
      },
      spawn: (_bin, _args, options) => {
        captured.push({ env: options.env, cwd: options.cwd });
        return spawn(
          process.execPath,
          [new URL("./fake-pi.mjs", import.meta.url).pathname],
          options,
        ) as any;
      },
    });

    const added = await backend.handle("addProject", [alias]) as { id: string };
    await mkdir(join(realProject, ".pi"), { recursive: true });
    await writeFile(join(realProject, ".pi", "mcp.json"), JSON.stringify({
      mcpServers: { local: { command: "true" } },
    }));
    await rm(alias);
    await symlink(otherProject, alias);

    const created = await backend.handle("newSession", [added.id, "Keep real"]) as { id: string };
    const listed = await backend.handle("listSessions", [added.id]) as Array<{ id: string }>;
    expect(listed.map((session) => session.id)).toEqual([created.id]);

    const realRoot = await realpath(realProject);
    const realSessions = join(realRoot, ".pi", "agent", "sessions");
    const files = (await readdir(realSessions)).filter((name) => name.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    expect(JSON.parse((await readFile(join(realSessions, files[0]), "utf8")).split("\n")[0])).toEqual(
      expect.objectContaining({ id: created.id, cwd: alias }),
    );
    await expect(readdir(join(otherProject, ".pi", "agent", "sessions"))).rejects.toMatchObject({ code: "ENOENT" });

    await backend.handle("setFirecrawlPdfApiKey", [added.id, "fc-test-key"]);
    expect(await readFile(join(realRoot, ".pi", "agent", "web-search.json"), "utf8")).toContain("fc-test-key");
    await expect(readFile(join(otherProject, ".pi", "agent", "web-search.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(otherProject, "SENTINEL"), "utf8")).toBe("external-sentinel\n");

    await backend.handle("revealProject", [added.id]);
    expect(revealed).toEqual([realRoot]);
    const mcp = await backend.handle("listUserMcpServers", [added.id]) as Array<{ name: string }>;
    expect(mcp.map((server) => server.name)).toEqual(["local"]);

    await backend.handle("sendPrompt", [created.id, "go"]);
    const spawned = captured.find((item) => item.env.PIPIUI_SESSION_KEY === created.id) ?? captured.at(-1);
    expect(spawned?.cwd).toBe(realRoot);
    expect(spawned?.env.PI_CODING_AGENT_DIR).toBe(join(realRoot, ".pi", "agent"));
    expect(spawned?.env.PI_CODING_AGENT_SESSION_DIR).toBe(realSessions);
    expect(spawned?.env.PI_CODING_AGENT_DIR).not.toBe(join(otherProject, ".pi", "agent"));
    expect(await readFile(join(otherProject, "SENTINEL"), "utf8")).toBe("external-sentinel\n");
  });

  it("serializes canonical models writers, keeps fields, and recovers after a failed job", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-models-write-queue-"));
    const host = join(root, "host-profile");
    const project = join(root, "proj");
    await mkdir(host, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(host, "pipiui-settings.json"), JSON.stringify({
      projectPathsVersion: 1,
      projectPathsCanonicalMigrationVersion: 1,
      projectPaths: [],
    }));
    await writeFile(join(host, "models.json"), JSON.stringify({
      keep: "canonical",
      providers: {
        existing: {
          api: "openai-completions",
          baseUrl: "https://probe.example/v1",
          apiKey: "sk-existing",
          models: [{ id: "already", name: "already", reasoning: true }],
        },
      },
    }));
    await writeFile(join(projectPiAgentDir(project), "models.json"), JSON.stringify({
      winner: "project",
      providers: {},
    }));

    const queue = createCanonicalModelsWriteQueue();
    const seen: string[] = [];
    await Promise.all([
      queue.enqueue(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        seen.push("first");
      }),
      queue.enqueue(async () => {
        seen.push("second");
      }),
    ]);
    expect(seen).toEqual(["first", "second"]);
    await expect(queue.enqueue(async () => {
      throw new Error("injected writer failure");
    })).rejects.toThrow("injected writer failure");

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("probe.example")) {
        return { ok: true, json: async () => ({ data: [{ id: "already", context_length: 111 }] }) };
      }
      if (href.includes("proxy.example")) {
        return { ok: true, json: async () => ({ data: [{ id: "gpt-4o-mini", context_length: 222 }] }) };
      }
      return { ok: false, json: async () => ({}) };
    }));

    backend = createPiHostBackend({
      agentDir: host,
      profileMode: "isolated",
      canonicalModelsWrite: queue,
      canonicalProjectPaths: async () => undefined,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => [],
        login: async () => undefined,
        logout: async () => undefined,
      },
    });

    await Promise.all([
      backend.handle("addProject", [project]),
      backend.handle("addOpenAICompatibleProvider", [{
        name: "My Proxy",
        baseUrl: "https://proxy.example/v1",
        apiKey: "sk-literal",
        modelId: "gpt-4o-mini",
      }]),
    ]);
    await backend.compatContextBackfill;

    const disk = JSON.parse(await readFile(join(host, "models.json"), "utf8"));
    expect(disk.keep).toBe("canonical");
    expect(disk.winner).toBe("project");
    expect(disk.providers.existing.models[0]).toMatchObject({ id: "already", contextWindow: 111 });
    expect(disk.providers["my-proxy"]).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://proxy.example/v1",
      models: [expect.objectContaining({ id: "gpt-4o-mini", contextWindow: 222 })],
    });
    expect((await lstat(join(host, "models.json"))).mode & 0o777).toBe(0o600);
  });
});
