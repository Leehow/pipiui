import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { MemoryBackendUnavailableError, UnavailableMemoryBackend, type MemoryBrokerBackend } from "./backend.ts";
import type { HermesCatalogPort } from "./memory-catalog.ts";
import type {
  MemoryActorContext,
  MemoryBrokerStatus,
  MemoryExperienceCandidate,
  MemoryQuery,
  MemoryQueryResult,
  MemoryRecordV2,
} from "#memory-broker-contract";

/** The one upstream version whose internal adapter shape is verified below. */
export const HERMES_MEMORY_PACKAGE_NAME = "pi-hermes-memory";
export const HERMES_MEMORY_PACKAGE_VERSION = "0.9.4";
const EXPERIENCE_QUEUE_FILE = "pipiui-memory-broker-experience-v1.jsonl";
const MAX_STATUS_DETAIL = 300;

type UnknownRecord = Record<string, unknown>;

type HermesDatabaseManager = {
  getDb(): unknown;
  close(): void;
};

type HermesMemoryEntry = {
  project: string | null;
  content: string;
};

type HermesSessionEntry = {
  sessionId: string;
  content: string;
  snippet: string;
};

type HermesBridge = {
  DatabaseManager: new (memoryDir: string) => HermesDatabaseManager;
  searchMemories: (database: HermesDatabaseManager, query: string, options: {
    project?: string | null;
    limit?: number;
  }) => HermesMemoryEntry[];
  searchSessions: (database: HermesDatabaseManager, query: string, options: {
    project?: string;
    limit?: number;
  }) => HermesSessionEntry[];
  addMemory: (
    database: HermesDatabaseManager,
    content: string,
    target: "memory" | "failure",
    project: string | null,
    category: "failure" | "insight" | "convention" | null,
  ) => unknown;
  getMemoryStats: (database: HermesDatabaseManager) => { total: number };
  loadConfig: () => UnknownRecord;
  AGENT_ROOT: string;
  detectProject: (projectsMemoryDir: string | undefined, cwd: string) => { name?: unknown };
};

export type HermesMainIntegration = {
  backendFactory: () => Promise<MemoryBrokerBackend>;
  detail?: string;
  configPath?: string;
};

export class HermesMemoryAdapterError extends Error {
  readonly code: "config-incompatible" | "version-incompatible" | "shape-incompatible" | "load-failed";

  constructor(
    code: HermesMemoryAdapterError["code"],
    message: string,
  ) {
    super(message);
    this.name = "HermesMemoryAdapterError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  return message.replace(/[\u0000\r\n]/gu, " ").trim().slice(0, MAX_STATUS_DETAIL) || "unknown error";
}

function configuredAgentRoot(env: Record<string, string | undefined>): string {
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  return configured ? resolve(configured) : join(homedir(), ".pi", "agent");
}

/**
 * PipiUI's host contract always uses a full provider/model reference. Provider
 * names and model-id shapes remain open-ended; this only rejects ambiguous or
 * control-character-bearing values before they reach upstream configuration.
 */
export function configuredMemoryReviewModel(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const value = env.PIPIUI_MEMORY_REVIEW_MODEL?.trim();
  if (!value || value.length > 300 || /[\u0000-\u001f\u007f\s]/u.test(value)) return undefined;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return value;
}

/**
 * Merges only PipiUI's two policy invariants. Unknown upstream keys survive
 * unchanged so this adapter does not own Hermes configuration semantics.
 */
export async function mergeHermesConfiguration(
  env: Record<string, string | undefined> = process.env,
): Promise<{ configPath: string; config: UnknownRecord }> {
  const configPath = join(configuredAgentRoot(env), "hermes-memory-config.json");
  let existing: UnknownRecord = {};
  try {
    const state = await lstat(configPath);
    if (state.isSymbolicLink()) {
      throw new HermesMemoryAdapterError("config-incompatible", "Hermes configuration path must not be a symbolic link.");
    }
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      throw new HermesMemoryAdapterError("config-incompatible", "Hermes configuration must contain a JSON object.");
    }
    existing = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const reviewModel = configuredMemoryReviewModel(env);
  const config: UnknownRecord = {
    ...existing,
    memoryMode: "policy-only",
    flushOnCompact: false,
    ...(reviewModel ? { llmModelOverride: reviewModel } : {}),
  };
  const encoded = `${JSON.stringify(config, null, 2)}\n`;
  const directory = dirname(configPath);
  const temporary = join(directory, `.hermes-memory-config-${randomBytes(12).toString("hex")}.tmp`);
  await mkdir(directory, { recursive: true });
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(encoded, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, configPath);
    await chmod(configPath, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return { configPath, config };
}

function requireFunction<T extends Function>(value: unknown, name: string): T {
  if (typeof value !== "function") {
    throw new HermesMemoryAdapterError("shape-incompatible", `pi-hermes-memory 0.9.4 is missing ${name}.`);
  }
  return value as T;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HermesMemoryAdapterError("shape-incompatible", `pi-hermes-memory 0.9.4 has an invalid ${name}.`);
  }
  return value;
}

function packageRoot(env: Record<string, string | undefined>): { root: string; entrypoint: string } {
  const require = createRequire(import.meta.url);
  let manifestPath: string;
  const configuredRoot = env.PIPIUI_HERMES_PACKAGE_ROOT?.trim();
  const configuredModules = env.PIPIUI_HERMES_NODE_MODULES_ROOT?.trim();
  if (configuredRoot || configuredModules) {
    if (!configuredRoot || !configuredModules) {
      throw new HermesMemoryAdapterError("load-failed", "Hermes managed package root contract is incomplete.");
    }
    try {
      const modules = realpathSync(resolve(configuredModules));
      const root = realpathSync(resolve(configuredRoot));
      if (relative(modules, root) !== HERMES_MEMORY_PACKAGE_NAME
        || root !== realpathSync(join(modules, HERMES_MEMORY_PACKAGE_NAME))) {
        throw new Error("package root is outside the managed node_modules root");
      }
      manifestPath = join(root, "package.json");
    } catch {
      throw new HermesMemoryAdapterError("load-failed", "Hermes managed package root is missing or outside its Electron-owned node_modules root.");
    }
  } else {
    try {
      manifestPath = require.resolve(`${HERMES_MEMORY_PACKAGE_NAME}/package.json`);
    } catch {
      throw new HermesMemoryAdapterError("load-failed", `Unable to resolve ${HERMES_MEMORY_PACKAGE_NAME}@${HERMES_MEMORY_PACKAGE_VERSION}.`);
    }
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new HermesMemoryAdapterError("load-failed", "Unable to read pi-hermes-memory package metadata.");
  }
  if (!isRecord(manifest)
    || manifest.name !== HERMES_MEMORY_PACKAGE_NAME
    || manifest.version !== HERMES_MEMORY_PACKAGE_VERSION) {
    throw new HermesMemoryAdapterError(
      "version-incompatible",
      `Expected ${HERMES_MEMORY_PACKAGE_NAME}@${HERMES_MEMORY_PACKAGE_VERSION}.`,
    );
  }
  const root = realpathSync(dirname(manifestPath));
  const main = typeof manifest.main === "string" ? manifest.main : "";
  let entrypoint: string;
  try {
    entrypoint = realpathSync(resolve(root, main));
  } catch {
    throw new HermesMemoryAdapterError("shape-incompatible", `${HERMES_MEMORY_PACKAGE_NAME}@${HERMES_MEMORY_PACKAGE_VERSION} has no loadable main entrypoint.`);
  }
  const relativeEntrypoint = relative(root, entrypoint);
  if (!main || !relativeEntrypoint || relativeEntrypoint.startsWith("..") || isAbsolute(relativeEntrypoint)) {
    throw new HermesMemoryAdapterError("shape-incompatible", `${HERMES_MEMORY_PACKAGE_NAME}@${HERMES_MEMORY_PACKAGE_VERSION} has an invalid main entrypoint.`);
  }
  return { root, entrypoint };
}

/**
 * The upstream package exposes only its extension factory. These imports are
 * deliberately isolated here until upstream publishes a stable broker API.
 */
async function loadHermesBridge(
  env: Record<string, string | undefined> = process.env,
): Promise<{ extension: (pi: unknown) => unknown; bridge: HermesBridge }> {
  const hermes = packageRoot(env);
  const moduleURL = (relativePath: string) => pathToFileURL(join(hermes.root, relativePath)).href;
  let extensionModule: UnknownRecord;
  let databaseModule: UnknownRecord;
  let memoryStoreModule: UnknownRecord;
  let sessionSearchModule: UnknownRecord;
  let configModule: UnknownRecord;
  let pathsModule: UnknownRecord;
  let projectModule: UnknownRecord;
  try {
    [extensionModule, databaseModule, memoryStoreModule, sessionSearchModule, configModule, pathsModule, projectModule] = await Promise.all([
      import(pathToFileURL(hermes.entrypoint).href) as Promise<UnknownRecord>,
      import(moduleURL("src/store/db.ts")) as Promise<UnknownRecord>,
      import(moduleURL("src/store/sqlite-memory-store.ts")) as Promise<UnknownRecord>,
      import(moduleURL("src/store/session-search.ts")) as Promise<UnknownRecord>,
      import(moduleURL("src/config.ts")) as Promise<UnknownRecord>,
      import(moduleURL("src/paths.ts")) as Promise<UnknownRecord>,
      import(moduleURL("src/project.ts")) as Promise<UnknownRecord>,
    ]);
  } catch (error) {
    throw new HermesMemoryAdapterError("load-failed", `Unable to load ${HERMES_MEMORY_PACKAGE_NAME}@${HERMES_MEMORY_PACKAGE_VERSION}: ${boundedDetail(error)}`);
  }
  const extension = requireFunction<(pi: unknown) => unknown>(extensionModule.default, "default extension factory");
  const bridge: HermesBridge = {
    DatabaseManager: requireFunction<HermesBridge["DatabaseManager"]>(databaseModule.DatabaseManager, "DatabaseManager"),
    searchMemories: requireFunction<HermesBridge["searchMemories"]>(memoryStoreModule.searchMemories, "searchMemories"),
    searchSessions: requireFunction<HermesBridge["searchSessions"]>(sessionSearchModule.searchSessions, "searchSessions"),
    addMemory: requireFunction<HermesBridge["addMemory"]>(memoryStoreModule.addMemory, "addMemory"),
    getMemoryStats: requireFunction<HermesBridge["getMemoryStats"]>(memoryStoreModule.getMemoryStats, "getMemoryStats"),
    loadConfig: requireFunction<HermesBridge["loadConfig"]>(configModule.loadConfig, "loadConfig"),
    AGENT_ROOT: requireString(pathsModule.AGENT_ROOT, "AGENT_ROOT"),
    detectProject: requireFunction<HermesBridge["detectProject"]>(projectModule.detectProject, "detectProject"),
  };
  return { extension, bridge };
}

function loadedHermesConfig(bridge: HermesBridge): UnknownRecord {
  const config = bridge.loadConfig();
  if (!isRecord(config)) {
    throw new HermesMemoryAdapterError("shape-incompatible", "pi-hermes-memory 0.9.4 returned an invalid configuration shape.");
  }
  return config;
}

function memoryDirectory(bridge: HermesBridge): string {
  const config = loadedHermesConfig(bridge);
  const configured = typeof config.memoryDir === "string" ? config.memoryDir.trim() : "";
  const legacy = join(bridge.AGENT_ROOT, "memory");
  return !configured || resolve(configured) === resolve(legacy)
    ? join(bridge.AGENT_ROOT, "pi-hermes-memory")
    : configured;
}

function projectName(bridge: HermesBridge, context: MemoryActorContext): string | null {
  const config = loadedHermesConfig(bridge);
  const projectsMemoryDir = typeof config.projectsMemoryDir === "string" ? config.projectsMemoryDir : undefined;
  const project = bridge.detectProject(projectsMemoryDir, context.projectRoot);
  return typeof project.name === "string" && project.name.trim() ? project.name : null;
}

function searchLimit(query: MemoryQuery): number {
  // Hermes caps its public tools at 20. The broker's byte budget determines a
  // narrower request budget while the contract still caps the returned count.
  return Math.max(1, Math.min(20, Math.ceil(query.budget / 100)));
}

function applicationMatches(content: string, query: MemoryQuery): boolean {
  const lowered = content.toLowerCase();
  return (!query.bundleID || lowered.includes(`[app:${query.bundleID.toLowerCase()}]`))
    && (!query.appName || lowered.includes(`[app-name:${query.appName.toLowerCase()}]`));
}

function visibleClaim(content: string): string {
  return content.split("\n", 1)[0]?.trim() || content.trim();
}

function candidateCategory(candidate: MemoryExperienceCandidate): "failure" | "insight" | "convention" | null {
  if (candidate.claimKind === "failure" || candidate.claimKind === "computer_failure" || candidate.outcome === "failure") {
    return "failure";
  }
  if (candidate.claimKind === "task") return "convention";
  return "insight";
}

function candidateContent(candidate: MemoryExperienceCandidate): string {
  const computer = candidate.evidence.flatMap((entry) => entry.computer ? [entry.computer] : [])[0];
  const metadata = [
    "[pipiui-memory-broker:v1]",
    `[kind:${candidate.kind}]`,
    `[claim-kind:${candidate.claimKind}]`,
    `[outcome:${candidate.outcome}]`,
    ...(computer?.bundleID ? [`[app:${computer.bundleID}]`] : []),
    ...(computer?.appName ? [`[app-name:${computer.appName.toLowerCase()}]`] : []),
  ];
  const evidence = candidate.evidence.map((item) => item.summary).filter(Boolean).join("; ");
  return [candidate.claim, metadata.join(" "), ...(evidence ? [`Evidence: ${evidence}`] : [])].join("\n");
}

class DurableExperienceQueue {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async append(candidate: MemoryExperienceCandidate, context: MemoryActorContext, reason: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const record = JSON.stringify({
      version: 1,
      kind: "pipiui-memory-experience",
      queuedAt: new Date().toISOString(),
      reason,
      projectRoot: context.projectRoot,
      actor: { agentID: context.agentID, runID: context.runID, role: context.role },
      candidate,
    });
    const handle = await open(this.path, "a", 0o600);
    try {
      await handle.writeFile(`${record}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async pendingCount(): Promise<number> {
    try {
      const raw = await readFile(this.path, "utf8");
      return raw.split("\n").filter((line) => line.trim()).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }
}

/**
 * Real main-only adapter for pi-hermes-memory 0.9.4. Its internals are checked
 * once at load time; replace this file when upstream offers a public broker API.
 */
export class HermesMemoryBrokerBackend implements MemoryBrokerBackend {
  private readonly bridge: HermesBridge;
  /** Catalog owns lifecycle; Hermes remains the real FTS write/query/verify engine. */
  readonly catalogPort: HermesCatalogPort;
  readonly scoreCatalogRecord: (text: string, record: MemoryRecordV2) => Promise<number>;
  private readonly database: HermesDatabaseManager;
  private readonly queue: DurableExperienceQueue;
  private failure: string | undefined;
  private closed = false;

  constructor(bridge: HermesBridge) {
    this.bridge = bridge;
    const directory = memoryDirectory(bridge);
    this.database = new bridge.DatabaseManager(directory);
    this.queue = new DurableExperienceQueue(join(directory, EXPERIENCE_QUEUE_FILE));
    this.catalogPort = {
      add: async (record) => this.addCatalogRecord(record),
      verify: async (record, hermesID) => this.verifyCatalogRecord(record, hermesID),
    };
    this.scoreCatalogRecord = async (text, record) => this.scoreRecord(text, record);
  }

  async query(query: MemoryQuery, context: MemoryActorContext): Promise<MemoryQueryResult[]> {
    try {
      this.assertOpen();
      const limit = searchLimit(query);
      const values = query.scope === "session"
        ? this.bridge.searchSessions(this.database, query.text, { project: projectName(this.bridge, context) ?? undefined, limit: limit * 2 })
          .filter((entry) => entry.sessionId === context.chatSessionID)
          .filter((entry) => applicationMatches(entry.content, query))
          .slice(0, limit)
          .map((entry, index) => ({ claim: visibleClaim(entry.snippet || entry.content), score: 1 / (index + 1) }))
        : this.projectResults(query, context, limit);
      return values;
    } catch (error) {
      this.failure = `Hermes query unavailable: ${boundedDetail(error)}`;
      throw new MemoryBackendUnavailableError(this.failure);
    }
  }

  async ingest(candidate: MemoryExperienceCandidate, context: MemoryActorContext, durable: boolean): Promise<void> {
    try {
      this.assertOpen();
      // Quarantined child observations and session-only claims never become an
      // implicit Hermes durable write. The fsync'd versioned queue is observable
      // through status until a trusted main promotion/review consumes it.
      if (!durable || candidate.scope !== "project") {
        await this.queue.append(candidate, context, durable ? "session-scope" : "quarantined");
        return;
      }
      this.bridge.addMemory(
        this.database,
        candidateContent(candidate),
        candidateCategory(candidate) === "failure" ? "failure" : "memory",
        projectName(this.bridge, context),
        candidateCategory(candidate),
      );
    } catch (error) {
      this.failure = `Hermes experience persistence unavailable: ${boundedDetail(error)}`;
      throw new MemoryBackendUnavailableError(this.failure);
    }
  }

  async verifyImported(candidate: MemoryExperienceCandidate, context: MemoryActorContext): Promise<boolean> {
    try {
      this.assertOpen();
      return this.projectResults({
        text: candidate.claim,
        budget: 1_200,
        scope: "project",
      }, context, 20).some((entry) => entry.claim === candidate.claim);
    } catch (error) {
      this.failure = `Hermes import readback unavailable: ${boundedDetail(error)}`;
      return false;
    }
  }

  private async addCatalogRecord(record: MemoryRecordV2): Promise<{ id: string }> {
    this.assertOpen();
    this.bridge.addMemory(this.database, `${record.claim}\n[pipiui-memory-catalog:v2] [catalog-id:${record.id}]`, "memory", record.scope.project, "insight");
    return { id: record.id };
  }

  private async verifyCatalogRecord(record: MemoryRecordV2, _hermesID?: string): Promise<boolean> {
    this.assertOpen();
    return this.projectResults({ text: record.claim, budget: 1_200, scope: "project" }, {
      projectRoot: record.scope.project, chatSessionID: "catalog", bridgeRoutingKey: "catalog", agentID: "main", runID: "catalog", role: "main",
    }, 20).some((entry) => entry.claim === record.claim);
  }

  private async scoreRecord(text: string, record: MemoryRecordV2): Promise<number> {
    if (!await this.verifyCatalogRecord(record, record.hermesID)) return 0;
    const terms = text.toLocaleLowerCase("en-US").split(/\s+/u).filter(Boolean);
    const claim = record.claim.toLocaleLowerCase("en-US");
    return terms.length ? terms.filter((term) => claim.includes(term)).length / terms.length : 0;
  }

  async status(): Promise<MemoryBrokerStatus> {
    if (this.closed) return { ready: false, detail: "Hermes memory backend is closed." };
    if (this.failure) return { ready: false, detail: this.failure };
    try {
      // Opens the native database and verifies the FTS-backed schema path rather
      // than reporting ready merely because the extension module imported.
      this.bridge.getMemoryStats(this.database);
      const pending = await this.queue.pendingCount();
      return {
        ready: true,
        detail: pending > 0
          ? `Hermes ${HERMES_MEMORY_PACKAGE_VERSION} is ready; ${pending} verified experience candidate${pending === 1 ? " is" : "s are"} pending trusted review.`
          : `Hermes ${HERMES_MEMORY_PACKAGE_VERSION} FTS backend is ready.`,
      };
    } catch (error) {
      this.failure = `Hermes backend degraded: ${boundedDetail(error)}`;
      return { ready: false, detail: this.failure };
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.database.close();
    } catch {
      // Upstream owns its native close semantics; shutdown remains non-blocking.
    }
  }

  private projectResults(query: MemoryQuery, context: MemoryActorContext, limit: number): MemoryQueryResult[] {
    const project = projectName(this.bridge, context);
    const entries = [
      ...(project ? this.bridge.searchMemories(this.database, query.text, { project, limit }) : []),
      ...this.bridge.searchMemories(this.database, query.text, { project: null, limit }),
    ];
    const seen = new Set<string>();
    return entries
      .filter((entry) => applicationMatches(entry.content, query))
      .filter((entry) => {
        const claim = visibleClaim(entry.content);
        if (seen.has(claim)) return false;
        seen.add(claim);
        return true;
      })
      .slice(0, limit)
      .map((entry, index) => ({ claim: visibleClaim(entry.content), score: 1 / (index + 1) }));
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Hermes memory backend is closed.");
    if (this.failure) throw new Error(this.failure);
  }
}

/**
 * Main-only programmatic backend constructor. It intentionally does not call the
 * upstream extension factory, so tests/hosts can exercise the verified storage
 * adapter without registering a second set of Hermes lifecycle hooks.
 */
export async function createHermesMemoryBrokerBackend(
  env: Record<string, string | undefined> = process.env,
): Promise<MemoryBrokerBackend> {
  const { bridge } = await loadHermesBridge(env);
  return new HermesMemoryBrokerBackend(bridge);
}

/** Main-only composition point. Worker/operator never import this module. */
export async function installHermesMainIntegration(
  pi: unknown,
  env: Record<string, string | undefined> = process.env,
): Promise<HermesMainIntegration> {
  try {
    const { configPath } = await mergeHermesConfiguration(env);
    const { extension, bridge } = await loadHermesBridge(env);
    await extension(pi);
    return {
      configPath,
      backendFactory: async () => new HermesMemoryBrokerBackend(bridge),
    };
  } catch (error) {
    const detail = `Hermes memory degraded: ${boundedDetail(error)}`;
    return {
      detail,
      backendFactory: async () => new UnavailableMemoryBackend(detail),
    };
  }
}
