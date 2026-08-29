import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateExtensionManifest } from "../src/extension-manifest.js";
import {
  assemblePiSpawn,
  MEMORY_EXTENSION_ID,
  MOUNTED_EXTENSIONS_ENV,
  REGISTERED_EXTENSION_PATHS_ENV,
  resolveSpawnPaths,
  workerRegisteredExtensionArgs,
} from "../src/spawn-assembly.js";

const runtimeSource = new URL("../../../resources/runtime", import.meta.url).pathname;
const extensionRoot = join(runtimeSource, "extensions", MEMORY_EXTENSION_ID);
const extensionEntry = join(extensionRoot, "agent", "memory-broker-extension.ts");
const brokerRoot = join(runtimeSource, "pi-ext", "packages", "memory-broker");
const brokerBackendModule = new URL(
  "../../../resources/runtime/pi-ext/packages/memory-broker/src/backend.ts",
  import.meta.url,
).href;
const brokerCatalogModule = new URL(
  "../../../resources/runtime/pi-ext/packages/memory-broker/src/memory-catalog.ts",
  import.meta.url,
).href;
const contractModule = new URL(
  "../../../resources/runtime/pi-ext/packages/memory-broker/vendor/pipiui-memory-broker-contract/contract/index.ts",
  import.meta.url,
).href;

/** Mirrors the memory-broker extension-recall harness: one pi runtime per install. */
function fakePi() {
  const handlers = new Map<string, Array<(...args: any[]) => unknown>>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  return {
    handlers,
    tools,
    commands,
    api: {
      on(event: string, handler: (...args: any[]) => unknown) {
        const values = handlers.get(event) ?? [];
        values.push(handler);
        handlers.set(event, values);
      },
      registerTool(tool: any) {
        tools.set(tool.name, tool);
      },
      registerCommand(name: string, command: any) {
        commands.set(name, command);
      },
    },
  };
}

async function installMainBroker(options: Record<string, unknown>, env: Record<string, string>) {
  const pi = fakePi();
  const mod = await import(extensionEntry);
  await mod.installMemoryBrokerExtension(pi.api, options, env);
  return pi;
}

/** macOS `/tmp` is an alias: the broker binds the realpath'd project root. */
async function tempProject(prefix: string) {
  return realpathSync(await mkdtemp(join(tmpdir(), prefix)));
}

describe("memory-extension package", () => {
  it("validates its manifest and wraps the broker package with a real, unaliased agent half", async () => {
    const manifest = JSON.parse(
      await readFile(join(extensionRoot, "pipiui-extension.json"), "utf8"),
    ) as unknown;
    const validation = validateExtensionManifest(manifest);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.manifest.id).toBe(MEMORY_EXTENSION_ID);
    expect(validation.manifest.agentExtension).toBe("agent/memory-broker-extension.ts");
    const entryStat = await lstat(join(extensionRoot, validation.manifest.agentExtension!));
    expect(entryStat.isFile()).toBe(true);
    expect(entryStat.isSymbolicLink()).toBe(false);
    // The agent half must load through the extension entry and expose the broker
    // install surface (the single implementation the worker identity remounts).
    const entry = await import(extensionEntry);
    expect(typeof entry.default).toBe("function");
    expect(typeof entry.installMemoryBrokerExtension).toBe("function");
  });

  it("registers exactly the frozen memory_query / memory_status tool contract", async () => {
    const pi = await installMainBroker(
      { backendFactory: async () => new (await import(brokerBackendModule)).InMemoryMemoryBackend() },
      { PIPIUI_MEMORY_BROKER_MODE: "main", PIPIUI_MEMORY_PROJECT_ROOT: "/proj" },
    );
    expect([...pi.tools.keys()].sort()).toEqual(["memory_query", "memory_status"]);
    // No write-side tools exist at all: management stays behind the memory command.
    for (const forbidden of ["memory_add", "memory_replace", "memory_remove", "memory_search"]) {
      expect(pi.tools.has(forbidden)).toBe(false);
    }

    const query = pi.tools.get("memory_query");
    const { MEMORY_LIMITS } = await import(contractModule);
    const properties = query.parameters.properties;
    expect(query.parameters.type).toBe("object");
    expect(properties.query.type).toBe("string");
    expect(properties.query.minLength).toBe(1);
    expect(properties.query.maxLength).toBe(MEMORY_LIMITS.maximumQueryTextUTF8Bytes);
    expect(properties.scope.anyOf.map((item: { const: string }) => item.const)).toEqual(["project", "session"]);
    expect(properties.budget.type).toBe("integer");
    expect(properties.budget.minimum).toBe(1);
    expect(properties.budget.maximum).toBe(MEMORY_LIMITS.maximumQueryBudget);
    // Application scope is operator-only; main mode never declares it.
    expect(properties.bundleID).toBeUndefined();
    expect(properties.appName).toBeUndefined();
    expect(query.description).toContain("loopback");
    expect(query.description).toContain("never durably writes");

    const status = pi.tools.get("memory_status");
    expect(status.parameters.type).toBe("object");
    expect(status.parameters.properties).toEqual({});
    expect(status.description).toContain("does not initialize or modify a backend");
  });

  it("fails soft when the main broker has not started", async () => {
    const pi = await installMainBroker(
      {},
      { PIPIUI_MEMORY_BROKER_MODE: "main", PIPIUI_MEMORY_PROJECT_ROOT: "/proj" },
    );
    const result = await pi.tools.get("memory_query").execute("call-1", { query: "anything" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Memory query unavailable");
  });

  it("serves memory_query and memory_status through the started main broker", async () => {
    const project = await tempProject("memory-ext-a-");
    try {
      const { InMemoryMemoryBackend } = await import(brokerBackendModule);
      const backend = new InMemoryMemoryBackend({ results: [{ claim: "Use UTF-8 café", score: 0.9 }] });
      const pi = await installMainBroker(
        { backendFactory: async () => backend },
        {
          PIPIUI_MEMORY_BROKER_MODE: "main",
          PIPIUI_MEMORY_PROJECT_ROOT: project,
          PIPIUI_MEMORY_CHAT_SESSION_ID: "session-a",
        },
      );
      await pi.handlers.get("session_start")![0]({}, { cwd: project });

      const result = await pi.tools.get("memory_query").execute("call-1", { query: "UTF-8" });
      expect(result.isError).toBeFalsy();
      // After startup, main-mode queries flow through the bounded retrieval
      // pipeline: the tool returns the structured advisory context, and the
      // broker backend still sees exactly one scoped query.
      const context = result.details.memory_context as {
        advisory: boolean;
        trust: string;
        trigger: string;
        items: Array<{ recordId: string; kind: string; scope: string; reference: string }>;
      };
      expect(context.advisory).toBe(true);
      expect(context.trust).toBe("untrusted reference");
      expect(context.trigger).toBe("explicit-query");
      expect(context.items).toHaveLength(1);
      expect(context.items[0]!.reference).toBe("Use UTF-8 café");
      expect(context.items[0]!.scope).toBe("project");
      expect(context.items[0]!.recordId).toMatch(/^broker-/);
      expect(backend.queries).toHaveLength(1);
      expect(backend.queries[0]!.context.projectRoot).toBe(project);

      const status = await pi.tools.get("memory_status").execute("call-2", {});
      expect(status.isError).toBeFalsy();
      expect(status.content[0].text).toContain("Memory backend is ready.");

      await pi.handlers.get("session_shutdown")![0]({}, {});
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});

describe("memory-extension legacy data import", () => {
  it("imports the V1 queue once, idempotently, preserving queue and permissions", async () => {
    const project = await tempProject("memory-ext-v1-");
    try {
      const catalogRoot = join(project, ".pi", "pipiui-memory");
      const queue = join(catalogRoot, "pipiui-memory-broker-experience-v1.jsonl");
      await mkdir(catalogRoot, { recursive: true });
      await writeFile(
        queue,
        `${JSON.stringify({
          version: 1,
          kind: "pipiui-memory-experience",
          reason: "quarantined",
          projectRoot: project,
          candidate: { claim: "legacy claim", sourceRuns: ["v1-run"], evidence: [{ summary: "legacy evidence" }] },
        })}\n`,
        "utf8",
      );
      // Production open auto-imports the V1 queue exactly once (hash marker).
      const { openMainMemoryCatalog } = await import(brokerCatalogModule);
      const catalog = await openMainMemoryCatalog({ mode: "main", memoryDir: catalogRoot });
      expect(catalog.list()).toHaveLength(1);
      // Re-import is a no-op: the source hash marker prevents resurrection.
      expect(await catalog.importV1()).toBe(0);
      const record = catalog.list()[0]!;
      expect(record.claim).toBe("legacy claim");
      expect(record.provenance[0]).toMatchObject({ source: "experience-v1", reason: "quarantined" });
      // The queue itself is preserved for replay/audit.
      expect(await readFile(queue, "utf8")).toContain("legacy claim");
      const permissions = await catalog.permissions();
      expect(permissions.log).toBe(0o600);
      expect(permissions.snapshot).toBe(0o600);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});

describe("memory-extension project isolation", () => {
  it("binds every query to the spawning project root and never crosses projects", async () => {
    const projectA = await tempProject("memory-ext-iso-a-");
    const projectB = await tempProject("memory-ext-iso-b-");
    try {
      const { InMemoryMemoryBackend } = await import(brokerBackendModule);
      const backendA = new InMemoryMemoryBackend({ results: [{ claim: "secret-of-A", score: 1 }] });
      const backendB = new InMemoryMemoryBackend({ results: [{ claim: "secret-of-B", score: 1 }] });
      const piA = await installMainBroker(
        { backendFactory: async () => backendA },
        {
          PIPIUI_MEMORY_BROKER_MODE: "main",
          PIPIUI_MEMORY_PROJECT_ROOT: projectA,
          PIPIUI_MEMORY_CHAT_SESSION_ID: "session-a",
        },
      );
      const piB = await installMainBroker(
        { backendFactory: async () => backendB },
        {
          PIPIUI_MEMORY_BROKER_MODE: "main",
          PIPIUI_MEMORY_PROJECT_ROOT: projectB,
          PIPIUI_MEMORY_CHAT_SESSION_ID: "session-b",
        },
      );
      await piA.handlers.get("session_start")![0]({}, { cwd: projectA });
      await piB.handlers.get("session_start")![0]({}, { cwd: projectB });

      // Project B asks for project A's secret by exact claim text.
      const resultB = await piB.tools.get("memory_query").execute("call-b", { query: "secret-of-A" });
      expect(resultB.isError).toBeFalsy();
      expect(resultB.content[0].text).toContain("secret-of-B");
      expect(resultB.content[0].text).not.toContain("secret-of-A");
      // Project A's broker never saw a query; B's broker bound the query to B.
      expect(backendA.queries).toHaveLength(0);
      expect(backendB.queries).toHaveLength(1);
      expect(backendB.queries[0]!.context.projectRoot).toBe(projectB);

      await piA.handlers.get("session_shutdown")![0]({}, {});
      await piB.handlers.get("session_shutdown")![0]({}, {});
    } finally {
      await rm(projectA, { recursive: true, force: true });
      await rm(projectB, { recursive: true, force: true });
    }
  });

  it("keeps durable catalog data inside each project's .pi/pipiui-memory", async () => {
    const projectA = await tempProject("memory-ext-disk-a-");
    const projectB = await tempProject("memory-ext-disk-b-");
    try {
      const { openMainMemoryCatalog } = await import(brokerCatalogModule);
      const catalogA = await openMainMemoryCatalog({
        mode: "main",
        memoryDir: join(projectA, ".pi", "pipiui-memory"),
      });
      await catalogA.upsert({
        kind: "semantic",
        claim: "A-only durable claim",
        scope: { kind: "project", project: projectA },
        sourceRuns: ["run-a"],
      });
      const catalogB = await openMainMemoryCatalog({
        mode: "main",
        memoryDir: join(projectB, ".pi", "pipiui-memory"),
      });
      expect(catalogB.list()).toHaveLength(0);
      const logA = await readFile(join(projectA, ".pi", "pipiui-memory", "pipiui-memory-catalog-v2.jsonl"), "utf8");
      expect(logA).toContain("A-only durable claim");
      // Project B never gains A's data file or contents.
      await expect(
        readFile(join(projectB, ".pi", "pipiui-memory", "pipiui-memory-catalog-v2.jsonl"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(projectA, { recursive: true, force: true });
      await rm(projectB, { recursive: true, force: true });
    }
  });
});

describe("memory-extension host spawn wiring", () => {
  const runtimeRoot = "/runtime";
  const entryPath = join(runtimeRoot, "extensions", MEMORY_EXTENSION_ID, "agent", "memory-broker-extension.ts");
  const hermes = join(runtimeRoot, "embedded", "node_modules", "pi-hermes-memory");
  const paths = { memoryBroker: entryPath, hermesMemory: hermes };

  it("main spawn mounts the extension entry with project binding and hermes roots", () => {
    const { args, env } = assemblePiSpawn({
      cwd: "/repo",
      features: { memoryBroker: true },
      paths,
      bridgePort: 1234,
    });
    expect(args).toContain("-e");
    expect(args).toContain(entryPath);
    expect(env.PIPIUI_MEMORY_BROKER_MODE).toBe("main");
    expect(env.PIPIUI_MEMORY_PROJECT_ROOT).toBe("/repo");
    expect(env.PIPIUI_HERMES_PACKAGE_ROOT).toBe(hermes);
    expect(env.PIPIUI_HERMES_NODE_MODULES_ROOT).toBe(join(runtimeRoot, "embedded", "node_modules"));
  });

  it("a disabled memory-extension package suppresses the legacy mount", () => {
    const { args, env } = assemblePiSpawn({
      cwd: "/repo",
      features: { memoryBroker: true },
      paths,
      bridgePort: 1234,
      registeredExtensions: [{ id: MEMORY_EXTENSION_ID, enabled: false, extensionPath: entryPath }],
    });
    expect(args).not.toContain(entryPath);
    expect(env.PIPIUI_MEMORY_BROKER_MODE).toBeUndefined();
    expect(env.PIPIUI_MEMORY_PROJECT_ROOT).toBeUndefined();
  });

  it("an enabled package keeps both channels on the same file so pi loads it once", () => {
    const { args, env } = assemblePiSpawn({
      cwd: "/repo",
      features: { memoryBroker: true },
      paths,
      bridgePort: 1234,
      registeredExtensions: [{ id: MEMORY_EXTENSION_ID, enabled: true, extensionPath: entryPath }],
    });
    // Legacy bridge contract + registry channel agree on one resolved file;
    // pi dedupes `-e` paths, so memory installs exactly once.
    expect(args.filter((arg) => arg === entryPath)).toHaveLength(2);
    expect(env.PIPIUI_MEMORY_BROKER_MODE).toBe("main");
  });

  it("worker remount env never carries the memory agent half", () => {
    const other = join(runtimeRoot, "extensions", "pdf-extension", "agent", "dist", "index.js");
    const { env } = assemblePiSpawn({
      cwd: "/repo",
      features: { memoryBroker: true },
      paths,
      bridgePort: 1234,
      registeredExtensions: [
        { id: MEMORY_EXTENSION_ID, enabled: true, extensionPath: entryPath },
        { id: "pdf-extension", enabled: true, extensionPath: other },
      ],
    });
    const workerPaths = (env[REGISTERED_EXTENSION_PATHS_ENV] ?? "").split(delimiter).filter(Boolean);
    expect(workerPaths).toEqual([other]);
    expect(workerRegisteredExtensionArgs(env)).toEqual(["-e", other]);
    // The main-session ownership signal still lists the memory extension.
    expect((env[MOUNTED_EXTENSIONS_ENV] ?? "").split(",")).toEqual(
      expect.arrayContaining([MEMORY_EXTENSION_ID, "pdf-extension"]),
    );
  });

  it("resolves the extension entry from the shipped runtime tree", () => {
    expect(resolveSpawnPaths(runtimeSource).memoryBroker).toBe(extensionEntry);
  });
});
