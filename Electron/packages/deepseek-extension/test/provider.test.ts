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
    expect([...providers.keys()]).toEqual(["deepseek-extended"]);
    const registered = providers.get(DEEPSEEK_PROVIDER_ID) as ReturnType<typeof createDeepSeekProvider>;
    expect(DEEPSEEK_PROVIDER_ID).toBe("deepseek-extended");
    expect(registered.name).toBe("DeepSeek Extended");
    expect(registered.api).toBe("openai-responses");
    expect(registered.models.map((model) => model.id)).toEqual([
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4-flash",
    ]);
    expect(hooks.some((hook) => hook.event === "before_provider_request")).toBe(true);
  });

  it("registers every provider model with the capability bag that hides generic web_search", () => {
    const providers = new Map<string, unknown>();
    const pi = {
      registerProvider: (id: string, config: unknown) => {
        providers.set(id, config);
      },
      on: () => undefined,
    };
    agent(pi as never);
    const registered = providers.get(DEEPSEEK_PROVIDER_ID) as ReturnType<typeof createDeepSeekProvider>;
    for (const model of registered.models) {
      // DeepSeek's own hosted search stays declared — this exact declaration is
      // what the host reads to keep the generic PipiUI web_search client tool
      // out of these models' tool lists (nativeSearch, or the hostedTools
      // search slice as fallback).
      expect(model.capabilities?.hostedTools?.tools).toEqual(["web_search"]);
      expect(model.capabilities?.nativeSearch?.tools).toEqual(["web_search"]);
      // Sibling capabilities survive untouched.
      expect(model.capabilities?.structuredOutputs).toBe(true);
    }
  });

  it("keeps the manifest catalog aligned with deepseekManifestModels", () => {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipiui-extension.json"), "utf8"),
    ) as { auth: { provider: { id: string; name: string; api: string; models: Array<{ id: string; api: string; capabilities?: { hostedTools?: { tools?: string[] } } }> } } };
    expect(manifest.auth.provider.id).toBe("deepseek-extended");
    expect(manifest.auth.provider.name).toBe("DeepSeek Extended");
    expect(manifest.auth.provider.api).toBe("openai-responses");
    expect(manifest.auth.provider.models.map((model) => model.id)).toEqual(deepseekManifestModels().map((model) => model.id));
    expect(manifest.auth.provider.models.every((model) => model.api === "openai-responses")).toBe(true);
    expect(manifest.auth.provider.models.every((model) => model.capabilities?.hostedTools?.tools?.includes("web_search"))).toBe(true);
  });

  it("declares exactly hosted web_search and nothing else in the manifest capabilities", () => {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipiui-extension.json"), "utf8"),
    ) as {
      auth: {
        provider: {
          models: Array<{
            id: string;
            capabilities?: {
              hostedTools?: { tools?: string[] };
              structuredOutputs?: unknown;
              nativeSearch?: { tools?: string[] };
            };
          }>;
        };
      };
    };
    for (const model of manifest.auth.provider.models) {
      // The bags name only DeepSeek's own hosted web_search — code_interpreter
      // / x_search are phase 2 and must not creep into the manifest.
      expect(model.capabilities?.hostedTools?.tools).toEqual(["web_search"]);
      expect(model.capabilities?.nativeSearch?.tools).toEqual(["web_search"]);
      expect(model.capabilities?.structuredOutputs).toBe(true);
    }
  });

  it("propagates the hide-generic-search capabilities through deepseekManifestModels", () => {
    for (const model of deepseekManifestModels()) {
      expect(model.capabilities.hostedTools.tools).toEqual(["web_search"]);
      expect(model.capabilities.nativeSearch.tools).toEqual(["web_search"]);
      expect(model.capabilities.structuredOutputs).toBe(true);
    }
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
    const official = await hook!.handler(
      { type: "before_provider_request", payload: { messages: [{ role: "user", content: "x" }] } },
      { model: { provider: "deepseek" } },
    );
    expect(official).toBeUndefined();
    const rewritten = await hook!.handler(
      {
        type: "before_provider_request",
        payload: {
          messages: [{ role: "user", content: "x" }],
          response_format: { type: "json_object" },
        },
      },
      { model: { provider: "deepseek-extended" } },
    ) as { messages: Array<{ role: string }> };
    expect(rewritten.messages[0]?.role).toBe("system");
  });
});
