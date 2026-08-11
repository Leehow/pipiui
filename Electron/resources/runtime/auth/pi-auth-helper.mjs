#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
function moduleRoot() {
  let pi = process.env.PIPIUI_PI_PATH || "";
  if (!pi) try { pi = execFileSync("which", ["pi"], { encoding: "utf8" }).trim(); } catch {}
  const candidates = [pi && join(dirname(pi), "node_modules/@earendil-works/pi-coding-agent"), pi && join(dirname(pi), "../lib/node_modules/@earendil-works/pi-coding-agent"), join(process.env.HOME || "", ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent"), "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent", "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent"].filter(Boolean);
  for (const candidate of candidates) if (existsSync(join(candidate, "package.json"))) return candidate;
  throw new Error("Cannot find external @earendil-works/pi-coding-agent; install/update the pi CLI");
}
async function runtime() {
  const root = moduleRoot(); const require = createRequire(join(root, "package.json")); let mod;
  try { mod = await import(join(root, "dist/index.js")); } catch { mod = require(join(root, "dist/index.js")); }
  return mod.ModelRuntime.create({ allowModelNetwork: true });
}
function interaction() {
  const input = createInterface({ input: process.stdin }); const pending = [];
  input.on("line", line => { const waiter = pending.shift(); if (waiter) waiter(JSON.parse(line).answer); });
  return { value: { prompt: prompt => { emit({ event: "prompt", prompt }); return new Promise(resolve => pending.push(resolve)); }, notify: notification => emit({ event: "notify", notification }) }, close: () => input.close() };
}
async function main() {
  const [command, providerId, authType] = process.argv.slice(2); const rt = await runtime();
  if (command === "list-models") return emit({ ok: true, models: (await rt.getAvailable()).map(m => ({ provider: m.provider, id: m.id, name: m.name, reasoning: m.reasoning, input: m.input })) });
  if (command === "list-providers") { await rt.getAvailable(); return emit({ ok: true, providers: rt.getProviders().map(p => ({ id: p.id, name: p.name, auth: { oauth: p.auth?.oauth ? { loginLabel: p.auth.oauth.loginLabel } : undefined, apiKey: p.auth?.apiKey ? {} : undefined } })) }); }
  if (command === "logout") { await rt.logout(providerId); return emit({ ok: true }); }
  if (command === "login-json") { const bridge = interaction(); try { emit({ ok: true, result: await rt.login(providerId, authType, bridge.value) }); } finally { bridge.close(); } return; }
  throw new Error(`unknown command ${command}`);
}
main().catch(error => { emit({ ok: false, error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; });
