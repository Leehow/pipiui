// @vitest-environment node
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DIRECT_OFFICECLI_TOOL } from "../agent/tool-contract.js";
import officeExtension, { registerOfficeDirectTool } from "../agent/index.js";
import { createDirectOfficeAdapter } from "../agent/adapter.js";
import { OFFICECLI_SKIP_UPDATE_ENV } from "../agent/sdk.js";
import { createFakeOfficeSdk } from "./fake-office-sdk.js";

type Registered = {
  name: string;
  execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<{
    content: Array<{ type: string; text?: string }>;
    details: { code: string; ok: boolean };
  }>;
};

function mockPi() {
  const tools = new Map<string, Registered>();
  return {
    api: { registerTool: (tool: Registered) => tools.set(tool.name, tool) },
    tools,
  };
}

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("pipiui_officecli (direct primary)", () => {
  it("registers the direct primary name only and works with no MCP config", async () => {
    const root = await mkdtemp(join(tmpdir(), "office-direct-"));
    temps.push(root);
    await writeFile(join(root, "a.docx"), "x");
    await writeFile(join(root, "officecli-bin"), "x");
    const sdk = createFakeOfficeSdk();
    const adapter = createDirectOfficeAdapter({
      projectRoot: root,
      locateBinary: () => join(root, "officecli-bin"),
      sdk,
    });
    const pi = mockPi();
    registerOfficeDirectTool(pi.api, adapter);
    expect([...pi.tools.keys()]).toEqual([DIRECT_OFFICECLI_TOOL]);
    expect(DIRECT_OFFICECLI_TOOL).toBe("pipiui_officecli");
    expect(pi.tools.has("officecli")).toBe(false);
    const tool = pi.tools.get(DIRECT_OFFICECLI_TOOL)!;
    delete process.env.MCP_CONFIG;
    delete process.env.PIPIUI_MCP;
    const result = await tool.execute("1", { command: ["view", "a.docx"] });
    expect(result.details.ok).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    expect(JSON.parse(result.content[0]?.text ?? "{}").code).toBe("ok");
  });

  it("sets OFFICECLI_SKIP_UPDATE=1 at extension mount without touching MCP config", () => {
    delete process.env[OFFICECLI_SKIP_UPDATE_ENV];
    const pi = mockPi();
    officeExtension(pi.api as never);
    expect(process.env[OFFICECLI_SKIP_UPDATE_ENV]).toBe("1");
    expect(process.env.MCP_CONFIG).toBeUndefined();
  });
});
