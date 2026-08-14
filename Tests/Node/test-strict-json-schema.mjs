import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const schemaModule = await import(
  pathToFileURL(join(repositoryRoot, "Electron/resources/runtime/pi-ext/subagent/strict-json-schema.ts")).href
);
const { makeStrictJsonSchema, omitNulls, makeStrictFunctionTools } = schemaModule;

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
