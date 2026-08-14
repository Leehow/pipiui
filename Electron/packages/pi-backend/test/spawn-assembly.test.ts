import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemblePiSpawn, mergedSpawnEnvironment, resolveSpawnPaths, sanitizeEnvironment } from "../src/spawn-assembly.js";
import { DEFAULT_FEATURES } from "../src/features.js";

describe("runtime info extension mount", () => {
  const runtimeInfo = "/runtime/extensions/pipiui-runtime-info.ts";

  it("always mounts for a main session, with or without a host bridge", () => {
    const input = { cwd: "/tmp/project", paths: { runtimeInfo } };
    expect(assemblePiSpawn(input).args).toEqual(["-e", runtimeInfo]);
    expect(assemblePiSpawn({ ...input, bridgePort: 1234 }).args).toEqual(["-e", runtimeInfo]);
  });

  it("mounts last so request evidence observes the final rewritten payload", () => {
    const codex = "/runtime/extensions/pipiui-codex-server-tools.ts";
    const browser = "/runtime/extensions/pipiui-electron-webview.ts";
    const output = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { codexServerTools: true, browser: true },
      paths: { codexServerTools: codex, webview: browser, runtimeInfo },
      bridgePort: 1234,
    });
    expect(output.args).toEqual(["-e", codex, "-e", browser, "-e", runtimeInfo]);
  });
});

describe("shared terminal extension mount", () => {
  it("mounts only behind the bridge feature gate", () => {
    const input = { cwd: "/tmp/project", paths: { terminal: "/runtime/extensions/pipiui-electron-terminal.ts" }, features: { terminal: true } };
    expect(assemblePiSpawn(input).args).not.toContain("/runtime/extensions/pipiui-electron-terminal.ts");
    expect(assemblePiSpawn({ ...input, bridgePort: 1234, sessionCapability: "cap" }).args).toEqual(["-e", "/runtime/extensions/pipiui-electron-terminal.ts"]);
  });
});

describe("main-only Hermes runtime ownership", () => {
  it("passes the exact managed package root only to the main memory broker", () => {
    const paths = { memoryBroker: "/runtime/memory-broker", hermesMemory: "/embedded/node_modules/pi-hermes-memory" };
    const main = assemblePiSpawn({ cwd: "/repo", features: { memoryBroker: true }, paths, bridgePort: 1234 });
    expect(main.env.PIPIUI_HERMES_PACKAGE_ROOT).toBe(paths.hermesMemory);
    expect(main.env.PIPIUI_HERMES_NODE_MODULES_ROOT).toBe("/embedded/node_modules");

    const worker = assemblePiSpawn({ cwd: "/repo", features: {}, paths, bridgePort: 1234 });
    expect(worker.env.PIPIUI_HERMES_PACKAGE_ROOT).toBeUndefined();
    expect(worker.env.PIPIUI_HERMES_NODE_MODULES_ROOT).toBeUndefined();
  });

  it("resolves Hermes only from the exact-version managed runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-hermes-spawn-"));
    try {
      const nodeModules = join(root, "node_modules");
      const hermes = join(nodeModules, "pi-hermes-memory");
      await mkdir(hermes, { recursive: true });
      await writeFile(join(hermes, "package.json"), JSON.stringify({ name: "pi-hermes-memory", version: "0.9.4" }));
      expect(resolveSpawnPaths("/runtime", { managedNodeModulesRoot: nodeModules }).hermesMemory).toBe(hermes);
      await writeFile(join(hermes, "package.json"), JSON.stringify({ name: "pi-hermes-memory", version: "0.9.3" }));
      expect(resolveSpawnPaths("/runtime", { managedNodeModulesRoot: nodeModules }).hermesMemory).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("explicit Pi resource mode", () => {
  it("disables ambient discovery while retaining explicit PipiUI mounts", () => {
    const { args, env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/electron/pi-agent",
      sessionsRoot: "/electron/pi-agent/sessions",
      resourceMode: "explicit",
      features: { philosophy: true, git: true },
      paths: { philosophy: "/runtime/philosophy.ts", git: "/runtime/git.ts" },
    });
    expect(args).toEqual(expect.arrayContaining([
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
      "-e", "/runtime/philosophy.ts", "/runtime/git.ts",
    ]));
    expect(env).toMatchObject({
      PI_CODING_AGENT_DIR: "/electron/pi-agent",
      PI_CODING_AGENT_SESSION_DIR: "/electron/pi-agent/sessions",
    });
  });

  it("keeps generic callers on Pi's default discovery behavior", () => {
    const { args, env } = assemblePiSpawn({ cwd: "/tmp/project", features: { git: true }, paths: { git: "/runtime/git.ts" } });
    expect(args).toEqual(["-e", "/runtime/git.ts"]);
    expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
    expect(env.PI_CODING_AGENT_SESSION_DIR).toBeUndefined();
  });
});

/**
 * Exactly one process may finalize worker worktrees for a repository. This host does not do that
 * work directly, so it hands merge, cleanup and disposition to the audited service inside pi.
 */
describe("worktree finalization ownership", () => {
  const base = { cwd: "/tmp/project", paths: { subagentDir: "/ext/subagent" } };

  it("hands finalization to pi when the subagent runtime is enabled", () => {
    const { env } = assemblePiSpawn({
      ...base,
      features: { subagent: true },
      bridgePort: 1234,
      bridgeRoutingKey: "key",
    });
    expect(env.PIPIUI_WORKTREE_FINALIZER).toBe("pi");
    expect(env.PIPIUI_MAIN_CWD).toBe("/tmp/project");
  });

  it("claims nothing when there is no subagent runtime to finalize for", () => {
    const { env } = assemblePiSpawn({
      ...base,
      features: {},
      bridgePort: 1234,
      bridgeRoutingKey: "key",
    });
    expect(env.PIPIUI_WORKTREE_FINALIZER).toBeUndefined();
  });

  it("cannot be smuggled in from the inherited environment", () => {
    // A stray value from an outer shell must not decide who owns a repository's Git.
    const sanitized = sanitizeEnvironment({
      PIPIUI_WORKTREE_FINALIZER: "pi",
      PATH: "/usr/bin",
    } as NodeJS.ProcessEnv);
    expect(sanitized.PIPIUI_WORKTREE_FINALIZER).toBeUndefined();
    expect(sanitized.PATH).toBe("/usr/bin");
  });
});

describe("Computer Agent host contract", () => {
  it("provides the persistent Procedure Store and Cua version only from host assembly", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { subagent: true, computerUse: true },
      paths: { subagentDir: "/ext/subagent", computerUse: "/ext/computer.ts" },
      bridgePort: 1234,
      computerCapability: "cap",
      computerDescriptor: { displayID: 1, width: 100, height: 100 },
    });
    expect(env.PIPIUI_COMPUTER_PROCEDURE_STORE).toMatch(/\/Library\/Application Support\/PipiUI\/computer-agent\/procedures\.json$/);
    expect(env.PIPIUI_CUA_DRIVER_VERSION).toBe("0.19.2");
  });

  it("strips inherited terminal broker and Cua contract values", () => {
    const env = sanitizeEnvironment({ PIPIUI_TERMINAL_WORKER_BROKER_TOKEN: "stale", PIPIUI_CUA_DRIVER_VERSION: "stale", PATH: "/usr/bin" });
    expect(env.PIPIUI_TERMINAL_WORKER_BROKER_TOKEN).toBeUndefined();
    expect(env.PIPIUI_CUA_DRIVER_VERSION).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });
});

/**
 * T17 parity: configured `<agentDir>/.env` keys reach the spawned pi process env. Mirrors Swift
 * `ChatSession.mergedSpawnEnv` + `PiProcess.mergedProcessEnvironment`: internal
 * PIPIUI_* contract wins > `.env` > host process env, with managed keys stripped from
 * both base layers.
 */
describe(".env injection into the pi spawn env (T17 parity)", () => {
  it("injects .env keys under the internal contract", () => {
    const merged = mergedSpawnEnvironment(
      {},
      { OPENAI_API_KEY: "sk-test", TEST_KEY: "xxx" },
      {},
    );
    expect(merged.OPENAI_API_KEY).toBe("sk-test");
    expect(merged.TEST_KEY).toBe("xxx");
  });

  it("internal PIPIUI_* values win over stale .env values", () => {
    const merged = mergedSpawnEnvironment(
      {},
      { PIPIUI_BRIDGE_PORT: "9999", TEST_KEY: "xxx" },
      { PIPIUI_BRIDGE_PORT: "1234" },
    );
    expect(merged.PIPIUI_BRIDGE_PORT).toBe("1234");
    expect(merged.TEST_KEY).toBe("xxx");
  });

  it("internal Pi profile paths win over stale .env and parent values", () => {
    const merged = mergedSpawnEnvironment(
      { PI_CODING_AGENT_DIR: "/global-parent", PI_CODING_AGENT_SESSION_DIR: "/global-parent/sessions" },
      { PI_CODING_AGENT_DIR: "/global-dotenv", PI_CODING_AGENT_SESSION_DIR: "/global-dotenv/sessions" },
      { PI_CODING_AGENT_DIR: "/electron/pi-agent", PI_CODING_AGENT_SESSION_DIR: "/electron/pi-agent/sessions" },
    );
    expect(merged.PI_CODING_AGENT_DIR).toBe("/electron/pi-agent");
    expect(merged.PI_CODING_AGENT_SESSION_DIR).toBe("/electron/pi-agent/sessions");
  });

  it("strips managed PIPIUI_* keys from .env and parent layers", () => {
    const merged = mergedSpawnEnvironment(
      { PIPIUI_SESSION_KEY: "stale-parent", ANTHROPIC_API_KEY: "parent-key" },
      { PIPIUI_SESSION_KEY: "stale-dotenv", OPENAI_API_KEY: "dot-key" },
      { PIPIUI_SESSION_KEY: "session-1" },
    );
    expect(merged.PIPIUI_SESSION_KEY).toBe("session-1");
    expect(merged.OPENAI_API_KEY).toBe("dot-key");
    expect(merged.ANTHROPIC_API_KEY).toBe("parent-key");
  });

  it("empty .env keeps parent and internal values", () => {
    const merged = mergedSpawnEnvironment(
      { PATH: "/usr/bin" },
      {},
      { PIPIUI_SESSION_KEY: "abc" },
    );
    expect(merged).toMatchObject({ PATH: "/usr/bin", PIPIUI_SESSION_KEY: "abc" });
  });
});

/**
 * The Swift app groups subagent with the bridge-dependent extensions because Swift always has a
 * bridge. The extension itself only uses the bridge for lifecycle reporting, so a bridge-less host
 * must still get real dispatch, worktrees and finalization — otherwise Electron has no workers at
 * all until an HTTP bridge exists.
 */
describe("bridge-free subagent orchestration", () => {
  const paths = { subagentDir: "/ext/subagent", agentsDir: "/ext/agents", memoryBroker: "/ext/memory", webview: "/ext/webview.ts", planRuntime: "/ext/plan.ts" };

  it("mounts subagent and claims finalization without a bridge", () => {
    const { args, env } = assemblePiSpawn({ cwd: "/tmp/project", features: { subagent: true }, paths });
    expect(args).toEqual(expect.arrayContaining(["-e", "/ext/subagent"]));
    expect(env).toMatchObject({ PIPIUI_SUBAGENT_EXT: "/ext/subagent", PIPIUI_AGENTS_DIR: "/ext/agents", PIPIUI_MAIN_CWD: "/tmp/project", PIPIUI_WORKTREE_FINALIZER: "pi" });
    expect(env.PIPIUI_SUBAGENT_MODELS_FILE).toBeUndefined();
    expect(env.PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE).toBeUndefined();
    expect(env.PIPIUI_MAIN_MODEL_FILE).toBeUndefined();
    expect(env.PIPIUI_BRIDGE_PORT).toBeUndefined();
  });

  it("binds nested model resolution to the Electron-owned materialized settings file", () => {
    const { env } = assemblePiSpawn({ cwd: "/tmp/project", features: { subagent: true }, paths, subagentModelsFile: "/electron/agent/subagent-models.json" });
    expect(env.PIPIUI_SUBAGENT_MODELS_FILE).toBe("/electron/agent/subagent-models.json");
  });

  it("keeps genuinely bridge-dependent extensions gated", () => {
    const { args } = assemblePiSpawn({ cwd: "/tmp/project", features: { subagent: true, memoryBroker: true, browser: true, philosophy: true }, paths });
    expect(args).not.toContain("/ext/memory");
    expect(args).not.toContain("/ext/webview.ts");
    expect(args).not.toContain("/ext/plan.ts");
  });

  it("mounts Plan only behind its own explicit feature", () => {
    const withoutPlan = assemblePiSpawn({ cwd: "/tmp/project", features: { philosophy: true }, paths, bridgePort: 1234 });
    expect(withoutPlan.args).not.toContain("/ext/plan.ts");
    const withPlan = assemblePiSpawn({ cwd: "/tmp/project", features: { philosophy: true, plan: true }, paths, bridgePort: 1234 });
    expect(withPlan.args).toEqual(expect.arrayContaining(["-e", "/ext/plan.ts"]));
  });

  it("never mounts a subagent runtime it could not resolve", () => {
    const { args, env } = assemblePiSpawn({ cwd: "/tmp/project", features: { subagent: true }, paths: {} });
    expect(args).not.toContain("-e");
    expect(env.PIPIUI_WORKTREE_FINALIZER).toBeUndefined();
  });
});

describe("installed runtime tree", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

  it("resolves only what the app actually installed", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-runtime-"));
    await mkdir(join(root, "pi-ext", "subagent"), { recursive: true });
    await mkdir(join(root, "extensions"), { recursive: true });
    await mkdir(join(root, "built-in-skills", "create-subagent"), { recursive: true });
    await mkdir(join(root, "pi-philosophy"), { recursive: true });
    await writeFile(join(root, "extensions", "pipiui-git.ts"), "//\n");
    await writeFile(join(root, "extensions", "pipiui-skillloader.ts"), "//\n");
    await writeFile(join(root, "extensions", "pipiui-runtime-info.ts"), "//\n");
    await writeFile(join(root, "pi-philosophy", "package.json"), JSON.stringify({ pi: { extensions: ["./philosophy.ts"] } }));
    await writeFile(join(root, "pi-philosophy", "philosophy.ts"), "//\n");

    const paths = resolveSpawnPaths(root);
    expect(paths.git).toBe(join(root, "extensions", "pipiui-git.ts"));
    expect(paths.runtimeInfo).toBe(join(root, "extensions", "pipiui-runtime-info.ts"));
    expect(paths.subagentDir).toBe(join(root, "pi-ext", "subagent"));
    expect(paths.philosophy).toBe(join(root, "pi-philosophy", "philosophy.ts"));
    expect(paths.builtInSkills).toBe(join(root, "built-in-skills"));
    // Never hand pi a path that is not there: `-e /does/not/exist` kills the session.
    expect(paths.media).toBeUndefined();
    expect(paths.agentsDir).toBeUndefined();
    expect(paths.memoryBroker).toBeUndefined();
    expect(paths.webSearch).toBeUndefined();
  });

  it("resolves nothing at all for a root the app never installed into", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-empty-"));
    expect(Object.values(resolveSpawnPaths(root)).filter(Boolean)).toEqual([]);
  });

  it("resolves exact managed extension versions from the bundled node_modules tree", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-bundled-managed-"));
    const runtimeRoot = join(root, "runtime");
    const nodeModules = join(root, "embedded", "node_modules");
    for (const [name, version] of [["pi-web-access", "0.20.0"], ["pi-mcp-extension", "1.5.0"]]) {
      const packageRoot = join(nodeModules, name);
      await mkdir(join(packageRoot, "dist"), { recursive: true });
      await writeFile(join(packageRoot, "dist", "index.js"), "//\n");
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name, version, pi: { extensions: ["./dist/index.js"] } }));
    }
    const paths = resolveSpawnPaths(runtimeRoot, { managedNodeModulesRoot: nodeModules });
    expect(paths.webSearch).toBe(join(nodeModules, "pi-web-access", "dist", "index.js"));
    expect(paths.mcp).toBe(join(nodeModules, "pi-mcp-extension", "dist", "index.js"));

    await writeFile(join(nodeModules, "pi-web-access", "package.json"), JSON.stringify({ version: "0.20.1", pi: { extensions: ["./dist/index.js"] } }));
    expect(resolveSpawnPaths(runtimeRoot, { managedNodeModulesRoot: nodeModules }).webSearch).toBeUndefined();
  });
});

describe("default feature set", () => {
  it("mounts the orchestration stack and the built-in browser while withholding unavailable desktop surfaces", () => {
    expect(DEFAULT_FEATURES).toMatchObject({ philosophy: true, plan: false, subagent: true, git: true, skillLoader: true, searchScope: false, webSearch: true, mcp: true, browser: true });
    expect(DEFAULT_FEATURES.computerUse).toBe(true);
  });

  it("injects Electron-owned built-in skills only when the skill loader resolves", () => {
    const ready = assemblePiSpawn({ cwd: "/tmp/project", features: { skillLoader: true }, paths: { skillLoader: "/runtime/extensions/pipiui-skillloader.ts", builtInSkills: "/runtime/built-in-skills" } });
    expect(ready.env.PIPIUI_BUILT_IN_SKILL_ROOT).toBe("/runtime/built-in-skills");
    const unavailable = assemblePiSpawn({ cwd: "/tmp/project", features: { skillLoader: true }, paths: { builtInSkills: "/runtime/built-in-skills" } });
    expect(unavailable.env.PIPIUI_BUILT_IN_SKILL_ROOT).toBeUndefined();
  });

  it("exports computer runtime routing only with a resolved extension, descriptor and capability", () => {
    const ready = assemblePiSpawn({ cwd: "/tmp/project", features: { computerUse: true, subagent: true }, paths: { computerUse: "/runtime/pipiui-computer-use.ts", subagentDir: "/runtime/pi-ext/subagent" }, bridgePort: 1234, bridgeRoutingKey: "session-id", computerCapability: "computer-secret", computerDescriptor: { displayID: 7, width: 1440, height: 900 } });
    expect(ready.args).toEqual(expect.arrayContaining(["-e", "/runtime/pi-ext/subagent"]));
    expect(ready.args).not.toContain("/runtime/pipiui-computer-use.ts");
    expect(ready.env).toMatchObject({ PIPIUI_COMPUTER_EXT: "/runtime/pipiui-computer-use.ts", PIPIUI_COMPUTER_CAPABILITY: "computer-secret", PIPIUI_COMPUTER_RUNTIME_PROTOCOL: "1", PIPIUI_COMPUTER_DISPLAY_ID: "7", PIPIUI_COMPUTER_WIDTH: "1440", PIPIUI_COMPUTER_HEIGHT: "900" });
    const unavailable = assemblePiSpawn({ cwd: "/tmp/project", features: { computerUse: true }, paths: { computerUse: "/runtime/pipiui-computer-use.ts" }, bridgePort: 1234, computerCapability: "computer-secret", computerDescriptor: { displayID: 7, width: 1440, height: 900 } });
    expect(unavailable.args).not.toContain("/runtime/pipiui-computer-use.ts");
    expect(unavailable.env.PIPIUI_COMPUTER_EXT).toBeUndefined();
  });

  it("does not register the browser extension when the feature is explicitly disabled", () => {
    const { args } = assemblePiSpawn({ cwd: "/tmp/project", features: { browser: false }, paths: { webview: "/ext/browser.ts" }, bridgePort: 1234, sessionCapability: "secret" });
    expect(args).not.toContain("/ext/browser.ts");
  });
});
