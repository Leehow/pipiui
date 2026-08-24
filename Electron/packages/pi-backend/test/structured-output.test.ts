import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";
import {
  StructuredOutputController,
  loadGrokStructuredOutputNormalize,
  modelDeclaresStructuredOutputs,
  modelUsesResponsesApi,
} from "../src/structured-output.js";
import {
  normalizeStructuredOutputRequest,
  structuredOutputsEnabled,
} from "../../grok-build-oauth-extension/agent/structured-output.js";
import type { Model, StructuredOutputRequest } from "@pipi/host-api";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const schema = {
  type: "object",
  additionalProperties: false,
  properties: { secret_schema_field_xyz: { type: "string" } },
  required: ["secret_schema_field_xyz"],
};

const request: StructuredOutputRequest = { name: "flag", schema, strict: true };

const grok: Model = {
  provider: "grok-build",
  id: "grok-4.6",
  name: "Grok 4.6",
  api: "openai-responses",
  capabilities: { structuredOutputs: true },
};
const claude: Model = { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" };
const completions: Model = {
  provider: "openai",
  id: "gpt-4o",
  name: "GPT-4o",
  api: "openai-completions",
  capabilities: { structuredOutputs: true },
};

async function tempDir(prefix = "pipi-structured-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe("structured output capability gate", () => {
  it("fails closed unless structuredOutputs is explicitly declared", () => {
    expect(modelDeclaresStructuredOutputs(undefined)).toBe(false);
    expect(modelDeclaresStructuredOutputs(claude)).toBe(false);
    expect(modelDeclaresStructuredOutputs({ capabilities: { structuredOutputs: false } })).toBe(false);
    expect(modelDeclaresStructuredOutputs({ capabilities: { structuredOutputs: { jsonSchema: false } } })).toBe(false);
    expect(modelDeclaresStructuredOutputs(grok)).toBe(true);
    expect(modelUsesResponsesApi(completions)).toBe(false);
    expect(modelUsesResponsesApi(grok)).toBe(true);
  });
});

describe("structured output host controller", () => {
  it("validates immediately, stays in memory, and is one-shot per session", () => {
    let model: Model = grok;
    const ctl = new StructuredOutputController(
      normalizeStructuredOutputRequest,
      () => model,
      structuredOutputsEnabled,
    );
    expect(ctl.set("s1", request)).toMatchObject({ name: "flag", strict: true });
    expect(ctl.peek("s1")?.schema).toEqual(schema);
    expect(ctl.take("s1")?.name).toBe("flag");
    expect(ctl.take("s1")).toBeUndefined();

    ctl.set("s1", request);
    ctl.set("s2", { ...request, name: "other" });
    ctl.set("s1", null);
    expect(ctl.peek("s1")).toBeUndefined();
    expect(ctl.peek("s2")?.name).toBe("other");

    model = claude;
    expect(() => ctl.set("s1", request)).toThrow(/未声明 structuredOutputs/);
    model = grok;
    ctl.set("s1", request);
    model = completions;
    expect(() => ctl.assertReadyToSend("s1")).toThrow(/Responses/);
    expect(ctl.peek("s1")).toBeUndefined();
  });

  it("rejects malformed requests via the shared normalize, not a copied validator", () => {
    const ctl = new StructuredOutputController(
      normalizeStructuredOutputRequest,
      () => grok,
      structuredOutputsEnabled,
    );
    expect(() => ctl.set("s1", { name: "  ", schema })).toThrow(/名称不能为空/);
    const cyclic: Record<string, unknown> = { type: "object" };
    cyclic.self = cyclic;
    expect(() => ctl.set("s1", { name: "out", schema: cyclic })).toThrow(/循环引用/);
  });
});

describe("structured output backend handler routing", () => {
  async function backendWithSession() {
    const root = await tempDir("pipi-structured-be-");
    const project = join(root, "project");
    const sessions = join(root, "sessions");
    const sessionPath = join(sessions, encodeURIComponent(project), "s1.jsonl");
    await mkdir(project, { recursive: true });
    await mkdir(join(sessions, encodeURIComponent(project)), { recursive: true });
    await writeFile(
      sessionPath,
      `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-23T00:00:00.000Z", cwd: project })}\n`,
    );
    const backend = createPiHostBackend({
      agentDir: join(root, "app-profile-agent"),
      sessionsRoot: sessions,
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      structuredOutputNormalize: normalizeStructuredOutputRequest,
      structuredOutputsEnabled,
    });
    (backend as unknown as { modelState: { model: Model; thinkingLevel: string; availableThinkingLevels: string[] } }).modelState = {
      model: grok,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    };
    return { backend, root, project, sessions, sessionPath };
  }

  it("sets/clears via Host API and never writes schema into the session jsonl", async () => {
    const { backend, sessionPath } = await backendWithSession();
    const before = await readFile(sessionPath, "utf8");
    await backend.handle("setStructuredOutput", ["s1", request]);
    const after = await readFile(sessionPath, "utf8");
    expect(after).toBe(before);
    expect(after).not.toContain("secret_schema_field_xyz");
    await backend.handle("setStructuredOutput", ["s1", null]);
    expect(await readFile(sessionPath, "utf8")).toBe(before);
    await backend.close();
  });

  it("blocks sendPrompt on an unsupported model so no prompt RPC happens", async () => {
    const { backend } = await backendWithSession();
    await backend.handle("setStructuredOutput", ["s1", request]);
    const state = { model: claude, thinkingLevel: "off" as const, availableThinkingLevels: [] as string[] };
    const boxed = backend as unknown as {
      modelState: typeof state;
      sessionModelStates: Map<string, typeof state>;
      sessionModelSnapshots: Map<string, typeof state>;
    };
    boxed.modelState = state;
    boxed.sessionModelStates.set("s1", state);
    boxed.sessionModelSnapshots.set("s1", state);
    let commanded = 0;
    (backend as unknown as { command: (id: string, body: unknown) => Promise<void> }).command = async () => {
      commanded += 1;
    };
    await expect(backend.handle("sendPrompt", ["s1", "hi"])).rejects.toThrow(/未声明 structuredOutputs/);
    expect(commanded).toBe(0);
    await backend.close();
  });

  it("fails closed when the grok host module is missing", async () => {
    const root = await tempDir("pipi-structured-missing-");
    const project = join(root, "project");
    await mkdir(join(root, "sessions", encodeURIComponent(project)), { recursive: true });
    await writeFile(
      join(root, "sessions", encodeURIComponent(project), "s1.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-23T00:00:00.000Z", cwd: project })}\n`,
    );
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
    });
    (backend as unknown as { modelState: { model: Model; thinkingLevel: string; availableThinkingLevels: string[] } }).modelState = {
      model: grok,
      thinkingLevel: "off",
      availableThinkingLevels: [],
    };
    await expect(backend.handle("setStructuredOutput", ["s1", request])).rejects.toThrow(/未启用 Structured Outputs/);
    await backend.close();
  });

  it("Host API set then bridge take consumes one-shot for that session only", async () => {
    const { backend } = await backendWithSession();
    await backend.handle("setStructuredOutput", ["s1", request]);
    const boxed = backend as unknown as {
      bridge: { listen(): Promise<number>; register(id: string): string };
    };
    const port = await boxed.bridge.listen();
    const capability = boxed.bridge.register("s1");
    const other = boxed.bridge.register("s-other");
    const take = (cap: string) => fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        sessionCapability: cap,
        action: "structured_output",
        event: { op: "take" },
      }),
    });
    const first = await (await take(capability)).json() as { ok: boolean; result?: { name?: string } };
    expect(first).toMatchObject({ ok: true, result: { name: "flag", strict: true } });
    expect(JSON.stringify(first)).toContain("secret_schema_field_xyz");
    const second = await (await take(capability)).json() as { result: unknown };
    expect(second.result).toBeNull();
    await backend.handle("setStructuredOutput", ["s1", request]);
    const isolated = await (await take(other)).json() as { result: unknown };
    expect(isolated.result).toBeNull();
    await backend.close();
  });

  it("loads normalizeStructuredOutputRequest from the bundled host entry", async () => {
    const runtime = await tempDir("pipi-structured-host-");
    const hostDir = join(runtime, "extensions/grok-build-oauth/agent/dist");
    await mkdir(hostDir, { recursive: true });
    await writeFile(join(hostDir, "host.js"), `
export function normalizeStructuredOutputRequest(request) {
  if (!request || typeof request.name !== "string" || !request.name.trim()) throw new Error("structured output 名称不能为空");
  return { name: request.name.trim(), schema: request.schema, strict: request.strict ?? true };
}
export function structuredOutputsEnabled(capabilities) {
  return capabilities?.structuredOutputs === true;
}
`);
    const loaded = await loadGrokStructuredOutputNormalize(runtime);
    expect(loaded?.normalize({ name: "flag", schema: { type: "object" } })).toMatchObject({ name: "flag", strict: true });
    expect(loaded?.enabled({ structuredOutputs: true })).toBe(true);
  });
});
