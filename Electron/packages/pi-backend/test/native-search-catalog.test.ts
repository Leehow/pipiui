import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import {
  modelHidesGenericWebSearch,
  type Model,
} from "@pipi/host-api";
import type { AuthInteractionLike, AuthRuntimeLike } from "../src/provider-auth.js";

function fakeAuthRuntime(
  catalog: Array<Record<string, unknown>>,
  credentialed: string[],
): AuthRuntimeLike {
  const ids = new Set(credentialed);
  return {
    getProviders: async () => [
      { id: "acme-chat", name: "Acme Chat", auth: { oauth: { loginLabel: "Login Acme" } } },
    ],
    getAvailable: async () => catalog.filter((model) => ids.has(String(model.provider))),
    login: async (providerId, _authType, interaction: AuthInteractionLike) => {
      interaction.notify({ type: "auth_url", url: "https://auth.example.com/start" });
      await interaction.prompt({ type: "manual_code", message: "code" });
      ids.add(providerId);
      return { type: "oauth" };
    },
    logout: async (providerId) => {
      ids.delete(providerId);
    },
  };
}

async function writeExtension(dir: string, body: unknown): Promise<void> {
  const dest = join(dir, "acme");
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, "pipiui-extension.json"), `${JSON.stringify(body, null, 2)}\n`);
}

const acmeManifest = {
  id: "acme",
  name: "Acme",
  version: "1.0.0",
  capabilities: [],
  auth: {
    provider: {
      id: "acme-chat",
      name: "Acme Chat",
      api: "openai-completions",
      oauth: true,
      models: [
        {
          id: "acme-fast",
          name: "Acme Fast",
          api: "openai-completions",
          input: ["text"],
          reasoning: false,
          capabilities: {
            nativeSearch: {
              tools: ["web_search", "x_search"],
              domains: { allow: ["docs.example"] },
            },
          },
        },
        {
          id: "acme-x",
          name: "Acme X",
          api: "openai-completions",
          input: ["text"],
          reasoning: false,
          capabilities: { nativeSearch: ["x_search"] },
        },
        {
          id: "acme-hosted",
          name: "Acme Hosted",
          api: "openai-completions",
          input: ["text"],
          reasoning: false,
          capabilities: {
            hostedTools: { tools: ["web_search", "code_interpreter"] },
            structuredOutputs: true,
            inputFiles: { upload: true },
          },
        },
      ],
    },
  },
};

describe("native-search catalog propagation", () => {
  let root = "";
  let backend: ReturnType<typeof createPiHostBackend> | undefined;

  afterEach(async () => {
    await backend?.close?.();
    backend = undefined;
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function setup(options: {
    credentialed?: string[];
    runtimeModels?: Array<Record<string, unknown>>;
    configured?: boolean;
  } = {}) {
    root = await mkdtemp(join(tmpdir(), "pipi-native-search-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    const credentialed = options.credentialed ?? ["acme-chat"];
    if (credentialed.includes("acme-chat")) {
      await writeFile(
        join(agent, "auth.json"),
        JSON.stringify({
          "acme-chat": { type: "oauth", access: "tok-secret", refresh: "ref-secret", expires: 9_999_999_999 },
        }),
      );
    }
    if (options.configured) {
      await writeFile(
        join(agent, "models.json"),
        JSON.stringify({
          providers: {
            relay: {
              apiKey: "k",
              models: [{
                id: "fast",
                name: "Fast",
                reasoning: true,
                capabilities: { nativeSearch: ["web_search"] },
              }],
            },
          },
        }),
      );
    } else {
      await writeFile(
        join(agent, "models.json"),
        JSON.stringify({ providers: { anthropic: { apiKey: "k", models: [{ id: "a1", name: "A1", reasoning: true }] } } }),
      );
    }
    await writeExtension(join(agent, "extensions"), acmeManifest);
    backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      authRuntime: fakeAuthRuntime(options.runtimeModels ?? [], credentialed),
    });
    return { agent, backend };
  }

  it("preserves declared nativeSearch on contributed models and selected state", async () => {
    const { backend: host } = await setup({ runtimeModels: [] });
    await host.handle("setExtensionEnabled" as never, ["acme", true, "app"]);
    const models = await host.handle("listModels", []) as Model[];
    const fast = models.find((model) => model.provider === "acme-chat" && model.id === "acme-fast");
    const xOnly = models.find((model) => model.provider === "acme-chat" && model.id === "acme-x");
    expect(fast?.capabilities).toEqual({
      nativeSearch: {
        tools: ["web_search", "x_search"],
        domains: { allow: ["docs.example"] },
      },
    });
    expect(xOnly?.capabilities).toEqual({ nativeSearch: { tools: ["x_search"] } });
    const hosted = models.find((model) => model.provider === "acme-chat" && model.id === "acme-hosted");
    expect(hosted?.capabilities).toEqual({
      hostedTools: { tools: ["web_search", "code_interpreter"] },
      structuredOutputs: true,
      inputFiles: { upload: true },
    });
    expect(modelHidesGenericWebSearch(fast)).toBe(true);
    expect(modelHidesGenericWebSearch(xOnly)).toBe(false);
    expect(modelHidesGenericWebSearch(hosted)).toBe(true);

    const selected = await host.handle("setModel", ["acme-chat", "acme-fast"]) as { model: Model };
    expect(selected.model.capabilities).toEqual(fast?.capabilities);
    expect((await host.handle("getModelState", []) as { model: Model }).model.capabilities).toEqual(fast?.capabilities);
  });

  it("merges contribution capabilities onto a runtime catalog row that omitted them", async () => {
    const { backend: host } = await setup({
      runtimeModels: [{
        provider: "acme-chat",
        id: "acme-fast",
        name: "Runtime Fast",
        reasoning: false,
        input: ["text"],
      }],
    });
    await host.handle("setExtensionEnabled" as never, ["acme", true, "app"]);
    const models = await host.handle("listModels", []) as Model[];
    expect(models.find((model) => model.id === "acme-fast")).toMatchObject({
      provider: "acme-chat",
      name: "Runtime Fast",
      capabilities: {
        nativeSearch: {
          tools: ["web_search", "x_search"],
          domains: { allow: ["docs.example"] },
        },
      },
    });
  });

  it("preserves nativeSearch from configured models.json through hostModelFromPi", async () => {
    const { backend: host } = await setup({
      credentialed: [],
      runtimeModels: [],
      configured: true,
    });
    const models = await host.handle("listModels", []) as Model[];
    expect(models.find((model) => model.provider === "relay")).toMatchObject({
      id: "fast",
      capabilities: { nativeSearch: { tools: ["web_search"] } },
    });
  });
});
