import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const schemaModule = await import(
  pathToFileURL(join(repositoryRoot, "Electron/resources/runtime/pi-ext/subagent/strict-json-schema.ts")).href
);
const { makeStrictJsonSchema, omitNulls, makeStrictFunctionTools, prepareStrictToolArguments, sanitizeStrictToolArguments } = schemaModule;

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
    background: true,
  });
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
