import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const schemaModule = await import(
  pathToFileURL(join(repositoryRoot, "Electron/resources/runtime/pi-ext/subagent/strict-json-schema.ts")).href
);
const { makeStrictJsonSchema, omitNulls, makeStrictFunctionTools, prepareStrictToolArguments, sanitizeStrictToolArguments, remapUnknownSubagentType } = schemaModule;

function collectObjectsMissingRequiredKeys(value, path = "$") {
  const missing = [];
  function walk(node, current) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, current + "[" + index + "]"));
      return;
    }
    const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
    if ((types.includes("object") || node.properties) && node.properties && typeof node.properties === "object") {
      const keys = Object.keys(node.properties);
      const required = Array.isArray(node.required) ? node.required : [];
      const absent = keys.filter((key) => !required.includes(key));
      if (absent.length > 0) missing.push({ path: current, missing: absent });
    }
    for (const [key, entry] of Object.entries(node)) walk(entry, current + "." + key);
  }
  walk(value, path);
  return missing;
}

test("makeStrictJsonSchema requires every property and makes former optionals nullable", () => {
  const schema = {
    type: "object",
    properties: {
      agent: { type: "string" },
      task: { type: "string" },
      agentId: { type: "string", description: "optional id" },
      thinking: { type: "string", enum: ["off", "low", "high"] },
      chain: {
        type: "array",
        items: {
          type: "object",
          properties: {
            agent: { type: "string" },
            task: { type: "string" },
            agentId: { type: "string" },
          },
          required: ["agent", "task"],
          additionalProperties: false,
        },
      },
    },
    required: ["agent", "task"],
    additionalProperties: false,
  };

  const strict = makeStrictJsonSchema(schema);
  assert.deepEqual(collectObjectsMissingRequiredKeys(strict), []);
  assert.equal(strict.additionalProperties, false);
  assert.deepEqual(strict.required, ["agent", "task", "agentId", "thinking", "chain"]);
  assert.deepEqual(strict.properties.agentId.type, ["string", "null"]);
  assert.deepEqual(strict.properties.thinking.type, ["string", "null"]);
  assert.deepEqual(strict.properties.thinking.enum, ["off", "low", "high", null]);
  assert.deepEqual(strict.properties.chain.type, ["array", "null"]);
  assert.deepEqual(strict.properties.chain.items.required, ["agent", "task", "agentId"]);
  assert.deepEqual(strict.properties.chain.items.properties.agentId.type, ["string", "null"]);
  assert.equal(strict.properties.agent.type, "string");
});

test("omitNulls drops null keys so execute can treat them as omitted", () => {
  assert.deepEqual(
    omitNulls({
      agent: "probe",
      task: "do it",
      agentId: null,
      chain: [{ agent: "probe", task: "next", title: null }],
    }),
    {
      agent: "probe",
      task: "do it",
      chain: [{ agent: "probe", task: "next" }],
    },
  );
});

const dispatchSchema = () =>
  makeStrictJsonSchema({
    type: "object",
    properties: {
      action: { type: "string", enum: ["abort", "resolve"] },
      agent: { type: "string" },
      task: { type: "string" },
      title: { type: "string" },
      thinking: { type: "string", enum: ["off", "medium", "high"] },
      blockedBy: {
        type: "array",
        items: { type: "string" },
        maxItems: 10,
      },
      chain: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            agent: { type: "string" },
            task: { type: "string" },
            thinking: { type: "string", enum: ["off", "medium"] },
          },
          required: ["agent", "task"],
          additionalProperties: false,
        },
      },
    },
    required: ["agent", "task"],
    additionalProperties: false,
  });

test("prepareStrictToolArguments fills omitted nullable keys and coerces action=single", () => {
  const schema = dispatchSchema();
  const prepared = prepareStrictToolArguments(schema, {
    action: "single",
    agent: "general-purpose",
    task: "hide the head promote button",
    thinking: "medium",
  });
  assert.equal(prepared.action, null);
  assert.equal(prepared.chain, null);
  assert.equal(prepared.title, null);
  assert.equal(prepared.agent, "general-purpose");
  assert.equal(prepared.task, "hide the head promote button");
  assert.equal(prepared.thinking, "medium");
  assert.deepEqual(collectObjectsMissingRequiredKeys(schema), []);
});

test("prepareStrictToolArguments coerces string nulls and quoted enum values", () => {
  const schema = dispatchSchema();
  const sentinels = prepareStrictToolArguments(schema, {
    agent: "probe",
    task: "inspect",
    thinking: "null",
    title: "unused",
  });
  assert.equal(sentinels.thinking, null);
  assert.equal(sentinels.title, null);

  const quoted = prepareStrictToolArguments(schema, {
    agent: "probe",
    task: "inspect",
    thinking: '"off"',
  });
  assert.equal(quoted.thinking, "off");
});

test("prepareStrictToolArguments coerces empty minItems arrays to null and keeps empty optional arrays", () => {
  const schema = dispatchSchema();
  const prepared = prepareStrictToolArguments(schema, {
    agent: "explore",
    task: "Locate quota menu",
    title: "Locate quota menu",
    blockedBy: [],
    thinking: "low",
    agentId: "quota-locate",
    chain: [],
  });
  assert.equal(prepared.chain, null);
  assert.deepEqual(prepared.blockedBy, []);
  assert.equal(prepared.agent, "explore");
  assert.equal(prepared.task, "Locate quota menu");
});

test("prepareStrictToolArguments drops sentinel single-mode fields when chain is present", () => {
  const schema = dispatchSchema();
  const prepared = prepareStrictToolArguments(schema, {
    action: null,
    agent: "null",
    task: "not used",
    title: "unused",
    thinking: "null",
    extra: "drop-me",
    chain: [{ agent: "general-purpose", task: "real work", thinking: "medium" }],
  });
  assert.equal(prepared.action, null);
  assert.equal(prepared.agent, null);
  assert.equal(prepared.task, null);
  assert.equal(prepared.title, null);
  assert.equal(prepared.thinking, null);
  assert.equal(prepared.extra, undefined);
  assert.deepEqual(prepared.chain, [{ agent: "general-purpose", task: "real work", thinking: "medium" }]);
});

test("sanitizeStrictToolArguments survives the additionalProperties validation loop payload", () => {
  // Registered (non-strict) subagent schema shape: additionalProperties:false,
  // optionals NOT nullable. Models retrying a dispatch have emitted null-valued
  // unknown keys (action/chain) plus unknown keys outright; pi rejects the call
  // before execute() with "root: must not have additional properties" and never
  // names the key, so nothing may survive that is not a declared property.
  const registeredSchema = {
    type: "object",
    properties: {
      agent: { type: "string" },
      task: { type: "string" },
      title: { type: "string" },
      thinking: { type: "string", enum: ["off", "medium", "high"] },
      desktop: { type: "string", enum: ["user-requested", "ui-verify"] },
      background: { type: "boolean" },
    },
    required: ["agent", "task"],
    additionalProperties: false,
  };
  const sanitized = sanitizeStrictToolArguments(registeredSchema, {
    action: null,
    agent: "general-purpose",
    task: "Implement the Swift-style cut-in",
    title: null,
    desktop: null,
    reason: "resolve-only field",
    chain: null,
    background: true,
  });
  assert.deepEqual(sanitized, {
    agent: "general-purpose",
    task: "Implement the Swift-style cut-in",
    title: "Implement the Swift-style cut-in",
    background: true,
  });
});

const grokSubagentSchema = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    description: { type: "string" },
    subagent_type: { type: "string" },
    run_in_background: { type: "boolean" },
    isolation: { type: "string" },
    cwd: { type: "string" },
    resume_from: { type: "string" },
  },
  required: ["prompt", "description"],
  additionalProperties: false,
};

test("sanitizeStrictToolArguments keeps Grok Build field names and isolation on explore", () => {
  const sanitized = sanitizeStrictToolArguments(grokSubagentSchema, {
    prompt: "Find the packaged Electron app and the upload script.",
    description: "locate artifact",
    subagent_type: "explore",
    isolation: "worktree",
    heartbeatSecs: 60,
  });
  assert.equal(sanitized.prompt, "Find the packaged Electron app and the upload script.");
  assert.equal(sanitized.description, "locate artifact");
  assert.equal(sanitized.subagent_type, "explore");
  assert.equal(sanitized.isolation, "worktree");
  assert.equal(sanitized.heartbeatSecs, undefined);
  assert.equal(sanitized.task, undefined);
  assert.equal(sanitized.agent, undefined);
});

test("sanitizeStrictToolArguments accepts legacy PipiUI names onto the Grok schema", () => {
  const sanitized = sanitizeStrictToolArguments(grokSubagentSchema, {
    agent: "explore",
    task: "Read README.md and summarize it.",
    title: "定位 relay 产物",
    worktree: "none",
    background: true,
    agentId: "readme-summary",
  });
  assert.equal(sanitized.prompt, "Read README.md and summarize it.");
  assert.equal(sanitized.description, "定位 relay 产物");
  assert.equal(sanitized.subagent_type, "explore");
  assert.equal(sanitized.isolation, "none");
  assert.equal(sanitized.run_in_background, true);
  assert.equal(sanitized.resume_from, "readme-summary");
});

test("sanitizeStrictToolArguments expands a short title-only brief so Grok can dispatch", () => {
  // 2026-08-15 session e9c359b8: Grok filled title + metadata and never emitted
  // the required brief. The public contract is now prompt/description; a short
  // description still becomes a dispatchable prompt.
  const liveMissingPrompt = {
    agent: "explore",
    title: "查模型切换失败",
    thinking: "low",
    agentId: "explore-model-switch",
    cwd: "/Users/haoli/leehow/code/pipiui",
    worktree: "none",
    noWorktreeReason: "read-only recon",
    blockedBy: [],
    fresh: false,
    background: true,
    verify: "",
  };
  const sanitized = sanitizeStrictToolArguments(grokSubagentSchema, liveMissingPrompt);
  assert.match(sanitized.prompt, /^查模型切换失败\n/);
  assert.match(sanitized.prompt, /Read-only investigation/);
  assert.notEqual(sanitized.prompt, sanitized.description);
  assert.equal(sanitized.description, "查模型切换失败");
  assert.equal(sanitized.subagent_type, "explore");
  assert.equal(sanitized.resume_from, "explore-model-switch");
  assert.equal(sanitized.isolation, "none");
  assert.equal(sanitized.run_in_background, true);

  const withPrompt = sanitizeStrictToolArguments(grokSubagentSchema, {
    subagent_type: "explore",
    prompt: "Read README.md and summarize it.",
    description: "定位 relay 产物",
  });
  assert.equal(withPrompt.prompt, "Read README.md and summarize it.");

  const longTitle = "Investigate how to host a static download of PipiUI Electron on the existing DMIT VPS. Read-only only.";
  const fromLongTitle = sanitizeStrictToolArguments(grokSubagentSchema, {
    subagent_type: "explore",
    description: longTitle,
  });
  assert.equal(fromLongTitle.prompt, longTitle);

  const empty = sanitizeStrictToolArguments(grokSubagentSchema, { subagent_type: "explore" });
  assert.equal(empty.prompt, undefined);
  assert.equal(empty.description, undefined);
});

test("sanitizeStrictToolArguments remaps Grok custom agent names and keeps isolation", () => {
  const exploreIsolation = sanitizeStrictToolArguments(grokSubagentSchema, {
    subagent_type: "explore",
    description: "查 DMIT 静态托管",
    isolation: "none",
    resume_from: "dmit-static",
  });
  assert.equal(exploreIsolation.subagent_type, "explore");
  assert.equal(exploreIsolation.resume_from, "dmit-static");
  assert.equal(exploreIsolation.isolation, "none");
  assert.match(exploreIsolation.prompt, /^查 DMIT 静态托管\n/);

  const customExplore = sanitizeStrictToolArguments(grokSubagentSchema, {
    agent: "dmit-static",
    title: "查 DMIT 静态托管",
    cwd: "/Users/haoli/leehow/code/pipiui",
    background: true,
  });
  assert.equal(customExplore.subagent_type, "dmit-static");
  const remappedExplore = remapUnknownSubagentType(customExplore, new Set(["explore", "general-purpose"]));
  assert.equal(remappedExplore.subagent_type, "explore");
  assert.equal(remappedExplore.resume_from, "dmit-static");

  const customPackager = sanitizeStrictToolArguments(grokSubagentSchema, {
    agent: "electron-pkg",
    title: "打包 Electron App",
    cwd: "/Users/haoli/leehow/code/pipiui",
    worktree: "none",
    noWorktreeReason: "Packaging must run in the primary checkout; isolated worktrees cannot create build/PipiUI Electron.app.",
    verify: "stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' 'build/PipiUI Electron.app/Contents/MacOS/PipiUI Electron'",
    background: true,
  });
  assert.equal(customPackager.subagent_type, "electron-pkg");
  assert.equal(customPackager.isolation, "none");
  assert.match(customPackager.prompt, /^打包 Electron App\n/);
  assert.match(customPackager.prompt, /Complete the work implied by this title/);
  const remappedPackager = remapUnknownSubagentType(customPackager, new Set(["explore", "general-purpose"]));
  assert.equal(remappedPackager.subagent_type, "general-purpose");
  assert.equal(remappedPackager.resume_from, "electron-pkg");

  const fullBrief = sanitizeStrictToolArguments(grokSubagentSchema, {
    agent: "pkg-upload",
    task: "Package the current primary-checkout PipiUI Electron app as a signed local App, then zip it for later upload.",
    title: "打包 Electron App",
    worktree: "none",
  });
  assert.equal(fullBrief.subagent_type, "pkg-upload");
  const remappedBrief = remapUnknownSubagentType(fullBrief, new Set(["explore", "general-purpose"]));
  assert.equal(remappedBrief.subagent_type, "general-purpose");
  assert.equal(remappedBrief.resume_from, "pkg-upload");
  assert.equal(fullBrief.prompt.startsWith("Package the current"), true);

  const missingId = sanitizeStrictToolArguments(grokSubagentSchema, {
    subagent_type: "general-purpose",
    prompt: "Package the current primary-checkout PipiUI Electron app as a signed local App.",
    description: "打包 Electron App",
    isolation: "none",
  });
  assert.equal(missingId.resume_from, "electron-app");

  const known = sanitizeStrictToolArguments(grokSubagentSchema, {
    subagent_type: "reviewer",
    prompt: "Review the sanitizer change only.",
    description: "review sanitizer",
  });
  assert.equal(known.subagent_type, "reviewer");
  assert.equal(known.resume_from, undefined);

  const projectAgent = remapUnknownSubagentType(
    { subagent_type: "probe", prompt: "inspect", description: "probe" },
    new Set(["probe", "explore"]),
  );
  assert.equal(projectAgent.subagent_type, "probe");
});

test("sanitizeStrictToolArguments keeps declared values and passes through non-objects", () => {
  const registeredSchema = {
    type: "object",
    properties: { agentId: { type: "string" } },
    required: ["agentId"],
    additionalProperties: false,
  };
  assert.deepEqual(
    sanitizeStrictToolArguments(registeredSchema, { agentId: "agent-1", action: null }),
    { agentId: "agent-1" },
  );
  assert.equal(sanitizeStrictToolArguments(registeredSchema, undefined), undefined);
});

test("makeStrictFunctionTools rewrites Responses and Completions function tools", () => {
  const tools = makeStrictFunctionTools([
    { type: "web_search" },
    {
      type: "function",
      name: "subagent",
      parameters: {
        type: "object",
        properties: { agent: { type: "string" }, agentId: { type: "string" } },
        required: ["agent"],
      },
    },
    {
      type: "function",
      function: {
        name: "read",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, offset: { type: "number" } },
          required: ["path"],
        },
      },
    },
  ]);
  assert.equal(tools[0].type, "web_search");
  assert.deepEqual(tools[1].parameters.required, ["agent", "agentId"]);
  assert.deepEqual(tools[1].parameters.properties.agentId.type, ["string", "null"]);
  assert.deepEqual(tools[2].function.parameters.required, ["path", "offset"]);
  assert.deepEqual(tools[2].function.parameters.properties.offset.type, ["number", "null"]);
});
