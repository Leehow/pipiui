#!/usr/bin/env node
/**
 * Thin bridge so PipiUI can drive pi's ModelRuntime.login / logout / provider list
 * without re-implementing OAuth. Invoked as:
 *   node pi-auth-helper.mjs <command> [args...]
 *
 * Commands:
 *   list-providers          → JSON { providers: [{id,name,authTypes,loginLabel?}] }
 *   list-models             → JSON { models: [{provider,id,name,contextWindow}] }
 *   login <provider> <oauth|api_key> [apiKey]
 *   logout <provider>
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";

function findPiModuleRoot() {
  const which = (() => {
    try {
      return execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  })();
  const candidates = [
    which ? join(dirname(which), "../lib/node_modules/@earendil-works/pi-coding-agent") : null,
    join(process.env.HOME || "", ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent"),
    "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent",
    "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(join(c, "package.json"))) return c;
  }
  throw new Error("Cannot find @earendil-works/pi-coding-agent (is pi installed via npm?)");
}

async function loadModelRuntime() {
  const root = findPiModuleRoot();
  const require = createRequire(join(root, "package.json"));
  // Prefer package export; fall back to dist path.
  try {
    return (await import(join(root, "dist/index.js"))).ModelRuntime;
  } catch {
    return require(join(root, "dist/index.js")).ModelRuntime;
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function openURL(url) {
  try {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // ignore
  }
}

async function withRuntime(fn) {
  const ModelRuntime = await loadModelRuntime();
  const runtime = await ModelRuntime.create({ allowModelNetwork: true });
  try {
    return await fn(runtime);
  } finally {
    // ModelRuntime has no dispose; process exit cleans up.
  }
}

async function listProviders() {
  await withRuntime(async (runtime) => {
    await runtime.getAvailable();
    const providers = [];
    for (const provider of runtime.getProviders()) {
      const authTypes = [];
      let loginLabel;
      if (provider.auth?.oauth) {
        authTypes.push("oauth");
        loginLabel = provider.auth.oauth.loginLabel;
      }
      if (provider.auth?.apiKey?.login) {
        authTypes.push("api_key");
      }
      if (authTypes.length === 0) continue;
      providers.push({
        id: provider.id,
        name: provider.name,
        authTypes,
        loginLabel,
      });
    }
    providers.sort((a, b) => a.name.localeCompare(b.name));
    emit({ ok: true, providers });
  });
}

async function listModels() {
  await withRuntime(async (runtime) => {
    const models = await runtime.getAvailable();
    emit({
      ok: true,
      models: models.map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name ?? m.id,
        contextWindow: m.contextWindow ?? null,
      })),
    });
  });
}

function makeInteraction(apiKeyFromArg) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q) =>
    new Promise((resolve, reject) => {
      rl.question(q, (answer) => {
        if (answer === undefined) reject(new Error("Login cancelled"));
        else resolve(answer);
      });
    });

  let usedArgKey = false;
  return {
    interaction: {
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          // Prefer first option (common default) when non-interactive; otherwise list.
          if (prompt.options?.length === 1) return prompt.options[0].id;
          emit({
            event: "select",
            message: prompt.message,
            options: prompt.options,
          });
          const answer = await ask(`${prompt.message} [${prompt.options.map((o) => o.id).join("|")}]: `);
          const match = prompt.options.find(
            (o) => o.id === answer || o.label === answer
          );
          if (!match) throw new Error("Login cancelled");
          return match.id;
        }
        if (
          !usedArgKey &&
          apiKeyFromArg &&
          (prompt.type === "password" ||
            /api\s*key/i.test(prompt.message || "") ||
            /key/i.test(prompt.placeholder || ""))
        ) {
          usedArgKey = true;
          return apiKeyFromArg;
        }
        emit({ event: "prompt", message: prompt.message, placeholder: prompt.placeholder });
        return ask(`${prompt.message}: `);
      },
      notify: (event) => {
        emit({ event: event.type, ...event });
        if (event.type === "auth_url" && event.url) openURL(event.url);
      },
    },
    close: () => rl.close(),
  };
}

async function login(providerId, authType, apiKey) {
  const { interaction, close } = makeInteraction(apiKey);
  try {
    await withRuntime(async (runtime) => {
      await runtime.login(providerId, authType, interaction);
      emit({ ok: true, providerId, authType });
    });
  } finally {
    close();
  }
}

async function logout(providerId) {
  await withRuntime(async (runtime) => {
    await runtime.logout(providerId);
    emit({ ok: true, providerId });
  });
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === "list-providers") await listProviders();
  else if (cmd === "list-models") await listModels();
  else if (cmd === "login") {
    const [providerId, authType, apiKey] = args;
    if (!providerId || (authType !== "oauth" && authType !== "api_key")) {
      throw new Error("Usage: login <providerId> <oauth|api_key> [apiKey]");
    }
    await login(providerId, authType, apiKey);
  } else if (cmd === "logout") {
    const [providerId] = args;
    if (!providerId) throw new Error("Usage: logout <providerId>");
    await logout(providerId);
  } else {
    throw new Error(`Unknown command: ${cmd ?? "(none)"}`);
  }
} catch (err) {
  emit({ ok: false, error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
}
