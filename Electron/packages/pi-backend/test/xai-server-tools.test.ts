import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const EXTENSION = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/extensions/pipiui-xai-server-tools.ts"),
).href;

type Handler = (event: any, ctx: any) => unknown;

async function loadXaiServerTools() {
  vi.resetModules();
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn(),
  };
  const extension = (await import(EXTENSION)).default;
  extension(pi as never);
  return { handlers };
}

function xaiCompletionsContext() {
  return {
    model: { provider: "xai", api: "openai-completions", id: "grok-4.6", name: "Grok 4.6" },
  };
}

function completionsPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: "grok-4.6",
    messages: [{ role: "user", content: "hello" }],
    tools: [
      { type: "function", function: { name: "bash", parameters: { type: "object" } } },
      { type: "function", function: { name: "web_search", parameters: { type: "object" } } },
    ],
    ...overrides,
  };
}

describe("pipiui-xai-server-tools", () => {
  it("never injects deprecated search_parameters and keeps client web_search on xAI completions", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    expect(beforeRequest).toBeTypeOf("function");

    const payload = completionsPayload({
      search_parameters: { mode: "auto" },
    });
    const result = beforeRequest?.(
      { type: "before_provider_request", payload },
      xaiCompletionsContext(),
    ) as Record<string, unknown> | undefined;

    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("search_parameters");
    expect(JSON.stringify(result)).not.toMatch(/search_parameters/);
    expect(result?.tools).toEqual(payload.tools);
  });

  it("does not advertise retired xAI live search in the system prompt", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeStart = handlers.get("before_agent_start")?.[0];
    const result = beforeStart?.(
      { type: "before_agent_start", systemPrompt: "You are a coding agent." },
      xaiCompletionsContext(),
    );

    expect(result).toBeUndefined();
  });

  it("leaves non-xAI completions payloads untouched", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const payload = completionsPayload();
    const result = beforeRequest?.(
      { type: "before_provider_request", payload },
      { model: { provider: "openai", api: "openai-completions", id: "gpt-4.1" } },
    );

    expect(result).toBeUndefined();
  });

  it("captures xAI rate-limit headers for the quota pill and throttles repeat writes", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pipiui-xai-quota-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      const { handlers } = await loadXaiServerTools();
      const afterResponse = handlers.get("after_provider_response")?.[0];
      expect(afterResponse).toBeTypeOf("function");

      const headers = {
        "x-ratelimit-limit-requests": "8300",
        "x-ratelimit-remaining-requests": "6225",
        "x-ratelimit-limit-tokens": "53000000",
        "x-ratelimit-remaining-tokens": "47700000",
      };
      afterResponse?.({ type: "after_provider_response", status: 200, headers }, xaiCompletionsContext());

      const captured = JSON.parse(readFileSync(join(agentDir, "grok-rate-limits.json"), "utf8"));
      expect(captured).toMatchObject({
        limitRequests: 8300, remainingRequests: 6225,
        limitTokens: 53000000, remainingTokens: 47700000,
      });
      expect(captured.capturedAt).toBeGreaterThan(0);

      // The 30s throttle keeps streaming turns from rewriting identical data.
      const firstWrite = captured.capturedAt;
      afterResponse?.(
        { type: "after_provider_response", status: 200, headers: { "x-ratelimit-limit-requests": "1", "x-ratelimit-remaining-requests": "1" } },
        xaiCompletionsContext(),
      );
      expect(JSON.parse(readFileSync(join(agentDir, "grok-rate-limits.json"), "utf8"))).toEqual(captured);
      expect(firstWrite).toBeGreaterThan(0);

      // Non-xAI providers must not overwrite the captured numbers.
      afterResponse?.(
        { type: "after_provider_response", status: 200, headers: { "x-ratelimit-limit-requests": "9", "x-ratelimit-remaining-requests": "9" } },
        { model: { provider: "openai", api: "openai-completions", id: "gpt-4.1" } },
      );
      expect(JSON.parse(readFileSync(join(agentDir, "grok-rate-limits.json"), "utf8"))).toEqual(captured);
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
