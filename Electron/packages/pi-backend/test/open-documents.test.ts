import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostBridge } from "../src/bridge.js";
import { createPiHostBackend } from "../src/index.js";
import { LIST_OPEN_DOCUMENTS_TOOL } from "../../../resources/runtime/extensions/pipiui-open-documents.ts";

let root = "";
let backend: ReturnType<typeof createPiHostBackend> | undefined;
let bridge: HostBridge | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await backend?.close();
  backend = undefined;
  await bridge?.close();
  bridge = undefined;
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-open-documents-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  backend = createPiHostBackend({ agentDir });
  return backend;
}

type Tool = {
  name: string;
  description: string;
  execute: () => Promise<any>;
};

async function loadOpenDocumentsTool() {
  vi.resetModules();
  const tools: Tool[] = [];
  const extension = (await import("../../../resources/runtime/extensions/pipiui-open-documents.ts")).default;
  extension({
    on: () => {},
    registerTool: (definition: Tool) => { tools.push(definition); },
  } as never);
  return tools.find((tool) => tool.name === LIST_OPEN_DOCUMENTS_TOOL)!;
}

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("panel open vs composer attach", () => {
  it("records panel-opened paths without creating pending prompt injection", async () => {
    const host = await fixture();
    const path = join(root, "notes.md");
    await writeFile(path, "# Panel body that must not enter the next prompt\n幼儿姓名：测试。\n");
    await host.handle("notifyDocumentsDropped", ["s1", [path]]);
    const injections = (host as unknown as {
      documentInjections: { takePending(sessionId: string): string | undefined };
    }).documentInjections;
    expect(injections.takePending("s1")).toBeUndefined();
    expect(await host.handle("listDocuments", [])).toMatchObject([{ path, name: "notes.md", kind: "markdown" }]);
  });

  it("still injects an explicit composer attachment once", async () => {
    const host = await fixture();
    const path = join(root, "form.docx");
    await writeFile(path, Buffer.alloc(64));
    await host.handle("notifyComposerDocumentsDropped", ["s1", [path]]);
    expect(await host.handle("listDocuments", [])).toEqual([]);
    const injections = (host as unknown as {
      documentInjections: { takePending(sessionId: string): string | undefined };
    }).documentInjections;
    const pending = injections.takePending("s1");
    expect(pending).toContain("[输入框] 用户附上了文档：");
    expect(pending).toContain(path);
    expect(injections.takePending("s1")).toBeUndefined();
  });
});

describe("list_open_documents", () => {
  it("returns only the capability session's metadata, never body or other sessions", async () => {
    const host = await fixture();
    const s1 = join(root, "s1.md");
    const s2 = join(root, "s2.md");
    await writeFile(s1, "# secret-s1-body\n");
    await writeFile(s2, "# secret-s2-body\n");
    await host.handle("notifyDocumentsDropped", ["s1", [s1]]);
    await host.handle("notifyDocumentsDropped", ["s2", [s2]]);
    const globalOnly = join(root, "global.md");
    await writeFile(globalOnly, "# global-only-body\n");
    await host.handle("watchDocument", [globalOnly]);

    const hostBridge = (host as unknown as { bridge: HostBridge }).bridge;
    const port = await hostBridge.listen();
    const cap1 = hostBridge.register("s1");
    const cap2 = hostBridge.register("s2");
    const post = (capability: string) =>
      fetch(`http://127.0.0.1:${port}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          sessionCapability: capability,
          action: "documents_list",
          event: {},
        }),
      });

    const listed1 = await (await post(cap1)).json() as { ok: boolean; result: { documents: Array<Record<string, unknown>> } };
    const listed2 = await (await post(cap2)).json() as { ok: boolean; result: { documents: Array<Record<string, unknown>> } };
    expect(listed1.ok).toBe(true);
    expect(listed1.result.documents).toEqual([
      expect.objectContaining({ name: "s1.md", kind: "markdown", path: s1, size: expect.any(Number) }),
    ]);
    expect(listed2.result.documents).toEqual([
      expect.objectContaining({ name: "s2.md", kind: "markdown", path: s2 }),
    ]);
    expect(JSON.stringify(listed1)).not.toContain("secret-s1-body");
    expect(JSON.stringify(listed1)).not.toContain("s2.md");
    expect(JSON.stringify(listed1)).not.toContain("global.md");
    expect(JSON.stringify(listed2)).not.toContain("secret-s2-body");
    expect(JSON.stringify(listed2)).not.toContain("s1.md");
    expect(JSON.stringify(listed2)).not.toContain("global.md");

    expect((await post("forged")).status).toBe(403);
  });

  it("tool execute uses the minted capability and fails closed without one", async () => {
    bridge = new HostBridge({
      onAgentEvent() {},
      onDocumentsList: async (sessionId) => ({
        documents: sessionId === "sess-a"
          ? [{ name: "notes.md", kind: "markdown", path: "/tmp/notes.md", size: 12 }]
          : [],
      }),
    });
    const port = await bridge.listen();
    const capability = bridge.register("sess-a");
    vi.stubEnv("PIPIUI_BRIDGE_PORT", String(port));
    vi.stubEnv("PIPIUI_SESSION_CAPABILITY", capability);
    const tool = await loadOpenDocumentsTool();
    expect(tool.description).toMatch(/already opened document/i);
    const listed = parse(await tool.execute());
    expect(listed).toEqual({
      ok: true,
      documents: [{ name: "notes.md", kind: "markdown", path: "/tmp/notes.md", size: 12 }],
    });
    expect(JSON.stringify(listed)).not.toMatch(/[\n#]/);

    vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "forged");
    const denied = await loadOpenDocumentsTool();
    const failed = await denied.execute();
    expect(failed.isError).toBe(true);
    expect(parse(failed).ok).toBe(false);
  });
});
