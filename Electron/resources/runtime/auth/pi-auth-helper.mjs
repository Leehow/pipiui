#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
 * Register the canonical grok-build provider from the bundled grok-build-oauth
 * extension (single source — never a copied OAuth transport) so the host's login
 * panel can show status / re-login / logout for it. Credential persistence stays
 * in pi's credential store under the current Pi home (PI_CODING_AGENT_DIR).
 */
async function registerBundledAuthProviders(rt) {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const providerModule = join(here, "..", "extensions", "grok-build-oauth", "agent", "dist", "provider.js");
    if (!existsSync(providerModule)) return;
    const { createGrokBuildProvider, GROK_BUILD_PROVIDER_ID } = await import(pathToFileURL(providerModule).href);
    if (typeof rt.registerProvider !== "function" || typeof rt.getProvider === "function" && rt.getProvider(GROK_BUILD_PROVIDER_ID)) return;
    const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
    rt.registerProvider(GROK_BUILD_PROVIDER_ID, createGrokBuildProvider(agentDir ? { authPath: join(agentDir, "auth.json") } : {}));
  } catch { /* auth surface must never break on an optional bundled extension */ }
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
  if (typeof rt.refresh === "function") await rt.refresh({ force: true, allowNetwork: true, signal: AbortSignal.timeout(MODEL_REFRESH_TIMEOUT_MS) });
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
