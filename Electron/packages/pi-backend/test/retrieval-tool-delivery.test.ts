import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import installRetrieval from "../../../resources/runtime/extensions/code-retrieval/agent/index.ts";
import { discoverBundledAgentsFromDirectory } from "../../../resources/runtime/pi-ext/subagent/agents.ts";
import { resolveSubagentToolSelection } from "../../../resources/runtime/pi-ext/subagent/desktop-tool-policy.mjs";
import { workerRegisteredExtensionArgs } from "../src/spawn-assembly.js";

type Registered = Parameters<Parameters<typeof installRetrieval>[0]["registerTool"]>[0];
function registeredTools() {
  const tools = new Map<string, Registered>();
  // Load the actual extension factory, not a copied schema. No session_start means
  // no filesystem scan, sidecar, API request, or access to project credentials.
  installRetrieval({ registerTool: tool => { tools.set(tool.name, tool); }, registerCommand() {}, on() {} });
  return tools;
}
const agents = discoverBundledAgentsFromDirectory(fileURLToPath(new URL("../../../resources/runtime/pi-ext/agents", import.meta.url))).agents;
function selection(role: string, disabledTools: string[] = []) {
  const agent = agents.find(agent => agent.name === role);
  expect(agent, role).toBeDefined();
  return resolveSubagentToolSelection({ declaredTools: agent!.tools, disabledTools, allowRecursiveDelegation: false, availableExtensionTools: [] });
}

describe("retrieval registration and worker delivery contracts", () => {
  it("registers deep as an optional property and supplies before-call routing guidance", () => {
    const tools = registeredTools();
    expect([...tools.keys()].sort()).toEqual(["code_nav", "code_search", "read_spans", "repo_map"]);
    const search = tools.get("code_search")!;
    const schema = search.parameters as { properties: Record<string, { type?: string }>; required: string[]; additionalProperties: boolean };
    expect(schema.properties.deep.type).toBe("boolean");
    expect(schema.required).toEqual(["query"]);
    expect(schema.additionalProperties).toBe(false);
    expect(search.promptSnippet).toMatch(/locating code by description/i);
    expect(search.promptGuidelines?.join("\n")).toMatch(/deep:true/);
    expect(search.promptGuidelines?.join("\n")).toMatch(/read_spans/);
    expect(search.promptGuidelines?.join("\n")).toMatch(/not proof.*complete or absent/i);
  });

  for (const role of ["explore", "general-purpose", "reviewer"]) {
    it(`${role} permits the registered schema and companion retrieval tools`, () => {
      const selected = selection(role);
      expect(selected.flag).toBe("--tools");
      const definitions = registeredTools();
      for (const name of definitions.keys()) expect(selected.names).toContain(name);
      // Selection is by name; the same registered definition (schema and guidance)
      // remains the one the worker extension supplies. This is not an LLM usage test.
      const available = [...definitions.values()].filter(tool => selected.names.includes(tool.name));
      const search = available.find(tool => tool.name === "code_search")!;
      expect((search.parameters.properties as Record<string, unknown>).deep).toBeDefined();
      expect(search.promptGuidelines?.some(line => line.includes("deep:true"))).toBe(true);
      expect(selected.names).toContain("grep");
      expect(selected.names).toContain("read");
    });
  }

  it("does not bypass an explicitly disabled search tool", () => {
    expect(selection("explore", ["code_search"]).names).not.toContain("code_search");
  });

  it("remounts the supplied retrieval entry without rewriting its tool definitions", () => {
    const entry = fileURLToPath(new URL("../../../resources/runtime/extensions/code-retrieval/agent/index.ts", import.meta.url));
    expect(workerRegisteredExtensionArgs({ PIPIUI_EXT_REGISTERED_PATHS: entry })).toEqual(["-e", entry]);
    expect(workerRegisteredExtensionArgs({})).toEqual([]);
  });
});
