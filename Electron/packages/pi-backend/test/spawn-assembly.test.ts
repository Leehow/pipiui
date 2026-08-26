import { afterEach, describe, expect, it } from "vitest";
import { existsSync, realpathSync, statSync, symlinkSync, chmodSync, linkSync, lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CONTRIBUTIONS_ENV, AGENT_CONTRIBUTIONS_ENV_MAX_BYTES, AGENT_CONTRIBUTIONS_FILE_ENV, AGENT_CONTRIBUTIONS_HOST_MAX_BYTES, AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV, assemblePiSpawn, buildVersionedAgentContributionSnapshot, contributionSidecarName, contributionSidecarTempPattern, extensionSettingsEnvName, isElectronNodeShim, MEDIA_COMPAT_FALLBACK_ENV, mergedSpawnEnvironment, MOUNTED_EXTENSIONS_ENV, REGISTERED_EXTENSION_PATHS_ENV, removeContributionSnapshotSidecar, resolveContributionSnapshotFile, resolveSpawnPaths, sanitizeEnvironment, serializeAgentContributions, userExtensionMounts, workerAgentContributionsSnapshot, workerRegisteredExtensionArgs, withToolPath } from "../src/spawn-assembly.js";
import { applySessionMountsToMainEnv, applySessionMountsToWorkerEnv } from "../src/secret-vault.js";
import { DEFAULT_FEATURES } from "../src/features.js";

describe("context-fold main-session mount", () => {
  const contextFold = "/runtime/pi-ext/packages/context-fold/index.ts";

  it("mounts the resolved context-fold entrypoint once behind its dedicated feature", () => {
    const input = { cwd: "/tmp/project", features: { contextFold: true }, paths: { contextFold } };
    expect(assemblePiSpawn(input).args).toEqual(["-e", contextFold]);
    expect(assemblePiSpawn({ ...input, bridgePort: 1234 }).args).toEqual(["-e", contextFold]);
  });

  it("honors the explicit feature-off kill switch", () => {
    const output = assemblePiSpawn({ cwd: "/tmp/project", features: { contextFold: false }, paths: { contextFold } });
    expect(output.args).not.toContain(contextFold);
  });

  it("fails open by omitting an unresolved runtime asset", () => {
    const output = assemblePiSpawn({ cwd: "/tmp/project", features: { contextFold: true }, paths: {} });
    expect(output.args).toEqual([]);
  });

  it("resolves only the shipped runtime entrypoint", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime");
    expect(resolveSpawnPaths(root).contextFold).toBe(join(root, "pi-ext", "packages", "context-fold", "index.ts"));
  });
});

describe("runtime info extension mount", () => {
  const runtimeInfo = "/runtime/extensions/pipiui-runtime-info.ts";
  const updateCenter = "/runtime/extensions/pipiui-update-center.ts";

  it("always mounts the update policy and runtime observer for a main session, with or without a host bridge", () => {
    const input = { cwd: "/tmp/project", paths: { updateCenter, runtimeInfo } };
    expect(assemblePiSpawn(input).args).toEqual(["-e", updateCenter, "-e", runtimeInfo]);
    expect(assemblePiSpawn({ ...input, bridgePort: 1234 }).args).toEqual(["-e", updateCenter, "-e", runtimeInfo]);
  });

  it("mounts last so request evidence observes the final rewritten payload", () => {
    const codex = "/runtime/extensions/pipiui-codex-server-tools.ts";
    const browser = "/runtime/extensions/pipiui-electron-webview.ts";
    const output = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { codexServerTools: true, browser: true },
      paths: { codexServerTools: codex, webview: browser, updateCenter, runtimeInfo },
      bridgePort: 1234,
    });
    expect(output.args).toEqual(["-e", codex, "-e", browser, "-e", updateCenter, "-e", runtimeInfo]);
  });

  it("naturally omits both main-only observers when an isolated helper supplies no paths", () => {
    expect(assemblePiSpawn({ cwd: "/tmp/project", paths: {} }).args).toEqual([]);
  });
});

describe("firecrawl pdf extension mount", () => {
  const firecrawlPdf = "/runtime/extensions/pipiui-firecrawl-pdf.ts";

  it("always mounts the bundled PDF parser when the runtime file exists", () => {
    const input = { cwd: "/tmp/project", paths: { firecrawlPdf } };
    expect(assemblePiSpawn(input).args).toEqual(["-e", firecrawlPdf]);
    expect(assemblePiSpawn({ ...input, resourceMode: "explicit" as const }).args).toEqual(["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "-e", firecrawlPdf]);
  });

  it("resolves the shipped extension from the source runtime tree", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime");
    expect(resolveSpawnPaths(root).firecrawlPdf).toBe(join(root, "extensions", "pipiui-firecrawl-pdf.ts"));
    expect(resolveSpawnPaths(root).pdfInspector).toBe(join(root, "pdf-inspector"));
    expect(resolveSpawnPaths(root).firecrawlAnydoc).toBe(join(root, "extensions", "pipiui-firecrawl-anydoc.ts"));
    expect(resolveSpawnPaths(root).anydoc).toBe(join(root, "anydoc"));
    expect(existsSync(join(root, "pdf-inspector", "node_modules", "@firecrawl", "pdf-inspector", "package.json"))).toBe(true);
    expect(existsSync(join(root, "pdf-inspector", "node_modules", "@firecrawl", "pdf-inspector-wasm", "pdf_inspector_wasm_bg.wasm"))).toBe(true);
    expect(existsSync(join(root, "anydoc", "node_modules", "@firecrawl", "anydoc-wasm", "anydoc_wasm_bg.wasm"))).toBe(true);
  });

  it("exports the inspector root and NODE_PATH so the Pi child can resolve official packages", () => {
    const firecrawlPdf = "/runtime/extensions/pipiui-firecrawl-pdf.ts";
    const pdfInspector = "/runtime/pdf-inspector";
    const firecrawlAnydoc = "/runtime/extensions/pipiui-firecrawl-anydoc.ts";
    const anydoc = "/runtime/anydoc";
    const { env, args } = assemblePiSpawn({ cwd: "/tmp/project", paths: { firecrawlPdf, pdfInspector, firecrawlAnydoc, anydoc } });
    expect(args).toEqual(["-e", firecrawlPdf, "-e", firecrawlAnydoc]);
    expect(env.PIPIUI_PDF_INSPECTOR_ROOT).toBe(pdfInspector);
    expect(env.PIPIUI_ANYDOC_ROOT).toBe(anydoc);
    expect(env.NODE_PATH?.split(delimiter)).toContain(join(pdfInspector, "node_modules"));
    expect(env.NODE_PATH?.split(delimiter)).toContain(join(anydoc, "node_modules"));
    expect(sanitizeEnvironment({ PIPIUI_PDF_INSPECTOR_ROOT: "/stale", PIPIUI_ANYDOC_ROOT: "/stale", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });
});

describe("coding tools extension mount", () => {
  const codingTools = "/runtime/extensions/pipiui-coding-tools.ts";

  it("always mounts the read-directory wrapper and exports the path for workers", () => {
    const input = { cwd: "/tmp/project", paths: { codingTools } };
    expect(assemblePiSpawn(input).args).toEqual(["-e", codingTools]);
    expect(assemblePiSpawn({ ...input, bridgePort: 1234 }).args).toEqual(["-e", codingTools]);
    expect(assemblePiSpawn(input).env.PIPIUI_CODING_TOOLS_EXT).toBe(codingTools);
  });

  it("stays off isolated helpers that pass no paths", () => {
    expect(assemblePiSpawn({ cwd: "/tmp/project", paths: {} }).args).toEqual([]);
    expect(assemblePiSpawn({ cwd: "/tmp/project", paths: {} }).env.PIPIUI_CODING_TOOLS_EXT).toBeUndefined();
  });

  it("cannot be smuggled in from the inherited environment", () => {
    expect(sanitizeEnvironment({ PIPIUI_CODING_TOOLS_EXT: "/stale.ts", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });

  it("resolves the shipped wrapper from the source runtime tree", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime");
    expect(resolveSpawnPaths(root).codingTools).toBe(join(root, "extensions", "pipiui-coding-tools.ts"));
  });
});

describe("office document screenshot gate mount", () => {
  const officeDocShotGate = "/runtime/extensions/pipiui-office-doc-shot-gate.ts";

  it("always mounts the gate and exports the path for workers", () => {
    const input = { cwd: "/tmp/project", paths: { officeDocShotGate } };
    expect(assemblePiSpawn(input).args).toEqual(["-e", officeDocShotGate]);
    expect(assemblePiSpawn({ ...input, bridgePort: 1234 }).args).toEqual(["-e", officeDocShotGate]);
    expect(assemblePiSpawn(input).env.PIPIUI_OFFICE_DOC_SHOT_GATE_EXT).toBe(officeDocShotGate);
  });

  it("stays off isolated helpers that pass no paths", () => {
    expect(assemblePiSpawn({ cwd: "/tmp/project", paths: {} }).args).toEqual([]);
    expect(assemblePiSpawn({ cwd: "/tmp/project", paths: {} }).env.PIPIUI_OFFICE_DOC_SHOT_GATE_EXT).toBeUndefined();
  });

  it("cannot be smuggled in from the inherited environment", () => {
    expect(sanitizeEnvironment({ PIPIUI_OFFICE_DOC_SHOT_GATE_EXT: "/stale.ts", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });

  it("resolves the shipped extension from the source runtime tree", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime");
    expect(resolveSpawnPaths(root).officeDocShotGate).toBe(join(root, "extensions", "pipiui-office-doc-shot-gate.ts"));
  });
});

describe("shared terminal extension mount", () => {
  it("mounts only behind the bridge feature gate", () => {
    const input = { cwd: "/tmp/project", paths: { terminal: "/runtime/extensions/pipiui-electron-terminal.ts" }, features: { terminal: true } };
    expect(assemblePiSpawn(input).args).not.toContain("/runtime/extensions/pipiui-electron-terminal.ts");
    expect(assemblePiSpawn({ ...input, bridgePort: 1234, sessionCapability: "cap" }).args).toEqual(["-e", "/runtime/extensions/pipiui-electron-terminal.ts"]);
  });
});

describe("built-in browser search mount", () => {
  const browserSearch = "/runtime/extensions/pipiui-browser-search.ts";
  const input = { cwd: "/tmp/project", paths: { browserSearch }, features: { browserSearch: true } };

  it("mounts only behind its own feature gate and only with a host bridge", () => {
    expect(assemblePiSpawn({ ...input, bridgePort: 1234 }).args).toEqual(["-e", browserSearch]);
    expect(assemblePiSpawn({ ...input, bridgePort: 1234, features: {} }).args).not.toContain(browserSearch);
    expect(assemblePiSpawn(input).args).not.toContain(browserSearch);
  });

  it("mounts independently of the interactive browser tool so each stays a separate switch", () => {
    const { args } = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { browserSearch: true },
      paths: { browserSearch, webview: "/ext/webview.ts" },
      bridgePort: 1234,
    });
    expect(args).toEqual(["-e", browserSearch]);
    expect(args).not.toContain("/ext/webview.ts");
  });

  it("puts the extensions directory on NODE_PATH so pi-web-access resolves PipiUI's Glimpse shim", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { browserSearch: true },
      paths: { browserSearch },
      bridgePort: 1234,
    });
    expect(env.NODE_PATH?.split(delimiter)[0]).toBe("/runtime/extensions");
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

  it("passes an optional provider-neutral review model only through the host-owned memory contract", () => {
    const paths = { memoryBroker: "/runtime/memory-broker", hermesMemory: "/embedded/node_modules/pi-hermes-memory" };
    const main = assemblePiSpawn({
      cwd: "/repo",
      features: { memoryBroker: true },
      paths,
      bridgePort: 1234,
      memoryReviewModelId: "provider/model-family/reviewer",
    });
    expect(main.env.PIPIUI_MEMORY_REVIEW_MODEL).toBe("provider/model-family/reviewer");
    const absent = assemblePiSpawn({ cwd: "/repo", features: { memoryBroker: true }, paths, bridgePort: 1234 });
    expect(absent.env.PIPIUI_MEMORY_REVIEW_MODEL).toBeUndefined();
  });

  it("resolves Hermes only from the exact-version managed runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-hermes-spawn-"));
    try {
      const nodeModules = join(root, "node_modules");
      const hermes = join(nodeModules, "pi-hermes-memory");
      await mkdir(hermes, { recursive: true });
      await writeFile(join(hermes, "package.json"), JSON.stringify({ name: "pi-hermes-memory", version: "0.9.6" }));
      expect(resolveSpawnPaths("/runtime", { managedNodeModulesRoot: nodeModules }).hermesMemory).toBe(hermes);
      await writeFile(join(hermes, "package.json"), JSON.stringify({ name: "pi-hermes-memory", version: "0.9.3" }));
      expect(resolveSpawnPaths("/runtime", { managedNodeModulesRoot: nodeModules }).hermesMemory).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
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
  it("provides only the active project Pi home and Cua version from host assembly", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/tmp/project/.pi/agent",
      features: { subagent: true, computerUse: true },
      paths: { subagentDir: "/ext/subagent", computerUse: "/ext/computer.ts" },
      bridgePort: 1234,
      computerCapability: "cap",
      computerDescriptor: { displayID: 1, width: 100, height: 100 },
    });
    expect(env.PIPIUI_ACTIVE_PROJECT_PI_HOME).toBe("/tmp/project/.pi/agent");
    expect(env.PIPIUI_COMPUTER_PROCEDURE_STORE).toBeUndefined();
    expect(env.PIPIUI_CUA_DRIVER_VERSION).toBe("0.22.0");
  });

  it("exports the enabled browser route for the single Computer Use Agent child", () => {
    const { env } = assemblePiSpawn({ cwd: "/tmp/project", features: { browser: true }, paths: { webview: "/ext/webview.ts" }, bridgePort: 1234 });
    expect(env.PIPIUI_WEBVIEW_EXT).toBe("/ext/webview.ts");
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
  it("applies PipiUI context-fold product defaults at the lowest precedence", () => {
    const merged = mergedSpawnEnvironment({}, {}, {});
    expect(merged).toMatchObject({
      CONTEXTFOLD_BUDGET_CAP: "150000",
      CONTEXTFOLD_TAIL: "30000",
      CONTEXTFOLD_COMPACT: "native",
      CONTEXTFOLD_SPOOL_RETAIN_DAYS: "30",
      CONTEXTFOLD_TOOL_USE_TRIGGER: "40",
      CONTEXTFOLD_TOOL_USE_KEEP: "12",
      CONTEXTFOLD_TOOL_USE_MIN_SAVINGS: "10000",
    });
  });

  it("lets caller, project .env, and internal values override context-fold defaults in order", () => {
    const parent = mergedSpawnEnvironment({ CONTEXTFOLD_BUDGET_CAP: "140000" }, {}, {});
    expect(parent.CONTEXTFOLD_BUDGET_CAP).toBe("140000");

    const project = mergedSpawnEnvironment(
      { CONTEXTFOLD_TAIL: "25000" },
      { CONTEXTFOLD_TAIL: "22000", CONTEXTFOLD_COMPACT: "det" },
      {},
    );
    expect(project.CONTEXTFOLD_TAIL).toBe("22000");
    expect(project.CONTEXTFOLD_COMPACT).toBe("det");

    const triggerOverride = mergedSpawnEnvironment(
      { CONTEXTFOLD_TOOL_USE_TRIGGER: "44" },
      { CONTEXTFOLD_TOOL_USE_TRIGGER: "48", CONTEXTFOLD_TOOL_USE_KEEP: "10" },
      { CONTEXTFOLD_TOOL_USE_MIN_SAVINGS: "12000" },
    );
    expect(triggerOverride.CONTEXTFOLD_TOOL_USE_TRIGGER).toBe("48");
    expect(triggerOverride.CONTEXTFOLD_TOOL_USE_KEEP).toBe("10");
    expect(triggerOverride.CONTEXTFOLD_TOOL_USE_MIN_SAVINGS).toBe("12000");

    const internal = mergedSpawnEnvironment(
      {},
      { CONTEXTFOLD_SPOOL_RETAIN_DAYS: "10" },
      { CONTEXTFOLD_SPOOL_RETAIN_DAYS: "45" },
    );
    expect(internal.CONTEXTFOLD_SPOOL_RETAIN_DAYS).toBe("45");

    const disabled = mergedSpawnEnvironment({}, { CONTEXTFOLD: "0" }, {});
    expect(disabled.CONTEXTFOLD).toBe("0");
  });

  it("defaults new Pi processes to native long cache retention", () => {
    const merged = mergedSpawnEnvironment({}, {}, {});
    expect(merged.PI_CACHE_RETENTION).toBe("long");
  });

  it.each(["short", "none", "provider-specific"])(
    "preserves an explicit PI_CACHE_RETENTION=%s value",
    (retention) => {
      const merged = mergedSpawnEnvironment(
        { PI_CACHE_RETENTION: retention },
        {},
        {},
      );
      expect(merged.PI_CACHE_RETENTION).toBe(retention);
    },
  );

  it("lets the configured project .env override the cache-retention default", () => {
    const merged = mergedSpawnEnvironment(
      {},
      { PI_CACHE_RETENTION: "none" },
      {},
    );
    expect(merged.PI_CACHE_RETENTION).toBe("none");
  });

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

  it("always marks the child as Electron-as-Node even under a Finder-like sparse env", () => {
    // Packaged Pi is the Electron Helper. A reconstructed spawn env that drops
    // ELECTRON_RUN_AS_NODE turns that Helper into a Chromium process that
    // busy-loops at ~80% CPU instead of running the script.
    const merged = mergedSpawnEnvironment(
      { HOME: "/tmp", PATH: "/usr/bin:/bin" },
      {},
      {},
    );
    expect(merged.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});

/**
 * The Swift app groups subagent with the bridge-dependent extensions because Swift always has a
 * bridge. The extension itself only uses the bridge for lifecycle reporting, so a bridge-less host
 * must still get real dispatch, worktrees and finalization — otherwise Electron has no workers at
 * all until an HTTP bridge exists.
 */
describe("bridge-free subagent orchestration", () => {
  const paths = { subagentDir: "/ext/subagent", agentsDir: "/ext/agents", memoryBroker: "/ext/memory", webview: "/ext/webview.ts", browserSearch: "/ext/browser-search.ts", planRuntime: "/ext/plan.ts" };

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

  it("binds the native-search catalog file for worker tool-list filtering", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { subagent: true },
      paths,
      subagentNativeSearchFile: "/electron/agent/native-search.json",
    });
    expect(env.PIPIUI_SUBAGENT_NATIVE_SEARCH_FILE).toBe("/electron/agent/native-search.json");
  });

  it("keeps genuinely bridge-dependent extensions gated", () => {
    const { args } = assemblePiSpawn({ cwd: "/tmp/project", features: { subagent: true, memoryBroker: true, browser: true, browserSearch: true, philosophy: true }, paths });
    expect(args).not.toContain("/ext/memory");
    expect(args).not.toContain("/ext/webview.ts");
    expect(args).not.toContain("/ext/browser-search.ts");
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
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

  it("resolves only what the app actually installed", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-runtime-"));
    await mkdir(join(root, "pi-ext", "subagent"), { recursive: true });
    await mkdir(join(root, "extensions"), { recursive: true });
    await mkdir(join(root, "built-in-skills", "create-subagent"), { recursive: true });
    await mkdir(join(root, "pi-philosophy"), { recursive: true });
    await writeFile(join(root, "extensions", "pipiui-git.ts"), "//\n");
    await writeFile(join(root, "extensions", "pipiui-skillloader.ts"), "//\n");
    await writeFile(join(root, "extensions", "pipiui-runtime-info.ts"), "//\n");
    await writeFile(join(root, "extensions", "pipiui-coding-tools.ts"), "//\n");
    await writeFile(join(root, "extensions", "pipiui-update-center.ts"), "//\n");
    await writeFile(join(root, "extensions", "pipiui-browser-search.ts"), "//\n");
    await writeFile(join(root, "pi-philosophy", "package.json"), JSON.stringify({ pi: { extensions: ["./philosophy.ts"] } }));
    await writeFile(join(root, "pi-philosophy", "philosophy.ts"), "//\n");

    const paths = resolveSpawnPaths(root);
    expect(paths.git).toBe(join(root, "extensions", "pipiui-git.ts"));
    expect(paths.runtimeInfo).toBe(join(root, "extensions", "pipiui-runtime-info.ts"));
    expect(paths.codingTools).toBe(join(root, "extensions", "pipiui-coding-tools.ts"));
    expect(paths.updateCenter).toBe(join(root, "extensions", "pipiui-update-center.ts"));
    expect(paths.browserSearch).toBe(join(root, "extensions", "pipiui-browser-search.ts"));
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
    for (const [name, version] of [["pi-web-access", "0.23.0"], ["pi-mcp-extension", "1.5.0"]]) {
      const packageRoot = join(nodeModules, name);
      await mkdir(join(packageRoot, "dist"), { recursive: true });
      await writeFile(join(packageRoot, "dist", "index.js"), "//\n");
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name, version, pi: { extensions: ["./dist/index.js"] } }));
    }
    const paths = resolveSpawnPaths(runtimeRoot, { managedNodeModulesRoot: nodeModules });
    expect(paths.webSearch).toBe(join(nodeModules, "pi-web-access", "dist", "index.js"));
    expect(paths.mcp).toBe(join(nodeModules, "pi-mcp-extension", "dist", "index.js"));

    await writeFile(join(nodeModules, "pi-web-access", "package.json"), JSON.stringify({ version: "0.23.1", pi: { extensions: ["./dist/index.js"] } }));
    expect(resolveSpawnPaths(runtimeRoot, { managedNodeModulesRoot: nodeModules }).webSearch).toBeUndefined();
  });
});

describe("default feature set", () => {
  it("mounts the orchestration stack and the built-in browser while withholding unavailable desktop surfaces", () => {
    expect(DEFAULT_FEATURES).toMatchObject({ philosophy: true, plan: true, subagent: true, contextFold: true, git: true, skillLoader: true, searchScope: false, webSearch: true, browserSearch: true, mcp: true, browser: true });
    expect(DEFAULT_FEATURES.computerUse).toBe(true);
  });

  it("injects Electron-owned built-in skills only when the skill loader resolves", () => {
    const skillLoader = "/runtime/extensions/pipiui-skillloader.ts";
    const ready = assemblePiSpawn({ cwd: "/tmp/project", features: { skillLoader: true }, paths: { skillLoader, builtInSkills: "/runtime/built-in-skills" } });
    expect(ready.env.PIPIUI_BUILT_IN_SKILL_ROOT).toBe("/runtime/built-in-skills");
    expect(ready.env.PIPIUI_SKILLLOADER_EXT).toBe(skillLoader);
    expect(ready.args).toEqual(expect.arrayContaining(["-e", skillLoader]));
    const unavailable = assemblePiSpawn({ cwd: "/tmp/project", features: { skillLoader: true }, paths: { builtInSkills: "/runtime/built-in-skills" } });
    expect(unavailable.env.PIPIUI_BUILT_IN_SKILL_ROOT).toBeUndefined();
    expect(unavailable.env.PIPIUI_SKILLLOADER_EXT).toBeUndefined();
    expect(sanitizeEnvironment({ PIPIUI_SKILLLOADER_EXT: "/stale.ts", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
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

describe("user-added Pi extensions", () => {
  it("mounts package entrypoints and loose files from the isolated profile, and ignores junk", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-user-ext-"));
    try {
      const dir = join(root, "user-extensions");
      const packaged = join(dir, "demo-pack");
      await mkdir(join(packaged, "dist"), { recursive: true });
      await writeFile(join(packaged, "dist", "index.js"), "//\n");
      await writeFile(join(packaged, "package.json"), JSON.stringify({ name: "demo-pack", pi: { extensions: ["./dist/index.js"] } }));
      await writeFile(join(dir, "loose.ts"), "//\n");
      await writeFile(join(dir, "readme.md"), "no\n");
      await mkdir(join(dir, "empty"), { recursive: true });
      expect(userExtensionMounts(root)).toEqual([
        join(packaged, "dist", "index.js"),
        join(dir, "loose.ts"),
      ]);
      const { args } = assemblePiSpawn({ cwd: "/tmp/project", agentDir: root, paths: { updateCenter: "/runtime/update.ts", runtimeInfo: "/runtime/info.ts" } });
      expect(args).toEqual([
        "-e", join(packaged, "dist", "index.js"),
        "-e", join(dir, "loose.ts"),
        "-e", "/runtime/update.ts",
        "-e", "/runtime/info.ts",
      ]);
      expect(userExtensionMounts(undefined)).toEqual([]);
      expect(assemblePiSpawn({ cwd: "/tmp/project", paths: { updateCenter: "/runtime/update.ts", runtimeInfo: "/runtime/info.ts" } }).args).toEqual(["-e", "/runtime/update.ts", "-e", "/runtime/info.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });
});

describe("registered PipiUI extension agent mounts (D3 / §5.5)", () => {
  const updateCenter = "/runtime/update.ts";
  const runtimeInfo = "/runtime/info.ts";
  const quotaAgent = "/pkg/quota/agent/dist/index.js";
  const offAgent = "/pkg/off/agent.js";
  const skillRoot = "/pkg/quota/agent/skills";

  it("mounts enabled agent.extension on -e and skips disabled/error", () => {
    const { args, env } = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [
        {
          id: "quota",
          enabled: true,
          extensionPath: quotaAgent,
          skillRoots: [skillRoot],
          settings: { "ext.quota.threshold": 80 },
        },
        { id: "off", enabled: false, extensionPath: offAgent },
        { id: "broken", enabled: false },
        { id: "my-ext", enabled: true, extensionPath: "/pkg/my-ext/agent.js", settings: { "ext.my-ext.on": true } },
      ],
    });
    expect(args).toEqual([
      "-e", quotaAgent,
      "-e", "/pkg/my-ext/agent.js",
      "-e", updateCenter,
      "-e", runtimeInfo,
    ]);
    expect(args).not.toContain(offAgent);
    expect(env[extensionSettingsEnvName("quota")]).toBe(JSON.stringify({ "ext.quota.threshold": 80 }));
    expect(env.PIPIUI_EXT_SETTINGS_QUOTA).toBe(JSON.stringify({ "ext.quota.threshold": 80 }));
    expect(env.PIPIUI_EXT_SETTINGS_MY_EXT).toBe(JSON.stringify({ "ext.my-ext.on": true }));
    expect(env.PIPIUI_SKILL_ROOTS?.split(delimiter)).toContain(skillRoot);
    expect(env[REGISTERED_EXTENSION_PATHS_ENV]?.split(delimiter)).toEqual([
      quotaAgent,
      "/pkg/my-ext/agent.js",
    ]);
    expect(workerRegisteredExtensionArgs(env)).toEqual([
      "-e", quotaAgent,
      "-e", "/pkg/my-ext/agent.js",
    ]);
    expect(workerRegisteredExtensionArgs(env, { computerWorker: true })).toEqual([]);
  });

  it("keeps skills when agent-half is absent and drops colliding mount paths", () => {
    const skillOnly = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [{ id: "quota", enabled: true, skillRoots: [skillRoot] }],
    });
    expect(skillOnly.env.PIPIUI_SKILL_ROOTS?.split(delimiter)).toContain(skillRoot);
    expect(skillOnly.env[REGISTERED_EXTENSION_PATHS_ENV]).toBeUndefined();
    expect(skillOnly.env[MOUNTED_EXTENSIONS_ENV]).toBeUndefined();

    const colliding = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [
        { id: "ext-a", enabled: true, extensionPath: quotaAgent },
        { id: "ext-b", enabled: true, extensionPath: quotaAgent },
      ],
    });
    expect(colliding.args).not.toContain(quotaAgent);
    expect(colliding.env[REGISTERED_EXTENSION_PATHS_ENV]).toBeUndefined();
  });

  it("does not leak inherited extension settings env into a spawn without mounts", () => {
    expect(sanitizeEnvironment({
      PIPIUI_EXT_SETTINGS_QUOTA: "{\"stale\":true}",
      PIPIUI_SKILL_ROOTS: "/stale",
      [REGISTERED_EXTENSION_PATHS_ENV]: "/stale/agent.js",
      [AGENT_CONTRIBUTIONS_ENV]: "[{\"id\":\"stale\"}]",
      PATH: "/usr/bin",
    })).toEqual({ PATH: "/usr/bin" });
    const { env } = assemblePiSpawn({ cwd: "/tmp/project", paths: { updateCenter, runtimeInfo } });
    expect(env.PIPIUI_EXT_SETTINGS_QUOTA).toBeUndefined();
    expect(env.PIPIUI_SKILL_ROOTS).toBeUndefined();
    expect(env[REGISTERED_EXTENSION_PATHS_ENV]).toBeUndefined();
    expect(env[AGENT_CONTRIBUTIONS_ENV]).toBeUndefined();
    expect(workerRegisteredExtensionArgs(env)).toEqual([]);
    expect(workerAgentContributionsSnapshot(env)).toBeUndefined();
  });

  it("snapshots enabled mounts so a later enable cannot rewrite a live spawn", () => {
    const first = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [{ id: "off", enabled: false, extensionPath: offAgent }],
    });
    expect(first.args).not.toContain(offAgent);
    expect(first.env[REGISTERED_EXTENSION_PATHS_ENV]).toBeUndefined();
    expect(workerRegisteredExtensionArgs(first.env)).toEqual([]);

    const laterEnabled = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [{ id: "off", enabled: true, extensionPath: offAgent }],
    });
    expect(laterEnabled.env[REGISTERED_EXTENSION_PATHS_ENV]).toBe(offAgent);
    // The already-assembled first spawn keeps its original args/env.
    expect(first.args).not.toContain(offAgent);
    expect(workerRegisteredExtensionArgs(first.env)).toEqual([]);
  });

  it("is the same worker -e remount the subagent spawn uses", async () => {
    const source = await readFile(new URL("../../../resources/runtime/pi-ext/subagent/index.ts", import.meta.url), "utf8");
    expect(source).toContain("PIPIUI_EXT_REGISTERED_PATHS");
    expect(source).toContain("args.push(\"-e\", mount)");
  });

  it("exports the philosophy path so a dispatched worker can mount it", async () => {
    // Workers spawn with `--no-extensions` and build their own argv, so a package the main
    // session mounted reaches them only through an exported path. Philosophy mounted without
    // exporting one for years: the runtime set PIPI_PHILOSOPHY_ROLE / _AGENT on every child
    // for a package no child ever loaded, and every agent-addressed layer reached nobody.
    const philosophy = "/runtime/pi-philosophy/philosophy.ts";
    const { args, env } = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { philosophy: true },
      paths: { philosophy, updateCenter, runtimeInfo },
    });
    expect(args).toContain(philosophy);
    expect(env.PIPIUI_PHILOSOPHY_EXT).toBe(philosophy);

    const off = assemblePiSpawn({ cwd: "/tmp/project", features: { philosophy: false }, paths: { philosophy, updateCenter, runtimeInfo } });
    expect(off.env.PIPIUI_PHILOSOPHY_EXT).toBeUndefined();

    const source = await readFile(new URL("../../../resources/runtime/pi-ext/subagent/index.ts", import.meta.url), "utf8");
    expect(source).toContain("process.env.PIPIUI_PHILOSOPHY_EXT");
    expect(source).toContain("args.push(\"-e\", PIPIUI_PHILOSOPHY_EXT)");
  });
});

describe("PIPIUI_EXT_AGENT_CONTRIBUTIONS spawn snapshot", () => {
  const updateCenter = "/runtime/update.ts";
  const runtimeInfo = "/runtime/info.ts";
  const promptMarker = "SECRET_PROMPT_BODY_MUST_NOT_ENTER_ENV";
  const contribZeta = {
    id: "zeta",
    origin: "builtin" as const,
    root: "/runtime/extensions/zeta",
    agents: ["/runtime/extensions/zeta/agents/first/AGENT.md", "/runtime/extensions/zeta/agents/second/AGENT.md"],
    patches: [],
  };
  const contribAlpha = {
    id: "alpha",
    origin: "app" as const,
    root: "/agent/extensions/alpha",
    agents: ["/agent/extensions/alpha/agents/alpha/AGENT.md"],
    patches: [{
      target: "explore",
      appendPrompt: "/agent/extensions/alpha/prompts/explore-extra.md",
      addTools: ["code_search"],
      removeTools: ["bash"],
    }],
  };
  const contribBeta = {
    id: "beta",
    origin: "project" as const,
    root: "/repo/.pi/agent/extensions/beta",
    agents: ["/repo/.pi/agent/extensions/beta/agents/beta/AGENT.md"],
    patches: [],
  };

  it("writes bounded metadata in origin-then-id order and never prompt bodies", () => {
    const registeredExtensions = [
      { id: "beta", enabled: true, agentContribution: contribBeta },
      { id: "zeta", enabled: true, extensionPath: "/runtime/extensions/zeta/agent.js", agentContribution: contribZeta },
      { id: "alpha", enabled: true, agentContribution: { ...contribAlpha, prompt: promptMarker } as typeof contribAlpha },
      { id: "off", enabled: false, agentContribution: contribAlpha },
    ];
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions,
    });
    const expected = serializeAgentContributions(registeredExtensions);
    expect(expected).toBe(JSON.stringify({
      version: 1,
      extensions: [
        {
          id: "zeta",
          origin: "builtin",
          root: contribZeta.root,
          agents: contribZeta.agents,
          patches: [],
        },
        {
          id: "alpha",
          origin: "app",
          root: contribAlpha.root,
          agents: contribAlpha.agents,
          patches: [{
            target: "explore",
            appendPrompt: contribAlpha.patches[0].appendPrompt,
            addTools: ["code_search"],
            removeTools: ["bash"],
          }],
        },
        {
          id: "beta",
          origin: "project",
          root: contribBeta.root,
          agents: contribBeta.agents,
          patches: [],
        },
      ],
    }));
    expect(env[AGENT_CONTRIBUTIONS_ENV]).toBe(expected);
    expect(env[AGENT_CONTRIBUTIONS_ENV]).not.toContain(promptMarker);
    expect(env[AGENT_CONTRIBUTIONS_ENV]).not.toContain("SECRET");
  });

  it("gives main session and workers the exact same snapshot string", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [
        { id: "alpha", enabled: true, agentContribution: contribAlpha },
        { id: "beta", enabled: true, agentContribution: contribBeta },
      ],
    });
    expect(workerAgentContributionsSnapshot(env)).toBe(env[AGENT_CONTRIBUTIONS_ENV]);
    expect(workerAgentContributionsSnapshot({ ...env })).toBe(env[AGENT_CONTRIBUTIONS_ENV]);
    const bridged = assemblePiSpawn({
      cwd: "/tmp/project",
      bridgePort: 9,
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [
        { id: "alpha", enabled: true, agentContribution: contribAlpha },
        { id: "beta", enabled: true, agentContribution: contribBeta },
      ],
    });
    expect(bridged.env[AGENT_CONTRIBUTIONS_ENV]).toBe(env[AGENT_CONTRIBUTIONS_ENV]);
    expect(workerAgentContributionsSnapshot(bridged.env)).toBe(env[AGENT_CONTRIBUTIONS_ENV]);
  });

  it("clears stale inherited contributions when the spawn has none", () => {
    const stale = { [AGENT_CONTRIBUTIONS_ENV]: JSON.stringify([contribAlpha]) };
    expect(sanitizeEnvironment(stale)[AGENT_CONTRIBUTIONS_ENV]).toBeUndefined();
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [
        { id: "alpha", enabled: false, agentContribution: contribAlpha },
        { id: "legacy", enabled: true, extensionPath: "/pkg/legacy/agent.js" },
      ],
    });
    expect(env[AGENT_CONTRIBUTIONS_ENV]).toBeUndefined();
    expect(env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBeUndefined();
    expect(workerAgentContributionsSnapshot(env)).toBeUndefined();
    const merged = mergedSpawnEnvironment(
      { [AGENT_CONTRIBUTIONS_ENV]: JSON.stringify({ version: 1, extensions: [contribAlpha] }), [AGENT_CONTRIBUTIONS_FILE_ENV]: "/tmp/stale.json", PATH: "/usr/bin" },
      { [AGENT_CONTRIBUTIONS_ENV]: "stale-dotenv", [AGENT_CONTRIBUTIONS_FILE_ENV]: "/tmp/stale-dotenv.json" },
      env,
    );
    expect(merged[AGENT_CONTRIBUTIONS_ENV]).toBeUndefined();
    expect(merged[AGENT_CONTRIBUTIONS_FILE_ENV]).toBeUndefined();
  });

  it("keeps old manifests without contributions compatible", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [
        { id: "quota", enabled: true, extensionPath: "/pkg/quota/agent.js", skillRoots: ["/pkg/quota/skills"] },
      ],
    });
    expect(env[REGISTERED_EXTENSION_PATHS_ENV]).toBe("/pkg/quota/agent.js");
    expect(env[AGENT_CONTRIBUTIONS_ENV]).toBeUndefined();
    expect(serializeAgentContributions([
      { id: "quota", enabled: true, extensionPath: "/pkg/quota/agent.js" },
    ])).toBeUndefined();
  });

  function bulkyContribution(id: string, toolWidth: number, patchCount: number, toolsPerPatch: number) {
    const token = "n".repeat(toolWidth);
    return {
      id,
      origin: "project" as const,
      root: `/repo/.pi/agent/extensions/${id}`,
      agents: [`/repo/.pi/agent/extensions/${id}/agents/${id}/AGENT.md`],
      patches: Array.from({ length: patchCount }, (_, patchIndex) => ({
        target: `explore-${patchIndex}`,
        addTools: Array.from({ length: toolsPerPatch }, (_, toolIndex) => `${token}_${patchIndex}_${toolIndex}`),
      })),
    };
  }

  it("disables contributions over the host byte cap and keeps extension/skills mounts", () => {
    const huge = bulkyContribution("huge", 220, 32, 32);
    const packages = [
      { id: "huge", enabled: true, extensionPath: "/pkg/huge/agent.js", skillRoots: ["/pkg/huge/skills"], agentContribution: huge },
    ];
    const built = buildVersionedAgentContributionSnapshot(packages);
    expect(built.byteLength).toBeGreaterThan(AGENT_CONTRIBUTIONS_HOST_MAX_BYTES);
    expect(built.json).toBeUndefined();
    expect(built.extensions).toEqual([]);
    expect(built.diagnostics.some((entry) => entry.code === "contribution-snapshot-oversize")).toBe(true);
    expect(serializeAgentContributions(packages)).toBeUndefined();
    const { env, args } = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: packages,
    });
    expect(env[AGENT_CONTRIBUTIONS_ENV]).toBeUndefined();
    expect(env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBeUndefined();
    expect(env[REGISTERED_EXTENSION_PATHS_ENV]).toBe("/pkg/huge/agent.js");
    expect(env.PIPIUI_SKILL_ROOTS).toBe("/pkg/huge/skills");
    expect(args).toContain("/pkg/huge/agent.js");
  });

  it("writes a session-owned snapshot file when the versioned JSON exceeds the env budget", async () => {
    const mid = bulkyContribution("mid", 80, 16, 32);
    const packages = [
      { id: "mid", enabled: true, extensionPath: "/pkg/mid/agent.js", agentContribution: mid },
    ];
    const built = buildVersionedAgentContributionSnapshot(packages);
    expect(built.json).toBeDefined();
    expect(built.byteLength).toBeGreaterThan(AGENT_CONTRIBUTIONS_ENV_MAX_BYTES);
    expect(built.byteLength).toBeLessThanOrEqual(AGENT_CONTRIBUTIONS_HOST_MAX_BYTES);
    const sessionRoot = await mkdtemp(join(tmpdir(), "pipi-contrib-snap-"));
    try {
      const sessionsRoot = join(sessionRoot, "sessions");
      const sessionPath = join(sessionsRoot, "chat-1.jsonl");
      await mkdir(sessionsRoot, { recursive: true });
      const { env } = assemblePiSpawn({
        cwd: sessionRoot,
        sessionPath,
        sessionsRoot,
        paths: { updateCenter, runtimeInfo },
        registeredExtensions: packages,
      });
      const expectedFile = resolveContributionSnapshotFile({ sessionPath, sessionsRoot });
      expect(expectedFile).toBe(join(realpathSync(sessionsRoot), "chat-1.ext-agent-contributions.json"));
      expect(env[AGENT_CONTRIBUTIONS_ENV]).toBeUndefined();
      expect(env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBe(expectedFile);
      expect(existsSync(expectedFile!)).toBe(true);
      expect(await readFile(expectedFile!, "utf8")).toBe(built.json);
      expect(workerAgentContributionsSnapshot(env)).toBe(built.json);
      const worker = assemblePiSpawn({
        cwd: sessionRoot,
        sessionPath,
        sessionsRoot,
        paths: { updateCenter, runtimeInfo },
        registeredExtensions: packages,
      });
      expect(worker.env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBe(env[AGENT_CONTRIBUTIONS_FILE_ENV]);
      expect(workerAgentContributionsSnapshot(worker.env)).toBe(built.json);
    } finally {
      await rm(sessionRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });

  it("refuses a snapshot file outside agentDir/sessionsRoot jail", () => {
    const mid = bulkyContribution("jail", 80, 16, 32);
    const packages = [
      { id: "jail", enabled: true, extensionPath: "/pkg/jail/agent.js", agentContribution: mid },
    ];
    expect(resolveContributionSnapshotFile({
      sessionPath: "/etc/passwd.jsonl",
      sessionsRoot: "/tmp/pipi-sessions",
    })).toBeUndefined();
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      sessionPath: "/etc/passwd.jsonl",
      sessionsRoot: "/tmp/pipi-sessions",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: packages,
    });
    expect(env[AGENT_CONTRIBUTIONS_ENV]).toBeUndefined();
    expect(env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBeUndefined();
    expect(env[REGISTERED_EXTENSION_PATHS_ENV]).toBe("/pkg/jail/agent.js");
  });
});

describe("agent contribution sidecar hardening (slice C)", () => {
  const updateCenter = "/runtime/update.ts";
  const runtimeInfo = "/runtime/info.ts";

  function heavyPackages(id = "heavy") {
    const token = "n".repeat(80);
    return [{
      id,
      enabled: true,
      extensionPath: `/pkg/${id}/agent.js`,
      agentContribution: {
        id,
        origin: "project" as const,
        root: `/repo/.pi/agent/extensions/${id}`,
        agents: [`/repo/.pi/agent/extensions/${id}/agents/${id}/AGENT.md`],
        patches: Array.from({ length: 16 }, (_, patchIndex) => ({
          target: `explore-${patchIndex}`,
          addTools: Array.from({ length: 32 }, (_, toolIndex) => `${token}_${patchIndex}_${toolIndex}`),
        })),
      },
    }];
  }

  /** Fresh session jail: sessionsRoot/<project>/<ts>.jsonl with the session file present. */
  async function freshSession(root: string) {
    const sessionsRoot = join(root, "sessions");
    const dir = join(sessionsRoot, encodeURIComponent("/tmp/project"));
    await mkdir(dir, { recursive: true });
    const sessionPath = join(dir, "chat-1.jsonl");
    await writeFile(sessionPath, "{\"type\":\"session\",\"version\":3}\n");
    return { sessionsRoot, dir, sessionPath };
  }

  it("writes an owner-only regular sidecar and leaves no temp files behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-contrib-hard-"));
    try {
      const { sessionsRoot, sessionPath } = await freshSession(root);
      const { env } = assemblePiSpawn({
        cwd: root,
        sessionPath,
        sessionsRoot,
        paths: { updateCenter, runtimeInfo },
        registeredExtensions: heavyPackages("perm"),
      });
      const file = env[AGENT_CONTRIBUTIONS_FILE_ENV]!;
      expect(file).toBeDefined();
      expect(env[AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]).toBe(dirname(file));
      const stat = lstatSync(file);
      expect(stat.isFile()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o600);
      expect(stat.nlink).toBe(1);
      const temps = readdirSync(dirname(file)).filter((name) => name.includes("ext-agent-contributions") && name.endsWith(".tmp"));
      expect(temps).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });

  it("replaces the sidecar atomically and keeps the mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-contrib-atomic-"));
    try {
      const { sessionsRoot, sessionPath } = await freshSession(root);
      const spawn = () => assemblePiSpawn({
        cwd: root,
        sessionPath,
        sessionsRoot,
        paths: { updateCenter, runtimeInfo },
        registeredExtensions: heavyPackages("atomic"),
      });
      const first = spawn();
      const file = first.env[AGENT_CONTRIBUTIONS_FILE_ENV]!;
      const firstBody = await readFile(file, "utf8");
      expect(firstBody).toContain("atomic");
      const second = spawn();
      expect(second.env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBe(file);
      const secondBody = await readFile(file, "utf8");
      expect(secondBody).toBe(firstBody);
      expect(lstatSync(file).mode & 0o777).toBe(0o600);
      expect(readdirSync(dirname(file)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });

  it("refuses a prepositioned symlink at the sidecar path and never writes through it", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-contrib-symlink-"));
    try {
      const { sessionsRoot, sessionPath, dir } = await freshSession(root);
      const victim = join(root, "victim.json");
      await writeFile(victim, "SECRET", { mode: 0o600 });
      const sidecar = join(realpathSync(dir), contributionSidecarName(sessionPath));
      symlinkSync(victim, sidecar);
      const { env } = assemblePiSpawn({
        cwd: root,
        sessionPath,
        sessionsRoot,
        paths: { updateCenter, runtimeInfo },
        registeredExtensions: heavyPackages("sl"),
      });
      expect(env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBeUndefined();
      expect(env[AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]).toBeUndefined();
      expect(await readFile(victim, "utf8")).toBe("SECRET");
      expect(lstatSync(sidecar).isSymbolicLink()).toBe(true);
      expect(readdirSync(realpathSync(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });

  it("refuses a hard-linked sidecar target", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-contrib-hardlink-"));
    try {
      const { sessionsRoot, sessionPath, dir } = await freshSession(root);
      const realDir = realpathSync(dir);
      const original = join(root, "original.json");
      await writeFile(original, JSON.stringify({ version: 1, extensions: [] }), { mode: 0o600 });
      linkSync(original, join(realDir, contributionSidecarName(sessionPath)));
      const { env } = assemblePiSpawn({
        cwd: root,
        sessionPath,
        sessionsRoot,
        paths: { updateCenter, runtimeInfo },
        registeredExtensions: heavyPackages("hl"),
      });
      expect(env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBeUndefined();
      expect(await readFile(original, "utf8")).toBe(JSON.stringify({ version: 1, extensions: [] }));
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });

  it("rejects a realpath-escaped session directory and a missing jail", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-contrib-escape-"));
    try {
      const sessionsRoot = join(root, "sessions");
      await mkdir(sessionsRoot, { recursive: true });
      const outside = join(root, "outside");
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, "stolen.jsonl"), "x\n");
      symlinkSync(outside, join(sessionsRoot, "link-project"));
      expect(resolveContributionSnapshotFile({
        sessionPath: join(sessionsRoot, "link-project", "stolen.jsonl"),
        sessionsRoot,
      })).toBeUndefined();
      expect(resolveContributionSnapshotFile({
        sessionPath: join(sessionsRoot, "no-such-dir", "chat.jsonl"),
        sessionsRoot,
      })).toBeUndefined();
      const packages = heavyPackages("esc");
      const { env } = assemblePiSpawn({
        cwd: root,
        sessionPath: join(sessionsRoot, "link-project", "stolen.jsonl"),
        sessionsRoot,
        paths: { updateCenter, runtimeInfo },
        registeredExtensions: packages,
      });
      expect(env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBeUndefined();
      expect(existsSync(join(outside, "stolen.ext-agent-contributions.json"))).toBe(false);
      expect(env[REGISTERED_EXTENSION_PATHS_ENV]).toBe("/pkg/esc/agent.js");
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });

  it("strips stale inherited session-root values like the other host contract keys", () => {
    const sanitized = sanitizeEnvironment({
      [AGENT_CONTRIBUTIONS_FILE_ENV]: "/tmp/stale.json",
      [AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]: "/tmp",
      PATH: "/usr/bin",
    });
    expect(sanitized[AGENT_CONTRIBUTIONS_FILE_ENV]).toBeUndefined();
    expect(sanitized[AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]).toBeUndefined();
  });

  it("main and worker share the same read-only sidecar reference", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-contrib-parity-"));
    try {
      const { sessionsRoot, sessionPath } = await freshSession(root);
      const packages = heavyPackages("parity");
      const spawn = () => assemblePiSpawn({
        cwd: root,
        sessionPath,
        sessionsRoot,
        paths: { updateCenter, runtimeInfo },
        registeredExtensions: packages,
      });
      const main = spawn();
      const worker = spawn();
      const file = main.env[AGENT_CONTRIBUTIONS_FILE_ENV]!;
      expect(worker.env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBe(file);
      expect(worker.env[AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]).toBe(main.env[AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]);
      expect(workerAgentContributionsSnapshot(worker.env)).toBe(await readFile(file, "utf8"));
      // rename/move never relocate the session file, so the derived sidecar stays valid.
      const moved = assemblePiSpawn({
        cwd: join(root, "other-project"),
        sessionPath,
        sessionsRoot,
        paths: { updateCenter, runtimeInfo },
        registeredExtensions: packages,
      });
      expect(moved.env[AGENT_CONTRIBUTIONS_FILE_ENV]).toBe(file);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });

  it("session delete removes the owned sidecar and orphaned temps, never foreign files", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-contrib-delete-"));
    try {
      const { sessionsRoot, sessionPath, dir } = await freshSession(root);
      const realDir = realpathSync(dir);
      const { env } = assemblePiSpawn({
        cwd: root,
        sessionPath,
        sessionsRoot,
        paths: { updateCenter, runtimeInfo },
        registeredExtensions: heavyPackages("del"),
      });
      const sidecar = env[AGENT_CONTRIBUTIONS_FILE_ENV]!;
      expect(existsSync(sidecar)).toBe(true);
      // Crash leftover temp for this sidecar, a foreign sidecar for another session,
      // and a decoy JSON that is not a versioned snapshot.
      const temp = join(realDir, `.${contributionSidecarName(sessionPath)}.999999.deadbeef.tmp`);
      await writeFile(temp, "garbage", { mode: 0o600 });
      const foreignSidecar = join(realDir, contributionSidecarName("chat-2.jsonl"));
      await writeFile(foreignSidecar, JSON.stringify({ version: 1, extensions: [] }), { mode: 0o600 });
      const decoy = join(realDir, "notes.json");
      await writeFile(decoy, "{\"hello\":\"world\"}", { mode: 0o600 });
      removeContributionSnapshotSidecar({ sessionPath, sessionsRoot });
      expect(existsSync(sidecar)).toBe(false);
      expect(existsSync(temp)).toBe(false);
      expect(existsSync(foreignSidecar)).toBe(true);
      expect(existsSync(decoy)).toBe(true);
      expect(existsSync(sessionPath)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });

  it("session delete never removes an unowned file at the canonical path", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-contrib-delete2-"));
    try {
      const { sessionsRoot, sessionPath, dir } = await freshSession(root);
      const realDir = realpathSync(dir);
      const impostor = join(realDir, contributionSidecarName(sessionPath));
      await writeFile(impostor, "{\"not\":\"ours\"}", { mode: 0o600 });
      removeContributionSnapshotSidecar({ sessionPath, sessionsRoot });
      expect(existsSync(impostor)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });
});

describe("grok-build delegation marker and media compat gate (M5)", () => {
  const updateCenter = "/runtime/update.ts";
  const runtimeInfo = "/runtime/info.ts";
  const grokAgent = "/pkg/grok-build-oauth/agent/dist/index.js";
  const mediaExt = "/runtime/extensions/pipiui-media.ts";

  it("exports the mounted manifest extension ids so legacy media can yield tool ownership", () => {
    const { args, env } = assemblePiSpawn({
      cwd: "/tmp/project",
      features: { generateImage: true },
      paths: { media: mediaExt, updateCenter, runtimeInfo },
      registeredExtensions: [{ id: "grok-build-oauth", enabled: true, extensionPath: grokAgent, settings: {} }],
    });
    // Both halves are mounted; the marker is what tells pipiui-media to stay dormant.
    expect(args).toContain(mediaExt);
    expect(args).toContain(grokAgent);
    expect(env[MOUNTED_EXTENSIONS_ENV]).toBe("grok-build-oauth");
  });

  it("omits the marker when the extension is disabled or has no agent entry", () => {
    const disabled = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [{ id: "grok-build-oauth", enabled: false, extensionPath: grokAgent }],
    });
    expect(disabled.env[MOUNTED_EXTENSIONS_ENV]).toBeUndefined();
    const noPath = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      registeredExtensions: [{ id: "grok-build-oauth", enabled: true }],
    });
    expect(noPath.env[MOUNTED_EXTENSIONS_ENV]).toBeUndefined();
  });

  it("merges host internal env (media compat gate) and strips inherited values", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      paths: { updateCenter, runtimeInfo },
      internalEnv: { [MEDIA_COMPAT_FALLBACK_ENV]: "1" },
    });
    expect(env[MEDIA_COMPAT_FALLBACK_ENV]).toBe("1");
    // A stale parent value can never turn the deprecated path back on.
    expect(sanitizeEnvironment({ [MEDIA_COMPAT_FALLBACK_ENV]: "1", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
    expect(sanitizeEnvironment({ [MOUNTED_EXTENSIONS_ENV]: "stale", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });
});

describe("withToolPath and the Electron node shim", () => {
  const trees: string[] = [];
  afterEach(async () => {
    await Promise.all(trees.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function seedNodeTree(kind: "shim" | "real"): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), `pipiui-${kind}-node-`));
    trees.push(root);
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    const body = kind === "shim"
      ? "#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 /Helper \"$@\"\n"
      : "#!/bin/sh\nexit 0\n";
    await writeFile(join(bin, "node"), body, { mode: 0o755 });
    return bin;
  }

  function firstNodeDir(path: string): string | undefined {
    return path.split(delimiter).find((dir) => existsSync(join(dir, "node")));
  }

  it("does not let the Electron node shim win PATH when a real node exists", async () => {
    const shimDir = await seedNodeTree("shim");
    const realDir = await seedNodeTree("real");
    const env = withToolPath(
      { PATH: [shimDir, "/usr/bin", "/bin", realDir].join(delimiter) },
      join(shimDir, "node"),
    );
    expect(firstNodeDir(env.PATH ?? "")).toBe(realDir);
    expect(env.PATH?.split(delimiter)).not.toContain(shimDir);
  });

  it("still prepends a normal pi executable directory when no shim is involved", () => {
    const env = withToolPath({ PATH: "/usr/bin:/bin" }, "/opt/homebrew/bin/pi");
    expect(env.PATH?.split(delimiter)[0]).toBe("/opt/homebrew/bin");
  });

  // A rewritten executable changes size/mtime, so the size+mtime-guarded shim memoization
  // must re-read it instead of replaying the stale verdict.
  it("re-evaluates a shim file whose content changed (shimCache size+mtime invalidation)", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipiui-shim-flip-"));
    trees.push(root);
    const node = join(root, "node");
    await writeFile(node, "#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 /Helper \"$@\"\n", { mode: 0o755 });
    expect(isElectronNodeShim(node)).toBe(true);
    await writeFile(node, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await utimes(node, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
    expect(isElectronNodeShim(node)).toBe(false);
  });

  // withToolPath must stay uncached: a real Node installed after the first spawn has to
  // demote the shim directory on the very next call, not reuse the frozen first PATH.
  it("reflects a real node that appears after the first call (no frozen PATH decision)", async () => {
    const shimDir = await seedNodeTree("shim");
    const lateDir = await seedNodeTree("shim");
    const baseEnv = { PATH: [shimDir, lateDir].join(delimiter) };
    const pi = join(shimDir, "node");
    // Both seeded node binaries are shims, so the second directory never wins first.
    const before = withToolPath(baseEnv, pi);
    expect(firstNodeDir(before.PATH ?? "")).not.toBe(lateDir);
    // Flip the second directory into a real node; the size+mtime change must be noticed
    // on the next call and the directory promoted ahead of the well-known fallbacks.
    const lateNode = join(lateDir, "node");
    await writeFile(lateNode, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await utimes(lateNode, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
    const after = withToolPath(baseEnv, pi);
    expect(firstNodeDir(after.PATH ?? "")).toBe(lateDir);
    expect(after.PATH?.split(delimiter)).not.toContain(shimDir);
  });
});

describe("secret vault spawn contract", () => {
  const secretVault = "/runtime/extensions/pipiui-secret-vault.ts";

  it("mounts the vault extension and pins the explicit App-profile vault directory", () => {
    const { args, env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/project/.pi/agent",
      vaultDir: "/electron/pi-agent",
      sessionId: "sess-1",
      paths: { secretVault },
    });
    expect(args).toEqual(["-e", secretVault]);
    expect(env.PI_CODING_AGENT_DIR).toBe("/project/.pi/agent");
    expect(env.PIPIUI_SECRET_VAULT_DIR).toBeUndefined();
    expect(env.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(env.PIPIUI_SESSION_ID).toBe("sess-1");
  });

  it("never derives the vault directory from a project agentDir", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/project/.pi/agent",
      sessionId: "sess-1",
      paths: { secretVault },
    });
    expect(env.PI_CODING_AGENT_DIR).toBe("/project/.pi/agent");
    expect(env.PIPIUI_SECRET_VAULT_DIR).toBeUndefined();
  });

  it("never injects a DEK and strips inherited vault keys", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/project/.pi/agent",
      vaultDir: "/electron/pi-agent",
      sessionId: "sess-1",
      paths: { secretVault },
    });
    expect(env.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(env.PIPIUI_SECRET_VAULT_DIR).toBeUndefined();
    expect(sanitizeEnvironment({ PIPIUI_SECRET_VAULT_DIR: "/stale", PIPIUI_VAULT_DEK: "leak", PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });

  it("merges session mounts onto main env without a DEK", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/project/.pi/agent",
      vaultDir: "/electron/pi-agent",
      sessionId: "sess-1",
      paths: { secretVault },
    });
    const main = applySessionMountsToMainEnv(
      mergedSpawnEnvironment(
        { PATH: "/usr/bin", OPENAI_API_KEY: "from-dotenv", TOKEN_B: "parent-b", PIPIUI_VAULT_DEK: "leak" },
        { OPENAI_API_KEY: "from-dotenv" },
        env,
      ),
      { TOKEN_A: "aaaaaaaaaaaa" },
    );
    expect(main.TOKEN_A).toBe("aaaaaaaaaaaa");
    expect(main.TOKEN_B).toBe("parent-b");
    expect(main.OPENAI_API_KEY).toBe("from-dotenv");
    expect(main.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(main.PIPIUI_SECRET_VAULT_DIR).toBeUndefined();
  });

  it("strips DEK from worker/subagent env while keeping session mounts", () => {
    const { env } = assemblePiSpawn({
      cwd: "/tmp/project",
      agentDir: "/project/.pi/agent",
      vaultDir: "/electron/pi-agent",
      sessionId: "sess-1",
      paths: { secretVault },
    });
    const child = applySessionMountsToWorkerEnv(
      mergedSpawnEnvironment(
        { PATH: "/usr/bin", OPENAI_API_KEY: "from-dotenv", TOKEN_B: "parent-b", PIPIUI_VAULT_DEK: "leak" },
        { OPENAI_API_KEY: "from-dotenv" },
        env,
      ),
      { TOKEN_A: "aaaaaaaaaaaa" },
    );
    expect(child.TOKEN_A).toBe("aaaaaaaaaaaa");
    expect(child.TOKEN_B).toBe("parent-b");
    expect(child.OPENAI_API_KEY).toBe("from-dotenv");
    expect(child.PIPIUI_VAULT_DEK).toBeUndefined();
    expect(child.PIPIUI_SECRET_VAULT_DIR).toBeUndefined();
  });

  it("resolves the shipped extension from the source runtime tree", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime");
    expect(resolveSpawnPaths(root).secretVault).toBe(join(root, "extensions", "pipiui-secret-vault.ts"));
  });
});
