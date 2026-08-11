"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const path = require("node:path");
const node_child_process = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const node_readline = require("node:readline");
const require$$3 = require("node:util");
const http = require("node:http");
const crypto$1 = require("node:crypto");
const require$$14 = require("node:fs/promises");
const PIPI_HOST_PROTOCOL_VERSION = 2;
const PIPI_HOST_IPC_CHANNEL = "pipi-host:v1";
const enabled = (f, key) => Boolean(f?.[key]);
const ext = (args, path2) => {
  if (path2) args.push("-e", path2);
};
function sanitizeEnvironment(env) {
  const exact = /* @__PURE__ */ new Set(["PIPIUI_AGENTS_DIR", "PIPIUI_BRIDGE_PORT", "PIPIUI_MAIN_CWD", "PIPIUI_MAIN_MODEL", "PIPIUI_MAIN_MODEL_FILE", "PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE", "PIPIUI_SESSION_KEY", "PIPIUI_SESSION_CAPABILITY", "PIPIUI_HOST_PROTOCOL", "PIPIUI_SKILL_READ_BLOCK", "PIPIUI_WEB_ACCESS_EXT", "PIPIUI_ARXIV_EXT", "PIPIUI_WORKTREE"]);
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== void 0 && !exact.has(key) && !["PIPIUI_AGENT_", "PIPIUI_MEMORY_", "PIPIUI_COMPUTER_", "PIPIUI_SEARCH_", "PIPIUI_SUBAGENT_", "PIPIUI_WORKTREE_", "PIPIUI_HERMES_"].some((prefix) => key.startsWith(prefix))));
}
function assemblePiSpawn(input) {
  const args = [];
  const env = {};
  const f = input.features ?? {};
  const p = input.paths;
  if (input.sessionPath) args.push("--session", input.sessionPath);
  if (enabled(f, "philosophy")) ext(args, p.philosophy);
  if (enabled(f, "generateImage")) ext(args, p.media);
  if (enabled(f, "git")) ext(args, p.git);
  if (enabled(f, "reload")) ext(args, p.reload);
  if (enabled(f, "webSearch")) {
    ext(args, p.webSearch);
    if (p.webSearch) env.PIPIUI_WEB_ACCESS_EXT = p.webSearch;
  }
  if (enabled(f, "arxivFetch")) {
    ext(args, p.arxivFetchPackage);
    if (p.arxivFetchPackage) env.PIPIUI_ARXIV_EXT = p.arxivFetchPackage;
  }
  if (enabled(f, "mcp")) ext(args, p.mcp);
  if (enabled(f, "skillLoader")) ext(args, p.skillLoader);
  if (enabled(f, "searchScope")) {
    ext(args, p.searchScope);
    if (p.searchScope) {
      env.PIPIUI_SEARCH_SCOPE_EXT = p.searchScope;
      env.PIPIUI_SEARCH_GRANT_FILE = path.join(os.homedir(), "Library", "Application Support", "PipiUI", "search-grants", `${input.grantSessionKey ?? "default"}.json`);
    }
  }
  if (enabled(f, "codexServerTools")) ext(args, p.codexServerTools);
  if (enabled(f, "claudeServerTools")) ext(args, p.claudeServerTools);
  args.push(...input.excludeToolsArgs ?? []);
  if (enabled(f, "subagent") && p.subagentDir) {
    ext(args, p.subagentDir);
    env.PIPIUI_SUBAGENT_EXT = p.subagentDir;
    env.PIPIUI_MAIN_CWD = input.cwd;
    env.PIPIUI_WORKTREE_FINALIZER = "pi";
    if (p.agentsDir) env.PIPIUI_AGENTS_DIR = p.agentsDir;
    const support = path.join(os.homedir(), "Library", "Application Support", "PipiUI");
    env.PIPIUI_SUBAGENT_MODELS_FILE = path.join(support, "subagent-models.json");
    env.PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE = path.join(support, "subagent-model-capabilities.json");
    env.PIPIUI_MAIN_MODEL_FILE = path.join(support, "main-model.json");
    if (input.mainModelId) env.PIPIUI_MAIN_MODEL = input.mainModelId;
  }
  if (!input.bridgePort) return { args, env };
  if (enabled(f, "memoryBroker")) {
    ext(args, p.memoryBroker);
    if (p.memoryBroker) {
      env.PIPIUI_MEMORY_BROKER_MODE = "main";
      env.PIPIUI_MEMORY_PROJECT_ROOT = input.cwd;
    }
  }
  if (enabled(f, "browser")) ext(args, p.webview);
  if (enabled(f, "philosophy")) ext(args, p.planRuntime);
  env.PIPIUI_BRIDGE_PORT = String(input.bridgePort);
  env.PIPIUI_SESSION_KEY = input.bridgeRoutingKey ?? "";
  if (input.sessionCapability) {
    env.PIPIUI_HOST_PROTOCOL = "1";
    env.PIPIUI_SESSION_CAPABILITY = input.sessionCapability;
  }
  if (enabled(f, "computerUse") && p.computerUse && input.computerCapability && input.computerDescriptor) {
    ext(args, p.computerUse);
    env.PIPIUI_COMPUTER_EXT = p.computerUse;
    env.PIPIUI_COMPUTER_CAPABILITY = input.computerCapability;
    env.PIPIUI_COMPUTER_RUNTIME_PROTOCOL = "1";
    env.PIPIUI_COMPUTER_DISPLAY_ID = String(input.computerDescriptor.displayID);
    env.PIPIUI_COMPUTER_WIDTH = String(input.computerDescriptor.width);
    env.PIPIUI_COMPUTER_HEIGHT = String(input.computerDescriptor.height);
  }
  return { args, env };
}
function declaredEntrypoint(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const p = manifest?.pi?.extensions?.[0];
    const candidate = typeof p === "string" ? path.resolve(root, p) : void 0;
    return candidate && candidate.startsWith(path.resolve(root) + "/") && fs.existsSync(candidate) ? candidate : void 0;
  } catch {
    return void 0;
  }
}
function resolvePiExecutable(env = process.env) {
  const fromPath = (env.PATH ?? "").split(":").filter(Boolean).map((dir) => path.join(dir, "pi"));
  const candidates = [...fromPath, path.join(os.homedir(), ".npm-global", "bin", "pi"), "/opt/homebrew/bin/pi", "/usr/local/bin/pi", path.join(os.homedir(), ".bun", "bin", "pi"), path.join(os.homedir(), ".local", "bin", "pi")];
  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? "pi";
}
function withToolPath(env, piExecutable) {
  const dirs = [path.dirname(piExecutable), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const existing = env.PATH ?? "";
  return { ...env, PATH: [.../* @__PURE__ */ new Set([...dirs, ...existing.split(":").filter(Boolean)])].join(":") };
}
function defaultRuntimeRoot() {
  return path.join(os.homedir(), "Library", "Application Support", "PipiUI");
}
const MANAGED_PACKAGES = [{ name: "pi-web-access", version: "0.20.0" }, { name: "pi-mcp-extension", version: "1.5.0" }];
const fileIfPresent$1 = (...segments) => {
  const path$1 = path.join(...segments);
  return fs.existsSync(path$1) ? path$1 : void 0;
};
const packageIfPresent = (...segments) => {
  const dir = path.join(...segments);
  return fs.existsSync(path.join(dir, "package.json")) ? dir : void 0;
};
function resolveSpawnPaths(runtimeRoot = defaultRuntimeRoot()) {
  const ext2 = path.join(runtimeRoot, "pi-ext");
  const managed = ({ name, version }) => declaredEntrypoint(path.join(runtimeRoot, "managed-npm", `${name}-${version}`, "node_modules", name));
  return { philosophy: declaredEntrypoint(path.join(runtimeRoot, "pi-philosophy")), media: fileIfPresent$1(runtimeRoot, "pipiui-media.ts"), git: fileIfPresent$1(runtimeRoot, "pipiui-git.ts"), reload: fileIfPresent$1(runtimeRoot, "pipiui-reload.ts"), skillLoader: fileIfPresent$1(runtimeRoot, "pipiui-skillloader.ts"), planRuntime: fileIfPresent$1(runtimeRoot, "pipiui-plan-runtime.ts"), searchScope: fileIfPresent$1(runtimeRoot, "pipiui-search-scope.ts"), codexServerTools: fileIfPresent$1(runtimeRoot, "pipiui-codex-server-tools.ts"), claudeServerTools: fileIfPresent$1(runtimeRoot, "pipiui-claude-server-tools.ts"), computerUse: fileIfPresent$1(runtimeRoot, "pipiui-computer-use.ts"), webview: fileIfPresent$1(runtimeRoot, "pipiui-electron-webview.ts"), subagentDir: fileIfPresent$1(ext2, "subagent"), agentsDir: fileIfPresent$1(ext2, "agents"), memoryBroker: packageIfPresent(ext2, "packages", "memory-broker"), arxivFetchPackage: packageIfPresent(ext2, "packages", "arxiv-fetch"), webSearch: managed(MANAGED_PACKAGES[0]), mcp: managed(MANAGED_PACKAGES[1]) };
}
function installElectronBrowserExtension(runtimeRoot, sourcePath = process.env.PIPIUI_BROWSER_EXTENSION_PATH ?? path.join(runtimeRoot, "pipiui-webview.ts")) {
  const skip = (reason) => {
    console.warn(`[pipi-install] browser extension not installed: ${reason} (${sourcePath})`);
    return void 0;
  };
  let source;
  try {
    source = fs.readFileSync(sourcePath, "utf8");
  } catch (error) {
    return skip(error instanceof Error ? error.message : String(error));
  }
  if (sourcePath.endsWith(".swift")) {
    const embedded = source.match(/private static let source = #"""\r?\n([\s\S]*?)\r?\n"""#/);
    if (!embedded) return skip("no embedded source block");
    source = embedded[1];
  }
  if (!source.includes('name: "browser"') || !source.includes("async function bridge(")) return skip("source is not the canonical browser tool");
  source = source.replace("const KEY = process.env.PIPIUI_SESSION_KEY;", "const KEY = process.env.PIPIUI_SESSION_KEY;\nconst CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;").replace('JSON.stringify({ sessionKey: KEY, action: "browser_cancel", requestID })', 'JSON.stringify({ schemaVersion: 1, sessionCapability: CAPABILITY, action: "browser_action", event: { action: "browser_cancel", requestID } })').replace("JSON.stringify({ sessionKey: KEY, action, requestID, ...params })", 'JSON.stringify({ schemaVersion: 1, sessionCapability: CAPABILITY, action: "browser_action", event: { action, requestID, ...params } })').replaceAll("screenshot, help", "screenshot, back, forward, reload, help").replaceAll("screenshot | help", "screenshot | back | forward | reload | help").replaceAll("click, input, select", "click, input, type, select").replace('        case "click":', `        case "type": {
          if (!params.selector || typeof params.text !== "string") return text('browser type requires selector and text.\\n\\n' + HELP);
          const r = await bridge("type", { selector: params.selector, text: params.text, scope: params.scope ?? "viewport" }, signal);
          return r.ok ? text(formatObservation(r), r) : bridgeFailure(r);
        }
        case "click":`).replace('  "help                    This text.",', '  "back | forward | reload Navigate the active built-in browser tab.",\n  "help                    This text.",').replace('        case "help":', `        case "back":
        case "forward":
        case "reload": {
          const r = await bridge(params.action, { scope: params.scope ?? "viewport" }, signal);
          return r.ok ? text(formatObservation(r), r) : bridgeFailure(r);
        }
        case "help":`);
  const target = path.join(runtimeRoot, "pipiui-electron-webview.ts");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(target, source, "utf8");
  return target;
}
const LEASE_PROTOCOL_VERSION = 1;
const DEFAULT_HEARTBEAT_MS = 15e3;
const DEFAULT_TTL_MS = 45e3;
class LeaseManager {
  sessionId;
  leasePath;
  holder;
  pid;
  host;
  heartbeatMs;
  ttlMs;
  now;
  instanceId = crypto.randomUUID();
  timer;
  owned = false;
  constructor(options) {
    this.sessionId = options.sessionId;
    this.leasePath = path.join(path.dirname(options.sessionPath), `${options.sessionId}.lease.json`);
    this.holder = options.holder ?? "pipiui-electron";
    this.pid = options.pid ?? process.pid;
    this.host = options.hostname ?? os.hostname();
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    process.once("exit", () => this.releaseSync());
  }
  record() {
    const timestamp = new Date(this.now()).toISOString();
    return { protocolVersion: LEASE_PROTOCOL_VERSION, holder: this.holder, pid: this.pid, hostname: this.host, instanceId: this.instanceId, acquiredAt: timestamp, heartbeatAt: timestamp, expiresAt: new Date(this.now() + this.ttlMs).toISOString() };
  }
  async read() {
    try {
      return JSON.parse(await fs.promises.readFile(this.leasePath, "utf8"));
    } catch {
      return void 0;
    }
  }
  expired(record2) {
    return !Number.isFinite(Date.parse(record2.expiresAt)) || Date.parse(record2.expiresAt) <= this.now();
  }
  same(record2) {
    return record2.instanceId === this.instanceId;
  }
  startHeartbeat() {
    if (!this.timer) this.timer = setInterval(() => {
      void this.heartbeat();
    }, this.heartbeatMs);
    this.timer.unref?.();
  }
  stopHeartbeat() {
    if (this.timer) clearInterval(this.timer);
    this.timer = void 0;
  }
  async query() {
    const holder = await this.read();
    if (!holder) return { sessionId: this.sessionId, writable: true };
    if (this.expired(holder)) {
      await fs.promises.rm(this.leasePath, { force: true });
      return { sessionId: this.sessionId, writable: true };
    }
    if (this.same(holder)) return { sessionId: this.sessionId, writable: true, holder };
    return { sessionId: this.sessionId, writable: false, holder };
  }
  async acquire() {
    if (this.owned) {
      await this.heartbeat();
      return this.query();
    }
    await fs.promises.mkdir(path.dirname(this.leasePath), { recursive: true });
    const record2 = this.record();
    try {
      const file = await fs.promises.open(this.leasePath, "wx");
      await file.writeFile(JSON.stringify(record2));
      await file.close();
      this.owned = true;
      this.startHeartbeat();
      return { sessionId: this.sessionId, writable: true, holder: record2 };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = await this.read();
      if (current && this.expired(current)) {
        await fs.promises.rm(this.leasePath, { force: true });
        return this.acquire();
      }
      return { sessionId: this.sessionId, writable: false, holder: current };
    }
  }
  async heartbeat() {
    if (!this.owned) return this.query();
    const current = await this.read();
    if (!current || !this.same(current)) {
      this.owned = false;
      this.stopHeartbeat();
      return this.query();
    }
    const next = { ...current, heartbeatAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + this.ttlMs).toISOString() };
    const temporary = `${this.leasePath}.${this.instanceId}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(next));
    await fs.promises.rename(temporary, this.leasePath);
    return { sessionId: this.sessionId, writable: true, holder: next };
  }
  async release() {
    this.stopHeartbeat();
    const current = await this.read();
    if (current && this.same(current)) await fs.promises.rm(this.leasePath, { force: true });
    this.owned = false;
  }
  releaseSync() {
    if (!this.owned || !fs.existsSync(this.leasePath)) return;
    try {
      const current = JSON.parse(fs.readFileSync(this.leasePath, "utf8"));
      if (this.same(current)) fs.unlinkSync(this.leasePath);
    } catch {
    }
  }
  async expire() {
    const current = await this.read();
    if (!current || !this.expired(current)) return false;
    await fs.promises.rm(this.leasePath, { force: true });
    return true;
  }
  async forceTakeover() {
    this.stopHeartbeat();
    this.owned = false;
    await fs.promises.rm(this.leasePath, { force: true });
    return this.acquire();
  }
}
const run = require$$3.promisify(node_child_process.execFile);
const GIT_TIMEOUT_MS = 5e3, GIT_MAX_BUFFER = 1024 * 1024;
const EMPTY_GIT_STATUS = Object.freeze({ isRepo: false, isDetached: false, localBranches: [], ahead: 0, behind: 0, isDirty: false, staged: 0, unstaged: 0, untracked: 0 });
async function git(cwd, args) {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, windowsHide: true });
    return stdout;
  } catch {
    return void 0;
  }
}
async function gitStrict(cwd, args) {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, windowsHide: true });
    return stdout;
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? "").trim();
    throw new Error(detail || "git command failed");
  }
}
function parsePorcelain(output) {
  let staged = 0, unstaged = 0, untracked = 0;
  for (const line of output.split("\n")) {
    if (line.length < 2) continue;
    const [x, y] = [line[0], line[1]];
    if (x === "?" && y === "?") {
      untracked += 1;
      continue;
    }
    if (x === "?" || y === "?") continue;
    if (x !== " ") staged += 1;
    if (y !== " ") unstaged += 1;
  }
  return { staged, unstaged, untracked };
}
function parseUpstreamCounts(output) {
  const parts = output.trim().split(/\s+/).filter(Boolean);
  const behind = Number(parts[0]), ahead = Number(parts[1]);
  return Number.isInteger(behind) && Number.isInteger(ahead) ? { behind, ahead } : { behind: 0, ahead: 0 };
}
function githubBrowserURL(remote) {
  const raw = remote.trim();
  const marker = /github\.com[:/]/i.exec(raw);
  if (!marker) return void 0;
  let path2 = raw.slice(marker.index + marker[0].length).split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
  if (path2.toLowerCase().endsWith(".git")) path2 = path2.slice(0, -4);
  const [owner, repo] = path2.split("/").filter(Boolean);
  return owner && repo ? `https://github.com/${owner}/${repo}` : void 0;
}
function validateBranchName(branch) {
  const name = branch.trim();
  if (!name) throw new Error("branch name is empty");
  if (name.startsWith("-")) throw new Error(`invalid branch name: ${branch}`);
  return name;
}
async function probeGit(cwd) {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.trim() !== "true") return { ...EMPTY_GIT_STATUS, localBranches: [] };
  const [head, sha, branches, origin, porcelain, upstreamRef] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["rev-parse", "--short", "HEAD"]),
    git(cwd, ["branch", "--format=%(refname:short)"]),
    git(cwd, ["remote", "get-url", "origin"]),
    git(cwd, ["status", "--porcelain"]),
    git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
  ]);
  const headRef = head?.trim() ?? "";
  const counts = parsePorcelain(porcelain ?? "");
  const upstream = upstreamRef?.trim() || void 0;
  const { behind, ahead } = upstream ? parseUpstreamCounts(await git(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]) ?? "") : { behind: 0, ahead: 0 };
  return {
    isRepo: true,
    currentBranch: headRef && headRef !== "HEAD" ? headRef : void 0,
    isDetached: headRef === "HEAD",
    shortSHA: sha?.trim() || void 0,
    localBranches: (branches ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
    upstream,
    ahead,
    behind,
    isDirty: counts.staged + counts.unstaged + counts.untracked > 0,
    ...counts,
    githubURL: origin ? githubBrowserURL(origin) : void 0
  };
}
async function checkoutBranch(cwd, branch) {
  await gitStrict(cwd, ["checkout", validateBranchName(branch)]);
  return probeGit(cwd);
}
const MAX_BODY_BYTES = 4 * 1024 * 1024;
function safeEqual(a, b) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto$1.timingSafeEqual(left, right);
}
class HostBridge {
  constructor(handlers) {
    this.handlers = handlers;
  }
  server;
  port;
  /** capability → sessionId. The capability is the only credential; the map is the router. */
  sessions = /* @__PURE__ */ new Map();
  computers = /* @__PURE__ */ new Map();
  /** Idempotent: repeated calls return the port of the already-listening server. */
  async listen() {
    if (this.port !== void 0) return this.port;
    const server = http.createServer((request, response) => this.route(request, response));
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("bridge failed to bind a TCP port");
    this.server = server;
    this.port = address.port;
    return this.port;
  }
  /** Mint this session's capability. Re-registering a session rotates it. */
  register(sessionId) {
    for (const [capability2, owner] of this.sessions) if (owner === sessionId) this.sessions.delete(capability2);
    const capability = crypto$1.randomBytes(32).toString("base64url");
    this.sessions.set(capability, sessionId);
    return capability;
  }
  registerComputer(sessionId) {
    for (const [capability2, owner] of this.computers) if (owner === sessionId) this.computers.delete(capability2);
    const capability = crypto$1.randomBytes(32).toString("base64url");
    this.computers.set(capability, sessionId);
    return capability;
  }
  unregister(sessionId) {
    for (const [capability, owner] of this.sessions) if (owner === sessionId) this.sessions.delete(capability);
    for (const [capability, owner] of this.computers) if (owner === sessionId) this.computers.delete(capability);
  }
  async close() {
    this.sessions.clear();
    this.computers.clear();
    const server = this.server;
    this.server = void 0;
    this.port = void 0;
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }
  sessionFor(capability) {
    if (typeof capability !== "string" || !capability) return void 0;
    for (const [known, sessionId] of this.sessions) if (safeEqual(known, capability)) return sessionId;
    return void 0;
  }
  route(request, response) {
    if (request.method !== "POST" || (request.url ?? "").split("?")[0] !== "/rpc") {
      this.reply(response, 404, { ok: false, error: "not found" });
      request.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        this.reply(response, 413, { ok: false, error: "payload too large" });
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (response.writableEnded) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return this.reply(response, 400, { ok: false, error: "invalid JSON body" });
      }
      void this.dispatch(body, response);
    });
    request.on("error", () => {
      if (!response.writableEnded) this.reply(response, 400, { ok: false, error: "request aborted" });
    });
  }
  async dispatch(body, response) {
    const computerSession = body && typeof body === "object" && typeof body.computerCapability === "string" ? [...this.computers].find(([capability]) => safeEqual(capability, body.computerCapability))?.[1] : void 0;
    if (computerSession && body.sessionKey === computerSession && typeof body.action === "string" && body.action.startsWith("computer_")) {
      try {
        return this.reply(
          response,
          200,
          await (this.handlers.onComputerAction?.(body, computerSession) ?? Promise.resolve({ ok: false, error: "computer host unavailable" }))
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.reply(response, 200, {
          ok: false,
          error: message,
          runtimeError: {
            code: "computer_host_error",
            message,
            retryable: true,
            requiresObservation: true
          }
        });
      }
    }
    const sessionId = body && typeof body === "object" ? this.sessionFor(body.sessionCapability) : void 0;
    if (!sessionId || body.schemaVersion !== 1) return this.reply(response, 403, { ok: false, error: "unauthorized bridge capability" });
    const event = body.event;
    if (!event || typeof event !== "object") return this.reply(response, 400, { ok: false, error: "missing event" });
    try {
      if (body.action === "agent_event") this.handlers.onAgentEvent(event, sessionId);
      else if (body.action === "plan_event") this.handlers.onPlanEvent?.(event, sessionId);
      else if (body.action === "browser_action") return this.reply(response, 200, await (this.handlers.onBrowserAction?.(event, sessionId) ?? Promise.resolve({ ok: false, error: "browser host unavailable" })));
      else return this.reply(response, 400, { ok: false, error: `unsupported action ${String(body.action)}` });
    } catch (error) {
      console.warn(`[pipi-bridge] handler error: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.reply(response, 200, { ok: true });
  }
  reply(response, status, payload) {
    if (response.writableEnded) return;
    const data = Buffer.from(JSON.stringify(payload));
    response.writeHead(status, { "content-type": "application/json", "content-length": data.length });
    response.end(data);
  }
}
const DEFAULT_FEATURES = Object.freeze({ philosophy: true, subagent: true, memoryBroker: true, git: true, generateImage: true, reload: true, webSearch: true, arxivFetch: true, mcp: true, skillLoader: true, codexServerTools: true, claudeServerTools: true, browser: true, computerUse: true });
class ProviderLoginSession {
  id;
  controller = new AbortController();
  cancelled = false;
  queue = [];
  waiters = [];
  promptResolve;
  promptReject;
  terminal;
  constructor(id) {
    this.id = id;
  }
  push(event) {
    if (event.kind === "completed" || event.kind === "failed" || event.kind === "cancelled") {
      if (this.terminal) return;
      this.terminal = event;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.queue.push(event);
  }
  next() {
    const head = this.queue.shift();
    if (head) return Promise.resolve(head);
    if (this.terminal) return Promise.resolve(this.terminal);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  prompt(p) {
    if (this.cancelled) return Promise.reject(new Error("Login cancelled"));
    if (p.type === "select" && p.options?.length === 1) return Promise.resolve(p.options[0].id);
    const event = p.type === "select" ? { kind: "prompt", promptType: "select", message: p.message, options: p.options?.map((o) => ({ id: o.id, label: o.label })) } : { kind: "prompt", promptType: p.type === "secret" ? "secret" : "text", message: p.message, placeholder: p.placeholder };
    this.push(event);
    return new Promise((resolve, reject) => {
      this.promptResolve = resolve;
      this.promptReject = reject;
    });
  }
  notify(e) {
    if (e.type === "auth_url" && e.url) {
      this.push({ kind: "auth_url", url: e.url, code: e.instructions });
    } else if (e.type === "device_code") {
      this.push({ kind: "auth_url", url: e.verificationUri ?? "", code: e.userCode, instructions: e.message });
    } else if (e.type === "info" || e.type === "progress") {
      this.push({ kind: "notice", message: e.message ?? e.type });
    }
  }
  async answer(input) {
    const resolve = this.promptResolve;
    if (!resolve) return false;
    this.promptResolve = void 0;
    this.promptReject = void 0;
    resolve(input);
    return true;
  }
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.controller.abort();
    this.queue = this.queue.filter((e) => e.kind === "completed" || e.kind === "failed" || e.kind === "cancelled");
    const reject = this.promptReject;
    if (reject) {
      this.promptReject = void 0;
      reject(new Error("Login cancelled"));
    }
  }
  interaction() {
    return {
      signal: this.controller.signal,
      prompt: (p) => this.prompt(p),
      notify: (e) => this.notify(e)
    };
  }
}
async function readAuthMetadata(authPath) {
  const map = /* @__PURE__ */ new Map();
  try {
    const raw = JSON.parse(await require$$14.readFile(authPath, "utf8"));
    for (const [providerId, entry] of Object.entries(raw ?? {})) {
      if (entry?.type === "api_key" || entry?.type === "oauth") map.set(providerId, entry.type);
    }
  } catch {
  }
  return map;
}
class ProviderAuthBackend {
  constructor(options) {
    this.options = options;
  }
  sessions = /* @__PURE__ */ new Map();
  seq = 0;
  async listProviders() {
    const stored = await readAuthMetadata(this.options.authPath);
    let registry;
    try {
      registry = await this.options.runtime.getProviders();
    } catch (err) {
      throw new Error(`无法读取 pi provider 目录：${err instanceof Error ? err.message : String(err)}`);
    }
    if (!Array.isArray(registry)) throw new Error("无法读取 pi provider 目录：返回了无效 registry");
    const result = [];
    const diagnostics = [];
    for (const provider of registry) {
      try {
        if (!provider || typeof provider.id !== "string" || !provider.id || typeof provider.name !== "string") {
          throw new Error("provider 元数据无效");
        }
        const authTypes = [];
        if (provider.auth?.oauth) authTypes.push("oauth");
        if (provider.auth?.apiKey) authTypes.push("api_key");
        if (authTypes.length === 0) continue;
        const credentialType = stored.get(provider.id);
        result.push({
          id: provider.id,
          name: provider.name,
          authTypes,
          loginLabel: provider.auth?.oauth?.loginLabel,
          authenticated: Boolean(credentialType),
          authType: credentialType
        });
      } catch (err) {
        diagnostics.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (result.length === 0 && diagnostics.length > 0) {
      throw new Error(`无法读取 pi provider 目录：${diagnostics.join("；")}`);
    }
    result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return result;
  }
  beginLogin(providerId, authType) {
    const loginId = `${providerId}-${authType}-${++this.seq}`;
    const session = new ProviderLoginSession(loginId);
    this.sessions.set(loginId, session);
    void this.runLogin(loginId, providerId, authType, session);
    return loginId;
  }
  async continueLogin(loginId, input) {
    const session = this.sessions.get(loginId);
    if (!session) return { kind: "failed", error: "登录会话不存在或已结束" };
    if (input !== void 0 && input !== "") {
      const answered = await session.answer(input);
      if (!answered && session.cancelled) return { kind: "cancelled" };
    }
    const event = await session.next();
    if (event.kind === "completed" || event.kind === "failed" || event.kind === "cancelled") {
      this.sessions.delete(loginId);
    }
    return event;
  }
  cancelLogin(loginId) {
    this.sessions.get(loginId)?.cancel();
  }
  async runLogin(loginId, providerId, authType, session) {
    try {
      await this.options.runtime.login(providerId, authType, session.interaction());
      if (!session.cancelled) {
        session.push({ kind: "completed", providerId });
        this.options.onLoginCompleted?.();
      }
    } catch (err) {
      session.push(session.cancelled ? { kind: "cancelled" } : { kind: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
}
const execFileAsync = require$$3.promisify(node_child_process.execFile);
function parseDotEnv(source) {
  const result = {};
  for (const raw of source.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw.trim());
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}
async function modelRuntimeEnvironment(agentDir, piPath, base) {
  let overlay = {};
  try {
    overlay = parseDotEnv(await require$$14.readFile(path.join(agentDir, ".env"), "utf8"));
  } catch {
  }
  return { ...base, ...overlay, PATH: [path.dirname(piPath), "/opt/homebrew/bin", "/usr/local/bin", base.PATH].filter(Boolean).join(path.delimiter), PIPIUI_PI_PATH: piPath };
}
async function resolveNode(explicit, env) {
  const executable = process.platform === "win32" ? "node.exe" : "node";
  const piSibling = env.PIPIUI_PI_PATH ? path.join(path.dirname(env.PIPIUI_PI_PATH), executable) : void 0;
  const currentNode = path.basename(process.execPath).toLowerCase().startsWith("node") ? process.execPath : void 0;
  const pathNodes = (env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, executable));
  for (const candidate of [explicit, env.PIPIUI_NODE_PATH, piSibling, ...pathNodes, "/opt/homebrew/bin/node", "/usr/local/bin/node", currentNode]) {
    if (!candidate) continue;
    try {
      await require$$14.access(candidate);
      return candidate;
    } catch {
    }
  }
  throw new Error("找不到可运行 Pi ModelRuntime 的 Node.js；请安装 pi CLI/Node.js 或设置 PIPIUI_NODE_PATH");
}
class ExternalAuthRuntime {
  constructor(options) {
    this.options = options;
  }
  async command(command, ...args) {
    const env = await modelRuntimeEnvironment(this.options.agentDir, this.options.piPath, this.options.env ?? process.env);
    const node = await resolveNode(this.options.nodePath, env);
    try {
      const { stdout } = await execFileAsync(node, [this.options.helperPath, command, ...args], { env, maxBuffer: 4 * 1024 * 1024 });
      const value = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "{}");
      if (!value.ok) throw new Error(value.error || "helper returned an invalid result");
      return value;
    } catch (error) {
      throw new Error(`外部 Pi runtime ${command} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async getProviders() {
    return (await this.command("list-providers")).providers;
  }
  async getAvailable() {
    return (await this.command("list-models")).models;
  }
  async logout(providerId) {
    await this.command("logout", providerId);
  }
  async login(providerId, authType, interaction) {
    const env = await modelRuntimeEnvironment(this.options.agentDir, this.options.piPath, this.options.env ?? process.env);
    const node = await resolveNode(this.options.nodePath, env);
    const child = node_child_process.spawn(node, [this.options.helperPath, "login-json", providerId, authType], { env, stdio: ["pipe", "pipe", "pipe"] });
    const abort = () => child.kill();
    interaction.signal?.addEventListener("abort", abort, { once: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4096);
    });
    const lines = node_readline.createInterface({ input: child.stdout });
    try {
      for await (const line of lines) {
        const event = JSON.parse(line);
        if (event.event === "prompt") child.stdin.write(`${JSON.stringify({ answer: await interaction.prompt(event.prompt) })}
`);
        else if (event.event === "notify") interaction.notify(event.notification);
        else if (event.ok) return event.result;
        else if (event.error) throw new Error(event.error);
      }
      throw new Error(stderr.trim() || `helper exited with code ${child.exitCode ?? "unknown"}`);
    } finally {
      interaction.signal?.removeEventListener("abort", abort);
      lines.close();
      child.stdin.end();
    }
  }
}
const snapshot = (value) => structuredClone(value);
const freeze = (value) => Object.freeze(value);
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
class SessionMessageQueue {
  dispatch;
  now;
  drainBehavior;
  onChange;
  sessions = /* @__PURE__ */ new Map();
  constructor(options) {
    this.dispatch = options.dispatch;
    this.now = options.now ?? Date.now;
    this.drainBehavior = options.drainBehavior ?? "prompt";
    this.onChange = options.onChange;
  }
  state(sessionId) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { items: [], turnActive: false, dispatching: false };
      this.sessions.set(sessionId, session);
    }
    return session;
  }
  changed(sessionId) {
    this.onChange?.(sessionId, this.listQueue(sessionId));
  }
  /** True while a turn is running or a queue-owned delivery is in flight. */
  isBusy(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.turnActive || session.dispatching : false;
  }
  /** Wait only for acceptance/failure of the currently-starting pi RPC, never for turn settle. */
  async waitForDispatch(sessionId) {
    await this.state(sessionId).dispatchPromise;
  }
  /**
   * Add a message for the session. When the session is idle the item is
   * dispatched immediately (`outcome: "dispatched"`); when busy it is appended
   * FIFO and returned as `outcome: "queued"` — never an "already processing"
   * error. Throws only for an empty message (no text and no attachments).
   */
  enqueue(sessionId, input) {
    const text2 = input.text ?? "";
    const attachments = snapshot(input.attachments ?? []);
    if (!text2.trim() && attachments.length === 0) throw new Error("cannot enqueue an empty message");
    const session = this.state(sessionId);
    const message = freeze({ id: crypto.randomUUID(), sessionId, text: text2, attachments, createdAt: this.now(), state: "queued" });
    session.items.push(message);
    if (session.turnActive || session.dispatching) {
      this.changed(sessionId);
      return { outcome: "queued", message: snapshot(message) };
    }
    const next = session.items.find((item) => item.state === "queued");
    const direct = next?.id === message.id;
    void this.drain(sessionId);
    const stored = session.items.find((item) => item.id === message.id) ?? message;
    return { outcome: direct ? "dispatched" : "queued", message: snapshot(stored) };
  }
  /** Snapshot of the active items for the session (queued, sending, failed). */
  listQueue(sessionId) {
    return this.state(sessionId).items.map((item) => snapshot(item));
  }
  /**
   * Restore persisted actionable items. A process restart cannot know whether a
   * previous `sending` RPC reached pi, so such entries conservatively become
   * `queued`; only `queued` and `failed` survive the restore.
   */
  restoreQueue(sessionId, items) {
    const session = this.state(sessionId);
    session.items = snapshot(items).map((item) => freeze({
      ...item,
      sessionId,
      attachments: snapshot(item.attachments ?? []),
      state: item.state === "failed" ? "failed" : "queued",
      error: item.state === "failed" ? item.error : void 0
    }));
    session.turnActive = false;
    session.dispatching = false;
    session.dispatchPromise = void 0;
    this.changed(sessionId);
  }
  /**
   * Edit an item that has not been sent yet (`queued` or `failed`). Text and
   * attachments are replaced as given; the failure state/error survives an
   * edit until the item is retried.
   */
  updateMessage(sessionId, id, input) {
    const session = this.state(sessionId);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state === "sending") throw new Error(`message ${id} is already sending`);
    const text2 = input.text ?? current.text;
    const attachments = snapshot(input.attachments !== void 0 ? input.attachments : current.attachments);
    if (!text2.trim() && attachments.length === 0) throw new Error("cannot update to an empty message");
    const updated = freeze({ ...current, text: text2, attachments, state: current.state === "queued" ? "queued" : "failed", error: current.state === "failed" ? current.error : void 0 });
    session.items[index] = updated;
    this.changed(sessionId);
    return snapshot(updated);
  }
  /** Remove an item that has not been sent yet (`queued` or `failed`). */
  removeMessage(sessionId, id) {
    const session = this.state(sessionId);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    if (session.items[index].state === "sending") throw new Error(`message ${id} is already sending`);
    const [removed] = session.items.splice(index, 1);
    this.changed(sessionId);
    return snapshot(removed);
  }
  /** Move an item to the head of the FIFO so it is delivered next on drain. */
  promoteMessage(sessionId, id) {
    const session = this.state(sessionId);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state === "sending") throw new Error(`message ${id} is already sending`);
    if (index === 0) return snapshot(current);
    session.items.splice(index, 1);
    session.items.unshift(current);
    this.changed(sessionId);
    return snapshot(current);
  }
  /**
   * Cut-in delivery. While the session is busy the item is injected into the
   * running turn with `steer` behavior and removed on success; on failure it is
   * retained as `failed`. While the session is idle the item is promoted to the
   * head and delivered like any other prompt. One queue-owned delivery per
   * session at a time.
   */
  async steerMessage(sessionId, id) {
    const session = this.state(sessionId);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state === "sending") throw new Error(`message ${id} is already sending`);
    if (session.dispatching) throw new Error(`session ${sessionId} is already delivering a message`);
    if (!session.turnActive) {
      const promoted = freeze({ ...current, state: "queued", error: void 0 });
      session.items.splice(index, 1);
      session.items.unshift(promoted);
      void this.drain(sessionId);
      return snapshot(session.items[0]);
    }
    session.dispatching = true;
    const sending = freeze({ ...current, state: "sending", error: void 0 });
    session.items[index] = sending;
    this.changed(sessionId);
    try {
      await this.dispatch(sessionId, { text: sending.text, attachments: sending.attachments }, "steer");
      if (session.items[index]?.id === id) session.items.splice(index, 1);
      this.changed(sessionId);
      return snapshot(sending);
    } catch (error) {
      const failed = freeze({ ...sending, state: "failed", error: errorMessage(error) });
      if (session.items[index]?.id === id) session.items[index] = failed;
      this.changed(sessionId);
      return snapshot(failed);
    } finally {
      session.dispatching = false;
      if (!session.turnActive) void this.drain(sessionId);
    }
  }
  /** Retry a failed item: restore it to `queued` at the head and clear its error. */
  retryMessage(sessionId, id) {
    const session = this.state(sessionId);
    const index = session.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`unknown queued message ${id}`);
    const current = session.items[index];
    if (current.state !== "failed") throw new Error(`message ${id} is ${current.state}; only failed messages can be retried`);
    const retried = freeze({ ...current, state: "queued", error: void 0 });
    session.items.splice(index, 1);
    session.items.unshift(retried);
    this.changed(sessionId);
    if (!session.turnActive && !session.dispatching) void this.drain(sessionId);
    return snapshot(retried);
  }
  /** A turn started outside the queue (host-dispatched prompt, pi agent_start). */
  markBusy(sessionId) {
    this.state(sessionId).turnActive = true;
  }
  /**
   * The session turned idle/settled. Clears the busy flag and delivers the next
   * queued item. Idempotent for duplicate idle/completion events: while a
   * delivery is in flight, or while the session is still marked busy, the drain
   * is a no-op.
   */
  async notifyIdle(sessionId) {
    const session = this.state(sessionId);
    session.turnActive = false;
    await this.drain(sessionId);
  }
  /**
   * Deliver the head queued item. No-op while the session is busy or while a
   * delivery is in flight. After a failed send (no turn started) the FIFO
   * continues automatically; after a successful send the next item waits for
   * the next `notifyIdle` — never dispatched while the turn is streaming.
   */
  async drain(sessionId) {
    const session = this.state(sessionId);
    if (session.dispatching || session.turnActive) return;
    const index = session.items.findIndex((item) => item.state === "queued");
    if (index < 0) return;
    const delivery = this.send(sessionId, session.items[index], this.drainBehavior);
    const acknowledgement = delivery.then(() => void 0);
    session.dispatchPromise = acknowledgement;
    const delivered = await delivery;
    if (session.dispatchPromise === acknowledgement) session.dispatchPromise = void 0;
    if (!delivered && !session.turnActive && !session.dispatching) await this.drain(sessionId);
  }
  /**
   * Single-flight delivery of one item. On success the item leaves the queue
   * (delivered) and the session is marked busy — the turn is streaming until
   * the host reports idle. On failure the item is kept with its error.
   */
  async send(sessionId, item, behavior) {
    const session = this.state(sessionId);
    session.dispatching = true;
    const sending = freeze({ ...item, state: "sending", error: void 0 });
    const index = session.items.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) session.items[index] = sending;
    this.changed(sessionId);
    try {
      await this.dispatch(sessionId, { text: sending.text, attachments: sending.attachments }, behavior);
      if (index >= 0 && session.items[index]?.id === item.id) session.items.splice(index, 1);
      session.turnActive = true;
      this.changed(sessionId);
      return true;
    } catch (error) {
      if (index >= 0 && session.items[index]?.id === item.id) session.items[index] = freeze({ ...sending, state: "failed", error: errorMessage(error) });
      this.changed(sessionId);
      return false;
    } finally {
      session.dispatching = false;
    }
  }
}
const isRecord$1 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const copy = (value) => structuredClone(value);
function attachment(value) {
  if (!isRecord$1(value) || typeof value.dataBase64 !== "string" || typeof value.mimeType !== "string") return void 0;
  return copy(value);
}
function restoreItem(value, sessionId) {
  if (!isRecord$1(value) || typeof value.id !== "string" || value.id.length === 0 || typeof value.text !== "string" || !Array.isArray(value.attachments) || typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return void 0;
  const attachments = value.attachments.map(attachment);
  if (attachments.some((item) => !item)) return void 0;
  const failed = value.state === "failed";
  const state = failed ? "failed" : "queued";
  return {
    id: value.id,
    sessionId,
    text: value.text,
    attachments,
    createdAt: value.createdAt,
    state,
    error: failed && typeof value.error === "string" ? value.error : void 0
  };
}
class FileQueueStore {
  constructor(root) {
    this.root = root;
  }
  pathFor(sessionId) {
    return path.join(this.root, `${encodeURIComponent(sessionId)}.json`);
  }
  async load(sessionId) {
    let raw;
    try {
      raw = JSON.parse(await fs.promises.readFile(this.pathFor(sessionId), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      return [];
    }
    if (!isRecord$1(raw) || raw.version !== 1 || raw.sessionId !== sessionId || !Array.isArray(raw.items)) return [];
    return raw.items.map((item) => restoreItem(item, sessionId)).filter((item) => Boolean(item));
  }
  async save(sessionId, items) {
    const target = this.pathFor(sessionId);
    await fs.promises.mkdir(this.root, { recursive: true });
    const body = { version: 1, sessionId, items: copy(items) };
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.promises.writeFile(temporary, JSON.stringify(body) + "\n", "utf8");
    await fs.promises.rename(temporary, target);
  }
  async remove(sessionId) {
    await fs.promises.rm(this.pathFor(sessionId), { force: true });
  }
}
const QUOTA_ACCOUNT_LABELS = {
  grok: "Grok 账号额度",
  glm: "GLM 账号额度",
  claude: "Claude 账号额度",
  codex: "Codex 账号额度",
  kimi: "Kimi 账号额度",
  qoder: "Qoder 账号额度",
  qwenTokenPlan: "Qwen Token Plan 额度",
  opencodeGo: "OpenCode Go 本机用量"
};
function quotaProviderFor(provider) {
  if (provider.toLowerCase().includes("relay")) return void 0;
  const p = provider.toLowerCase();
  if (p === "xai" || p.includes("grok")) return "grok";
  if (p.includes("zai") || p.includes("zhipu") || p.includes("bigmodel")) return "glm";
  if (p === "anthropic" || p.includes("claude")) return "claude";
  if (p.includes("openai") || p.includes("codex")) return "codex";
  if (p.includes("kimi")) return "kimi";
  if (p.includes("qoder")) return "qoder";
  if (p.includes("qwen-token-plan")) return "qwenTokenPlan";
  if (p.includes("opencode-go")) return "opencodeGo";
  return void 0;
}
function parseCodexAuth(raw) {
  let root;
  try {
    root = JSON.parse(raw);
  } catch {
    return void 0;
  }
  if (typeof root !== "object" || root === null) return void 0;
  const record2 = root;
  const tokens = record2.tokens;
  if (typeof tokens === "object" && tokens !== null) {
    const t = tokens;
    const access = (typeof t.access_token === "string" ? t.access_token : void 0) ?? (typeof t.accessToken === "string" ? t.accessToken : void 0);
    if (!access) return void 0;
    const accountId = (typeof t.account_id === "string" ? t.account_id : void 0) ?? (typeof t.accountId === "string" ? t.accountId : void 0);
    return accountId ? { accessToken: access, accountId } : { accessToken: access };
  }
  if (typeof record2.OPENAI_API_KEY === "string" && record2.OPENAI_API_KEY) {
    return { accessToken: record2.OPENAI_API_KEY };
  }
  return void 0;
}
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
function codexWindowLabel(windowSeconds) {
  if (!windowSeconds || windowSeconds <= 0) return "额度";
  const hours = windowSeconds / 3600;
  if (hours >= 4.5 && hours <= 5.5) return "5h";
  const days = Math.round(windowSeconds / 86400);
  if (days >= 4 && days <= 12) return "周";
  if (days >= 20 && days <= 45) return "月";
  return "额度";
}
function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : void 0;
  }
  return void 0;
}
function parseCodexUsageWindows(body) {
  if (typeof body !== "object" || body === null) return [];
  const rateLimit = body.rate_limit;
  if (typeof rateLimit !== "object" || rateLimit === null) return [];
  const windows = [];
  for (const key of ["primary_window", "secondary_window"]) {
    const dict = rateLimit[key];
    if (typeof dict !== "object" || dict === null) continue;
    const d = dict;
    const used = asNumber(d.used_percent);
    if (used === void 0) continue;
    let resetsAt;
    const reset = d.reset_at;
    if (typeof reset === "number" && Number.isFinite(reset)) resetsAt = reset * 1e3;
    else if (typeof reset === "string") {
      const parsed = Date.parse(reset);
      if (Number.isFinite(parsed)) resetsAt = parsed;
    }
    const label = codexWindowLabel(asNumber(d.limit_window_seconds));
    windows.push({ id: key, usedPercent: Math.min(100, Math.max(0, used)), resetsAt, label, title: label === "额度" ? "额度" : `${label}额度` });
  }
  return windows.map((w, index) => windows.length > 1 ? { ...w, id: `window${index}` } : w);
}
function defaultReadCodexAuth(env) {
  return async () => {
    const custom = env.CODEX_HOME?.trim();
    const codexHome = custom ? custom.replace(/^~(?=\/|$)/, os.homedir()) : path.join(os.homedir(), ".codex");
    try {
      return await fs.promises.readFile(path.join(codexHome, "auth.json"), "utf8");
    } catch {
      return void 0;
    }
  };
}
async function fetchCodexQuota(env = process.env, deps = {}) {
  const readAuth = deps.readCodexAuth ?? defaultReadCodexAuth(env);
  const raw = await readAuth();
  if (raw === void 0) return void 0;
  const credentials = parseCodexAuth(raw);
  if (!credentials) return void 0;
  const doFetch = deps.fetch ?? fetch;
  const headers = {
    Authorization: `Bearer ${credentials.accessToken}`,
    Accept: "application/json",
    "User-Agent": "CodexBar"
  };
  if (credentials.accountId) headers["ChatGPT-Account-Id"] = credentials.accountId;
  const response = await doFetch(CODEX_USAGE_URL, { method: "GET", headers, signal: AbortSignal.timeout(15e3) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseCodexUsageWindows(await response.json());
}
const QUOTA_STALE_AFTER_MS = 3 * 60 * 1e3;
class QuotaStore {
  constructor(env = process.env, deps = {}) {
    this.env = env;
    this.deps = deps;
  }
  cache = /* @__PURE__ */ new Map();
  inFlight = /* @__PURE__ */ new Map();
  /**
   * Returns the snapshot for the provider backing `modelProvider`, refreshing
   * it when stale. `null` = no credential / fetch failed / not implemented →
   * the UI hides the capsule. Failures keep the last good cache when one exists.
   */
  async snapshot(modelProvider, force = false) {
    const kind = quotaProviderFor(modelProvider);
    if (!kind) return null;
    const now = (this.deps.now ?? Date.now)();
    const cached = this.cache.get(kind);
    if (cached && !force && now - cached.fetchedAt < QUOTA_STALE_AFTER_MS) return cached.snapshot;
    const pending = this.inFlight.get(kind);
    if (pending && !force) return pending;
    const task = (async () => {
      try {
        if (kind !== "codex") return cached?.snapshot ?? null;
        const windows = await fetchCodexQuota(this.env, this.deps);
        if (!windows || windows.length === 0) return cached?.snapshot ?? null;
        const snapshot2 = { provider: kind, accountLabel: QUOTA_ACCOUNT_LABELS[kind], windows };
        this.cache.set(kind, { snapshot: snapshot2, fetchedAt: (this.deps.now ?? Date.now)() });
        return snapshot2;
      } catch {
        return cached?.snapshot ?? null;
      } finally {
        this.inFlight.delete(kind);
      }
    })();
    this.inFlight.set(kind, task);
    return task;
  }
}
function globallyRegistered(pkg, settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json")) {
  try {
    const packages = JSON.parse(fs.readFileSync(settingsPath, "utf8"))?.packages;
    if (!Array.isArray(packages)) return false;
    return packages.some((entry) => {
      const source = typeof entry === "string" ? entry : entry?.source;
      return typeof source === "string" && (source === pkg || source.startsWith(`${pkg}@`) || source.endsWith(`/${pkg}`));
    });
  } catch {
    return false;
  }
}
function resolveNpmExecutable(env = process.env) {
  const fromPath = (env.PATH ?? "").split(":").filter(Boolean).map((dir) => path.join(dir, "npm"));
  return [...fromPath, "/opt/homebrew/bin/npm", "/usr/local/bin/npm", "/usr/bin/npm"].find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
const installedVersion = (dir, pkg) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "node_modules", pkg, "package.json"), "utf8")).version;
  } catch {
    return void 0;
  }
};
const runNpm = (npm, args) => new Promise((resolve) => {
  const child = node_child_process.spawn(npm, args, { stdio: ["ignore", "pipe", "pipe"] });
  let detail = "";
  child.stdout.on("data", (chunk) => {
    detail += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    detail += String(chunk);
  });
  child.on("error", (error) => resolve({ status: -1, detail: error.message }));
  child.on("close", (status) => resolve({ status: status ?? -1, detail: detail.slice(-2e3) }));
});
async function ensureManagedPackage(entry, runtimeRoot, deps = {}) {
  const { name, version } = entry;
  const env = deps.env ?? process.env;
  if (globallyRegistered(name, deps.settingsPath)) return { package: name, state: "skipped", detail: "registered in ~/.pi/agent/settings.json" };
  const dir = path.join(runtimeRoot, "managed-npm", `${name}-${version}`);
  if (installedVersion(dir, name) === version) return { package: name, state: "present" };
  const npm = (deps.resolveNpm ?? resolveNpmExecutable)(env);
  if (!npm) return { package: name, state: "failed", detail: "npm is unavailable on PATH" };
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    return { package: name, state: "failed", detail: String(error) };
  }
  const result = await (deps.run ?? runNpm)(npm, ["install", "--prefix", dir, `${name}@${version}`]);
  if (result.status !== 0) return { package: name, state: "failed", detail: `exit ${result.status}: ${result.detail}` };
  if (!fs.existsSync(path.join(dir, "node_modules", name, "package.json")))
    return { package: name, state: "failed", detail: "npm reported success but the package is not on disk" };
  return { package: name, state: "installed" };
}
async function ensureManagedPackages(runtimeRoot, deps = {}) {
  return Promise.all(MANAGED_PACKAGES.map((entry) => ensureManagedPackage(entry, runtimeRoot, deps)));
}
const EMBEDDED_SOURCE = /private static let source = #"""\r?\n([\s\S]*?)\r?\n"""#/;
const TARGET_FILE = /"(pipiui-[a-z0-9-]+\.ts)"/;
const SKIP_ENTRIES = /* @__PURE__ */ new Set(["node_modules", ".git", ".DS_Store"]);
const SIGNATURE_FILE = ".pipiui-install.json";
const emptyReport = () => ({ installed: [], unchanged: [], failures: [] });
function extractSwiftExtension(swift) {
  const source = swift.match(EMBEDDED_SOURCE)?.[1];
  const fileName = swift.match(TARGET_FILE)?.[1];
  return source && fileName ? { fileName, source } : void 0;
}
function treeSignature(root) {
  const parts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP_ENTRIES.has(entry.name)) continue;
      const path$1 = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path$1);
        continue;
      }
      const stat = fs.statSync(path$1);
      parts.push(`${path.relative(root, path$1)}#${stat.size}#${Math.round(stat.mtimeMs)}`);
    }
  };
  walk(root);
  return parts.join(";");
}
const storedSignature = (dest) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dest, SIGNATURE_FILE), "utf8")).signature;
  } catch {
    return void 0;
  }
};
function syncTree(source, dest, report = emptyReport()) {
  if (!fs.existsSync(source)) {
    report.failures.push(`${dest}: source missing at ${source}`);
    return report;
  }
  const signature = treeSignature(source);
  if (fs.existsSync(dest) && storedSignature(dest) === signature) {
    report.unchanged.push(dest);
    return report;
  }
  const staging = `${dest}.staging-${process.pid}`;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(source, staging, { recursive: true, filter: (path2) => !SKIP_ENTRIES.has(path2.slice(path2.lastIndexOf("/") + 1)) });
    fs.writeFileSync(path.join(staging, SIGNATURE_FILE), JSON.stringify({ signature, installedAt: (/* @__PURE__ */ new Date()).toISOString() }), "utf8");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(staging, dest);
    report.installed.push(dest);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    report.failures.push(`${dest}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return report;
}
function installSwiftExtensions(swiftDir, runtimeRoot, report = emptyReport()) {
  if (!fs.existsSync(swiftDir)) {
    report.failures.push(`swift extensions: source missing at ${swiftDir}`);
    return report;
  }
  fs.mkdirSync(runtimeRoot, { recursive: true });
  for (const name of fs.readdirSync(swiftDir).filter((entry) => entry.endsWith("Extension.swift")).sort()) {
    const path$1 = path.join(swiftDir, name);
    try {
      const extracted = extractSwiftExtension(fs.readFileSync(path$1, "utf8"));
      if (!extracted) {
        report.failures.push(`${name}: no embedded source block`);
        continue;
      }
      const target = path.join(runtimeRoot, extracted.fileName);
      if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === extracted.source) {
        report.unchanged.push(target);
        continue;
      }
      fs.writeFileSync(target, extracted.source, "utf8");
      report.installed.push(target);
    } catch (error) {
      report.failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}
function installFile(source, target, report) {
  try {
    const bytes = fs.readFileSync(source);
    if (fs.existsSync(target) && fs.readFileSync(target).equals(bytes)) {
      report.unchanged.push(target);
      return;
    }
    fs.writeFileSync(target, bytes);
    report.installed.push(target);
  } catch (error) {
    report.failures.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function installRuntimeTree(assets, runtimeRoot) {
  const report = emptyReport();
  fs.mkdirSync(runtimeRoot, { recursive: true });
  if (assets.piExt) syncTree(assets.piExt, path.join(runtimeRoot, "pi-ext"), report);
  else report.failures.push("pi-ext: no source path resolved");
  if (assets.piPhilosophy) syncTree(assets.piPhilosophy, path.join(runtimeRoot, "pi-philosophy"), report);
  else report.failures.push("pi-philosophy: no source path resolved");
  if (assets.swiftExtensionsDir) installSwiftExtensions(assets.swiftExtensionsDir, runtimeRoot, report);
  else report.failures.push("swift extensions: no source path resolved");
  if (assets.computerUse) installFile(assets.computerUse, path.join(runtimeRoot, "pipiui-computer-use.ts"), report);
  else report.failures.push("pipiui-computer-use.ts: no source path resolved");
  return report;
}
const text = (content) => typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p.text ?? p.thinking ?? "").join("") : "";
const emitFrame = (listeners, event) => listeners.forEach((l) => l(event));
function asTime(value) {
  const n = Date.parse(value ?? "");
  return Number.isFinite(n) ? n : Date.now();
}
const METADATA_HEAD_BYTES = 64 * 1024, METADATA_TAIL_BYTES = 64 * 1024;
function parseLines(data) {
  const result = [];
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try {
      result.push(JSON.parse(line));
    } catch {
    }
  }
  return result;
}
function sessionName(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r?.type === "session_info" && typeof r.name === "string" && r.name.trim())
      return r.name.trim();
  }
  for (const r of records) {
    if (r?.type === "message" && r.message?.role === "user") {
      const value = text(r.message.content).trim();
      if (value) return value.slice(0, 80);
    }
  }
}
async function readSessionMeta(path2) {
  const stat = await fs.promises.stat(path2);
  const handle = await fs.promises.open(path2, "r");
  try {
    const head = Buffer.alloc(Math.min(METADATA_HEAD_BYTES, stat.size));
    await handle.read(head, 0, head.length, 0);
    const headRows = parseLines(head.toString("utf8"));
    const header = headRows.find((row) => row?.type === "session");
    if (!header?.id || typeof header.cwd !== "string")
      throw new Error("invalid session header");
    const tailLength = Math.min(METADATA_TAIL_BYTES, stat.size);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, Math.max(0, stat.size - tailLength));
    const tailRows = parseLines(tail.toString("utf8"));
    const last = [...tailRows].reverse().find((row) => typeof row?.timestamp === "string");
    const timestamp = Date.parse(last?.timestamp ?? "");
    return {
      path: path2,
      header,
      name: sessionName([...headRows, ...tailRows]),
      updatedAt: Number.isFinite(timestamp) ? timestamp : stat.mtimeMs
    };
  } finally {
    await handle.close();
  }
}
async function readHistoryFallback(path2, offset = 0, limit = 500) {
  const result = [];
  let seen = 0;
  const lines = node_readline.createInterface({
    input: fs.createReadStream(path2, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "message") continue;
    if (seen++ < offset) continue;
    const message = entry.message ?? {};
    const role = message.role === "toolResult" ? "tool" : message.role;
    if (role !== "user" && role !== "assistant" && role !== "tool") continue;
    result.push({
      id: entry.id,
      role,
      content: text(message.content),
      timestamp: asTime(entry.timestamp ?? message.timestamp)
    });
    if (result.length >= limit) break;
  }
  return result;
}
const SESSION_MANAGER_MAX_BYTES = 4 * 1024 * 1024;
let sessionManagerModule;
async function loadSessionManager() {
  return sessionManagerModule ??= Promise.resolve().then(() => require("./index-CAG480R2.js")).then((n) => n._bundledPiCodingAgent);
}
async function readHistory(path2, offset = 0, limit = 500) {
  const stat = await fs.promises.stat(path2);
  if (stat.size > SESSION_MANAGER_MAX_BYTES) {
    console.warn(
      `[pipi-backend] SessionManager skipped for ${path2}: ${stat.size} bytes exceeds bounded history limit`
    );
    return readHistoryFallback(path2, offset, limit);
  }
  try {
    const { SessionManager } = await loadSessionManager();
    const manager = SessionManager.open(path2);
    const entries = manager.buildContextEntries();
    const visible = [];
    for (const entry of entries) {
      if (entry.type === "message") {
        const message = entry.message ?? {};
        const role = message.role === "toolResult" ? "tool" : message.role;
        if (role === "user" || role === "assistant" || role === "tool")
          visible.push({
            id: entry.id,
            role,
            content: text(message.content),
            timestamp: asTime(entry.timestamp ?? message.timestamp)
          });
      } else if (entry.type === "custom_message" && entry.display) {
        visible.push({
          id: entry.id,
          role: "user",
          content: text(entry.content),
          timestamp: asTime(entry.timestamp)
        });
      } else if (entry.type === "compaction" && entry.summary) {
        visible.push({
          id: entry.id,
          role: "assistant",
          content: entry.summary,
          timestamp: asTime(entry.timestamp)
        });
      }
    }
    return visible.slice(offset, offset + limit);
  } catch (error) {
    console.warn(
      `[pipi-backend] SessionManager fallback for ${path2}: ${error instanceof Error ? error.message : String(error)}`
    );
    return readHistoryFallback(path2, offset, limit);
  }
}
function dirId(path2) {
  return Buffer.from(path2).toString("base64url");
}
const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const nonEmpty = (value) => typeof value === "string" && value.trim() ? value : void 0;
const num2 = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
const modelRef = (value) => nonEmpty(value);
const providerOf = (ref) => {
  const provider = ref?.split("/")[0];
  return provider && provider !== ref ? provider : void 0;
};
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function supportsImagesFor(modelId, provider, input) {
  if (Array.isArray(input)) return input.some((x) => x === "image");
  const p = provider.toLowerCase(), m = modelId.toLowerCase();
  if (p.includes("deepseek") || m.includes("deepseek")) return false;
  const visionHints = [
    "gpt-4o",
    "claude-3",
    "claude-4",
    "claude-5",
    "gemini",
    "qwen-vl",
    "glm-4v",
    "glm-5v",
    "llava",
    "moondream",
    "vision"
  ];
  if (visionHints.some((h) => p.includes(h) || m.includes(h))) return true;
  if (m.includes("vl") || p.includes("vl")) return true;
  return true;
}
const ATTACHMENT_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
};
function sanitizeAttachmentName(name, fallback) {
  const base = path.basename(name ?? "");
  const safe = base.replace(/[^\w.\-() ]/g, "").trim();
  return safe || fallback;
}
class PiHostBackend {
  protocolVersion = 2;
  listeners = /* @__PURE__ */ new Set();
  live = /* @__PURE__ */ new Map();
  leases = /* @__PURE__ */ new Map();
  models = [];
  modelState = {
    model: {
      provider: "unknown",
      id: "unknown",
      name: "Unknown",
      reasoning: false
    },
    thinkingLevel: "off",
    availableThinkingLevels: ["off"]
  };
  sessionModelStates = /* @__PURE__ */ new Map();
  sessionModelSnapshots = /* @__PURE__ */ new Map();
  computerDescriptor;
  computerUsable = () => false;
  root;
  pi;
  runtimeRoot;
  agentDir;
  features;
  proc;
  env;
  modelsLoaded;
  configuredModels = [];
  hiddenIds = [];
  hiddenIdsLoaded;
  projectPaths = [];
  projectPathsLoaded;
  settingsWrite = Promise.resolve();
  auth;
  authRuntimePromise;
  queue;
  queueStore;
  quotaStore;
  queueLoads = /* @__PURE__ */ new Map();
  queueWrites = /* @__PURE__ */ new Map();
  closed = false;
  bridge;
  constructor(options = {}) {
    this.computerDescriptor = options.computerDescriptor;
    this.computerUsable = options.computerUsable ?? (() => false);
    this.agentDir = options.agentDir ?? path.join(os.homedir(), ".pi", "agent");
    this.root = options.sessionsRoot ?? path.join(this.agentDir, "sessions");
    this.pi = options.piPath ?? resolvePiExecutable(options.env ?? process.env);
    this.runtimeRoot = options.runtimeRoot ?? defaultRuntimeRoot();
    this.features = options.features ?? DEFAULT_FEATURES;
    if (this.features.browser)
      installElectronBrowserExtension(this.runtimeRoot, options.browserExtensionSourcePath);
    this.proc = options.spawn ?? node_child_process.spawn;
    this.env = options.env ?? process.env;
    const queueRoot = options.agentDir || !options.sessionsRoot ? path.join(this.agentDir, "pipiui-queues") : path.join(this.root, ".pipiui-queues");
    this.queueStore = options.queueStore ?? new FileQueueStore(queueRoot);
    this.quotaStore = options.quotaStore ?? new QuotaStore(this.env);
    this.queue = new SessionMessageQueue({
      dispatch: (id, payload, behavior) => this.dispatchQueuedMessage(id, payload, behavior),
      onChange: (id, items) => this.queueChanged(id, items)
    });
    this.bridge = new HostBridge({
      onAgentEvent: (event, sessionId) => this.mapAgentEvent(event, sessionId),
      onPlanEvent: (event, sessionId) => this.planEvent(event, sessionId),
      onBrowserAction: async (event) => options.browserAction ? options.browserAction(event) : { ok: false, error: "browser host unavailable" },
      onComputerAction: async (event) => options.computerAction ? options.computerAction(event) : { ok: false, error: "computer host unavailable" }
    });
    if (options.authRuntime) {
      this.authRuntimePromise = Promise.resolve(options.authRuntime);
    } else if (options.authHelperPath) {
      this.authRuntimePromise = Promise.resolve(new ExternalAuthRuntime({
        helperPath: options.authHelperPath,
        nodePath: options.authNodePath,
        piPath: this.pi,
        agentDir: this.agentDir,
        env: this.env
      }));
    }
    this.auth = new ProviderAuthBackend({
      runtime: {
        getProviders: async () => (await this.modelRuntime()).getProviders(),
        getAvailable: async () => (await this.modelRuntime()).getAvailable(),
        login: async (p, t, i) => (await this.modelRuntime()).login(p, t, i),
        logout: async (p) => (await this.modelRuntime()).logout(p)
      },
      authPath: path.join(this.agentDir, "auth.json"),
      onLoginCompleted: () => {
        void this.refreshModelsAfterAuthChange();
      }
    });
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Graceful connection teardown for hosts that allocate one backend per client. */
  async close() {
    this.closed = true;
    await this.bridge.close();
    const live = [...this.live.values()];
    this.live.clear();
    for (const item of live) {
      for (const pending of item.pending.values())
        pending.reject(new Error("host backend closed"));
      item.pending.clear();
      try {
        item.process?.stdin.end();
      } catch {
      }
    }
    await Promise.all(live.map((item) => item.exit ?? Promise.resolve()));
    await Promise.all(
      [...this.leases.values()].map(
        (lease) => lease.release().catch(() => void 0)
      )
    );
    await Promise.all(
      [...this.queueWrites.values()].map(
        (write) => write.catch(() => void 0)
      )
    );
    this.leases.clear();
    this.listeners.clear();
  }
  stream(event) {
    emitFrame(this.listeners, {
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: "stream",
      event
    });
  }
  agent(event) {
    emitFrame(this.listeners, {
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: "agents",
      event
    });
  }
  queueChanged(id, items) {
    if (this.closed) return;
    this.persistQueue(id, items);
    this.stream({
      type: "queue_update",
      sessionId: id,
      queue: items,
      pendingFollowUps: this.live.get(id)?.followUps ?? []
    });
  }
  persistQueue(id, items) {
    const prior = this.queueWrites.get(id) ?? Promise.resolve();
    const write = prior.catch(() => void 0).then(() => this.queueStore.save(id, items));
    this.queueWrites.set(id, write);
    void write.catch(
      (error) => console.warn(
        `[pipi-backend] queue persistence failed for ${id}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }
  async loadQueue(id) {
    let task = this.queueLoads.get(id);
    if (!task) {
      task = this.queueStore.load(id).then((items) => this.queue.restoreQueue(id, items)).catch((error) => {
        console.warn(
          `[pipi-backend] queue restore failed for ${id}: ${error instanceof Error ? error.message : String(error)}`
        );
        this.queue.restoreQueue(id, []);
      });
      this.queueLoads.set(id, task);
    }
    await task;
  }
  async queueIdle(id) {
    if (this.closed) return;
    await this.loadQueue(id);
    await new Promise((resolve2) => setImmediate(resolve2));
    if (!this.closed) await this.queue.notifyIdle(id);
  }
  async enqueueMessage(id, text2, attachments) {
    await this.loadQueue(id);
    const result = this.queue.enqueue(id, { text: text2, attachments });
    if (result.outcome === "dispatched") await this.queue.waitForDispatch(id);
    return {
      outcome: result.outcome === "dispatched" ? "direct" : "queued",
      message: result.message
    };
  }
  async index() {
    const files = [];
    const walk = async (d) => {
      if (!fs.existsSync(d)) return;
      for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        e.isDirectory() ? await walk(p) : e.isFile() && p.endsWith(".jsonl") && files.push(p);
      }
    };
    await walk(this.root);
    const result = [];
    for (const path2 of files) {
      try {
        result.push(await readSessionMeta(path2));
      } catch {
      }
    }
    return result;
  }
  async locate(id) {
    for (const item of await this.index())
      if (item.header.id === id) return this.confirmSessionMeta(item);
    throw new Error(`unknown session ${id}`);
  }
  async confirmSessionMeta(meta) {
    try {
      if ((await fs.promises.stat(meta.path)).size > SESSION_MANAGER_MAX_BYTES)
        return meta;
      const { SessionManager } = await loadSessionManager();
      const manager = SessionManager.open(meta.path);
      const header = manager.getHeader();
      if (!header) return meta;
      const entries = manager.getEntries();
      const last = entries.at(-1);
      return {
        ...meta,
        header,
        name: manager.getSessionName() ?? meta.name,
        updatedAt: last?.timestamp ? asTime(last.timestamp) : meta.updatedAt
      };
    } catch (error) {
      console.warn(
        `[pipi-backend] SessionManager metadata fallback for ${meta.path}: ${error instanceof Error ? error.message : String(error)}`
      );
      return meta;
    }
  }
  project(path$1) {
    return { id: dirId(path$1), name: path.basename(path$1) || path$1, path: path$1 };
  }
  async loadConfiguredModels() {
    if (this.modelsLoaded) return this.modelsLoaded;
    this.modelsLoaded = (async () => {
      let settings = {}, catalog = {};
      try {
        settings = JSON.parse(
          await fs.promises.readFile(path.join(this.agentDir, "settings.json"), "utf8")
        );
      } catch {
      }
      try {
        catalog = JSON.parse(
          await fs.promises.readFile(path.join(this.agentDir, "models.json"), "utf8")
        );
      } catch {
      }
      const configured = [];
      for (const [provider, config] of Object.entries(
        catalog.providers ?? {}
      )) {
        const key = config?.apiKey;
        const available = typeof key === "string" && key.trim() !== "" && (key.startsWith("$") ? Boolean(this.env[key.slice(1)]) : true);
        if (!available) continue;
        for (const model of config.models ?? [])
          if (typeof model?.id === "string")
            configured.push({
              provider: model.provider ?? provider,
              id: model.id,
              name: model.name ?? model.id,
              reasoning: Boolean(model.reasoning),
              supportsImages: supportsImagesFor(
                model.id,
                model.provider ?? provider,
                model.input
              )
            });
      }
      this.configuredModels = configured;
      this.models = [...configured];
      const preferred = configured.find(
        (model) => model.provider === settings.defaultProvider && model.id === settings.defaultModel
      ) ?? configured.find((model) => model.id === settings.defaultModel) ?? configured[0];
      if (preferred)
        this.modelState = {
          model: preferred,
          thinkingLevel: settings.defaultThinkingLevel ?? "off",
          availableThinkingLevels: preferred.reasoning ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"] : ["off"]
        };
    })();
    return this.modelsLoaded;
  }
  async handle(method, params) {
    switch (method) {
      case "listProjects":
        return (await this.loadProjectPaths()).map(
          (path2) => this.project(path2)
        );
      case "getProjectPaths":
        return [...await this.loadProjectPaths()];
      case "setProjectPaths":
        return this.saveProjectPaths(params[0]);
      case "addProject":
        return this.addProject(params[0]);
      case "removeProject":
        return this.removeProject(params[0]);
      case "listSessions": {
        const pid = params[0];
        const paths = await this.loadProjectPaths();
        if (!paths.some((path2) => dirId(path2) === pid))
          throw new Error(`unknown project ${pid}`);
        const all = await this.index();
        return all.filter((s) => dirId(s.header.cwd) === pid).map((s) => ({
          id: s.header.id,
          projectId: pid,
          name: s.name ?? "Session",
          updatedAt: s.updatedAt
        })).sort((a, b) => b.updatedAt - a.updatedAt);
      }
      case "newSession":
        return this.newSession(
          params[0],
          params[1]
        );
      case "resumeSession": {
        const s = await this.locate(params[0]);
        await this.leaseFor(s).acquire();
        await this.loadQueue(s.header.id);
        return this.toSession(s);
      }
      case "deleteSession": {
        const s = await this.locate(params[0]);
        await this.leases.get(s.header.id)?.release();
        this.leases.delete(s.header.id);
        await this.queueWrites.get(s.header.id)?.catch(() => void 0);
        await this.queueStore.remove(s.header.id);
        this.queueLoads.delete(s.header.id);
        await fs.promises.rm(s.path);
        this.live.get(s.header.id)?.process?.stdin.end();
        this.live.delete(s.header.id);
        this.sessionModelStates.delete(s.header.id);
        this.sessionModelSnapshots.delete(s.header.id);
        return;
      }
      case "getSessionHistory": {
        const session = await this.locate(params[0]);
        return readHistory(
          session.path,
          Number(params[1] ?? 0),
          Number(params[2] ?? 500)
        );
      }
      case "getSessionLease": {
        const s = await this.locate(params[0]);
        return this.leaseFor(s).query();
      }
      case "forceTakeoverSessionLease": {
        const s = await this.locate(params[0]);
        return this.leaseFor(s).forceTakeover();
      }
      case "sendPrompt":
        return this.enqueueMessage(
          params[0],
          params[1],
          params[2]
        );
      case "listQueue":
        await this.loadQueue(params[0]);
        return this.queue.listQueue(params[0]);
      case "enqueueMessage":
        return this.enqueueMessage(
          params[0],
          params[1],
          params[2]
        );
      case "updateQueuedMessage": {
        const input = { text: params[2] };
        if (params.length > 3)
          input.attachments = params[3];
        await this.loadQueue(params[0]);
        return this.queue.updateMessage(
          params[0],
          params[1],
          input
        );
      }
      case "removeQueuedMessage":
        await this.loadQueue(params[0]);
        return this.queue.removeMessage(
          params[0],
          params[1]
        );
      case "promoteQueuedMessage":
        await this.loadQueue(params[0]);
        return this.queue.promoteMessage(
          params[0],
          params[1]
        );
      case "steerQueuedMessage":
        await this.loadQueue(params[0]);
        return this.queue.steerMessage(
          params[0],
          params[1]
        );
      case "retryQueuedMessage":
        await this.loadQueue(params[0]);
        return this.queue.retryMessage(
          params[0],
          params[1]
        );
      case "stop":
        return this.command(params[0], { type: "abort" }).then(
          () => void 0
        );
      case "queueFollowUp":
        return this.prompt(params[0], params[1], true);
      case "getHiddenModelIds":
        return this.loadHiddenModelIds();
      case "setHiddenModelIds":
        return this.saveHiddenModelIds(params[0]);
      case "authProviders":
        return this.auth.listProviders();
      case "beginProviderLogin":
        return {
          loginId: this.auth.beginLogin(
            params[0],
            params[1]
          )
        };
      case "continueProviderLogin":
        return this.auth.continueLogin(
          params[0],
          params[1]
        );
      case "cancelProviderLogin":
        this.auth.cancelLogin(params[0]);
        return;
      case "removeProviderCredentials":
        return this.removeProviderCredentials(params[0]);
      case "listModels":
        await this.loadModelCatalog();
        return this.models;
      case "getModelState":
        return this.getModelState(params[0]);
      case "setModel":
        if (params.length === 2)
          return this.setConfiguredModel(params[0], params[1]);
        return this.setModel(
          params[0],
          params[1],
          params[2]
        );
      case "setThinkingLevel":
        return this.setThinking(
          params[0],
          params[1]
        );
      case "getSessionStats":
        return this.getSessionStats(params[0]);
      case "getQuotaSnapshot":
        return this.getQuotaSnapshot();
      case "listAgents": {
        const sessionId = params[0];
        return [...this.agents.values()].filter(
          (agent) => !sessionId || agent.sessionId === sessionId
        );
      }
      case "abortAgent":
        return this.agentCommand(params[0], "abort");
      case "resolveAgent":
        return this.agentCommand(params[0], "resolve");
      case "checkAgent":
        return this.getAgent(params[0]);
      case "getWorktreeStatus":
        return this.getWorktree(params[0]);
      case "mergeWorktree":
        return this.worktreeCommand(params[0], "merge");
      case "discardWorktree":
        return this.worktreeCommand(params[0], "discard");
      case "gitStatus":
        return probeGit(await this.projectPath(params[0]));
      case "gitCheckout":
        return checkoutBranch(
          await this.projectPath(params[0]),
          params[1]
        );
      case "capabilities":
        return {
          computerUse: Boolean(
            this.features.computerUse && this.computerDescriptor && this.computerUsable()
          ),
          revealInFinder: process.platform === "darwin",
          terminal: true,
          git: true
        };
    }
  }
  /** Git operations run in a known project work tree only — never in an id-derived path. */
  async projectPath(projectId) {
    const projects = await this.handle("listProjects", []);
    const project = projects.find((item) => item.id === projectId);
    if (!project) throw new Error(`unknown project ${projectId}`);
    return project.path;
  }
  /** `provider/model` for PIPIUI_MAIN_MODEL, so dispatched workers can size themselves against the main model. Unknown stays absent rather than guessed. */
  mainModelId() {
    const m = this.modelState.model;
    return m.provider === "unknown" && m.id === "unknown" ? void 0 : `${m.provider}/${m.id}`;
  }
  toSession(s) {
    return {
      id: s.header.id,
      projectId: dirId(s.header.cwd),
      name: s.name ?? "Session",
      updatedAt: s.updatedAt
    };
  }
  leaseFor(s) {
    let lease = this.leases.get(s.header.id);
    if (!lease) {
      lease = new LeaseManager({ sessionId: s.header.id, sessionPath: s.path });
      this.leases.set(s.header.id, lease);
    }
    return lease;
  }
  async requireLease(id) {
    const s = await this.locate(id);
    const status = await this.leaseFor(s).acquire();
    if (!status.writable)
      throw new Error(
        `session is read-only: held by ${status.holder?.holder ?? "another writer"}`
      );
  }
  async newSession(projectId, name) {
    await this.loadConfiguredModels();
    const projects = await this.handle("listProjects", []);
    const p = projects.find((x) => x.id === projectId);
    if (!p) throw new Error(`unknown project ${projectId}`);
    const id = crypto.randomUUID();
    const dir = path.join(this.root, encodeURIComponent(p.path));
    await fs.promises.mkdir(dir, { recursive: true });
    const path$1 = path.join(
      dir,
      `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`
    );
    const header = {
      type: "session",
      version: 3,
      id,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      cwd: p.path
    };
    const lines = [JSON.stringify(header)];
    if (name)
      lines.push(
        JSON.stringify({
          type: "session_info",
          id: crypto.randomUUID(),
          parentId: null,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          name
        })
      );
    await fs.promises.writeFile(path$1, lines.join("\n") + "\n");
    this.sessionModelSnapshots.set(id, this.modelState);
    return {
      id,
      projectId,
      name: name ?? "New session",
      updatedAt: Date.now()
    };
  }
  async ensure(id) {
    let live = this.live.get(id);
    if (live) return live;
    await this.requireLease(id);
    const found = await this.locate(id);
    const session = this.toSession(found);
    await this.loadConfiguredModels();
    const desired = this.sessionModelSnapshots.get(id) ?? this.modelState;
    this.sessionModelSnapshots.set(id, desired);
    const bridgePort = await this.bridge.listen();
    const sessionCapability = this.bridge.register(id);
    const computerCapability = this.features.computerUse && this.computerDescriptor && this.computerUsable() ? this.bridge.registerComputer(id) : void 0;
    const output = assemblePiSpawn({
      sessionPath: found.path,
      cwd: found.header.cwd,
      features: this.features,
      paths: resolveSpawnPaths(this.runtimeRoot),
      mainModelId: this.mainModelId(),
      bridgePort,
      bridgeRoutingKey: id,
      sessionCapability,
      computerCapability,
      computerDescriptor: computerCapability ? this.computerDescriptor : void 0
    });
    const child = this.proc(this.pi, ["--mode", "rpc", ...output.args], {
      cwd: found.header.cwd,
      env: withToolPath(
        { ...sanitizeEnvironment(this.env), ...output.env },
        this.pi
      ),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let resolveExit;
    const exit = new Promise((resolve2) => {
      resolveExit = resolve2;
    });
    live = {
      session,
      path: found.path,
      cwd: found.header.cwd,
      process: child,
      exit,
      buffer: "",
      pending: /* @__PURE__ */ new Map(),
      followUps: [],
      toolArgs: /* @__PURE__ */ new Map()
    };
    this.live.set(id, live);
    child.stdout.on("data", (chunk) => this.lines(live, chunk.toString()));
    const failPending = (reason) => {
      for (const p of live.pending.values()) p.reject(reason);
      live.pending.clear();
    };
    child.on("error", (error) => failPending(error));
    child.on("exit", () => {
      failPending(new Error("pi exited"));
      this.live.delete(id);
      this.bridge.unregister(id);
      resolveExit();
      void this.leases.get(id)?.release();
      if (!this.closed) void this.queueIdle(id);
    });
    if (desired.model.provider !== "unknown" && desired.model.id !== "unknown") {
      await this.command(id, {
        type: "set_model",
        provider: desired.model.provider,
        modelId: desired.model.id
      });
    }
    await this.command(id, {
      type: "set_thinking_level",
      level: desired.thinkingLevel
    });
    await this.refreshState(live);
    return live;
  }
  lines(live, chunk) {
    live.buffer += chunk;
    let at;
    while ((at = live.buffer.indexOf("\n")) >= 0) {
      const line = live.buffer.slice(0, at).replace(/\r$/, "");
      live.buffer = live.buffer.slice(at + 1);
      if (!line) continue;
      try {
        this.rpcEvent(live, JSON.parse(line));
      } catch {
      }
    }
  }
  rpcEvent(live, e) {
    if (e.type === "agent_event" || e.type === "pipiui_agent_event") {
      this.mapAgentEvent(e.event ?? e, live.session.id);
      return;
    }
    if (e.type === "response") {
      const pending = live.pending.get(e.id);
      if (pending) {
        live.pending.delete(e.id);
        e.success ? pending.resolve(e.data) : pending.reject(new Error(e.error ?? "pi RPC failed"));
      }
      return;
    }
    const id = live.session.id;
    if (e.type === "agent_start") {
      void this.loadQueue(id).then(() => this.queue.markBusy(id));
      this.stream({ type: "status", sessionId: id, status: "started" });
    } else if (e.type === "agent_settled") {
      this.stream({
        type: "status",
        sessionId: id,
        status: "settled",
        pendingFollowUps: live.followUps
      });
      void this.queueIdle(id);
      void this.pushSessionStats(id);
    } else if (e.type === "agent_stopped" || e.type === "agent_error") {
      this.stream({
        type: "status",
        sessionId: id,
        status: "stopped",
        pendingFollowUps: live.followUps
      });
      void this.queueIdle(id);
    } else if (e.type === "queue_update") {
      live.followUps = e.followUp ?? [];
      this.stream({
        type: "status",
        sessionId: id,
        status: "streaming",
        pendingFollowUps: live.followUps
      });
    } else if (e.type === "message_update") {
      const d = e.assistantMessageEvent ?? {};
      if (d.type === "text_delta")
        this.stream({
          type: "text",
          sessionId: id,
          contentIndex: d.contentIndex ?? 0,
          delta: d.delta ?? ""
        });
      if (d.type === "thinking_delta")
        this.stream({
          type: "thinking",
          sessionId: id,
          contentIndex: d.contentIndex ?? 0,
          delta: d.delta ?? ""
        });
      if (d.type === "toolcall_delta") {
        const index = d.contentIndex ?? 0;
        live.toolArgs.set(
          index,
          (live.toolArgs.get(index) ?? "") + (d.delta ?? "")
        );
      } else if (d.type === "toolcall_end") {
        const index = d.contentIndex ?? 0;
        const buffered = live.toolArgs.get(index) ?? "";
        live.toolArgs.delete(index);
        const call = d.toolCall ?? {};
        const args = call.arguments != null && typeof call.arguments === "object" ? JSON.stringify(call.arguments) : typeof call.arguments === "string" ? call.arguments : buffered;
        this.stream({
          type: "tool_call",
          sessionId: id,
          toolCallId: call.id ?? `content-${index}`,
          name: call.name ?? "tool",
          delta: args
        });
      }
    } else if (e.type === "message_end") {
      live.toolArgs.clear();
    } else if (e.type === "tool_execution_end")
      this.stream({
        type: "tool_result",
        sessionId: id,
        toolCallId: e.toolCallId,
        content: text(e.result?.content),
        isError: e.isError
      });
  }
  command(id, body) {
    return this.ensure(id).then(
      (live) => new Promise((resolve2, reject) => {
        const child = live.process;
        if (child && (child.exitCode !== null || child.signalCode)) {
          reject(new Error("pi exited"));
          return;
        }
        const req = crypto.randomUUID();
        live.pending.set(req, { resolve: resolve2, reject });
        live.process.stdin.write(
          JSON.stringify({ id: req, ...body }) + "\n"
        );
      })
    );
  }
  async refreshState(live) {
    try {
      const models = await this.command(live.session.id, {
        type: "get_available_models"
      });
      this.models = (models.models ?? []).map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name ?? m.id,
        reasoning: Boolean(m.reasoning),
        supportsImages: supportsImagesFor(m.id, m.provider, m.input)
      }));
      const state = await this.command(live.session.id, { type: "get_state" });
      const levels = await this.command(live.session.id, {
        type: "get_available_thinking_levels"
      });
      const model = state.model ? {
        provider: state.model.provider,
        id: state.model.id,
        name: state.model.name ?? state.model.id,
        reasoning: Boolean(state.model.reasoning),
        supportsImages: supportsImagesFor(
          state.model.id,
          state.model.provider,
          state.model.input
        )
      } : this.models[0] ?? this.modelState.model;
      this.sessionModelStates.set(live.session.id, {
        model,
        thinkingLevel: state.thinkingLevel ?? "off",
        availableThinkingLevels: levels.levels ?? ["off"]
      });
    } catch {
    }
  }
  /** Shared atomic settings store. New fields must merge here so model/queue preferences survive project-list updates. */
  settingsFile() {
    return path.join(this.agentDir, "pipiui-settings.json");
  }
  async readSettings() {
    let value;
    try {
      value = JSON.parse(await fs.promises.readFile(this.settingsFile(), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw new Error(
        `无法读取 PipiUI 设置：${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!isRecord(value)) throw new Error("PipiUI 设置必须是 object");
    return value;
  }
  async updateSettings(update) {
    let result;
    const write = this.settingsWrite.catch(() => void 0).then(async () => {
      const settings = await this.readSettings();
      result = update(settings);
      const target = this.settingsFile();
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
      await fs.promises.writeFile(
        tmp,
        JSON.stringify(settings, null, 2) + "\n",
        "utf8"
      );
      await fs.promises.rename(tmp, target);
    });
    this.settingsWrite = write;
    await write;
    return result;
  }
  checkedProjectPaths(value) {
    if (!Array.isArray(value) || !value.every((path2) => typeof path2 === "string" && path2.length > 0))
      throw new Error("projectPaths 必须是 string[]（每项不能为空）");
    return [...new Set(value)];
  }
  async discoveredProjectPaths() {
    const paths = [];
    const seen = /* @__PURE__ */ new Set();
    for (const session of await this.index()) {
      const path2 = session.header.cwd;
      if (typeof path2 === "string" && !seen.has(path2)) {
        seen.add(path2);
        paths.push(path2);
      }
    }
    return paths;
  }
  /** Migrates JSONL cwd discovery once. Version presence makes an intentional [] durable. */
  async loadProjectPaths() {
    if (!this.projectPathsLoaded) {
      this.projectPathsLoaded = (async () => {
        const settings = await this.readSettings();
        if (settings.projectPathsVersion === 1) {
          this.projectPaths = this.checkedProjectPaths(settings.projectPaths);
          return;
        }
        if (settings.projectPathsVersion !== void 0 || settings.projectPaths !== void 0)
          throw new Error("unsupported projectPaths settings version");
        const discovered = await this.discoveredProjectPaths();
        this.projectPaths = await this.updateSettings((current) => {
          if (current.projectPathsVersion === 1)
            return this.checkedProjectPaths(current.projectPaths);
          if (current.projectPathsVersion !== void 0 || current.projectPaths !== void 0)
            throw new Error("unsupported projectPaths settings version");
          current.projectPathsVersion = 1;
          current.projectPaths = [...discovered];
          return [...discovered];
        });
      })();
    }
    await this.projectPathsLoaded;
    return [...this.projectPaths];
  }
  async saveProjectPaths(value) {
    const paths = this.checkedProjectPaths(value);
    const saved = await this.updateSettings((settings) => {
      settings.projectPathsVersion = 1;
      settings.projectPaths = [...paths];
      return [...paths];
    });
    this.projectPaths = saved;
    this.projectPathsLoaded = Promise.resolve();
    return [...saved];
  }
  async addProject(value) {
    if (typeof value !== "string" || !value.length)
      throw new Error("project path 必须是非空 string");
    const paths = await this.loadProjectPaths();
    if (!paths.includes(value)) await this.saveProjectPaths([...paths, value]);
    return this.project(value);
  }
  /** Removes only the explicit sidebar entry; session JSONL files remain untouched. */
  async removeProject(projectId) {
    const paths = await this.loadProjectPaths();
    if (!paths.some((path2) => dirId(path2) === projectId))
      throw new Error(`unknown project ${projectId}`);
    await this.saveProjectPaths(
      paths.filter((path2) => dirId(path2) !== projectId)
    );
  }
  /** Atomic opt-out visibility store, mirroring Swift ModelVisibility(UserDefaults). */
  async loadHiddenModelIds() {
    if (!this.hiddenIdsLoaded) {
      this.hiddenIdsLoaded = (async () => {
        const raw = await this.readSettings();
        const value = raw.hiddenModelIds;
        if (value === void 0) {
          this.hiddenIds = [];
          return;
        }
        if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
          throw new Error("hiddenModelIds 必须是 string[]");
        this.hiddenIds = [...new Set(value)].sort();
      })();
    }
    await this.hiddenIdsLoaded;
    return [...this.hiddenIds];
  }
  async saveHiddenModelIds(value) {
    if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
      throw new Error("hiddenModelIds 必须是 string[]");
    const sorted = [...new Set(value)].sort();
    await this.updateSettings((settings) => {
      settings.hiddenModelIds = [...sorted];
    });
    this.hiddenIds = [...sorted];
    this.hiddenIdsLoaded = Promise.resolve();
    return [...sorted];
  }
  async modelRuntime() {
    if (!this.authRuntimePromise) {
      this.authRuntimePromise = (async () => {
        const mod = await Promise.resolve().then(() => require("./index-CAG480R2.js")).then((n) => n._bundledPiCodingAgent);
        const real = await mod.ModelRuntime.create({
          authPath: path.join(this.agentDir, "auth.json"),
          modelsPath: path.join(this.agentDir, "models.json"),
          allowModelNetwork: false
        });
        return {
          getProviders: () => real.getProviders(),
          getAvailable: () => real.getAvailable(),
          login: (p, t, i) => real.login(p, t, i),
          logout: (p) => real.logout(p)
        };
      })();
    }
    return this.authRuntimePromise;
  }
  toRuntimeModel(m) {
    return {
      provider: m.provider,
      id: m.id,
      name: m.name ?? m.id,
      reasoning: Boolean(m.reasoning),
      supportsImages: supportsImagesFor(m.id, m.provider, m.input)
    };
  }
  /** Merge configured/custom models with pi's auth-aware runtime catalog in stable order. */
  async mergeRuntimeModels(includeCurrent = true) {
    const merged = new Map(
      this.configuredModels.map((model) => [
        `${model.provider}/${model.id}`,
        model
      ])
    );
    try {
      const runtime = await this.modelRuntime();
      const available = await runtime.getAvailable();
      const additions = [...available].map((model) => this.toRuntimeModel(model)).sort(
        (a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id)
      );
      for (const model of additions) {
        const key = `${model.provider}/${model.id}`;
        if (!merged.has(key)) merged.set(key, model);
      }
    } catch (error) {
      throw new Error(`Pi 模型目录不可用（未返回可能不完整的配置模型回退）：${error instanceof Error ? error.message : String(error)}`);
    }
    const current = this.modelState.model;
    const currentKey = `${current.provider}/${current.id}`;
    if (includeCurrent && current.provider !== "unknown" && !merged.has(currentKey))
      merged.set(currentKey, current);
    this.models = [...merged.values()];
  }
  async loadModelCatalog(includeCurrent = true) {
    await this.loadConfiguredModels();
    await this.mergeRuntimeModels(includeCurrent);
  }
  /** Rebuild after pi login/logout while preserving still-configured literal/env-key models. */
  async refreshModelsAfterAuthChange(includeCurrent = true) {
    this.modelsLoaded = void 0;
    await this.loadModelCatalog(includeCurrent);
    return this.models;
  }
  async removeProviderCredentials(providerId) {
    const rt = await this.modelRuntime();
    await rt.logout(providerId);
    const models = await this.refreshModelsAfterAuthChange(false);
    if (this.modelState.model.provider === providerId) {
      const next = models[0] ?? {
        provider: "unknown",
        id: "unknown",
        name: "无可用模型",
        reasoning: false
      };
      this.modelState = {
        ...this.modelState,
        model: next,
        availableThinkingLevels: next.reasoning ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"] : ["off"]
      };
    }
    return this.modelState;
  }
  /** Mirror Swift prepareMessage: persist under <cwd>/.pi/attachments and append readable paths. */
  async prepareImageMessage(live, text2, attachments) {
    const dir = path.join(live.cwd, ".pi", "attachments");
    await fs.promises.mkdir(dir, { recursive: true });
    const paths = [];
    for (const [i, a] of attachments.entries()) {
      const ext2 = ATTACHMENT_EXT[a.mimeType] ?? "img";
      const name = sanitizeAttachmentName(a.name, `attachment-${i + 1}.${ext2}`);
      const file = name.endsWith(`.${ext2}`) ? path.join(dir, name) : path.join(dir, `${name}.${ext2}`);
      await fs.promises.writeFile(file, Buffer.from(a.dataBase64, "base64"));
      paths.push(file);
    }
    const trimmed = text2.trim();
    const lines = [];
    if (trimmed) lines.push(trimmed);
    lines.push("");
    if (paths.length === 1) lines.push(`Attached image file: ${paths[0]}`);
    else {
      lines.push("Attached image files:");
      for (const p of paths) lines.push(`- ${p}`);
    }
    lines.push(
      "(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)"
    );
    return lines.join("\n");
  }
  async dispatchQueuedMessage(id, payload, behavior) {
    await this.requireLease(id);
    const live = await this.ensure(id);
    const attachments = payload.attachments;
    const message = attachments.length ? await this.prepareImageMessage(live, payload.text, attachments) : payload.text;
    const body = {
      type: behavior === "steer" ? "steer" : behavior === "follow_up" ? "follow_up" : "prompt",
      message
    };
    if (attachments.length && behavior !== "follow_up")
      body.images = attachments.map((a) => ({
        type: "image",
        data: a.dataBase64,
        mimeType: a.mimeType
      }));
    await this.command(id, body);
  }
  async prompt(id, prompt, follow, attachments) {
    if (!follow) {
      await this.enqueueMessage(id, prompt, attachments);
      return;
    }
    await this.dispatchQueuedMessage(
      id,
      { text: prompt, attachments: [] },
      "follow_up"
    );
    const live = this.live.get(id);
    if (!live) return;
    live.followUps.push(prompt);
    this.stream({
      type: "status",
      sessionId: id,
      status: "streaming",
      pendingFollowUps: live.followUps
    });
  }
  async getModelState(sessionId) {
    await this.loadModelCatalog();
    if (!sessionId) return this.modelState;
    await this.ensure(sessionId);
    return this.sessionModelStates.get(sessionId) ?? this.sessionModelSnapshots.get(sessionId) ?? this.modelState;
  }
  /** Legacy/default selection path used before any session exists; live UI changes are session-scoped. */
  async setConfiguredModel(provider, modelId) {
    await this.loadModelCatalog();
    const model = this.models.find(
      (item) => item.provider === provider && item.id === modelId
    );
    if (!model) throw new Error(`unknown model ${provider}/${modelId}`);
    this.modelState = {
      ...this.modelState,
      model,
      availableThinkingLevels: model.reasoning ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"] : ["off"]
    };
    return this.modelState;
  }
  async setModel(sessionId, provider, modelId) {
    const live = await this.ensure(sessionId);
    await this.command(sessionId, { type: "set_model", provider, modelId });
    await this.refreshState(live);
    const state = this.sessionModelStates.get(sessionId);
    this.sessionModelSnapshots.set(sessionId, state);
    return state;
  }
  async setThinking(sessionId, level) {
    const live = await this.ensure(sessionId);
    const current = this.sessionModelStates.get(sessionId) ?? this.sessionModelSnapshots.get(sessionId) ?? this.modelState;
    if (!current.availableThinkingLevels.includes(level))
      throw new Error(`thinking level ${level} is unavailable`);
    await this.command(sessionId, { type: "set_thinking_level", level });
    await this.refreshState(live);
    const state = this.sessionModelStates.get(sessionId);
    this.sessionModelSnapshots.set(sessionId, state);
    return state;
  }
  /**
   * Real pi `get_session_stats` RPC mapped onto the stable SessionStats shape.
   * `sessionId` is optional and defaults to the current active (most recently
   * started) live session; a cold session is spawned like any resume so stats
   * always come from pi, never from renderer-side JSONL scanning.
   */
  async getSessionStats(sessionId) {
    const id = sessionId ?? [...this.live.keys()].at(-1);
    if (!id) throw new Error("no active session; pass an explicit sessionId");
    const live = await this.ensure(id);
    return this.sessionStatsData(live.session.id);
  }
  /**
   * Account-quota snapshot for the provider backing the current model (Codex
   * plan today). Mirrors the Swift app's quota capsule below the input bar;
   * resolves null — never throws — when the provider has no quota source.
   */
  async getQuotaSnapshot() {
    await this.loadConfiguredModels();
    const provider = this.modelState.model.provider;
    return this.quotaStore.snapshot(provider);
  }
  async sessionStatsData(id) {
    const data = await this.command(id, { type: "get_session_stats" });
    const tokens = isRecord(data?.tokens) ? data.tokens : {};
    const contextUsage = isRecord(data?.contextUsage) ? data.contextUsage : void 0;
    const model = (this.sessionModelStates.get(id) ?? this.modelState).model;
    const stats = {
      sessionId: id,
      tokens: {
        input: num(tokens.input),
        output: num(tokens.output),
        cacheRead: num(tokens.cacheRead),
        cacheWrite: num(tokens.cacheWrite),
        total: num(tokens.total)
      },
      cost: typeof data?.cost === "number" ? data.cost : 0,
      contextUsage: contextUsage ? {
        tokens: typeof contextUsage.tokens === "number" ? contextUsage.tokens : null,
        contextWindow: num(contextUsage.contextWindow),
        percent: typeof contextUsage.percent === "number" ? contextUsage.percent : null
      } : void 0,
      model: model.provider === "unknown" && model.id === "unknown" ? void 0 : { provider: model.provider, id: model.id, name: model.name }
    };
    return stats;
  }
  /** Best-effort post-settle snapshot; the command query above stays authoritative. */
  async pushSessionStats(id) {
    try {
      const stats = await this.sessionStatsData(id);
      emitFrame(this.listeners, {
        protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
        channel: "session_stats",
        event: { type: "snapshot", sessionId: id, stats }
      });
    } catch {
    }
  }
  agents = /* @__PURE__ */ new Map();
  worktrees = /* @__PURE__ */ new Map();
  async getAgent(id) {
    const a = this.agents.get(id);
    if (!a) throw new Error(`unknown agent ${id}`);
    return a;
  }
  async getWorktree(id) {
    return this.worktrees.get(id) ?? {
      agentId: id,
      lifecycle: "none",
      merge: "unavailable",
      discard: "unavailable"
    };
  }
  async agentCommand(id, operation) {
    const a = await this.getAgent(id);
    if (operation === "abort") a.state = "aborted";
    else {
      a.handled = true;
      a.closeout = a.closeout ?? "Boss marked this episode handled";
    }
    this.agent({ type: "agent", agent: { ...a } });
  }
  /**
  * Manual merge/discard of a retained worker worktree.
  *
  * Automatic finalization is real: this host sets PIPIUI_WORKTREE_FINALIZER=pi, so a successful
  * worker is merged and cleaned up by the audited service inside pi. What is NOT implemented is
  * this manual fallback for a worktree the policy deliberately retained (failed/aborted work).
  * It used to flip the status fields to "merged"/"discarded" and report success while touching
  * no Git at all — telling a user their work was merged when the branch was untouched is worse
  * than having no button. Until this routes through a real host-api operation, it fails loudly.
  */
  async worktreeCommand(id, operation) {
    const current = await this.getWorktree(id);
    if (operation === "merge" && current.merge !== "ready")
      throw new Error("worktree cannot be merged");
    if (operation === "discard" && current.discard !== "ready")
      throw new Error("worktree cannot be discarded");
    throw new Error(
      `manual worktree ${operation} is not implemented in this host yet: retained worktree ${current.path ?? id} on branch ${current.branch ?? "(unknown)"} is untouched. Successful workers are merged automatically; resolve this one from the Swift app or with git directly.`
    );
  }
  /**
   * Plan tools POST here once the philosophy plan runtime is mounted. This host has no Plan
   * panel yet, so the event is acknowledged and dropped rather than relayed — the bridge must
   * still answer, or `plan_publish` would look broken to the agent.
   */
  planEvent(event, sessionId) {
  }
  mapAgentEvent(raw, sessionId) {
    const current = this.agents.get(raw.agentId);
    if (raw.kind === "closeout") {
      if (!current || current.runId !== raw.runId || raw.disposition !== "cleaned")
        return;
      const agent2 = {
        ...current,
        handled: true,
        closeout: raw.reason ?? current.closeout
      };
      this.agents.set(agent2.agentId, agent2);
      this.agent({ type: "agent", agent: agent2 });
      return;
    }
    const state = raw.ok ? "ok" : raw.aborted ? "aborted" : raw.interrupted ? "interrupted" : raw.stalled ? "stalled" : raw.kind === "end" ? "failed" : "running";
    const usage = isRecord(raw.usage) ? raw.usage : void 0;
    const terminal = raw.kind === "end";
    const agent = {
      agentId: raw.agentId,
      runId: raw.runId,
      name: raw.name ?? current?.name ?? "subagent",
      task: raw.task ?? current?.task ?? "",
      state,
      stalled: raw.stalled,
      handled: current?.handled,
      cost: raw.cost ?? usage?.cost ?? current?.cost,
      turns: raw.turns ?? raw.turn ?? current?.turns,
      outputCount: raw.output ? 1 : current?.outputCount,
      sessionId: sessionId ?? current?.sessionId,
      parentId: raw.parentId !== void 0 ? raw.parentId : current?.parentId,
      depth: raw.depth ?? current?.depth,
      role: raw.role ?? raw.agentType ?? current?.role ?? raw.name,
      title: raw.title ?? current?.title,
      createdAt: raw.createdAt ?? (raw.at ? asTime(raw.at) : current?.createdAt ?? Date.now()),
      // `start` sends `model: null` when the worker inherits the main model, so a null must never
      // clobber a model a later `usage` event resolved.
      model: modelRef(raw.model) ?? current?.model,
      provider: providerOf(modelRef(raw.model)) ?? current?.provider,
      // The extension's `activity` is the one-line "what this worker is doing right now"; it is what
      // Swift shows as the row subtitle and in the 正在执行 block.
      listSubtitle: nonEmpty(raw.activity) ?? current?.listSubtitle,
      // `update` carries a rolling snapshot of the output; only the terminal event is the real result,
      // so a running worker never renders a 最终结果 card built from a half-written answer.
      finalResult: terminal ? nonEmpty(raw.output) ?? current?.finalResult : current?.finalResult,
      endedAt: terminal ? current?.endedAt ?? Date.now() : current?.endedAt,
      inputTokens: num2(usage?.input) ?? current?.inputTokens,
      outputTokens: num2(usage?.output) ?? current?.outputTokens,
      cacheTokens: num2(usage?.cacheRead) ?? current?.cacheTokens,
      contextTokens: num2(usage?.contextTokens) ?? current?.contextTokens
    };
    this.agents.set(agent.agentId, agent);
    const lifecycle = raw.worktreeLifecycle ?? (raw.worktreePath ? state === "running" ? "active" : "pendingReview" : void 0);
    if (lifecycle) {
      const status = {
        agentId: agent.agentId,
        path: raw.worktreePath ?? this.worktrees.get(agent.agentId)?.path,
        branch: raw.worktreeBranch ?? this.worktrees.get(agent.agentId)?.branch,
        error: raw.worktreeError ?? this.worktrees.get(agent.agentId)?.error,
        lifecycle,
        merge: lifecycle === "pendingReview" ? "ready" : lifecycle === "merged" ? "merged" : "unavailable",
        discard: lifecycle === "pendingReview" ? "ready" : lifecycle === "discarded" ? "discarded" : "unavailable"
      };
      this.worktrees.set(agent.agentId, status);
      this.agent({ type: "worktree", status });
    }
    if (raw.kind === "log_delta")
      this.agent({
        type: "agent_log",
        agentId: agent.agentId,
        itemType: raw.itemType,
        text: raw.text ?? "",
        name: raw.name,
        isError: raw.isError
      });
    else if (raw.kind === "log")
      for (const item of raw.items ?? [])
        this.agent({
          type: "agent_log",
          agentId: agent.agentId,
          itemType: item.itemType,
          text: item.text,
          name: item.name,
          isError: item.isError
        });
    this.agent({ type: "agent", agent });
  }
  /** Lease surface deliberately remains absent: no lease is acquired/released in this backend. */
}
function createPiHostBackend(options = {}) {
  return new PiHostBackend(options);
}
const browserDOMControllerSource = '(function () {\n  "use strict";\n\n  const API_NAME = "__pipiBrowserDOM";\n  const OVERLAY_ATTRIBUTE = "data-pipiui-browser-highlight";\n  const MAX_ELEMENTS = 256;\n  const MAX_UTF16_UNITS = 20000;\n  const MAX_REDACTION_ENTRIES = 64;\n  const MAX_REDACTION_VALUE_UNITS = 4096;\n  const MAX_REDACTION_TOTAL_UNITS = 16384;\n  const SENSITIVE_AUTOCOMPLETE_TOKEN = /^(current-password|new-password|one-time-code|cc(?:-|$))/i;\n  // Query/hash parameter names whose values must never appear in public observations.\n  const SENSITIVE_URL_PARAM = /(?:^|[._-])(?:token|password|passwd|secret|key|reset|auth|otp|code|session|sig|signature|credential|bearer)(?:[._-]|$)|^(?:token|password|passwd|secret|key|reset|auth|otp|code|session|sig|signature|credential|bearer)$/i;\n  const BARE_PASSWORD_SEMANTICS = /\\b(?:password|passcode|passwd)\\b|密码|密碼|口令/i;\n  const STRING_LIMITS = Object.freeze({\n    url: 4096,\n    title: 512,\n    name: 512,\n    state: 256,\n    valueHint: 256,\n    frame: 160,\n    limitation: 512,\n    error: 512,\n    selected: 256,\n    action: 256,\n    code: 128,\n    token: 128,\n    snapshotID: 128,\n  });\n\n  const state = {\n    activeSnapshot: null,\n    pendingFrameClick: null,\n    redactionValues: [],\n    redactionTotalUnits: 0,\n    redactionOverflow: false,\n    sequence: 0,\n    highlight: null,\n    highlightTimer: null,\n  };\n\n  function opaqueID(prefix) {\n    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {\n      return `${prefix}-${globalThis.crypto.randomUUID()}`;\n    }\n    state.sequence += 1;\n    return `${prefix}-${Date.now().toString(36)}-${state.sequence.toString(36)}-${Math.random().toString(36).slice(2)}`;\n  }\n\n  function normalizedText(value) {\n    return String(value ?? "").replace(/\\s+/g, " ").trim();\n  }\n\n  function truncateUTF16(value, limit) {\n    const string = String(value ?? "");\n    if (string.length <= limit) return string;\n    let end = Math.max(0, limit - 1);\n    if (end > 0 && /[\\uD800-\\uDBFF]/.test(string.charAt(end - 1))) end -= 1;\n    return `${string.slice(0, end)}…`;\n  }\n\n  function secretVariants(values) {\n    const variants = new Set();\n    for (const rawValue of values || []) {\n      const raw = String(rawValue ?? "");\n      if (!raw) continue;\n      const normalized = normalizedText(raw);\n      for (const candidate of [raw, normalized]) {\n        if (!candidate) continue;\n        variants.add(candidate);\n        try {\n          const encoded = encodeURIComponent(candidate);\n          variants.add(encoded);\n          variants.add(encoded.replace(/%20/g, "+"));\n          const lowerEscapes = encoded.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());\n          variants.add(lowerEscapes);\n          variants.add(lowerEscapes.replace(/%20/gi, "+"));\n        } catch (_) {}\n      }\n    }\n    return Array.from(variants).sort((left, right) => right.length - left.length);\n  }\n\n  function retainRedactions(values) {\n    if (state.redactionOverflow) return false;\n    for (const value of values || []) {\n      const raw = String(value ?? "");\n      if (!raw || state.redactionValues.includes(raw)) continue;\n      if (raw.length > MAX_REDACTION_VALUE_UNITS\n        || state.redactionValues.length >= MAX_REDACTION_ENTRIES\n        || state.redactionTotalUnits + raw.length > MAX_REDACTION_TOTAL_UNITS) {\n        state.redactionOverflow = true;\n        return false;\n      }\n      state.redactionValues.push(raw);\n      state.redactionTotalUnits += raw.length;\n    }\n    return true;\n  }\n\n  function activeRedactionVariants(extraValues = []) {\n    return secretVariants([...state.redactionValues, ...extraValues]);\n  }\n\n  function redactionCapacityFailure() {\n    invalidateSnapshot();\n    return {\n      ok: false,\n      error: "browser redaction capacity exceeded; reload the document before continuing",\n      code: "browser_redaction_capacity_exceeded",\n      requiresObservation: true,\n      redacted: true,\n    };\n  }\n\n  function redactString(value, variants) {\n    let result = String(value ?? "");\n    for (const secret of variants) {\n      if (!secret || !result.includes(secret)) continue;\n      if (secret.length < 3) return "[redacted]";\n      result = result.split(secret).join("[redacted]");\n    }\n    return result;\n  }\n\n  function stringLimitForKey(key) {\n    if (key === "limitations") return STRING_LIMITS.limitation;\n    return STRING_LIMITS[key] || 512;\n  }\n\n  function sanitizePublic(value, variants, key = "") {\n    if (typeof value === "string") {\n      if (key === "token" || key === "snapshotID") return truncateUTF16(value, stringLimitForKey(key));\n      return truncateUTF16(redactString(value, variants), stringLimitForKey(key));\n    }\n    if (Array.isArray(value)) return value.map((item) => sanitizePublic(item, variants, key));\n    if (value && typeof value === "object") {\n      const result = {};\n      for (const [childKey, childValue] of Object.entries(value)) {\n        result[childKey] = sanitizePublic(childValue, variants, childKey);\n      }\n      return result;\n    }\n    return value;\n  }\n\n  function serializedLength(value) {\n    try {\n      return JSON.stringify(value).length;\n    } catch (_) {\n      return MAX_UTF16_UNITS + 1;\n    }\n  }\n\n  function enforceEnvelopeBudget(value, variants) {\n    const envelope = sanitizePublic(value, variants);\n    const elementLists = [];\n    const limitationLists = [];\n    function findDroppable(current) {\n      if (!current || typeof current !== "object") return;\n      if (Array.isArray(current.elements)) elementLists.push(current.elements);\n      if (Array.isArray(current.limitations)) limitationLists.push(current.limitations);\n      for (const child of Object.values(current)) findDroppable(child);\n    }\n    findDroppable(envelope);\n    while (serializedLength(envelope) > MAX_UTF16_UNITS && elementLists.some((list) => list.length)) {\n      const list = elementLists.find((candidate) => candidate.length);\n      list.pop();\n      if (envelope.observation && typeof envelope.observation === "object") envelope.observation.truncated = true;\n      else envelope.truncated = true;\n    }\n    while (serializedLength(envelope) > MAX_UTF16_UNITS && limitationLists.some((list) => list.length)) {\n      limitationLists.find((candidate) => candidate.length).pop();\n    }\n    if (serializedLength(envelope) > MAX_UTF16_UNITS) {\n      return {\n        ok: false,\n        error: "browser response exceeded the public output budget",\n        code: "browser_output_truncated",\n        requiresObservation: true,\n      };\n    }\n    return envelope;\n  }\n\n  function invalidateSnapshot() {\n    state.activeSnapshot = null;\n  }\n\n  function clearPendingFrameClick() {\n    const pending = state.pendingFrameClick;\n    if (pending?.frameElement) {\n      if (pending.onLoad) pending.frameElement.removeEventListener("load", pending.onLoad);\n      if (pending.onError) pending.frameElement.removeEventListener("error", pending.onError);\n    }\n    state.pendingFrameClick = null;\n  }\n\n  function clearHighlight() {\n    if (state.highlightTimer !== null) {\n      clearTimeout(state.highlightTimer);\n      state.highlightTimer = null;\n    }\n    if (state.highlight && state.highlight.isConnected) state.highlight.remove();\n    state.highlight = null;\n  }\n\n  function highlight(element) {\n    clearHighlight();\n    const rect = element.getBoundingClientRect();\n    const ownerDocument = element.ownerDocument || document;\n    const overlay = ownerDocument.createElement("div");\n    overlay.setAttribute(OVERLAY_ATTRIBUTE, "true");\n    Object.assign(overlay.style, {\n      position: "fixed",\n      left: `${Math.max(0, rect.left)}px`,\n      top: `${Math.max(0, rect.top)}px`,\n      width: `${Math.max(0, rect.width)}px`,\n      height: `${Math.max(0, rect.height)}px`,\n      boxSizing: "border-box",\n      border: "2px solid rgb(10, 132, 255)",\n      borderRadius: "4px",\n      background: "rgba(10, 132, 255, 0.10)",\n      zIndex: "2147483647",\n      pointerEvents: "none",\n    });\n    (ownerDocument.documentElement || ownerDocument.body).appendChild(overlay);\n    state.highlight = overlay;\n    state.highlightTimer = setTimeout(clearHighlight, 1000);\n  }\n\n  function implicitRole(element) {\n    const tag = element.localName;\n    if (tag === "a" && element.hasAttribute("href")) return "link";\n    if (tag === "button") return "button";\n    if (tag === "select") return "combobox";\n    if (tag === "textarea") return "textbox";\n    if (tag === "input") {\n      const type = (element.getAttribute("type") || "text").toLowerCase();\n      if (["button", "submit", "reset", "image"].includes(type)) return "button";\n      if (type === "checkbox") return "checkbox";\n      if (type === "radio") return "radio";\n      if (type === "range") return "slider";\n      return "textbox";\n    }\n    if (/^h[1-6]$/.test(tag)) return "heading";\n    if (tag === "nav") return "navigation";\n    if (tag === "main") return "main";\n    if (tag === "header") return "banner";\n    if (tag === "footer") return "contentinfo";\n    if (tag === "aside") return "complementary";\n    if (tag === "form") return "form";\n    return "";\n  }\n\n  function role(element) {\n    return normalizedText(element.getAttribute("role")) || implicitRole(element);\n  }\n\n  function referencedText(element, attribute) {\n    const ids = normalizedText(element.getAttribute(attribute)).split(" ").filter(Boolean);\n    if (!ids.length) return "";\n    return normalizedText(ids.map((id) => element.ownerDocument.getElementById(id)?.textContent || "").join(" "));\n  }\n\n  function accessibleName(element) {\n    const labelled = referencedText(element, "aria-labelledby");\n    if (labelled) return truncateUTF16(labelled, STRING_LIMITS.name);\n    const aria = normalizedText(element.getAttribute("aria-label"));\n    if (aria) return truncateUTF16(aria, STRING_LIMITS.name);\n    if (element.labels && element.labels.length) {\n      const labelText = normalizedText(Array.from(element.labels).map((label) => label.textContent || "").join(" "));\n      if (labelText) return truncateUTF16(labelText, STRING_LIMITS.name);\n    }\n    for (const attribute of ["alt", "title", "placeholder"]) {\n      const value = normalizedText(element.getAttribute(attribute));\n      if (value) return truncateUTF16(value, STRING_LIMITS.name);\n    }\n    if (element.localName === "input") {\n      const type = (element.getAttribute("type") || "text").toLowerCase();\n      if (["button", "submit", "reset"].includes(type)) {\n        const value = normalizedText(element.value);\n        if (value) return truncateUTF16(value, STRING_LIMITS.name);\n      }\n    }\n    return truncateUTF16(normalizedText(element.textContent), STRING_LIMITS.name);\n  }\n\n  function semanticFieldText(element) {\n    const raw = [\n      element.id,\n      element.getAttribute("name"),\n      element.getAttribute("aria-label"),\n      referencedText(element, "aria-labelledby"),\n      element.getAttribute("placeholder"),\n      accessibleName(element),\n    ].filter(Boolean).join(" ");\n    return normalizedText(raw\n      .normalize("NFKC")\n      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")\n      .replace(/[_./-]+/g, " "))\n      .toLowerCase();\n  }\n\n  function isSensitive(element) {\n    if (!["input", "textarea", "select"].includes(element.localName)) return false;\n    const type = element.localName === "input"\n      ? (element.getAttribute("type") || "text").toLowerCase()\n      : "";\n    const autocompleteTokens = normalizedText(element.getAttribute("autocomplete")).split(" ");\n    if (type === "password" || autocompleteTokens.some((token) => SENSITIVE_AUTOCOMPLETE_TOKEN.test(token))) {\n      return true;\n    }\n\n    const semantics = semanticFieldText(element);\n    if (!semantics) return false;\n    // Defense in depth: bare password keywords in name/id/label/placeholder.\n    if (BARE_PASSWORD_SEMANTICS.test(semantics)) return true;\n    const inputMode = normalizedText(element.getAttribute("inputmode")).toLowerCase();\n    const numericEntry = ["numeric", "decimal", "tel"].includes(inputMode)\n      || ["number", "tel"].includes(type);\n    const otpSemantics = /(?:\\botp\\b|\\bone\\s*time\\s*(?:code|passcode|password)\\b|\\b(?:verification|authentication|auth)\\s*(?:code|passcode)\\b|\\b(?:sms|email)\\s*(?:verification\\s*)?code\\b|验证码|驗證碼|一次性(?:密码|密碼|口令|验证码|驗證碼)|动态(?:码|碼|密码|密碼)|短信(?:码|碼|验证码|驗證碼)|认证码|認證碼)/i;\n    const cardNumberSemantics = /(?:\\b(?:credit|debit|payment|bank)\\s*card\\s*(?:number|no|pan)?\\b|\\bcard\\s*(?:number|no|pan)\\b|\\bpan\\b|银行卡号|銀行卡號|信用卡号|信用卡號|借记卡号|借記卡號|支付卡号|支付卡號|卡号|卡號)/i;\n    const cardSecuritySemantics = /(?:\\b(?:cvv2?|cvc2?|cid)\\b|\\b(?:card\\s*)?(?:security|verification)\\s*code\\b|安全码|安全碼|卡片验证码|卡片驗證碼)/i;\n    const cardExpirySemantics = /(?:\\b(?:card\\s*)?(?:expiry|expiration)(?:\\s*(?:date|month|year|mm|yy))?\\b|\\bexp\\s*(?:date|month|year|mm|yy)\\b|有效期|到期(?:日|日期|月|月份|年|年份)|失效日期)/i;\n    const numericAuthenticationSemantics = numericEntry\n      && /(?:\\b(?:verification|authentication|auth)\\b|身份验证|身份驗證|认证|認證)/i.test(semantics);\n    const numericPaymentSemantics = numericEntry\n      && /(?:\\b(?:credit|debit|payment|bank)\\s*card\\b|银行卡|銀行卡|信用卡|借记卡|借記卡)/i.test(semantics);\n    return otpSemantics.test(semantics)\n      || cardNumberSemantics.test(semantics)\n      || cardSecuritySemantics.test(semantics)\n      || cardExpirySemantics.test(semantics)\n      || numericAuthenticationSemantics\n      || numericPaymentSemantics;\n  }\n\n  function redactURLForObservation(href) {\n    const raw = String(href || "");\n    try {\n      const url = new URL(raw, String(location.href));\n      let changed = false;\n      const redactParams = (params) => {\n        for (const key of [...params.keys()]) {\n          if (SENSITIVE_URL_PARAM.test(key)) {\n            params.set(key, "[redacted]");\n            changed = true;\n          }\n        }\n      };\n      redactParams(url.searchParams);\n      if (url.hash && url.hash.length > 1) {\n        const hashBody = url.hash.slice(1);\n        if (hashBody.includes("=")) {\n          const hashParams = new URLSearchParams(hashBody);\n          const before = hashParams.toString();\n          redactParams(hashParams);\n          if (hashParams.toString() !== before) {\n            url.hash = hashParams.toString();\n            changed = true;\n          }\n        }\n      }\n      return changed ? url.toString() : raw;\n    } catch (_) {\n      return raw;\n    }\n  }\n\n  function controlValue(element) {\n    return ["input", "textarea", "select"].includes(element.localName)\n      ? String(element.value || "")\n      : "";\n  }\n\n  function collectCurrentSensitiveValues() {\n    const values = [];\n    function walk(root, iframeDepth) {\n      const children = root.nodeType === Node.DOCUMENT_NODE\n        ? (root.documentElement ? [root.documentElement] : [])\n        : Array.from(root.children || []);\n      for (const element of children) {\n        if (isSensitive(element)) values.push(String(element.value || ""));\n        if (element.shadowRoot) walk(element.shadowRoot, iframeDepth);\n        if (element.localName === "iframe" && iframeDepth < 1) {\n          try {\n            if (element.contentDocument?.documentElement) walk(element.contentDocument, iframeDepth + 1);\n          } catch (_) {}\n        }\n        walk(element, iframeDepth);\n      }\n    }\n    walk(document, 0);\n    return values;\n  }\n\n  function retainCurrentSensitiveValues() {\n    return retainRedactions(collectCurrentSensitiveValues());\n  }\n\n  function isSelfHidden(element) {\n    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return true;\n    if (element.hasAttribute(OVERLAY_ATTRIBUTE) || element.closest?.(`[${OVERLAY_ATTRIBUTE}]`)) return true;\n    const view = element.ownerDocument?.defaultView;\n    const style = view?.getComputedStyle(element);\n    return !style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0;\n  }\n\n  function isHiddenComposed(element) {\n    let current = element;\n    const visited = new Set();\n    while (current && !visited.has(current)) {\n      visited.add(current);\n      if (isSelfHidden(current)) return true;\n      if (current.parentElement) {\n        current = current.parentElement;\n        continue;\n      }\n      const root = current.getRootNode?.();\n      if (root && root.host) {\n        current = root.host;\n        continue;\n      }\n      const frameElement = current.ownerDocument?.defaultView?.frameElement;\n      current = frameElement || null;\n    }\n    return false;\n  }\n\n  function isDisabled(element) {\n    return Boolean(element.matches?.(":disabled") || element.getAttribute("aria-disabled") === "true");\n  }\n\n  function hasVisibleBox(element) {\n    const rect = element.getBoundingClientRect();\n    return rect.width > 0 && rect.height > 0;\n  }\n\n  function isInteractive(element, elementRole) {\n    if (element.matches?.("a[href],button,input,textarea,select,summary,[contenteditable=\'true\'],[tabindex]")) return true;\n    return ["button", "link", "textbox", "checkbox", "radio", "combobox", "listbox", "menuitem", "option", "slider", "switch", "tab"].includes(elementRole);\n  }\n\n  function isContext(element, elementRole) {\n    return /^h[1-6]$/.test(element.localName)\n      || element.localName === "label"\n      || ["heading", "main", "navigation", "banner", "contentinfo", "complementary", "form"].includes(elementRole);\n  }\n\n  function stateDescription(element) {\n    const values = [];\n    if (element.matches?.(":checked") || element.getAttribute("aria-checked") === "true") values.push("checked");\n    if (element.getAttribute("aria-expanded") === "true") values.push("expanded");\n    if (element.getAttribute("aria-expanded") === "false") values.push("collapsed");\n    if (element.getAttribute("aria-selected") === "true") values.push("selected");\n    if (element.matches?.(":focus")) values.push("focused");\n    if (element.hasAttribute("required") || element.getAttribute("aria-required") === "true") values.push("required");\n    return values.join(",");\n  }\n\n  function valueHint(element) {\n    if (isSensitive(element)) return "sensitive value hidden";\n    if (element.localName === "select") {\n      return truncateUTF16(normalizedText(element.selectedOptions?.[0]?.textContent || element.value), STRING_LIMITS.valueHint);\n    }\n    if (element.localName === "input" || element.localName === "textarea") {\n      const value = normalizedText(element.value);\n      return value ? `value length ${value.length}` : "empty";\n    }\n    if (element.isContentEditable) {\n      const value = normalizedText(element.textContent);\n      return value ? `text length ${value.length}` : "empty";\n    }\n    return "";\n  }\n\n  function frameRect(element, offsetX, offsetY) {\n    const rect = element.getBoundingClientRect();\n    return {\n      x: Math.round((rect.left + offsetX) * 10) / 10,\n      y: Math.round((rect.top + offsetY) * 10) / 10,\n      width: Math.round(rect.width * 10) / 10,\n      height: Math.round(rect.height * 10) / 10,\n    };\n  }\n\n  function inViewport(rect) {\n    return rect.x + rect.width > 0\n      && rect.y + rect.height > 0\n      && rect.x < globalThis.innerWidth\n      && rect.y < globalThis.innerHeight;\n  }\n\n  function owningFrameElement(ownerDocument) {\n    try {\n      return ownerDocument?.defaultView?.frameElement || null;\n    } catch (_) {\n      return null;\n    }\n  }\n\n  function resolvedHref(element) {\n    if ((element.localName === "a" || element.localName === "area") && element.hasAttribute("href")) {\n      return String(element.href || "");\n    }\n    return "";\n  }\n\n  function submitSemantics(element) {\n    const type = (element.getAttribute("type") || (element.localName === "button" ? "submit" : "")).toLowerCase();\n    const isSubmit = (element.localName === "button" && type === "submit")\n      || (element.localName === "input" && ["submit", "image"].includes(type));\n    if (!isSubmit || !element.form) return ["", ""];\n    let action = "";\n    try {\n      action = String(\n        element.hasAttribute("formaction")\n          ? element.formAction\n          : (element.form.action || element.ownerDocument.URL || ""),\n      );\n    } catch (_) {}\n    const method = String(\n      element.hasAttribute("formmethod") ? element.formMethod : (element.form.method || "get"),\n    ).toLowerCase();\n    return [action, method];\n  }\n\n  function fingerprint(element, frame, elementRole, name) {\n    const [formAction, formMethod] = submitSemantics(element);\n    return [\n      frame,\n      element.localName,\n      (element.getAttribute("type") || "").toLowerCase(),\n      elementRole,\n      name,\n      resolvedHref(element),\n      formAction,\n      formMethod,\n      element.isContentEditable ? "editable" : "not-editable",\n    ].join("\\u001f");\n  }\n\n  function collect(scope) {\n    const candidates = [];\n    const limitations = [\n      "closed_shadow_roots_not_structured; use screenshot or Computer Use",\n      // Platform gaps: declared so the model falls back to screenshot/user handoff.\n      "js_dialogs_not_handled; alert/confirm/prompt are suppressed — use screenshot or user handoff if a dialog is required",\n      "file_input_paths_not_supported; cannot supply local file paths — use screenshot or user handoff for uploads",\n    ];\n    let iframeCounter = 0;\n    let sawFileInput = false;\n\n    function walkContainer(root, frame, iframeDepth, offsetX, offsetY) {\n      const children = root.nodeType === Node.DOCUMENT_NODE\n        ? (root.documentElement ? [root.documentElement] : [])\n        : Array.from(root.children || []);\n      for (const current of children) {\n        if (isSelfHidden(current)) continue;\n        const currentRole = role(current);\n        if (!isDisabled(current) && hasVisibleBox(current)) {\n          const rect = frameRect(current, offsetX, offsetY);\n          if ((scope === "page" || inViewport(rect)) && (isInteractive(current, currentRole) || isContext(current, currentRole))) {\n            const name = accessibleName(current);\n            candidates.push({\n              element: current,\n              ownerDocument: current.ownerDocument,\n              rootNode: current.getRootNode(),\n              owningFrameElement: owningFrameElement(current.ownerDocument),\n              frame,\n              fingerprint: fingerprint(current, frame, currentRole, name),\n              public: {\n                tag: current.localName,\n                role: currentRole,\n                name,\n                state: stateDescription(current),\n                valueHint: valueHint(current),\n                frame,\n                rect,\n              },\n            });\n          }\n        }\n\n        if (current.localName === "input"\n          && (current.getAttribute("type") || "").toLowerCase() === "file") {\n          sawFileInput = true;\n        }\n\n        if (current.shadowRoot) walkContainer(current.shadowRoot, frame, iframeDepth, offsetX, offsetY);\n        if (current.localName === "iframe") {\n          const childFrame = `${frame}/iframe[${iframeCounter}]`;\n          iframeCounter += 1;\n          if (iframeDepth >= 1) {\n            limitations.push(`nested_iframe_unavailable:${childFrame}`);\n          } else {\n            try {\n              const childDocument = current.contentDocument;\n              if (!childDocument || !childDocument.documentElement) throw new Error("cross-origin or unavailable");\n              const iframeRect = current.getBoundingClientRect();\n              walkContainer(childDocument, childFrame, iframeDepth + 1, offsetX + iframeRect.left, offsetY + iframeRect.top);\n            } catch (_) {\n              limitations.push(`cross_origin_iframe:${childFrame}; use screenshot or Computer Use`);\n            }\n          }\n        }\n        if (current.localName === "canvas") {\n          limitations.push("canvas_or_webgl_not_structured; use screenshot or Computer Use");\n        }\n        walkContainer(current, frame, iframeDepth, offsetX, offsetY);\n      }\n    }\n\n    walkContainer(document, "main", 0, 0, 0);\n    if (sawFileInput) {\n      limitations.push("file_input_present; structured browser cannot set file paths — use user handoff or Computer Use");\n    }\n    return { candidates, limitations };\n  }\n\n  function viewportInfo() {\n    return { width: Math.round(globalThis.innerWidth), height: Math.round(globalThis.innerHeight) };\n  }\n\n  function scrollInfo() {\n    const root = document.scrollingElement || document.documentElement;\n    const pixelsAbove = Math.max(0, Math.round(root.scrollTop));\n    const pixelsBelow = Math.max(0, Math.round(root.scrollHeight - root.clientHeight - root.scrollTop));\n    const maximum = Math.max(0, root.scrollHeight - root.clientHeight);\n    return {\n      pixelsAbove,\n      pixelsBelow,\n      positionPercent: maximum > 0 ? Math.round((root.scrollTop / maximum) * 1000) / 10 : 0,\n    };\n  }\n\n  function observe(scope, action, secretValues) {\n    const normalizedScope = scope === "page" ? "page" : "viewport";\n    if (!retainRedactions(secretValues) || !retainCurrentSensitiveValues()) {\n      return redactionCapacityFailure();\n    }\n    const variants = activeRedactionVariants();\n    const { candidates, limitations } = collect(normalizedScope);\n    const snapshotID = opaqueID("snapshot");\n    const map = new Map();\n    const envelope = sanitizePublic({\n      ok: true,\n      snapshotID,\n      // Public URL only — keep the raw href in activeSnapshot for stale checks.\n      url: redactURLForObservation(String(location.href)),\n      title: String(document.title || ""),\n      loading: document.readyState !== "complete",\n      viewport: viewportInfo(),\n      scroll: scrollInfo(),\n      elements: [],\n      limitations: [],\n      truncated: false,\n      ...(action ? { action } : {}),\n    }, variants);\n\n    for (const limitation of limitations) {\n      const publicLimitation = sanitizePublic(limitation, variants, "limitations");\n      envelope.limitations.push(publicLimitation);\n      if (serializedLength(envelope) > MAX_UTF16_UNITS) {\n        envelope.limitations.pop();\n        envelope.truncated = true;\n      }\n    }\n\n    for (const candidate of candidates) {\n      if (envelope.elements.length >= MAX_ELEMENTS) {\n        envelope.truncated = true;\n        continue;\n      }\n      const token = opaqueID("element");\n      const index = envelope.elements.length;\n      const publicElement = sanitizePublic({ index, token, ...candidate.public }, variants);\n      envelope.elements.push(publicElement);\n      if (serializedLength(envelope) > MAX_UTF16_UNITS) {\n        envelope.elements.pop();\n        envelope.truncated = true;\n        continue;\n      }\n      map.set(token, { ...candidate, index, token });\n    }\n\n    state.activeSnapshot = { id: snapshotID, url: String(location.href), map };\n    clearPendingFrameClick();\n    return enforceEnvelopeBudget(envelope, variants);\n  }\n\n  function failure(error, code, requiresObservation = false, extra = {}, secretValues = []) {\n    if (!retainRedactions(secretValues)) return redactionCapacityFailure();\n    return enforceEnvelopeBudget(\n      { ok: false, error, code, requiresObservation, ...extra },\n      activeRedactionVariants(),\n    );\n  }\n\n  function stale(error) {\n    invalidateSnapshot();\n    return failure(error, "stale_browser_snapshot", true);\n  }\n\n  function validateEntry(entry) {\n    const snapshot = state.activeSnapshot;\n    if (!snapshot) return stale("The document changed; observe again.");\n    if (snapshot.url !== String(location.href)) return stale("The document URL changed; observe again.");\n    const element = entry.element;\n    if (!element.isConnected\n      || element.ownerDocument !== entry.ownerDocument\n      || element.getRootNode() !== entry.rootNode\n      || owningFrameElement(element.ownerDocument) !== entry.owningFrameElement) {\n      return stale("The requested element moved to a different document or composed root.");\n    }\n    if (isHiddenComposed(element) || isDisabled(element) || !hasVisibleBox(element)) {\n      return stale("The requested element is now hidden or disabled.");\n    }\n    const currentRole = role(element);\n    const currentName = accessibleName(element);\n    if (fingerprint(element, entry.frame, currentRole, currentName) !== entry.fingerprint) {\n      return stale("The requested element changed; observe again.");\n    }\n    return null;\n  }\n\n  function resolveTarget(params) {\n    const snapshot = state.activeSnapshot;\n    if (!snapshot || typeof params.snapshot_id !== "string" || params.snapshot_id !== snapshot.id) {\n      return { error: stale("The browser snapshot is stale; observe again.") };\n    }\n    const hasIndex = Number.isInteger(params.element_index);\n    const hasToken = typeof params.element_token === "string" && params.element_token.length > 0;\n    if (hasIndex === hasToken) {\n      return { error: failure("Provide exactly one of element_index or element_token.", "invalid_browser_target") };\n    }\n    let entry = null;\n    if (hasToken) entry = snapshot.map.get(params.element_token) || null;\n    else entry = Array.from(snapshot.map.values()).find((candidate) => candidate.index === params.element_index) || null;\n    if (!entry) return { error: stale("The requested element is no longer in the active snapshot.") };\n    const validationError = validateEntry(entry);\n    if (validationError) return { error: validationError };\n    return { entry };\n  }\n\n  function nativeValueSetter(element, value) {\n    const prototype = element.localName === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;\n    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;\n    if (!setter) throw new Error("native value setter unavailable");\n    setter.call(element, value);\n  }\n\n  function dispatchBeforeInput(element, text) {\n    return element.dispatchEvent(new InputEvent("beforeinput", {\n      bubbles: true,\n      cancelable: true,\n      composed: true,\n      data: text,\n      inputType: "insertText",\n    }));\n  }\n\n  function dispatchInputEvents(element, text) {\n    element.dispatchEvent(new InputEvent("input", {\n      bubbles: true,\n      composed: true,\n      data: text,\n      inputType: "insertText",\n    }));\n    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));\n  }\n\n  function composedParentElement(element) {\n    if (element.parentElement) return element.parentElement;\n    const root = element.getRootNode?.();\n    return root && root.host instanceof Element ? root.host : null;\n  }\n\n  function isScrollableOnAxis(element, vertical) {\n    const view = element.ownerDocument?.defaultView || globalThis;\n    const style = view.getComputedStyle(element);\n    const overflow = vertical ? style.overflowY : style.overflowX;\n    if (!/(auto|scroll|overlay)/.test(overflow)) return false;\n    return vertical\n      ? element.scrollHeight > element.clientHeight\n      : element.scrollWidth > element.clientWidth;\n  }\n\n  function resolveScrollTarget(element, vertical) {\n    if (!element) {\n      return { target: document.scrollingElement || document.documentElement, kind: "page" };\n    }\n    if (isScrollableOnAxis(element, vertical)) return { target: element, kind: "element" };\n    let ancestor = composedParentElement(element);\n    while (ancestor) {\n      if (isScrollableOnAxis(ancestor, vertical)) return { target: ancestor, kind: "ancestor" };\n      ancestor = composedParentElement(ancestor);\n    }\n    const ownerDocument = element.ownerDocument || document;\n    return { target: ownerDocument.scrollingElement || ownerDocument.documentElement, kind: "page" };\n  }\n\n  function composedContains(ancestor, descendant) {\n    if (ancestor === descendant || ancestor.contains?.(descendant)) return true;\n    let current = descendant;\n    while (current) {\n      current = composedParentElement(current);\n      if (current === ancestor) return true;\n    }\n    return false;\n  }\n\n  function clickHitTarget(element) {\n    const rect = element.getBoundingClientRect();\n    if (!(rect.width > 0 && rect.height > 0)) return null;\n    const ownerDocument = element.ownerDocument || document;\n    const view = ownerDocument.defaultView || globalThis;\n    const x = rect.left + rect.width / 2;\n    const y = rect.top + rect.height / 2;\n    if (x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight) return null;\n    const hit = ownerDocument.elementFromPoint(x, y);\n    if (!hit) return null;\n    if (composedContains(element, hit) || composedContains(hit, element)) return null;\n    return hit;\n  }\n\n  function actionObservation(scope, action, secretValues = []) {\n    return observe(scope, action, secretValues);\n  }\n\n  function sensitiveHandoff(scope, secretValues) {\n    if (!retainRedactions(secretValues) || !retainCurrentSensitiveValues()) {\n      return redactionCapacityFailure();\n    }\n    invalidateSnapshot();\n    const observation = observe(scope, { kind: "focus", userHandoffRequired: true }, secretValues);\n    return failure(\n      "This sensitive field requires user input.",\n      "user_handoff_required",\n      false,\n      { requiresUserInput: true, observation },\n      secretValues,\n    );\n  }\n\n  function queryVisibleSelector(selector) {\n    if (typeof selector !== "string" || !selector.trim()) return null;\n    let matched = null;\n    try {\n      matched = document.querySelector(selector);\n    } catch (_) {\n      return { error: failure("Invalid CSS selector.", "invalid_browser_wait") };\n    }\n    if (!matched) return { element: null };\n    if (isHiddenComposed(matched) || !hasVisibleBox(matched)) return { element: null };\n    return { element: matched };\n  }\n\n  function hasUnresolvedDocumentResources() {\n    try {\n      const images = document.images;\n      for (let i = 0; i < images.length; i += 1) {\n        if (!images[i].complete) return true;\n      }\n    } catch (_) {}\n    return false;\n  }\n\n  function networkIdleStatus(quietMs) {\n    const quiet = Math.min(5000, Math.max(50, Number(quietMs) || 500));\n    const now = performance.now();\n    let lastEnd = 0;\n    let inflight = false;\n    try {\n      const navigationEntries = performance.getEntriesByType("navigation") || [];\n      for (const entry of navigationEntries) {\n        const end = entry.loadEventEnd || entry.domComplete || entry.responseEnd || 0;\n        if (end > lastEnd) lastEnd = end;\n      }\n      const resources = performance.getEntriesByType("resource") || [];\n      for (const entry of resources) {\n        // Incomplete resource timings keep responseEnd at 0 in WebKit while in flight.\n        if (!(entry.responseEnd > 0)) {\n          inflight = true;\n          continue;\n        }\n        if (entry.responseEnd > lastEnd) lastEnd = entry.responseEnd;\n      }\n    } catch (_) {}\n    // Performance entries alone miss in-flight images on some WebKit builds; DOM complete flags cover that gap without page-world fetch/XHR patches.\n    if (hasUnresolvedDocumentResources()) inflight = true;\n    const readyState = String(document.readyState || "");\n    if (readyState !== "complete") {\n      return {\n        ready: false,\n        reason: "document_loading",\n        readyState,\n        lastActivityAgeMs: lastEnd > 0 ? Math.max(0, now - lastEnd) : 0,\n        quietMs: quiet,\n      };\n    }\n    if (inflight) {\n      return {\n        ready: false,\n        reason: "resource_inflight",\n        readyState,\n        lastActivityAgeMs: 0,\n        quietMs: quiet,\n      };\n    }\n    if (!(lastEnd > 0)) {\n      return {\n        ready: true,\n        reason: "idle",\n        readyState,\n        lastActivityAgeMs: quiet,\n        quietMs: quiet,\n      };\n    }\n    const age = Math.max(0, now - lastEnd);\n    return {\n      ready: age >= quiet,\n      reason: age >= quiet ? "idle" : "quiet_window",\n      readyState,\n      lastActivityAgeMs: age,\n      quietMs: quiet,\n    };\n  }\n\n  function waitCheck(params, scope) {\n    const mode = String(params?.mode || "");\n    if (mode === "idle") {\n      const status = networkIdleStatus(params.idle_ms);\n      return enforceEnvelopeBudget({\n        ok: true,\n        ready: status.ready === true,\n        mode: "idle",\n        ...status,\n      }, activeRedactionVariants());\n    }\n\n    if (mode !== "selector") {\n      return failure("wait requires mode \'selector\' or \'idle\'.", "invalid_browser_wait");\n    }\n\n    const hasSelector = typeof params.selector === "string" && params.selector.trim().length > 0;\n    const hasIndex = Number.isInteger(params.element_index);\n    const hasToken = typeof params.element_token === "string" && params.element_token.length > 0;\n    if (hasSelector && (hasIndex || hasToken || typeof params.snapshot_id === "string")) {\n      return failure("wait selector mode accepts selector or a snapshot element target, not both.", "invalid_browser_wait");\n    }\n    if (hasSelector) {\n      const matched = queryVisibleSelector(params.selector);\n      if (matched.error) return matched.error;\n      return enforceEnvelopeBudget({\n        ok: true,\n        ready: Boolean(matched.element),\n        mode: "selector",\n        selector: truncateUTF16(params.selector, 512),\n      }, activeRedactionVariants());\n    }\n    if (!hasIndex && !hasToken) {\n      return failure("wait selector mode requires selector or a snapshot element target.", "invalid_browser_wait");\n    }\n    const resolved = resolveTarget(params);\n    if (resolved.error) {\n      // Stale/missing targets are "not ready yet" while the document may still be updating.\n      // Hard validation errors (invalid_browser_target) stay terminal.\n      const code = resolved.error.code;\n      if (code === "invalid_browser_target" || code === "invalid_browser_wait") return resolved.error;\n      return enforceEnvelopeBudget({\n        ok: true,\n        ready: false,\n        mode: "selector",\n        pendingReason: code || "target_not_ready",\n      }, activeRedactionVariants());\n    }\n    return enforceEnvelopeBudget({\n      ok: true,\n      ready: true,\n      mode: "selector",\n      scope,\n    }, activeRedactionVariants());\n  }\n\n  function dispatch(params) {\n    const action = String(params?.action || "");\n    const scope = params?.scope === "page" ? "page" : "viewport";\n    if (action === "observe") return observe(scope, params.action_metadata || null, []);\n    if (action === "wait_check") return waitCheck(params, scope);\n    if (action === "clear") {\n      invalidateSnapshot();\n      clearPendingFrameClick();\n      state.redactionValues = [];\n      state.redactionTotalUnits = 0;\n      state.redactionOverflow = false;\n      clearHighlight();\n      return { ok: true };\n    }\n    if (action === "invalidate") {\n      invalidateSnapshot();\n      clearPendingFrameClick();\n      clearHighlight();\n      return { ok: true };\n    }\n    if (action === "finalize_click") {\n      const pending = state.pendingFrameClick;\n      if (pending) {\n        if (pending.activationCancelled) {\n          clearPendingFrameClick();\n          return actionObservation(scope, params.action_metadata || { kind: "click" });\n        }\n        if (pending.errorObserved) {\n          clearPendingFrameClick();\n          return failure(\n            "The iframe navigation failed; use screenshot or Computer Use if the destination is unavailable.",\n            "browser_iframe_navigation_failed",\n            true,\n            { limitations: ["iframe_navigation_failed; use screenshot or Computer Use"] },\n          );\n        }\n        let currentDocument = null;\n        try {\n          currentDocument = pending.frameElement?.contentDocument || null;\n        } catch (_) {}\n        if (!currentDocument) {\n          if (pending.loadObserved || pending.errorObserved) {\n            clearPendingFrameClick();\n            return failure(\n              "The iframe destination is cross-origin or unavailable; use screenshot or Computer Use.",\n              "browser_iframe_content_unavailable",\n              true,\n              { limitations: ["cross_origin_iframe_after_navigation; use screenshot or Computer Use"] },\n            );\n          }\n          return enforceEnvelopeBudget({ ok: true, pendingFrameNavigation: true }, activeRedactionVariants());\n        }\n        if (pending.navigationBearing) {\n          const documentChanged = currentDocument !== pending.sourceDocument\n            || String(currentDocument.URL || "") !== pending.sourceURL;\n          const sameDocumentURLChanged = currentDocument === pending.sourceDocument\n            && String(currentDocument.URL || "") !== pending.sourceURL;\n          const usable = currentDocument.readyState === "complete"\n            && (pending.loadObserved || sameDocumentURLChanged);\n          if (pending.loadObserved && !documentChanged) {\n            clearPendingFrameClick();\n            return failure(\n              "The iframe navigation did not replace the source document.",\n              "browser_iframe_navigation_failed",\n              true,\n              { limitations: ["iframe_navigation_failed; use screenshot or Computer Use"] },\n            );\n          }\n          if (!documentChanged || !usable) {\n            return enforceEnvelopeBudget({ ok: true, pendingFrameNavigation: true }, activeRedactionVariants());\n          }\n        }\n      }\n      clearPendingFrameClick();\n      return actionObservation(scope, params.action_metadata || { kind: "click" });\n    }\n\n    const targeted = ["click", "input", "select"].includes(action)\n      || (action === "scroll" && (Number.isInteger(params.element_index) || typeof params.element_token === "string"));\n    const resolved = targeted ? resolveTarget(params) : null;\n    if (resolved?.error) return resolved.error;\n    const entry = resolved?.entry || null;\n    const element = entry?.element || null;\n\n    try {\n      if (action === "click") {\n        if (clickHitTarget(element)) {\n          invalidateSnapshot();\n          return failure(\n            "The target is obscured at its center; observe again before retrying.",\n            "browser_target_obscured",\n            true,\n            { retryable: true },\n          );\n        }\n        const preFocusSensitive = isSensitive(element);\n        const preFocusValue = controlValue(element);\n        highlight(element);\n        element.focus({ preventScroll: true });\n        const postFocusSensitive = isSensitive(element);\n        const postFocusValue = (preFocusSensitive || postFocusSensitive) ? controlValue(element) : "";\n        if (preFocusSensitive || postFocusSensitive) {\n          return sensitiveHandoff(scope, [preFocusValue, postFocusValue]);\n        }\n        const postFocusError = validateEntry(entry);\n        if (postFocusError) return postFocusError;\n        const frameElement = entry.owningFrameElement;\n        let pending = null;\n        let clickEvent = null;\n        let submitEvent = null;\n        let invalidObserved = false;\n        const ownerDocument = entry.ownerDocument;\n        const submitForm = element.form || null;\n        const [formAction] = submitSemantics(element);\n        const href = resolvedHref(element);\n        const initiallyNavigationBearing = Boolean((href && !href.toLowerCase().startsWith("javascript:")) || formAction);\n        const captureClick = (event) => {\n          const path = typeof event.composedPath === "function" ? event.composedPath() : [];\n          if (event.target === element || path.includes(element)) clickEvent = event;\n        };\n        const captureSubmit = (event) => {\n          if (submitForm && event.target === submitForm\n            && (!event.submitter || event.submitter === element)) submitEvent = event;\n        };\n        const captureInvalid = (event) => {\n          if (submitForm && event.target?.form === submitForm) invalidObserved = true;\n        };\n        ownerDocument.addEventListener("click", captureClick, true);\n        if (submitForm) ownerDocument.addEventListener("submit", captureSubmit, true);\n        if (submitForm) ownerDocument.addEventListener("invalid", captureInvalid, true);\n        if (frameElement) {\n          pending = {\n            frameElement,\n            sourceDocument: entry.ownerDocument,\n            sourceURL: String(entry.ownerDocument.URL || ""),\n            navigationBearing: initiallyNavigationBearing,\n            activationCancelled: false,\n            loadObserved: false,\n            errorObserved: false,\n          };\n          pending.onLoad = () => { pending.loadObserved = true; };\n          pending.onError = () => { pending.errorObserved = true; };\n          frameElement.addEventListener("load", pending.onLoad);\n          frameElement.addEventListener("error", pending.onError);\n          state.pendingFrameClick = pending;\n        } else {\n          clearPendingFrameClick();\n        }\n        invalidateSnapshot();\n        try {\n          element.click();\n        } finally {\n          ownerDocument.removeEventListener("click", captureClick, true);\n          if (submitForm) {\n            ownerDocument.removeEventListener("submit", captureSubmit, true);\n            ownerDocument.removeEventListener("invalid", captureInvalid, true);\n          }\n        }\n        const constraintBlocked = Boolean(\n          submitForm\n          && !submitForm.noValidate\n          && !element.formNoValidate\n          && (invalidObserved || (!submitEvent && submitForm.matches(":invalid"))),\n        );\n        const activationCancelled = Boolean(\n          clickEvent?.defaultPrevented\n          || submitEvent?.defaultPrevented\n          || constraintBlocked,\n        );\n        if (pending) {\n          pending.activationCancelled = activationCancelled;\n          pending.navigationBearing = initiallyNavigationBearing && !activationCancelled;\n        }\n        return enforceEnvelopeBudget({\n          ok: true,\n          deferObservation: true,\n          targetFrame: entry.frame,\n          navigationBearing: state.pendingFrameClick?.navigationBearing === true,\n          action: { kind: "click" },\n        }, activeRedactionVariants());\n      }\n\n      if (action === "input") {\n        if (typeof params.text !== "string") return failure("input requires text.", "invalid_browser_input");\n        if (!retainRedactions([params.text])) return redactionCapacityFailure();\n        const preFocusSensitive = isSensitive(element);\n        const preFocusValue = controlValue(element);\n        highlight(element);\n        element.focus({ preventScroll: true });\n        const postFocusSensitive = isSensitive(element);\n        const postFocusValue = (preFocusSensitive || postFocusSensitive) ? controlValue(element) : "";\n        const secretValues = [params.text, preFocusValue, postFocusValue];\n        if (preFocusSensitive || postFocusSensitive) {\n          return sensitiveHandoff(scope, secretValues);\n        }\n        if (!retainCurrentSensitiveValues()) return redactionCapacityFailure();\n        const postFocusError = validateEntry(entry);\n        if (postFocusError) return postFocusError;\n        if (!dispatchBeforeInput(element, params.text)) {\n          invalidateSnapshot();\n          return failure("The page cancelled text input; observe again.", "browser_input_cancelled", true, {}, secretValues);\n        }\n        if (isSensitive(element)) {\n          return sensitiveHandoff(scope, [...secretValues, controlValue(element)]);\n        }\n        const postBeforeInputError = validateEntry(entry);\n        if (postBeforeInputError) return postBeforeInputError;\n        if (element.localName === "input" || element.localName === "textarea") {\n          nativeValueSetter(element, params.text);\n        } else if (element.isContentEditable) {\n          element.textContent = params.text;\n        } else {\n          return failure("The target does not accept text input.", "unsupported_browser_action");\n        }\n        dispatchInputEvents(element, params.text);\n        invalidateSnapshot();\n        return actionObservation(scope, { kind: "input", characterCount: params.text.length }, [params.text]);\n      }\n\n      if (action === "select") {\n        if (element.localName !== "select") return failure("The target is not a select control.", "unsupported_browser_action");\n        if (typeof params.option !== "string") return failure("select requires option.", "invalid_browser_input");\n        const preFocusSensitive = isSensitive(element);\n        const preFocusValue = controlValue(element);\n        highlight(element);\n        element.focus({ preventScroll: true });\n        const postFocusSensitive = isSensitive(element);\n        const postFocusValue = (preFocusSensitive || postFocusSensitive) ? controlValue(element) : "";\n        if (preFocusSensitive || postFocusSensitive) {\n          return sensitiveHandoff(scope, [params.option, preFocusValue, postFocusValue]);\n        }\n        const postFocusError = validateEntry(entry);\n        if (postFocusError) return postFocusError;\n        const option = Array.from(element.options).find((candidate) => candidate.label === params.option || candidate.value === params.option);\n        if (!option) return stale("The requested option changed; observe again.");\n        element.value = option.value;\n        option.selected = true;\n        element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));\n        element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));\n        invalidateSnapshot();\n        return actionObservation(scope, { kind: "select", selected: truncateUTF16(option.label || option.value, STRING_LIMITS.selected) });\n      }\n\n      if (action === "scroll") {\n        const direction = ["up", "down", "left", "right"].includes(params.direction) ? params.direction : "down";\n        const amount = Math.min(10, Math.max(0.1, Number(params.amount) || 0.8));\n        if (element) highlight(element);\n        const vertical = direction === "up" || direction === "down";\n        const { target, kind: targetKind } = resolveScrollTarget(element, vertical);\n        const sign = direction === "up" || direction === "left" ? -1 : 1;\n        const ownerView = target.ownerDocument?.defaultView || globalThis;\n        const width = target === target.ownerDocument?.scrollingElement ? ownerView.innerWidth : target.clientWidth;\n        const height = target === target.ownerDocument?.scrollingElement ? ownerView.innerHeight : target.clientHeight;\n        target.scrollBy({ left: vertical ? 0 : sign * width * amount, top: vertical ? sign * height * amount : 0, behavior: "auto" });\n        invalidateSnapshot();\n        return actionObservation(scope, { kind: "scroll", direction, amount, target: targetKind });\n      }\n    } catch (_) {\n      invalidateSnapshot();\n      clearPendingFrameClick();\n      return failure("The browser action could not be completed; observe again.", "browser_action_failed", true);\n    }\n\n    return failure(`Unsupported structured browser action: ${truncateUTF16(action, 128)}`, "unsupported_browser_action");\n  }\n\n  Object.defineProperty(globalThis, API_NAME, {\n    value: Object.freeze({ dispatch }),\n    configurable: false,\n    enumerable: false,\n    writable: false,\n  });\n})();\n';
function routeBrowserView(view, visible, mainHost, hiddenHost) {
  mainHost.contentView.removeChildView(view);
  hiddenHost.contentView.removeChildView(view);
  if (visible) {
    hiddenHost.hide?.();
    mainHost.contentView.addChildView(view);
  } else {
    hiddenHost.contentView.addChildView(view);
    hiddenHost.showInactive?.();
  }
}
const hiddenBounds = { x: 0, y: 0, width: 0, height: 0, visible: false };
const toolHiddenBounds = { x: 0, y: 0, width: 1280, height: 800, visible: false };
const defaultPartition = "persist:pipiui-browser";
function normalizeBrowserURL(value) {
  const input = value.trim();
  if (!input) return "";
  if (/^(about:|file:|https?:\/\/)/i.test(input)) return input;
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input)) return `http://${input}`;
  if (/\s/.test(input) || !input.includes(".")) return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  return `https://${input}`;
}
function canonicalBrowserURL(value) {
  const normalized = normalizeBrowserURL(value);
  if (!normalized) return "";
  try {
    return new URL(normalized).href;
  } catch {
    return normalized;
  }
}
function isAbortedNavigation(error) {
  if (!error || typeof error !== "object") return false;
  const candidate = error;
  return candidate.code === "ERR_ABORTED" || candidate.code === -3 || candidate.errno === -3 || candidate.errorCode === -3 || typeof candidate.message === "string" && /\bERR_ABORTED\b/.test(candidate.message);
}
function tabTitle(url) {
  if (!url || url === "about:blank") return "新标签页";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
function copyTab(tab) {
  const { history: _history, historyIndex: _historyIndex, ...publicTab } = tab;
  return { ...publicTab };
}
function copyTabs(tabs, activeTabId) {
  return { tabs: tabs.map(copyTab), activeTabId };
}
class BrowserTabsHost {
  constructor(createView, partition = defaultPartition) {
    this.createView = createView;
    this.partition = partition;
    this.createTab();
  }
  tabs = [];
  listeners = /* @__PURE__ */ new Set();
  revealWaiters = /* @__PURE__ */ new Set();
  view;
  attach;
  attachedVisible;
  activeTabId;
  shownTabId;
  pending;
  toolRevealPending = false;
  toolNavigationPending = false;
  bounds = hiddenBounds;
  sequence = 0;
  /** A later BrowserWindow can become the sole owner after the prior one closes. */
  attachToWindow(attach) {
    this.view?.setVisible?.(false);
    this.view = void 0;
    this.shownTabId = void 0;
    this.attach = attach;
    this.attachedVisible = void 0;
  }
  detachWindow() {
    this.view?.setVisible?.(false);
    this.view = void 0;
    this.shownTabId = void 0;
    this.attach = void 0;
    this.attachedVisible = void 0;
  }
  async listTabs() {
    return this.state();
  }
  async getActiveTab() {
    return this.active ? copyTab(this.active) : void 0;
  }
  async newTab(options = {}) {
    const tab = this.createTab(options);
    this.activeTabId = tab.id;
    this.emit();
    await this.show(tab, "restore");
    return copyTab(tab);
  }
  async switchTab(tabId) {
    const tab = this.requireTab(tabId);
    this.activeTabId = tab.id;
    this.emit();
    await this.show(tab, "restore");
    return copyTab(tab);
  }
  async closeTab(tabId) {
    const index = this.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) throw new Error(`unknown browser tab: ${tabId}`);
    const wasActive = this.activeTabId === tabId;
    this.tabs.splice(index, 1);
    if (this.tabs.length === 0) {
      const fresh = this.createTab();
      this.activeTabId = fresh.id;
    } else if (wasActive) {
      this.activeTabId = this.tabs[Math.min(index, this.tabs.length - 1)].id;
    }
    if (wasActive) this.view?.webContents.stop?.();
    this.emit();
    if (this.active) await this.show(this.active, "restore");
    return this.state();
  }
  async loadURL(url, tabId) {
    const target = normalizeBrowserURL(url);
    if (!target) throw new Error("请输入网址或搜索内容。");
    const tab = this.activate(tabId);
    this.pushHistory(tab, target);
    tab.title = tabTitle(target);
    this.emit();
    await this.show(tab, "push");
    return copyTab(tab);
  }
  async goBack(tabId) {
    const tab = this.activate(tabId);
    if (tab.historyIndex <= 0) return copyTab(tab);
    tab.historyIndex -= 1;
    tab.url = tab.history[tab.historyIndex];
    tab.title = tabTitle(tab.url);
    this.emit();
    await this.show(tab, "history");
    return copyTab(tab);
  }
  async goForward(tabId) {
    const tab = this.activate(tabId);
    if (tab.historyIndex >= tab.history.length - 1) return copyTab(tab);
    tab.historyIndex += 1;
    tab.url = tab.history[tab.historyIndex];
    tab.title = tabTitle(tab.url);
    this.emit();
    await this.show(tab, "history");
    return copyTab(tab);
  }
  async reload(tabId) {
    const tab = this.activate(tabId);
    if (!this.isVisible() || !this.view) return copyTab(tab);
    tab.isLoading = true;
    this.pending = { tabId: tab.id, kind: "reload", url: tab.url || "about:blank" };
    this.emit();
    this.view.webContents.reload();
    return copyTab(tab);
  }
  async snapshot(tabId) {
    const tab = this.tabFor(tabId);
    const snapshot2 = { tabId: tab.id, url: tab.url, title: tab.title, isLoading: tab.isLoading };
    const evaluate = this.view?.webContents.executeJavaScript;
    if (tab.id !== this.activeTabId || tab.id !== this.shownTabId || !evaluate) return snapshot2;
    try {
      const text2 = await evaluate.call(this.view.webContents, 'document.body?.innerText ?? ""');
      if (typeof text2 === "string") snapshot2.text = text2;
    } catch {
    }
    return snapshot2;
  }
  async toolAction(request) {
    try {
      await this.revealForTool();
      if (request.action === "navigate") {
        if (!request.url) return { ok: false, error: "browser navigate requires url" };
        try {
          await this.loadURLForTool(request.url);
        } catch (error) {
          const currentURL = this.view?.webContents.getURL?.() ?? "";
          if (!isAbortedNavigation(error) || canonicalBrowserURL(currentURL) !== canonicalBrowserURL(request.url)) throw error;
        }
        return this.domAction({ action: "observe", scope: request.scope ?? "viewport" });
      }
      if (request.action === "back") {
        await this.goBack();
        if (this.active) await this.show(this.active, "history", true);
        return this.domAction({ action: "observe", scope: request.scope ?? "viewport" });
      }
      if (request.action === "forward") {
        await this.goForward();
        if (this.active) await this.show(this.active, "history", true);
        return this.domAction({ action: "observe", scope: request.scope ?? "viewport" });
      }
      if (request.action === "reload") {
        if (this.active) await this.show(this.active, "reload", true);
        return this.domAction({ action: "observe", scope: request.scope ?? "viewport" });
      }
      if (request.action === "screenshot") {
        await this.ensureToolPage();
        const image = await this.view?.webContents.capturePage?.();
        if (!image) return { ok: false, error: "browser screenshot is unavailable" };
        const bytes = Buffer.from(image.toPNG());
        if (bytes.length === 0) return { ok: false, error: "browser screenshot is empty" };
        return { ok: true, base64: bytes.toString("base64"), mimeType: "image/png" };
      }
      if (request.action === "type") {
        if (request.selector) return this.selectorAction({ ...request, action: "input", mode: "append" });
        return this.domAction({ ...request, action: "input", text: request.text ?? "" });
      }
      if (request.selector && (request.action === "click" || request.action === "input")) {
        return this.selectorAction(request);
      }
      if (["observe", "click", "input", "select", "scroll", "content", "eval"].includes(request.action)) return this.domAction(request);
      return { ok: false, error: `unknown browser action: ${request.action}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async domAction(request) {
    await this.ensureToolPage();
    const execute = this.view?.webContents.executeJavaScript;
    if (!execute || !this.active || this.shownTabId !== this.active.id) return { ok: false, error: "browser page is unavailable" };
    const source = `if(!globalThis.__pipiBrowserDOM){${browserDOMControllerSource}}
;globalThis.__pipiBrowserDOM.dispatch(${JSON.stringify(request)})`;
    const result = await execute.call(this.view.webContents, source);
    return result && typeof result === "object" ? result : { ok: false, error: "browser action returned no result" };
  }
  async ensureToolPage() {
    const tab = this.active ?? this.createTab();
    if (!this.view || this.shownTabId !== tab.id) await this.show(tab, "restore", true);
  }
  async loadURLForTool(url) {
    const target = normalizeBrowserURL(url);
    if (!target) throw new Error("请输入网址或搜索内容。");
    this.toolNavigationPending = true;
    try {
      const tab = this.activate();
      this.pushHistory(tab, target);
      tab.title = tabTitle(target);
      this.emit();
      await this.show(tab, "push", true);
    } finally {
      this.toolNavigationPending = false;
    }
  }
  async selectorAction(request) {
    const execute = this.view?.webContents.executeJavaScript;
    if (!execute) return { ok: false, error: "browser page is unavailable" };
    const selector = JSON.stringify(request.selector);
    const text2 = JSON.stringify(request.text ?? "");
    const append = request.action === "input" && request.mode === "append";
    const code = `(()=>{const e=document.querySelector(${selector});if(!e)return {ok:false,error:'selector not found'};if(${JSON.stringify(request.action)}==='click'){e.click();return {ok:true}};const p=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;p?p.call(e,${append ? `String(e.value??'')+${text2}` : text2}):e.value=${text2};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true}})()`;
    const result = await execute.call(this.view.webContents, code);
    if (!result || typeof result !== "object" || !result.ok) return result;
    return this.domAction({ action: "observe", scope: request.scope ?? "viewport" });
  }
  async setViewBounds(bounds) {
    this.bounds = {
      x: Math.max(0, Math.round(Number.isFinite(bounds.x) ? bounds.x : 0)),
      y: Math.max(0, Math.round(Number.isFinite(bounds.y) ? bounds.y : 0)),
      width: Math.max(0, Math.round(Number.isFinite(bounds.width) ? bounds.width : 0)),
      height: Math.max(0, Math.round(Number.isFinite(bounds.height) ? bounds.height : 0)),
      visible: bounds.visible !== false
    };
    if (!this.isVisible()) {
      if (this.view) this.attachView(this.view, false);
      this.view?.setBounds(hiddenBounds);
      this.view?.setVisible?.(false);
      this.shownTabId = void 0;
      return;
    }
    const view = this.ensureView();
    this.attachView(view, true);
    view.setBounds(this.bounds);
    view.setVisible?.(true);
    this.revealWaiters.forEach((resolve) => resolve());
    this.revealWaiters.clear();
    const activeHasPage = Boolean(this.active && (this.active.history.length > 0 || this.active.url));
    if (!this.toolRevealPending && !this.toolNavigationPending && activeHasPage && this.active && this.shownTabId !== this.active.id) void this.show(this.active, "restore");
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  get active() {
    return this.activeTabId ? this.tabs.find((tab) => tab.id === this.activeTabId) : void 0;
  }
  state() {
    return copyTabs(this.tabs, this.activeTabId);
  }
  async revealForTool() {
    if (this.isVisible()) return;
    this.toolRevealPending = true;
    try {
      this.listeners.forEach((listener) => listener({ type: "reveal" }));
      if (this.isVisible()) return;
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          this.revealWaiters.delete(finish);
          resolve();
        };
        this.revealWaiters.add(finish);
        setTimeout(finish, 300);
      });
    } finally {
      this.toolRevealPending = false;
    }
  }
  createTab(options = {}) {
    const url = options.url ? normalizeBrowserURL(options.url) : "";
    const tab = {
      id: `browser-tab-${++this.sequence}`,
      title: tabTitle(url),
      url,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      // TODO(BrowserContext Spaces): this is metadata only until a space can own the single view.
      partition: options.partition,
      history: url ? [url] : [],
      historyIndex: url ? 0 : -1
    };
    this.tabs.push(tab);
    this.activeTabId ??= tab.id;
    return tab;
  }
  requireTab(tabId) {
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) throw new Error(`unknown browser tab: ${tabId}`);
    return tab;
  }
  tabFor(tabId) {
    return tabId ? this.requireTab(tabId) : this.active ?? this.createTab();
  }
  activate(tabId) {
    const tab = this.tabFor(tabId);
    this.activeTabId = tab.id;
    return tab;
  }
  pushHistory(tab, url) {
    if (tab.history[tab.historyIndex] === url) {
      tab.url = url;
    } else {
      tab.history.splice(tab.historyIndex + 1);
      tab.history.push(url);
      tab.historyIndex = tab.history.length - 1;
      tab.url = url;
    }
    this.syncNavigationButtons(tab);
  }
  syncNavigationButtons(tab) {
    tab.canGoBack = tab.historyIndex > 0;
    tab.canGoForward = tab.historyIndex >= 0 && tab.historyIndex < tab.history.length - 1;
  }
  isVisible() {
    return this.bounds.visible !== false && this.bounds.width > 0 && this.bounds.height > 0;
  }
  ensureView() {
    if (this.view) return this.view;
    if (!this.attach) throw new Error("browser window is unavailable");
    const view = this.createView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: this.partition } });
    this.view = view;
    view.setBounds(hiddenBounds);
    view.setVisible?.(false);
    view.webContents.on("did-start-loading", () => this.setLoading(true));
    view.webContents.on("did-stop-loading", () => this.setLoading(false));
    view.webContents.on("did-fail-load", () => this.setLoading(false));
    view.webContents.on("did-navigate", (_event, url) => this.didNavigate(url));
    view.webContents.on("did-navigate-in-page", (_event, url) => this.didNavigate(url));
    view.webContents.on("page-title-updated", (_event, title) => this.didUpdateTitle(title));
    return view;
  }
  attachView(view, visible) {
    if (this.attachedVisible === visible) return;
    this.attach?.(view, visible);
    this.attachedVisible = visible;
  }
  async show(tab, kind, allowHidden = false) {
    const visible = this.isVisible();
    if (!visible && !allowHidden) return;
    const view = this.ensureView();
    this.attachView(view, visible);
    view.setBounds(visible ? this.bounds : toolHiddenBounds);
    view.setVisible?.(true);
    this.shownTabId = tab.id;
    const url = (tab.history[tab.historyIndex] ?? tab.url) || "about:blank";
    this.pending = { tabId: tab.id, kind, url };
    tab.isLoading = true;
    this.emit();
    try {
      await Promise.resolve(view.webContents.loadURL(url));
    } catch (error) {
      if (this.pending?.tabId === tab.id) this.pending = void 0;
      tab.isLoading = false;
      this.emit();
      throw error;
    }
  }
  navigationTab() {
    return this.pending ? this.tabs.find((tab) => tab.id === this.pending.tabId) : this.active;
  }
  setLoading(isLoading) {
    const tab = this.navigationTab();
    if (!tab) return;
    tab.isLoading = isLoading;
    if (!isLoading) this.pending = void 0;
    this.emit();
  }
  didNavigate(url) {
    const tab = this.navigationTab();
    if (!tab) return;
    const pending = this.pending;
    if (pending?.kind === "push") {
      if (tab.historyIndex >= 0) tab.history[tab.historyIndex] = url;
      else this.pushHistory(tab, url);
    } else if (pending?.kind === "history") {
      tab.history[tab.historyIndex] = url;
    } else if (!pending || pending.kind === "reload") {
      this.pushHistory(tab, url);
    } else if (pending.kind === "restore" && tab.url) {
      tab.url = url;
      if (tab.historyIndex >= 0) tab.history[tab.historyIndex] = url;
    }
    if (url !== "about:blank" || tab.url) {
      tab.url = url;
      if (!tab.title || tab.title === "新标签页") tab.title = tabTitle(url);
    }
    this.syncNavigationButtons(tab);
    this.emit();
  }
  didUpdateTitle(title) {
    const tab = this.navigationTab();
    if (!tab || !title.trim()) return;
    tab.title = title.trim();
    this.emit();
  }
  emit() {
    const event = { type: "tabs", snapshot: this.state() };
    this.listeners.forEach((listener) => listener(event));
  }
}
function withBrowserTabsHost(backend, browser) {
  const listeners = /* @__PURE__ */ new Set();
  browser.subscribe((event) => {
    const frame = { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: "browser", event };
    listeners.forEach((listener) => listener(frame));
  });
  return {
    async handle(method, params) {
      switch (method) {
        case "browserListTabs":
          return browser.listTabs();
        case "browserGetActiveTab":
          return browser.getActiveTab();
        case "browserNewTab":
          return browser.newTab(params[0]);
        case "browserSwitchTab":
          return browser.switchTab(params[0]);
        case "browserCloseTab":
          return browser.closeTab(params[0]);
        case "browserLoadURL":
          return browser.loadURL(params[0], params[1]);
        case "browserGoBack":
          return browser.goBack(params[0]);
        case "browserGoForward":
          return browser.goForward(params[0]);
        case "browserReload":
          return browser.reload(params[0]);
        case "browserSnapshot":
          return browser.snapshot(params[0]);
        case "browserSetViewBounds":
          return browser.setViewBounds(params[0]);
        case "capabilities": {
          const current = await backend.handle(method, params);
          return { ...current && typeof current === "object" ? current : {}, browser: true };
        }
        default:
          return backend.handle(method, params);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      const unsubscribe = backend.subscribe(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    }
  };
}
const CUA_DRIVER_VERSION = "0.19.2";
function cuaSocketPath(temporaryDirectory = os.tmpdir(), pid = process.pid, nonce = crypto$1.randomUUID(), platform = process.platform) {
  const root = platform === "win32" ? temporaryDirectory : "/tmp";
  const compactNonce = nonce.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  return path.join(root, `pcua-${pid}-${compactNonce}.sock`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function buildActionCall(action, target) {
  const type = String(action.type ?? action.action ?? "");
  if (type === "wait" || type === "screenshot") return null;
  const coordinate = Array.isArray(action.coordinate) ? action.coordinate : [action.x, action.y];
  const point = Number.isFinite(Number(coordinate[0])) && Number.isFinite(Number(coordinate[1])) ? { x: Number(coordinate[0]), y: Number(coordinate[1]) } : {};
  const element = {
    ...typeof action.element_token === "string" ? { element_token: action.element_token } : {},
    ...Number.isInteger(action.element_index) ? { element_index: action.element_index } : {},
    ...typeof action.snapshot_id === "string" ? { snapshot_id: action.snapshot_id } : {}
  };
  const base = {
    session: target.session,
    pid: target.pid,
    window_id: target.window_id,
    ...element,
    ...action.delivery_mode ? { delivery_mode: action.delivery_mode } : {}
  };
  if ([
    "click",
    "left_click",
    "right_click",
    "middle_click",
    "double_click",
    "triple_click"
  ].includes(type))
    return {
      tool: "click",
      arguments: {
        ...base,
        ...point,
        button: type === "right_click" ? "right" : type === "middle_click" ? "middle" : "left",
        count: type === "double_click" ? 2 : type === "triple_click" ? 3 : 1
      }
    };
  if (type === "type")
    return {
      tool: "type_text",
      arguments: { ...base, ...point, text: action.text }
    };
  if (type === "key" || type === "keypress") {
    const keys = (Array.isArray(action.keys) ? action.keys : [action.key]).filter((key) => typeof key === "string" && key.length > 0);
    if (!keys.length) throw new Error(`${type} requires keys`);
    return keys.length === 1 ? { tool: "press_key", arguments: { ...base, key: keys[0] } } : { tool: "hotkey", arguments: { ...base, keys } };
  }
  if (type === "scroll")
    return {
      tool: "scroll",
      arguments: {
        ...base,
        ...point,
        direction: action.scroll_direction ?? action.direction ?? "down",
        amount: action.scroll_amount ?? action.amount ?? 3
      }
    };
  throw new Error(`unsupported computer action ${type}`);
}
class CuaDriverHost {
  constructor(driverPath, display, spawnDriver = node_child_process.spawn, timeoutMs = 32e3) {
    this.driverPath = driverPath;
    this.display = display;
    this.spawnDriver = spawnDriver;
    this.timeoutMs = timeoutMs;
  }
  daemon;
  proxy;
  lines;
  socket;
  nextID = 0;
  pending = /* @__PURE__ */ new Map();
  starting;
  targets = /* @__PURE__ */ new Map();
  sessions = /* @__PURE__ */ new Set();
  desktopSessions = /* @__PURE__ */ new Map();
  usable() {
    try {
      fs.accessSync(this.driverPath, fs.constants.X_OK);
      return process.platform === "darwin" || process.platform === "linux" || process.platform === "win32";
    } catch {
      return false;
    }
  }
  status() {
    return {
      usable: this.usable(),
      driverPath: this.driverPath,
      version: CUA_DRIVER_VERSION,
      display: this.display
    };
  }
  async handle(request) {
    if (request.protocolVersion !== 1)
      return this.failure(
        "unsupported_protocol_version",
        "Electron Computer Runtime requires protocolVersion 1",
        false
      );
    if (request.action === "computer_cancel") {
      this.cancel();
      return { ok: true, cancelled: true };
    }
    if (!this.usable())
      return this.failure(
        "driver_unavailable",
        `Cua Driver ${CUA_DRIVER_VERSION} is missing or not executable at ${this.driverPath}`,
        false
      );
    if (request.action === "computer_runtime_capabilities") {
      const permissions = await this.call("check_permissions", {});
      return {
        ok: true,
        protocol: { name: "pipiui-computer-runtime", version: 1 },
        operations: [
          "computer_runtime_capabilities",
          "computer_batch",
          "computer_open_application",
          "computer_cancel"
        ],
        actions: [
          "screenshot",
          "click",
          "left_click",
          "right_click",
          "double_click",
          "type",
          "key",
          "keypress",
          "scroll",
          "wait"
        ],
        features: {
          batchActions: true,
          inMemoryScreenshots: true,
          requestCancellation: true
        },
        display: {
          id: this.display.displayID,
          width: this.display.width,
          height: this.display.height
        },
        permissions: permissions.structuredContent ?? {}
      };
    }
    if (request.action === "computer_open_application") {
      const session = String(request.sessionKey ?? "");
      if (!session)
        return this.failure(
          "missing_session",
          "computer runtime requires a session key",
          false
        );
      await this.startSession(session);
      const launched = await this.call(
        "launch_app",
        request.bundle_identifier ? { bundle_id: request.bundle_identifier } : { name: request.application_name }
      );
      const structured = record(launched.structuredContent) ? launched.structuredContent : {};
      const pid = Number(structured.pid);
      const windows = Array.isArray(structured.windows) ? structured.windows.filter(record) : [];
      const windowID = Number(
        windows.find((window) => Number(window.pid) === pid)?.window_id ?? windows[0]?.window_id
      );
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(windowID) || windowID <= 0) {
        this.targets.delete(session);
        return this.failure(
          "target_unavailable",
          "Cua Driver launch_app did not return an exact pid and window_id",
          true
        );
      }
      const target = { pid, window_id: windowID, session };
      this.targets.set(session, target);
      await this.call("bring_to_front", {
        pid: target.pid,
        window_id: target.window_id
      });
      return {
        ok: true,
        ...structured,
        target,
        ...await this.observe(target)
      };
    }
    if (request.action === "computer_batch") {
      const actions = Array.isArray(request.actions) ? request.actions : [];
      const session = String(request.sessionKey ?? "");
      if (!session)
        return this.failure(
          "missing_session",
          "computer runtime requires a session key",
          false
        );
      const mutates = actions.some(
        (raw) => record(raw) && !["screenshot", "wait"].includes(
          String(raw.type ?? raw.action ?? "")
        )
      );
      const target = this.targets.get(session);
      if (mutates && !target)
        return this.failure(
          "target_unavailable",
          "Open an application before sending desktop input; no exact target is pinned for this session",
          false
        );
      if (target) await this.startSession(session, "window");
      for (const raw of actions)
        if (record(raw)) await this.perform(raw, target);
      return {
        ok: true,
        ...target ? await this.observe(target) : await this.observeDesktop(await this.startDesktopSession(session))
      };
    }
    return this.failure(
      "unsupported_action",
      `unsupported computer action ${String(request.action)}`,
      false
    );
  }
  cancel() {
    const error = new Error("computer request cancelled");
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
    this.lines?.close();
    this.lines = void 0;
    this.proxy?.kill("SIGTERM");
    this.daemon?.kill("SIGTERM");
    this.proxy = void 0;
    this.daemon = void 0;
    this.starting = void 0;
    this.targets.clear();
    this.sessions.clear();
    this.desktopSessions.clear();
  }
  failure(code, message, retryable) {
    return {
      ok: false,
      error: message,
      runtimeError: {
        code,
        message,
        retryable,
        requiresObservation: retryable
      }
    };
  }
  async ensureStarted() {
    if (this.proxy && this.daemon && !this.proxy.killed && !this.daemon.killed)
      return;
    if (this.starting) return this.starting;
    this.starting = this.start().catch((error) => {
      this.cancel();
      throw error;
    });
    return this.starting;
  }
  async start() {
    this.socket = cuaSocketPath();
    const daemon = this.spawnDriver(
      this.driverPath,
      [
        "serve",
        "--embedded",
        "--parent-liveness-stdio",
        "--no-permissions-gate",
        "--socket",
        this.socket,
        "--host-bundle-id",
        "com.leehow.pipiui-electron",
        "--permission-mode",
        "unrestricted",
        "--dangerously-bypass-approvals"
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    this.daemon = daemon;
    let stderr = "";
    daemon.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8192);
    });
    const deadline = Date.now() + 1e4;
    while (!fs.existsSync(this.socket)) {
      if (daemon.exitCode !== null)
        throw new Error(`Cua Driver daemon exited: ${stderr.trim()}`);
      if (Date.now() >= deadline)
        throw new Error(`Cua Driver startup timed out at ${this.socket}`);
      await sleep(25);
    }
    if (process.platform !== "win32") {
      const stat = fs.statSync(this.socket);
      if (!stat.isSocket())
        throw new Error("Cua Driver did not create a private socket");
    }
    const proxy = this.spawnDriver(
      this.driverPath,
      [
        "mcp",
        "--embedded",
        "--socket",
        this.socket,
        "--host-bundle-id",
        "com.leehow.pipiui-electron"
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    this.proxy = proxy;
    proxy.on(
      "exit",
      () => this.rejectPending(new Error("Cua Driver MCP proxy exited"))
    );
    this.lines = node_readline.createInterface({ input: proxy.stdout });
    this.lines.on("line", (line) => this.receive(line));
    const initialized = await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "PipiUI Electron", version: "0.1" }
    });
    if (!record(initialized?.result) || typeof initialized.result.protocolVersion !== "string")
      throw new Error("Cua Driver returned an invalid initialize response");
    proxy.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
    );
  }
  rejectPending(error) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }
  receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const id = Number(message?.id);
    const item = this.pending.get(id);
    if (!item) return;
    this.pending.delete(id);
    clearTimeout(item.timer);
    item.resolve(message);
  }
  async rpc(method, params) {
    if (!this.proxy?.stdin.writable)
      throw new Error("Cua Driver MCP proxy is unavailable");
    const id = ++this.nextID;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Cua Driver ${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.proxy.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
    );
    return response;
  }
  async call(name, args) {
    await this.ensureStarted();
    const response = await this.rpc("tools/call", { name, arguments: args });
    if (response.error)
      throw new Error(response.error.message ?? `Cua Driver ${name} failed`);
    const result = response.result ?? {};
    if (result.isError || result.is_error)
      throw new Error(
        result.content?.map((x) => x.text).filter(Boolean).join("\n") || `Cua Driver ${name} failed`
      );
    return result;
  }
  async startSession(session, captureScope = "window") {
    if (this.sessions.has(session)) return;
    await this.call("start_session", {
      session,
      capture_scope: captureScope
    });
    this.sessions.add(session);
  }
  async startDesktopSession(ownerSession) {
    const existing = this.desktopSessions.get(ownerSession);
    if (existing) return existing;
    const desktopSession = `pipiui-desktop-${crypto$1.randomUUID()}`;
    await this.startSession(desktopSession, "desktop");
    this.desktopSessions.set(ownerSession, desktopSession);
    return desktopSession;
  }
  async perform(action, target) {
    const type = String(action.type ?? action.action ?? "");
    if (type === "wait") {
      await sleep(
        Math.min(
          1e4,
          Number(action.duration_ms ?? Number(action.duration ?? 1) * 1e3)
        )
      );
      return;
    }
    if (type === "screenshot") return;
    if (!target) throw new Error("computer action requires an exact target");
    const call = buildActionCall(action, target);
    if (call) await this.call(call.tool, call.arguments);
  }
  async observe(target) {
    return this.imageResult(
      await this.call("get_window_state", {
        ...target,
        max_elements: 2e3,
        max_depth: 25
      })
    );
  }
  async observeDesktop(session) {
    return this.imageResult(await this.call("get_desktop_state", { session }));
  }
  imageResult(result) {
    const structured = record(result.structuredContent) ? result.structuredContent : {};
    const image = Array.isArray(result.content) ? result.content.find((item) => item?.type === "image") : void 0;
    const base64 = typeof image?.data === "string" && image.data.length > 0 ? image.data : typeof structured.screenshot_png_b64 === "string" && structured.screenshot_png_b64.length > 0 ? structured.screenshot_png_b64 : void 0;
    if (!base64) throw new Error("Cua Driver screenshot returned no image");
    const metadata = { ...structured };
    delete metadata.screenshot_png_b64;
    return {
      ...metadata,
      screenshotId: crypto$1.randomUUID(),
      base64,
      mimeType: image?.mimeType ?? image?.mime_type ?? structured.screenshot_mime_type ?? "image/png",
      accessibility: {
        elements: Array.isArray(structured.elements) ? structured.elements : [],
        elementCount: Array.isArray(structured.elements) ? structured.elements.length : 0
      }
    };
  }
}
const fileIfPresent = (path2) => fs.existsSync(path2) ? path2 : void 0;
function resolveRuntimeAssets(lookup) {
  const { env } = lookup;
  const driverName = process.platform === "win32" ? "cua-driver.exe" : "cua-driver";
  if (lookup.packaged) {
    const root = lookup.resourcesPath;
    const swiftDir2 = env.PIPIUI_SWIFT_EXTENSIONS_DIR ?? path.join(root, "swift-extensions");
    return {
      piExt: env.PIPIUI_PI_EXT_PATH ?? fileIfPresent(path.join(root, "pi-ext")),
      piPhilosophy: env.PIPIUI_PI_PHILOSOPHY_PATH ?? fileIfPresent(path.join(root, "pi-philosophy")),
      swiftExtensionsDir: fileIfPresent(swiftDir2),
      computerUse: env.PIPIUI_COMPUTER_EXTENSION_PATH ?? fileIfPresent(path.join(root, "pipiui-computer-use.ts")),
      webviewSwift: env.PIPIUI_BROWSER_EXTENSION_PATH ?? fileIfPresent(path.join(swiftDir2, "WebviewExtension.swift")),
      authHelper: env.PIPIUI_AUTH_HELPER_PATH ?? fileIfPresent(path.join(root, "pi-auth-helper.mjs")),
      cuaDriver: env.PIPIUI_CUA_DRIVER_PATH ?? path.join(root, "cua-driver", driverName)
    };
  }
  const repoRoot = path.resolve(lookup.dirname, "..", "..", "..", "..", "..");
  const sources = path.join(repoRoot, "Sources", "PipiUI");
  const swiftDir = env.PIPIUI_SWIFT_EXTENSIONS_DIR ?? sources;
  return {
    piExt: env.PIPIUI_PI_EXT_PATH ?? fileIfPresent(path.join(sources, "PiExt")),
    piPhilosophy: env.PIPIUI_PI_PHILOSOPHY_PATH ?? fileIfPresent(path.join(sources, "PiPhilosophy")),
    swiftExtensionsDir: fileIfPresent(swiftDir),
    computerUse: env.PIPIUI_COMPUTER_EXTENSION_PATH ?? fileIfPresent(path.join(repoRoot, "Electron", "resources", "pipiui-computer-use.ts")),
    webviewSwift: env.PIPIUI_BROWSER_EXTENSION_PATH ?? fileIfPresent(path.join(swiftDir, "WebviewExtension.swift")),
    authHelper: env.PIPIUI_AUTH_HELPER_PATH ?? fileIfPresent(path.join(repoRoot, "Electron", "resources", "pi-auth-helper.mjs")),
    cuaDriver: env.PIPIUI_CUA_DRIVER_PATH ?? path.join(repoRoot, "Electron", ".cua-driver", driverName)
  };
}
function registerPipiHostIpc(ipc, backend, channel = PIPI_HOST_IPC_CHANNEL) {
  const renderers = /* @__PURE__ */ new Set();
  backend.subscribe((frame) => {
    for (const renderer of renderers) renderer.send(channel, { type: "event", ...frame });
  });
  ipc.handle(channel, async (event, request) => {
    renderers.add(event.sender);
    if (request.protocolVersion !== PIPI_HOST_PROTOCOL_VERSION || request.type !== "request") {
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id ?? "", type: "response", ok: false, error: "unsupported protocol" };
    }
    try {
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: "response", ok: true, result: await backend.handle(request.method, request.params) };
    } catch (error) {
      return { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: request.id, type: "response", ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
function withMockTerminalOutput(backend) {
  const listeners = /* @__PURE__ */ new Set();
  const terminals = /* @__PURE__ */ new Map();
  const emit = (terminalId, data) => {
    const event = { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: "terminal", event: { type: "output", terminalId, data } };
    listeners.forEach((listener) => listener(event));
  };
  const terminal = (terminalId) => {
    const current = terminals.get(terminalId);
    if (!current) throw new Error(`unknown terminal: ${terminalId}`);
    return current;
  };
  return {
    async handle(method, params) {
      switch (method) {
        case "terminalOpen": {
          const options = params[0] ?? {};
          const id = `terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const cwd = options.cwd ?? process.cwd();
          terminals.set(id, { cwd, input: "" });
          return { id, title: "终端", cwd, initialOutput: `\x1B[1;36mpipiui_e mock terminal\x1B[0m\r
${cwd}\r
$ ` };
        }
        case "terminalWrite": {
          const [terminalId, raw] = params;
          const current = terminal(terminalId);
          for (const character of raw.replace(/\r\n/g, "\r")) {
            if (character === "\r" || character === "\n") {
              const command = current.input.trim();
              current.input = "";
              emit(terminalId, "\r\n");
              if (command) emit(terminalId, `mock: received ${command}\r
`);
              emit(terminalId, "$ ");
            } else if (character === "") {
              current.input = "";
              emit(terminalId, "^C\r\n$ ");
            } else if (character === "") {
              if (current.input) {
                current.input = current.input.slice(0, -1);
                emit(terminalId, "\b \b");
              }
            } else {
              current.input += character;
              emit(terminalId, character);
            }
          }
          return;
        }
        case "terminalClear":
          terminal(params[0]).input = "";
          return;
        case "terminalClose":
          terminals.delete(params[0]);
          return;
        default:
          return backend.handle(method, params);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      const unsubscribe = backend.subscribe(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    }
  };
}
function withOpenExternal(backend) {
  return {
    async handle(method, params) {
      if (method === "openExternal") {
        const url = params[0];
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("invalid URL");
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("only http/https URLs may be opened");
        await electron.shell.openExternal(parsed.toString());
        return;
      }
      return backend.handle(method, params);
    },
    subscribe: (listener) => backend.subscribe(listener)
  };
}
function createWindow(browser) {
  const window = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    // Like VS Code/Notion on macOS: no system title strip, only the traffic
    // lights remain. The renderer reserves a draggable strip via
    // env(titlebar-area-*). Keep the default framed titlebar elsewhere.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const hiddenBrowserHost = new electron.BaseWindow({
    show: false,
    x: -1e4,
    y: -1e4,
    width: 1280,
    height: 800,
    frame: false,
    focusable: false,
    skipTaskbar: true
  });
  browser.attachToWindow((rawView, visible) => {
    routeBrowserView(rawView, visible, window, hiddenBrowserHost);
  });
  window.on("closed", () => {
    browser.detachWindow();
    hiddenBrowserHost.destroy();
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
if (electron.app) {
  electron.app.whenReady().then(() => {
    const browser = new BrowserTabsHost((options) => new electron.WebContentsView(options));
    const primary = electron.screen.getPrimaryDisplay();
    const display = { displayID: primary.id, width: primary.size.width, height: primary.size.height };
    const assets = resolveRuntimeAssets({
      packaged: electron.app.isPackaged,
      resourcesPath: process.resourcesPath,
      dirname: __dirname,
      env: process.env
    });
    const computer = new CuaDriverHost(assets.cuaDriver, display);
    const runtimeRoot = process.env.PIPIUI_RUNTIME_ROOT ?? defaultRuntimeRoot();
    const install = installRuntimeTree(assets, runtimeRoot);
    if (install.installed.length)
      console.info(`[pipi-install] refreshed ${install.installed.length} runtime asset(s) under ${runtimeRoot}`);
    for (const failure of install.failures) console.warn(`[pipi-install] ${failure}`);
    void ensureManagedPackages(runtimeRoot).then((results) => {
      for (const result of results)
        if (result.state === "failed") console.warn(`[pipi-install] ${result.package}: ${result.detail}`);
        else if (result.state === "installed") console.info(`[pipi-install] installed ${result.package}`);
    });
    const piBackend = createPiHostBackend({
      browserAction: (request) => browser.toolAction(request),
      computerAction: (request) => computer.handle(request),
      computerDescriptor: display,
      computerUsable: () => computer.usable(),
      browserExtensionSourcePath: assets.webviewSwift,
      authHelperPath: assets.authHelper,
      runtimeRoot
    });
    registerPipiHostIpc(electron.ipcMain, withOpenExternal(withBrowserTabsHost(withMockTerminalOutput(piBackend), browser)));
    createWindow(browser);
    electron.app.on("activate", () => {
      if (electron.BrowserWindow.getAllWindows().length === 0) createWindow(browser);
    });
  });
  electron.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") electron.app.quit();
  });
}
exports.registerPipiHostIpc = registerPipiHostIpc;
