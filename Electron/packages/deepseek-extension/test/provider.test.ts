import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import agent from "../agent/index.js";
import { deepseekManifestModels } from "../agent/models.js";
import { DEEPSEEK_PROVIDER_ID, createDeepSeekProvider } from "../agent/provider.js";

describe("deepseek extension entry", () => {
  it("registers the deepseek provider via the shared factory", () => {
    const providers = new Map<string, unknown>();
    const hooks: Array<{ event: string; handler: (...args: unknown[]) => unknown }> = [];
    const pi = {
      registerProvider: (id: string, config: unknown) => {
        providers.set(id, config);
      },
      on: (event: string, handler: (...args: unknown[]) => unknown) => {
        hooks.push({ event, handler });
      },
    };
    agent(pi as never);
    expect(providers.has(DEEPSEEK_PROVIDER_ID)).toBe(true);
    const registered = providers.get(DEEPSEEK_PROVIDER_ID) as ReturnType<typeof createDeepSeekProvider>;
    expect(registered.name).toBe("DeepSeek");
    expect(registered.api).toBe("openai-responses");
    expect(registered.models.some((model) => model.id === "deepseek-v4-flash-vision-exp")).toBe(true);
    expect(hooks.some((hook) => hook.event === "before_provider_request")).toBe(true);
  });

  it("keeps the manifest catalog aligned with deepseekManifestModels", () => {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipiui-extension.json"), "utf8"),
    ) as { auth: { provider: { api: string; models: Array<{ id: string; api: string; capabilities?: { hostedTools?: { tools?: string[] } } }> } } };
    expect(manifest.auth.provider.api).toBe("openai-responses");
    expect(manifest.auth.provider.models.map((model) => model.id)).toEqual(deepseekManifestModels().map((model) => model.id));
    expect(manifest.auth.provider.models.every((model) => model.api === "openai-responses")).toBe(true);
    expect(manifest.auth.provider.models.every((model) => model.capabilities?.hostedTools?.tools?.includes("web_search"))).toBe(true);
  });

  it("rewrites deepseek requests and ignores other providers", async () => {
    const hooks: Array<{ event: string; handler: (...args: unknown[]) => unknown }> = [];
    agent({
      registerProvider: () => undefined,
      on: (event: string, handler: (...args: unknown[]) => unknown) => {
        hooks.push({ event, handler });
      },
    } as never);
    const hook = hooks.find((item) => item.event === "before_provider_request");
    expect(hook).toBeTruthy();
    const other = await hook!.handler(
      { type: "before_provider_request", payload: { messages: [{ role: "user", content: "x" }], response_format: { type: "json_object" } } },
      { model: { provider: "openai" } },
    );
    expect(other).toBeUndefined();
    const rewritten = await hook!.handler(
      {
        type: "before_provider_request",
        payload: {
          messages: [{ role: "user", content: "x" }],
          response_format: { type: "json_object" },
        },
      },
      { model: { provider: "deepseek" } },
    ) as { messages: Array<{ role: string }> };
    expect(rewritten.messages[0]?.role).toBe("system");
  });
});
