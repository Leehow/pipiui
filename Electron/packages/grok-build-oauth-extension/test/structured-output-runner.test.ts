/**
 * Real ExtensionRunner + Grok structured hook + provider-call gate.
 * Proves take/normalize/apply failures never reach the provider HTTP call.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import { installFatalHookPropagation } from "../../../resources/runtime/pi-ext/subagent/fatal-hook.ts";
import {
  createStructuredOutputHooks,
  takeStructuredOutputViaBridge,
} from "../agent/structured-output-hooks.js";
import { isPipiUIFatalHookError } from "../agent/structured-output.js";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: { secret_schema_field_xyz: { type: "string" } },
  required: ["secret_schema_field_xyz"],
};

const LEAK = /secret_schema_field_xyz|sk-live|file-abc|\/Users\/haoli|Bearer /;

type Handler = (event: unknown, ctx: unknown) => unknown;

function extension(path: string, handler: Handler) {
  return {
    path,
    handlers: new Map<string, Handler[]>([["before_provider_request", [handler]]]),
    flags: new Map(),
    shortcuts: new Map(),
  };
}

function grokModel() {
  return {
    provider: "grok-build",
    id: "grok-4.6",
    api: "openai-responses",
    capabilities: { structuredOutputs: true },
  };
}

function createRunner(handlers: Array<{ path: string; handler: Handler }>) {
  const runner = new ExtensionRunner(
    handlers.map((item) => extension(item.path, item.handler)),
    {} as never,
    process.cwd(),
    { getSessionId: () => "sess-a" } as never,
    {} as never,
  );
  (runner as unknown as { getModel: () => unknown }).getModel = grokModel;
  return runner;
}

async function sendTurn(runner: ExtensionRunner, payload: Record<string, unknown>) {
  let providerCalls = 0;
  let sent: unknown;
  try {
    const next = await runner.emitBeforeProviderRequest(payload);
    providerCalls += 1;
    sent = next;
    return { providerCalls, payload: sent };
  } catch (error) {
    return { providerCalls, error };
  }
}

const incoming = () => ({
  model: "grok-4.6",
  stream: true,
  input: [{ role: "user", content: "summarize" }],
  tools: [{ type: "web_search" }],
});

installFatalHookPropagation(ExtensionRunner);

describe("structured output runner fail-closed", () => {
  const envKeys = ["PIPIUI_BRIDGE_PORT", "PIPIUI_SESSION_CAPABILITY"];
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.PIPIUI_BRIDGE_PORT = "9";
    process.env.PIPIUI_SESSION_CAPABILITY = "cap-sess-a";
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("bridge take reject does not call the provider", async () => {
    const hooks = createStructuredOutputHooks({
      takeRequest: () => takeStructuredOutputViaBridge(async () => new Response(JSON.stringify({
        ok: false,
        error: "ECONNREFUSED /Users/haoli/secret.json Bearer sk-live file-abc secret_schema_field_xyz",
      }), { status: 200 })),
    });
    const runner = createRunner([{ path: "grok-structured", handler: hooks.beforeProviderRequest }]);
    const result = await sendTurn(runner, incoming());
    expect(result.providerCalls).toBe(0);
    expect(isPipiUIFatalHookError(result.error)).toBe(true);
    expect(String((result.error as Error).message)).toMatch(/无法读取 Structured Output/);
    expect(String((result.error as Error).message)).not.toMatch(LEAK);
  });

  it("invalid bridge response does not call the provider", async () => {
    const hooks = createStructuredOutputHooks({
      takeRequest: () => takeStructuredOutputViaBridge(async () => new Response("not-json", { status: 500 })),
    });
    const runner = createRunner([{ path: "grok-structured", handler: hooks.beforeProviderRequest }]);
    const result = await sendTurn(runner, incoming());
    expect(result.providerCalls).toBe(0);
    expect(isPipiUIFatalHookError(result.error)).toBe(true);
    expect(String((result.error as Error).message)).toMatch(/无法读取 Structured Output/);
  });

  it("normalize fail does not call the provider", async () => {
    const hooks = createStructuredOutputHooks({
      takeRequest: () => takeStructuredOutputViaBridge(async () => new Response(JSON.stringify({
        ok: true,
        result: { name: "  ", schema },
      }), { status: 200 })),
    });
    const runner = createRunner([{ path: "grok-structured", handler: hooks.beforeProviderRequest }]);
    const result = await sendTurn(runner, incoming());
    expect(result.providerCalls).toBe(0);
    expect(isPipiUIFatalHookError(result.error)).toBe(true);
    expect(String((result.error as Error).message)).toMatch(/名称不能为空/);
    expect(String((result.error as Error).message)).not.toMatch(LEAK);
  });

  it("ordinary hook throw is still swallowed and the provider is called", async () => {
    const hooks = createStructuredOutputHooks({
      takeRequest: async () => undefined,
    });
    const runner = createRunner([
      {
        path: "third-party",
        handler: () => {
          throw new Error("third-party boom /Users/haoli/secret.json");
        },
      },
      { path: "grok-structured", handler: hooks.beforeProviderRequest },
    ]);
    const payload = incoming();
    const result = await sendTurn(runner, payload);
    expect(result.providerCalls).toBe(1);
    expect(result.payload).toEqual(payload);
    expect(result.payload).not.toHaveProperty("text");
  });

  it("successful structured request still injects text.format before the provider call", async () => {
    const hooks = createStructuredOutputHooks({
      takeRequest: () => takeStructuredOutputViaBridge(async () => new Response(JSON.stringify({
        ok: true,
        result: { name: "flag", schema, strict: true },
      }), { status: 200 })),
    });
    const runner = createRunner([{ path: "grok-structured", handler: hooks.beforeProviderRequest }]);
    const result = await sendTurn(runner, incoming());
    expect(result.providerCalls).toBe(1);
    expect(result.payload).toMatchObject({
      tools: [{ type: "web_search" }],
      text: { format: { type: "json_schema", name: "flag", schema, strict: true } },
    });
  });
});
