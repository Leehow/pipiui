import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createExtensionLoader } from "../src/extension-loader.js";
import { createExtensionRegistry } from "../src/extension-registry.js";
import { assemblePiSpawn } from "../src/spawn-assembly.js";

/**
 * web-access-extension migration contract.
 *
 * The extension package `resources/runtime/extensions/web-access-extension`
 * owns the mounting of the four frozen Web Access tools; the implementation is
 * the version-pinned `pi-web-access` package wrapped by the extension's agent
 * half. These tests pin, in order: the schema snapshot, deterministic result
 * formatting, the registration path (manifest → loader → spawn `-e`), and
 * behavioral equivalence of all four tools when mounted through the extension
 * versus the pinned package.
 */

const extensionDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../resources/runtime/extensions/web-access-extension",
);

const FROZEN_TOOLS = ["web_search", "fetch_content", "source_check", "get_search_content"] as const;

type CapturedTool = {
  name: string;
  label?: string;
  description?: string;
  promptSnippet?: string;
  parameters?: unknown;
  execute?: (callId: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown) => Promise<unknown>;
};

type ToolResult = { content: Array<{ type: string; text?: string }>; details?: unknown };

const resultText = (result: ToolResult) => result.content.map((chunk) => chunk.text ?? "").join("\n");

/** Minimal ExtensionAPI capture harness: records mounts, no-ops session side effects. */
function capturePi() {
  const tools: CapturedTool[] = [];
  const commands: string[] = [];
  const shortcuts: string[] = [];
  const pi = {
    registerTool: (tool: CapturedTool) => { tools.push(tool); },
    registerCommand: (name: string) => { commands.push(name); },
    registerShortcut: (key: unknown) => { shortcuts.push(String(key)); },
    appendEntry: () => {},
    sendMessage: () => {},
    on: () => ({ unsubscribe() {} }),
    exec: async () => { throw new Error("pi.exec is not expected in web-access extension tests"); },
  };
  return { pi, tools, commands, shortcuts };
}

let agentDir = "";
let previousAgentDir: string | undefined;
let webAccessPackage: { default: (pi: object) => void };
let extensionEntry: { default: (pi: object) => void };

beforeAll(async () => {
  // pi-web-access reads its config from PI_CODING_AGENT_DIR at module load;
  // point it at an empty temp home so tests never touch a real ~/.pi and see
  // default tool names/enablement.
  agentDir = mkdtempSync(join(tmpdir(), "web-access-ext-test-"));
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  webAccessPackage = await import("pi-web-access");
  extensionEntry = await import(pathToFileURL(join(extensionDir, "agent", "index.ts")).href);
});

afterAll(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (agentDir) rmSync(agentDir, { recursive: true, force: true });
});

/** Mount the four tools both ways: pinned package directly, and via the extension agent half. */
function mountBothWays() {
  const viaPackage = capturePi();
  webAccessPackage.default(viaPackage.pi);
  const viaExtension = capturePi();
  extensionEntry.default(viaExtension.pi);
  const byName = (tools: CapturedTool[]) => new Map(tools.map((tool) => [tool.name, tool]));
  return { viaPackage, viaExtension, packageByName: byName(viaPackage.tools), extensionByName: byName(viaExtension.tools) };
}

describe("web-access-extension schema snapshot", () => {
  it("mounts exactly the four frozen tools plus claimed arxiv_fetch through the extension agent half", () => {
    const { viaExtension, extensionByName } = mountBothWays();
    expect(viaExtension.tools.map((tool) => tool.name).sort()).toEqual([...FROZEN_TOOLS, "arxiv_fetch"].sort());
    for (const name of FROZEN_TOOLS) {
      expect(extensionByName.get(name), `tool ${name} mounted`).toBeDefined();
    }
    // Claimed from the bare pi-ext/packages/arxiv-fetch mount (no package twin to snapshot).
    expect(extensionByName.get("arxiv_fetch"), "claimed arxiv_fetch mounted").toBeDefined();
  });

  it("extension-mounted schemas are identical to the pinned package and snapshotted", () => {
    const { viaPackage, extensionByName } = mountBothWays();
    for (const name of FROZEN_TOOLS) {
      const tool = extensionByName.get(name)!;
      const twin = viaPackage.tools.find((item) => item.name === name);
      expect(twin, `package twin for ${name}`).toBeDefined();
      expect(tool.parameters).toEqual(twin!.parameters);
      expect(tool.label).toBe(twin!.label);
      expect(tool.description).toBe(twin!.description);
      expect(tool.promptSnippet).toBe(twin!.promptSnippet);
      expect(JSON.parse(JSON.stringify(tool.parameters))).toMatchSnapshot(`${name} schema`);
    }
  });
});

describe("web-access-extension result formatting", () => {
  it("web_search renders the deterministic no-query error", async () => {
    const { extensionByName } = mountBothWays();
    const result = (await extensionByName.get("web_search")!.execute!("probe", {})) as ToolResult;
    expect(resultText(result)).toBe("Error: No query provided. Use 'query' or 'queries' parameter.");
    expect(result.details).toEqual({ error: "No query provided" });
  });

  it("get_search_content renders the stored-content-sources guidance with frozen tool names", async () => {
    const { extensionByName } = mountBothWays();
    const result = (await extensionByName.get("get_search_content")!.execute!("probe", {
      responseId: "probe-missing-response-id",
    })) as ToolResult;
    expect(resultText(result)).toBe(
      'Error: No stored results for responseId "probe-missing-response-id". Use a responseId returned by web_search, source_check, or fetch_content.',
    );
    expect(result.details).toEqual({ error: "Not found", responseId: "probe-missing-response-id" });
  });

  // pi-web-access 0.25.0 dropped the "findText cannot be combined with offset or
  // limit" rejection so bridge-supplied pagination defaults stop breaking a
  // findText lookup. The combination now falls through to the ordinary
  // stored-results lookup; this pins that the wrapper does not reintroduce the
  // old rejection.
  it("get_search_content tolerates findText alongside pagination defaults", async () => {
    const { extensionByName } = mountBothWays();
    const result = (await extensionByName.get("get_search_content")!.execute!("probe", {
      responseId: "probe",
      findText: "x",
      offset: 1,
    })) as ToolResult;
    expect(resultText(result)).toBe(
      'Error: No stored results for responseId "probe". Use a responseId returned by web_search, source_check, or fetch_content.',
    );
    expect(result.details).toEqual({ error: "Not found", responseId: "probe" });
  });
});

describe("web-access-extension registration path", () => {
  it("manifest pins the frozen core-capability contract and declares the agent half", () => {
    const manifest = JSON.parse(readFileSync(join(extensionDir, "pipiui-extension.json"), "utf8"));
    expect(manifest.id).toBe("web-access-extension");
    expect(manifest.name).toBe("PipiUI Web Access");
    expect(manifest.agent).toEqual({ extension: "agent/index.ts" });
    expect(manifest.hostApi).toBe(">=1.0.0 <2.0.0");
    expect(manifest.permissions).toEqual(["net.request"]);
    expect(manifest.update).toEqual({ channel: "stable", signature: "ed25519" });
    expect(existsSync(join(extensionDir, manifest.agent.extension))).toBe(true);
  });

  it("builtin discovery loads the package and mounts the agent half into a session spawn (-e)", () => {
    const root = mkdtempSync(join(tmpdir(), "web-access-ext-load-"));
    try {
      const builtinRoot = join(root, "extensions");
      cpSync(extensionDir, join(builtinRoot, "web-access-extension"), { recursive: true });
      const registry = createExtensionRegistry([]);
      const loader = createExtensionLoader({ registry, builtinRoot, appRoot: join(root, "app-extensions") });
      loader.scan();
      expect(registry.get("web-access-extension")?.state).toBe("enabled");
      const mounted = loader.spawnPackages().find((pkg) => pkg.id === "web-access-extension");
      expect(mounted?.enabled).toBe(true);
      const expectedEntry = join(realpathSync(builtinRoot), "web-access-extension", "agent", "index.ts");
      expect(mounted?.extensionPath).toBe(expectedEntry);
      const output = assemblePiSpawn({ cwd: root, paths: {}, registeredExtensions: loader.spawnPackages() });
      expect(output.args).toContain("-e");
      expect(output.args).toContain(expectedEntry);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("web-access-extension four-tool behavioral equivalence", () => {
  const cases: Array<{ name: (typeof FROZEN_TOOLS)[number]; params: Record<string, unknown> }> = [
    { name: "web_search", params: {} },
    { name: "web_search", params: { query: "  " } },
    { name: "fetch_content", params: {} },
    { name: "fetch_content", params: { url: "https://example.com", mode: "answer" } },
    { name: "source_check", params: {} },
    // A source_check call with a claim would run a real (keyless DuckDuckGo) search;
    // only validation-level paths are exercised so tests stay offline and deterministic.
    { name: "fetch_content", params: { url: "https://example.com", mode: "raw", forceClone: true } },
    { name: "get_search_content", params: { responseId: "probe-missing-response-id" } },
    { name: "get_search_content", params: { responseId: "probe", findText: "x", offset: 1 } },
    { name: "get_search_content", params: { responseId: "probe", findMode: "fuzzy" } },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} ${JSON.stringify(testCase.params)} matches the pinned package`, async () => {
      const { packageByName, extensionByName } = mountBothWays();
      const run = async (tool: CapturedTool | undefined) => {
        expect(tool, `${tool?.name ?? testCase.name} mounted`).toBeDefined();
        return await tool!.execute!("probe", testCase.params) as ToolResult;
      };
      const viaExtension = await run(extensionByName.get(testCase.name));
      const viaPackage = await run(packageByName.get(testCase.name));
      expect(viaExtension).toEqual(viaPackage);
      expect(typeof resultText(viaExtension)).toBe("string");
      expect(resultText(viaExtension).length).toBeGreaterThan(0);
    });
  }

  it("extension mount surfaces the same command and shortcut set as the package", () => {
    const { viaPackage, viaExtension } = mountBothWays();
    expect(viaExtension.commands.sort()).toEqual(viaPackage.commands.sort());
    expect(viaExtension.shortcuts.sort()).toEqual(viaPackage.shortcuts.sort());
  });
});
