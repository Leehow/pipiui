#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const MODEL_REFRESH_TIMEOUT_MS = 5_000;
export function modelRuntimeOptions() {
  return { allowModelNetwork: true, modelRefreshTimeoutMs: MODEL_REFRESH_TIMEOUT_MS };
}
function moduleRoot() {
  let pi = process.env.PIPIUI_PI_PATH || "";
  if (!pi) try { pi = execFileSync("which", ["pi"], { encoding: "utf8" }).trim(); } catch {}
  const candidates = [pi && join(dirname(pi), "node_modules/@earendil-works/pi-coding-agent"), pi && join(dirname(pi), "../lib/node_modules/@earendil-works/pi-coding-agent"), join(process.env.HOME || "", ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent"), "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent", "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent"].filter(Boolean);
  for (const candidate of candidates) if (existsSync(join(candidate, "package.json"))) return candidate;
  throw new Error("Cannot find external @earendil-works/pi-coding-agent; install/update the pi CLI");
}
/**
 * Register every bundled extension that exports `createAuthProvider` from its
 * agent provider module. No per-extension host special case. Credential
 * persistence stays in pi's credential store under the current Pi home.
 */
async function registerBundledAuthProviders(rt, refreshExisting = false) {
  try {
    if (typeof rt.registerProvider !== "function") return;
    // Same home precedence as extension agent halves: PI_COC_AGENT_DIR >
    // PI_CODING_AGENT_DIR; never a global ~/.pi/agent fallback (fail closed —
    // registration is skipped when no home is resolved). The spawner pins
    // PI_CODING_AGENT_DIR to the backend's auth home, so a miss here means the
    // helper was launched outside the host: say so, don't vanish.
    const agentDir = process.env.PI_COC_AGENT_DIR?.trim() || process.env.PI_CODING_AGENT_DIR?.trim();
    if (!agentDir) {
      console.warn("[pi-auth-helper] no PI_COC_AGENT_DIR/PI_CODING_AGENT_DIR resolved; bundled auth providers will not be registered");
      return;
    }
    const seen = new Set();
    const registerModule = async (providerModule, fallbackId, origin) => {
      if (!providerModule || !existsSync(providerModule)) return;
      try {
        const mod = await import(pathToFileURL(providerModule).href);
        const factory = mod.createAuthProvider ?? mod.createGrokBuildProvider;
        const id = typeof mod.AUTH_PROVIDER_ID === "string" && mod.AUTH_PROVIDER_ID.trim()
          ? mod.AUTH_PROVIDER_ID.trim()
          : typeof mod.GROK_BUILD_PROVIDER_ID === "string" && mod.GROK_BUILD_PROVIDER_ID.trim()
            ? mod.GROK_BUILD_PROVIDER_ID.trim()
            : fallbackId;
        if (typeof factory !== "function" || !id || seen.has(id)) return;
        if (!refreshExisting && typeof rt.getProvider === "function" && rt.getProvider(id)) { seen.add(id); return; }
        seen.add(id);
        rt.registerProvider(id, await factory({ authPath: join(agentDir, "auth.json"), cacheDir: null }));
      } catch (error) {
        console.warn(`[pi-auth-helper] auth provider registration failed (${origin}): ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    // Host-supplied claims first: enabled extensions' provider modules,
    // including user-installed ones this script cannot discover from
    // its own tree. Serialized by ExternalAuthRuntime at spawn time.
    let hostModules = [];
    try { hostModules = JSON.parse(process.env.PIPIUI_EXTENSION_AUTH_PROVIDERS ?? "[]"); } catch { hostModules = []; }
    if (Array.isArray(hostModules)) {
      for (const entry of hostModules) {
        if (!entry || typeof entry.module !== "string") continue;
        await registerModule(entry.module, typeof entry.id === "string" ? entry.id.trim() : "", `host:${entry.id ?? entry.module}`);
      }
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const extensionsRoot = join(here, "..", "extensions");
    if (!existsSync(extensionsRoot)) return;
    let names = [];
    try { names = readdirSync(extensionsRoot); } catch { return; }
    for (const name of names) {
      await registerModule(join(extensionsRoot, name, "agent", "dist", "provider.js"), "", `bundled:${name}`);
    }
  } catch (error) {
    console.warn(`[pi-auth-helper] bundled auth provider scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function runtime() {
  const root = moduleRoot(); const require = createRequire(join(root, "package.json")); let mod;
  try { mod = await import(join(root, "dist/index.js")); } catch { mod = require(join(root, "dist/index.js")); }
  const rt = await mod.ModelRuntime.create(modelRuntimeOptions());
  await registerBundledAuthProviders(rt);
  return rt;
}
/** Non-secret model metadata required by Electron's capability reconciliation. */
export function serializeAvailableModel(model) {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    api: model.api,
    reasoning: model.reasoning,
    input: model.input,
    thinkingLevelMap: model.thinkingLevelMap,
    compat: model.compat,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: model.cost,
    capabilities: model.capabilities,
  };
}
function interaction() {
  const input = createInterface({ input: process.stdin }); const pending = [];
  input.on("line", line => { const waiter = pending.shift(); if (waiter) waiter(JSON.parse(line).answer); });
  return { value: { prompt: prompt => { emit({ event: "prompt", prompt }); return new Promise(resolve => pending.push(resolve)); }, notify: notification => emit({ event: "notify", notification }) }, close: () => input.close() };
}
/** Execute a single non-interactive command against the given ModelRuntime. */
async function runCommand(rt, command, args) {
  if (command === "list-models") return { models: (await rt.getAvailable()).map(serializeAvailableModel) };
  if (command === "list-providers") { await rt.getAvailable(); return { providers: rt.getProviders().map(p => ({ id: p.id, name: p.name, auth: { oauth: p.auth?.oauth ? { loginLabel: p.auth.oauth.loginLabel } : undefined, apiKey: p.auth?.apiKey ? {} : undefined } })) }; }
  if (command === "logout") { await rt.logout(args[0]); return {}; }
  throw new Error(`unknown command ${command}`);
}
/** Reset the reused runtime's cached catalog/availability so the next command re-fetches (auth change). */
async function reload(rt) {
  const signal = AbortSignal.timeout(MODEL_REFRESH_TIMEOUT_MS);
  await registerBundledAuthProviders(rt, true);
  if (typeof rt.refresh === "function") await rt.refresh({ force: true, allowNetwork: true, signal });
}
/** Resident worker: reuse one ModelRuntime across many commands via newline-delimited JSON-RPC on stdin/stdout. */
async function serve() {
  const rt = await runtime();
  emit({ ready: true }); // startup handshake so the client knows the runtime is up
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    let req;
    try { req = JSON.parse(line); } catch { emit({ id: "unknown", ok: false, error: "invalid request" }); continue; }
    const id = req && typeof req.id === "string" ? req.id : "unknown";
    try {
      if (req.cmd === "reload") { await reload(rt); emit({ id, ok: true, data: {} }); continue; }
      const data = await runCommand(rt, req.cmd, Array.isArray(req.args) ? req.args : []);
      emit({ id, ok: true, data });
    } catch (error) { emit({ id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  }
}
async function main() {
  const [command, providerId, authType] = process.argv.slice(2);
  if (command === "serve") return serve();
  const rt = await runtime();
  if (command === "list-models" || command === "list-providers" || command === "logout") return emit({ ok: true, ...(await runCommand(rt, command, [providerId])) });
  if (command === "login-json") { const bridge = interaction(); try { emit({ ok: true, result: await rt.login(providerId, authType, bridge.value) }); } finally { bridge.close(); } return; }
  throw new Error(`unknown command ${command}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { emit({ ok: false, error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; });
