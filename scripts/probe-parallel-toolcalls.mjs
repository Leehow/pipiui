#!/usr/bin/env node
/**
 * Probe native multi-tool-call and subagent batch preferences without sending
 * credentials or unredacted provider responses to disk. Node 18+; no deps.
 *
 * Reads ~/.pi/agent/models.json, models-store.json, and auth.json, plus the
 * provider API-key environment variables documented by pi. Default reports
 * are intentionally written to the primary checkout so a
 * disposable worktree cannot lose experiment evidence.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HOME = process.env.HOME || process.env.USERPROFILE;
const PI_AGENT = path.join(HOME, ".pi", "agent");
const PRIMARY_ROOT = "/Users/haoli/leehow/code/pipiui";
const REPORT_DIR = path.join(PRIMARY_ROOT, ".pi", "boss");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "Sources", "PipiUI", "Resources", "ModelCapabilities.json");
const RUNS = 3;
const TIMEOUT_MS = 60_000;
const TARGETS = [
  ["deepseek", "deepseek-v4-flash"], ["deepseek", "deepseek-v4-pro"],
  ["kimi-coding", "k3"], ["kimi-coding", "k3-256k"],
  ["openai-codex", "gpt-5.3-codex-spark"], ["openai-codex", "gpt-5.6-luna"],
  ["openai-codex", "gpt-5.6-sol"], ["openai-codex", "gpt-5.6-terra"],
  ["xai", "grok-4.5"],
  ["zai-coding-cn", "glm-5-turbo"], ["zai-coding-cn", "glm-5.2"], ["zai-coding-cn", "glm-5v-turbo"],
  // Bonus targets are attempted only when the allowed files provide credentials.
  ["anthropic", "claude-sonnet-5"], ["google", "gemini-3-pro-preview"],
];
const CITIES = ["Paris", "Tokyo", "New York"];
const PARALLEL_HINT = "If you intend to call multiple tools and there are no dependencies between the calls, make all of the independent calls in the same block.";
const BOSS_SYSTEM = "You are a boss agent. Delegate research work with the subagent tool. Use independent delegates when goals are independent.";

function usage() {
  console.log("Usage: node scripts/probe-parallel-toolcalls.mjs [--list] [--only provider/model] [--resume raw.json] [--emit-registry]");
}

function parseArgs(argv) {
  let list = false;
  let only;
  let resume;
  let emitRegistry = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--list") list = true;
    else if (argv[i] === "--only") only = argv[++i];
    else if (argv[i] === "--resume") resume = argv[++i];
    else if (argv[i] === "--emit-registry") emitRegistry = true;
    else if (argv[i] === "--help" || argv[i] === "-h") { usage(); process.exit(0); }
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (only && !/^[-\w]+\/[\w.-]+$/.test(only)) throw new Error("--only must be provider/model");
  return { list, only, resume, emitRegistry };
}

async function readJson(name) {
  return JSON.parse(await readFile(path.join(PI_AGENT, name), "utf8"));
}

function findModel(store, provider, id) {
  return store?.[provider]?.models?.find((model) => model.id === id);
}

function findProviderConfig(config, provider) {
  return config?.providers?.[provider];
}

const ENV_API_KEYS = {
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google: "GEMINI_API_KEY",
  "kimi-coding": "KIMI_API_KEY",
  "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
  xai: "XAI_API_KEY",
};

function credentialFor({ provider, model, auth, config }) {
  const authEntry = auth?.[provider];
  if (authEntry?.key) return { value: authEntry.key, kind: "api_key", source: "auth.json" };
  if (authEntry?.access) {
    if (typeof authEntry.expires === "number" && authEntry.expires <= Date.now()) {
      return { expired: true, source: "auth.json", reason: "OAuth access token is expired; the provider-specific refresh flow is not replayed by this probe" };
    }
    return { value: authEntry.access, kind: "oauth", source: "auth.json" };
  }
  const envName = ENV_API_KEYS[provider];
  if (envName && process.env[envName]?.trim()) return { value: process.env[envName], kind: "api_key", source: `environment:${envName}` };
  const direct = findProviderConfig(config, provider);
  if (direct?.apiKey) return { value: direct.apiKey, kind: "api_key", source: "models.json" };

  // ZAI Coding model definitions and the configured Zhipu coding credential
  // intentionally share the same official endpoint, but use different labels.
  if (provider === "zai-coding-cn") {
    const compatible = Object.entries(config?.providers || {}).find(([, entry]) =>
      entry?.baseUrl === model.baseUrl && entry?.api === model.api && entry?.apiKey,
    );
    if (compatible) return { value: compatible[1].apiKey, kind: "api_key", source: "models.json:same-endpoint" };
  }
  return null;
}

function headersFor(target) {
  const headers = { "content-type": "application/json", ...(target.model.headers || {}) };
  if (target.credential.kind === "oauth") {
    headers.authorization = `Bearer ${target.credential.value}`;
  } else if (target.model.api === "anthropic-messages") {
    headers["x-api-key"] = target.credential.value;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.authorization = `Bearer ${target.credential.value}`;
  }
  if (target.provider === "openai-codex") {
    // ChatGPT Codex Responses uses the account-scoped backend route.
    if (target.auth?.[target.provider]?.accountId) headers["chatgpt-account-id"] = target.auth[target.provider].accountId;
    headers["user-agent"] = "pi-parallel-toolcall-probe/1.0";
  }
  return headers;
}

const weatherParameters = {
  type: "object", additionalProperties: false,
  properties: { city: { type: "string", description: "The city whose weather is requested." } },
  required: ["city"],
};
const subagentParameters = {
  type: "object", additionalProperties: false,
  properties: {
    agent: { type: "string", description: "Agent role for one task, such as explore." },
    task: { type: "string", description: "One focused task. Do not combine independent goals." },
    title: { type: "string", description: "Short title for one task." },
    tasks: {
      type: "array",
      description: "Parallel tasks. Put each independent goal in its own element; do not merge independent goals into one task.",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          agent: { type: "string" }, task: { type: "string" }, title: { type: "string" },
        }, required: ["agent", "task"],
      },
    },
  },
};

function probeSpec(probe) {
  if (probe === "A" || probe === "B") return {
    system: probe === "B" ? PARALLEL_HINT : undefined,
    user: "Use get_weather to check the weather in Paris, Tokyo, and New York. I need all three.",
    tool: { name: "get_weather", description: "Get the current weather for exactly one city.", parameters: weatherParameters },
  };
  return {
    system: BOSS_SYSTEM,
    user: "Delegate these three independent research goals: (1) find the current OWASP top security risks, (2) compare three competitors' public pricing pages, and (3) summarize the last six months of release notes. Use the subagent tool now.",
    tool: { name: "subagent", description: "Delegate one task with agent/task/title, or parallel independent tasks with tasks[].", parameters: subagentParameters },
  };
}

function openAIChatPayload(target, spec) {
  const messages = [];
  if (spec.system) messages.push({ role: "system", content: spec.system });
  messages.push({ role: "user", content: spec.user });
  return {
    url: `${target.model.baseUrl.replace(/\/$/, "")}/chat/completions`,
    body: { model: target.model.id, messages, tools: [{ type: "function", function: spec.tool }], tool_choice: "auto", max_tokens: 1024 },
  };
}

function responsesPayload(target, spec) {
  const input = [];
  if (spec.system) input.push({ role: "system", content: [{ type: "input_text", text: spec.system }] });
  input.push({ role: "user", content: [{ type: "input_text", text: spec.user }] });
  const base = target.model.baseUrl.replace(/\/$/, "");
  return {
    url: target.provider === "openai-codex" ? `${base}/codex/responses` : `${base}/responses`,
    body: {
      model: target.model.id, input,
      tools: [{ type: "function", name: spec.tool.name, description: spec.tool.description, parameters: spec.tool.parameters, strict: false }],
      tool_choice: "auto", store: false,
      ...(target.provider === "openai-codex" ? { stream: true } : { max_output_tokens: 1024 }),
    },
  };
}

function anthropicPayload(target, spec) {
  return {
    url: `${target.model.baseUrl.replace(/\/$/, "")}/v1/messages`,
    body: {
      model: target.model.id, max_tokens: 1024, system: spec.system,
      messages: [{ role: "user", content: spec.user }],
      tools: [{ name: spec.tool.name, description: spec.tool.description, input_schema: spec.tool.parameters }],
    },
  };
}

function googlePayload(target, spec) {
  const base = target.model.baseUrl.replace(/\/$/, "");
  return {
    url: `${base}/models/${encodeURIComponent(target.model.id)}:generateContent`,
    body: {
      systemInstruction: spec.system ? { parts: [{ text: spec.system }] } : undefined,
      contents: [{ role: "user", parts: [{ text: spec.user }] }],
      tools: [{ functionDeclarations: [{ name: spec.tool.name, description: spec.tool.description, parameters: spec.tool.parameters }] }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: { maxOutputTokens: 1024 },
    },
  };
}

function requestShape(target, spec) {
  switch (target.model.api) {
    case "openai-completions": return openAIChatPayload(target, spec);
    case "openai-responses":
    case "openai-codex-responses": return responsesPayload(target, spec);
    case "anthropic-messages": return anthropicPayload(target, spec);
    case "google-generative-ai": return googlePayload(target, spec);
    default: throw new Error(`Unsupported API type: ${target.model.api}`);
  }
}

function parseArguments(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try { return JSON.parse(value); } catch { return { _unparsed: value.slice(0, 500) }; }
}

function uniqueCalls(calls) {
  const seen = new Set();
  return calls.filter((call) => {
    const key = `${call.name || ""}:${JSON.stringify(call.arguments || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractCalls(api, payload) {
  if (api === "openai-completions") {
    return (payload?.choices?.[0]?.message?.tool_calls || []).map((call) => ({ name: call.function?.name, arguments: parseArguments(call.function?.arguments) }));
  }
  if (api === "openai-responses" || api === "openai-codex-responses") {
    return uniqueCalls((payload?.output || []).filter((item) => item?.type === "function_call" && typeof item.name === "string").map((call) => ({ name: call.name, arguments: parseArguments(call.arguments) })));
  }
  if (api === "anthropic-messages") {
    return (payload?.content || []).filter((item) => item?.type === "tool_use").map((call) => ({ name: call.name, arguments: parseArguments(call.input) }));
  }
  if (api === "google-generative-ai") {
    return (payload?.candidates?.[0]?.content?.parts || []).filter((part) => part?.functionCall).map((part) => ({ name: part.functionCall.name, arguments: parseArguments(part.functionCall.args) }));
  }
  return [];
}

function decodeSSE(text) {
  let completed;
  const output = [];
  const eventTypes = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data);
      if (typeof event.type === "string") eventTypes.push(event.type);
      if (event.type === "response.completed" && event.response) completed = event.response;
      if (event.type === "response.output_item.done" && event.item) output.push(event.item);
      if (event.type === "response.function_call_arguments.done") {
        output.push({ type: "function_call", name: event.name, arguments: event.arguments });
      }
    } catch { /* Ignore non-JSON SSE keep-alives. */ }
  }
  const decoded = completed || { output: [] };
  // The Codex backend's response.completed can omit output while the preceding
  // argument-done events carry the complete function calls.
  if (!Array.isArray(decoded.output) || decoded.output.length === 0) decoded.output = output;
  return { payload: decoded, eventTypes: [...new Set(eventTypes)] };
}

function cleanError(text) {
  return String(text || "request failed")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9._-]{10,}/g, "[redacted]")
    .slice(0, 500);
}

async function callProbe(target, probe, run) {
  const spec = probeSpec(probe);
  const { url, body } = requestShape(target, spec);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, { method: "POST", headers: headersFor(target), body: JSON.stringify(body), signal: controller.signal });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!response.ok) return { probe, run, status: "error", httpStatus: response.status, durationMs: Date.now() - started, error: cleanError(json?.error?.message || json?.message || text) };
    let outputEventTypes;
    if (!json && target.provider === "openai-codex") {
      const decoded = decodeSSE(text);
      json = decoded.payload;
      outputEventTypes = decoded.eventTypes;
    }
    if (!json) return { probe, run, status: "error", durationMs: Date.now() - started, error: "provider returned non-JSON response" };
    return { probe, run, status: "ok", durationMs: Date.now() - started, calls: extractCalls(target.model.api, json), ...(outputEventTypes ? { outputEventTypes } : {}) };
  } catch (error) {
    return { probe, run, status: "error", durationMs: Date.now() - started, error: error?.name === "AbortError" ? `timeout after ${TIMEOUT_MS / 1000}s` : cleanError(error?.message) };
  } finally { clearTimeout(timer); }
}

function cityCoverage(calls) {
  const values = calls.map((call) => String(call.arguments?.city || "").toLowerCase());
  return CITIES.filter((city) => values.some((value) => value.includes(city.toLowerCase()))).length;
}

function classifyBatch(calls) {
  const subagentCalls = calls.filter((call) => call.name === "subagent");
  if (subagentCalls.some((call) => Array.isArray(call.arguments?.tasks) && call.arguments.tasks.length >= 2)) return "tasks[len>=2]";
  if (subagentCalls.length >= 2 && subagentCalls.every((call) => typeof call.arguments?.task === "string")) return "multiple single calls";
  if (subagentCalls.length === 1 && typeof subagentCalls[0].arguments?.task === "string") {
    const task = subagentCalls[0].arguments.task.toLowerCase();
    const hits = ["owasp", "security", "pricing", "competitor", "release", "changelog"].filter((word) => task.includes(word)).length;
    if (hits >= 3) return "single merged brief";
  }
  return "other";
}

function summarizeAB(records) {
  const ok = records.filter((record) => record.status === "ok");
  const parallel = ok.filter((record) => record.calls.length >= 2).length;
  const calls = ok.map((record) => record.calls.length);
  const coverage = ok.map((record) => cityCoverage(record.calls));
  return {
    completed: ok.length, errors: records.length - ok.length, parallelRate: ok.length ? parallel / ok.length : null,
    meanCalls: ok.length ? calls.reduce((a, b) => a + b, 0) / ok.length : null,
    meanCoverage: ok.length ? coverage.reduce((a, b) => a + b, 0) / ok.length : null,
  };
}

function summarizeC(records) {
  const ok = records.filter((record) => record.status === "ok");
  const distribution = Object.fromEntries(["tasks[len>=2]", "multiple single calls", "single merged brief", "other"].map((kind) => [kind, 0]));
  for (const record of ok) distribution[classifyBatch(record.calls)] += 1;
  return {
    completed: ok.length, errors: records.length - ok.length, distribution,
    batchRate: ok.length ? distribution["tasks[len>=2]"] / ok.length : null,
  };
}

function pct(value) { return value == null ? "n/a" : `${Math.round(value * 100)}%`; }
function fixed(value) { return value == null ? "n/a" : value.toFixed(1); }

function interpretation(summary) {
  if (summary.status === "skipped") return `Skipped: ${summary.reason}.`;
  if (summary.status === "unavailable") return `Unavailable: ${summary.reason}.`;
  const a = summary.metrics.A.parallelRate ?? 0;
  const b = summary.metrics.B.parallelRate ?? 0;
  const c = summary.metrics.C.batchRate ?? 0;
  if (a >= 2 / 3 && c >= 2 / 3) return "Strong boss candidate: native fan-out and tasks[] batching are both consistent.";
  if (a >= 2 / 3 && summary.metrics.C.distribution["multiple single calls"] >= 2) return "Good boss candidate for native multi-call fan-out, but it does not prefer tasks[].";
  if (b >= 2 / 3 && c >= 1 / 3) return "Usable with the standard parallel hint; batch behavior needs monitoring.";
  if (a >= 1 / 3 || b >= 1 / 3) return "Partial multi-call support; do not rely on it alone for boss fan-out.";
  return "Poor boss candidate for native parallel delegation; enforce batching in orchestration.";
}

function modelContextWindow(store, item) {
  const model = findModel(store, item.provider, item.model);
  const contextWindow = model?.contextWindow ?? model?.limit?.context;
  return typeof contextWindow === "number" ? contextWindow : null;
}

function attemptedRuns(metric, status) {
  if (metric) return metric.completed + metric.errors;
  return status === "skipped" ? 0 : RUNS;
}

function probeARegistryValue(item) {
  const metric = item.metrics?.A;
  return {
    status: item.status,
    rate: metric?.parallelRate ?? null,
    completed_runs: metric?.completed ?? 0,
    attempted_runs: attemptedRuns(metric, item.status),
    mean_calls: metric?.meanCalls ?? null,
    mean_city_coverage: metric?.meanCoverage ?? null,
    ...(item.status === "completed" ? {} : { reason: item.reason ?? "no probe result" }),
  };
}

function probeCRegistryValue(item) {
  const metric = item.metrics?.C;
  return {
    status: item.status,
    rate: metric?.batchRate ?? null,
    completed_runs: metric?.completed ?? 0,
    attempted_runs: attemptedRuns(metric, item.status),
    distribution: metric?.distribution ?? {},
    ...(item.status === "completed" ? {} : { reason: item.reason ?? "no probe result" }),
  };
}

function recommendedRoles(item) {
  if (item.status !== "completed") return [];
  const a = item.metrics?.A?.parallelRate ?? 0;
  const c = item.metrics?.C;
  const supportsTasksBatch = (c?.batchRate ?? 0) >= 2 / 3;
  const supportsMultipleCalls = (c?.distribution?.["multiple single calls"] ?? 0) >= 2;
  return [
    ...(a >= 2 / 3 && (supportsTasksBatch || supportsMultipleCalls) ? ["boss"] : []),
    "worker",
  ];
}

function registryNotes(item) {
  if (item.status !== "completed") return `Probe ${item.status}: ${item.reason ?? "no probe result"}`;
  const a = item.metrics.A;
  const c = item.metrics.C;
  const distribution = Object.entries(c.distribution)
    .filter(([, count]) => count)
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(", ");
  return `Probe A: ${pct(a.parallelRate)} parallel tool calls across ${a.completed}/${attemptedRuns(a, item.status)} completed runs. Probe C: ${pct(c.batchRate)} tasks[] batches (${distribution || "none"}).`;
}

async function emitRegistry(results, store, startedAt) {
  let existing = {};
  try {
    existing = JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const models = existing.models && typeof existing.models === "object" && !Array.isArray(existing.models)
    ? { ...existing.models }
    : {};
  for (const item of results) {
    const key = `${item.provider}/${item.model}`;
    models[key] = {
      provider: item.provider,
      model: item.model,
      parallel_tool_calls: probeARegistryValue(item),
      tasks_batch: probeCRegistryValue(item),
      context_window: modelContextWindow(store, item),
      recommended_roles: recommendedRoles(item),
      notes: registryNotes(item),
      probed_at: item.supplementalAt ?? startedAt,
    };
  }
  const registry = {
    ...existing,
    schema_version: 1,
    updated_at: startedAt,
    probe: {
      runs_per_probe: RUNS,
      timeout_ms: TIMEOUT_MS,
      parallel_tool_calls: "Probe A: spontaneous independent weather tool calls.",
      tasks_batch: "Probe C: subagent tasks[] batch preference.",
    },
    models,
  };
  await mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  await writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  return REGISTRY_PATH;
}

function markdown(results, rawPath, startedAt) {
  const lines = [
    "# Model multi-tool-call capability matrix",
    "",
    `Generated: ${startedAt}. Each probe was repeated ${RUNS} times; per-request timeout: ${TIMEOUT_MS / 1000}s.`,
    "A: spontaneous three-city weather tool calls. B: same prompt plus standard parallel hint. C: subagent schema preference for tasks[] vs single task.",
    "",
    "| Model | A multi-call / mean calls / city coverage | B multi-call / mean calls / city coverage | B uplift | C tasks[] batch rate | C distribution (completed runs) | Interpretation |",
    "|---|---:|---:|---:|---:|---|---|",
  ];
  for (const item of results) {
    const label = `${item.provider}/${item.model}`;
    if (item.status !== "completed") {
      const state = item.status === "skipped" ? "skipped" : "unavailable";
      lines.push(`| ${label} | ${state} | ${state} | — | ${state} | — | ${interpretation(item)} |`);
      continue;
    }
    const { A, B, C } = item.metrics;
    const a = `${pct(A.parallelRate)} / ${fixed(A.meanCalls)} / ${fixed(A.meanCoverage)}/3`;
    const b = `${pct(B.parallelRate)} / ${fixed(B.meanCalls)} / ${fixed(B.meanCoverage)}/3`;
    const uplift = A.parallelRate == null || B.parallelRate == null ? "n/a" : `${Math.round((B.parallelRate - A.parallelRate) * 100)}pp`;
    const distribution = Object.entries(C.distribution).filter(([, count]) => count).map(([kind, count]) => `${kind}: ${count}`).join(", ") || "none";
    lines.push(`| ${label} | ${a} | ${b} | ${uplift} | ${pct(C.batchRate)} | ${distribution}; errors: ${C.errors} | ${interpretation(item)} |`);
  }
  const supplemental = results.filter((item) => item.supplementalAt);
  if (supplemental.length) {
    lines.push("", "## Supplemental credential recheck", "");
    for (const item of supplemental) lines.push(`- ${item.provider}/${item.model}: ${item.supplementalAt} (${item.credentialSource ?? item.reason ?? "no credential source"}).`);
  }
  lines.push("", "## Method notes", "", "- ‘Multi-call’ means the first model response contained two or more tool calls. City coverage is the mean number of Paris/Tokyo/New York calls in that response.", "- The raw JSON stores normalized tool names/arguments, timing, HTTP status, and sanitized errors only. It never stores credentials, request headers, or unredacted provider responses.", `- Raw JSON: \`${rawPath}\`.`, "");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [config, store, auth] = await Promise.all([readJson("models.json"), readJson("models-store.json"), readJson("auth.json")]);
  const resumed = args.resume ? JSON.parse(await readFile(args.resume, "utf8")) : null;
  const targets = TARGETS.filter(([provider, model]) => !args.only || `${provider}/${model}` === args.only).map(([provider, id]) => {
    const model = findModel(store, provider, id);
    if (!model) return { provider, id, skip: "model is not present in models-store.json" };
    const credential = credentialFor({ provider, model, auth, config });
    if (!credential) return { provider, id, model, skip: "no credential in auth.json, models.json, or the documented provider environment variable" };
    if (credential.expired) return { provider, id, model, skip: credential.reason };
    return { provider, id, model, credential, auth };
  });
  if (args.only && !targets.length) throw new Error(`Unknown probe target: ${args.only}`);
  if (args.list) {
    for (const target of targets) console.log(`${target.provider}/${target.id} — ${target.skip ? `SKIP (${target.skip})` : `${RUNS * 3} requests (A/B/C × ${RUNS})`}`);
    console.log(`Total planned requests: ${targets.filter((target) => !target.skip).length * RUNS * 3}`);
    return;
  }
  if (args.emitRegistry && resumed) {
    const resumedResults = resumed.results.filter((item) => !args.only || `${item.provider}/${item.model}` === args.only);
    if (args.only && resumedResults.length === 0) throw new Error(`No saved result for ${args.only}`);
    console.log(`Updated ${await emitRegistry(resumedResults, store, resumed.generatedAt ?? new Date().toISOString())}`);
    return;
  }

  const startedAt = new Date().toISOString();
  const results = (resumed?.results || []).filter((item) => !targets.some((target) => target.provider === item.provider && target.id === item.model));
  for (const target of targets) {
    if (target.skip) {
      results.push({ provider: target.provider, model: target.id, status: "skipped", reason: target.skip, supplementalAt: startedAt });
      continue;
    }
    console.log(`Probing ${target.provider}/${target.id}…`);
    const records = [];
    for (const probe of ["A", "B", "C"]) {
      for (let run = 1; run <= RUNS; run += 1) records.push(await callProbe(target, probe, run));
    }
    const byProbe = Object.fromEntries(["A", "B", "C"].map((probe) => [probe, records.filter((record) => record.probe === probe)]));
    const allFailed = records.every((record) => record.status === "error");
    results.push({
      provider: target.provider, model: target.id, api: target.model.api,
      contextWindow: target.model.contextWindow ?? target.model.limit?.context ?? null,
      status: allFailed ? "unavailable" : "completed", supplementalAt: startedAt,
      ...(allFailed ? { reason: `all ${records.length} requests failed: ${records[0].error}` } : {}),
      credentialSource: target.credential.source,
      records, metrics: { A: summarizeAB(byProbe.A), B: summarizeAB(byProbe.B), C: summarizeC(byProbe.C) },
    });
  }
  await mkdir(REPORT_DIR, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const rawPath = path.join(REPORT_DIR, `model-toolcall-raw-${stamp}.json`);
  const reportPath = path.join(REPORT_DIR, "model-toolcall-matrix.md");
  const targetOrder = new Map(TARGETS.map(([provider, model], index) => [`${provider}/${model}`, index]));
  results.sort((a, b) => targetOrder.get(`${a.provider}/${a.model}`) - targetOrder.get(`${b.provider}/${b.model}`));
  const raw = { generatedAt: startedAt, runCount: RUNS, timeoutMs: TIMEOUT_MS, results };
  await writeFile(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  await writeFile(reportPath, markdown(results, rawPath, startedAt), "utf8");
  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${rawPath}`);
  if (args.emitRegistry) console.log(`Updated ${await emitRegistry(results, store, startedAt)}`);
}

main().catch((error) => { console.error(`probe failed: ${cleanError(error?.message)}`); process.exitCode = 1; });
