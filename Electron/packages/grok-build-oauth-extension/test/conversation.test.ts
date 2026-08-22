import { describe, expect, it } from "vitest";
import {
  accessTokenFromCredentials,
  buildConversationRequest,
  conversationProviderTransport,
} from "../agent/conversation.js";
import {
  createAuthProvider,
  createGrokBuildProvider,
  GROK_BUILD_CONVERSATION_MODEL_IDS,
  GROK_BUILD_PROVIDER_ID,
} from "../agent/provider.js";

describe("grok-build conversation request adapter", () => {
  it("routes contributed models through HTTPS openai-completions + OAuth access", () => {
    const provider = createAuthProvider();
    expect(createAuthProvider).toBe(createGrokBuildProvider);
    expect(GROK_BUILD_PROVIDER_ID).toBe("grok-build");
    expect(provider.api).toBe("openai-completions");
    expect(provider.baseUrl).toBe("https://api.x.ai/v1");
    expect(provider.authHeader).toBe(true);
    expect(provider.models.map((model) => model.id)).toEqual([...GROK_BUILD_CONVERSATION_MODEL_IDS]);
    expect(conversationProviderTransport()).toEqual({
      api: "openai-completions",
      baseUrl: "https://api.x.ai/v1",
      authHeader: true,
    });

    const request = buildConversationRequest({
      modelId: "grok-4.6",
      credentials: { access: "at-secret", refresh: "rt-secret" },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(request.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer at-secret");
    expect(request.body.model).toBe("grok-4.6");
    expect(JSON.stringify(request.body)).not.toContain("at-secret");
    expect(JSON.stringify(request.body)).not.toContain("rt-secret");
  });

  it("fails closed without an access token and never echoes secrets", () => {
    expect(() => accessTokenFromCredentials({ refresh: "rt-secret" })).toThrow(/未登录/);
    expect(() => accessTokenFromCredentials({})).toThrow(/未登录/);
    try {
      accessTokenFromCredentials({ access: "", refresh: "rt-secret" });
      throw new Error("expected fail-closed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("rt-secret");
      expect(message).not.toContain("at-");
    }
    expect(() =>
      buildConversationRequest({
        modelId: "grok-4.6",
        credentials: { refresh: "rt-secret" },
      }),
    ).toThrow(/未登录/);
    expect(() =>
      buildConversationRequest({
        modelId: "grok-4.6",
        credentials: { access: "at-secret" },
        baseUrl: "http://127.0.0.1/v1",
      }),
    ).toThrow(/HTTPS/);
  });

  it("getApiKey is fail-closed and returns only the access token", () => {
    const provider = createGrokBuildProvider();
    expect(provider.oauth.getApiKey({ access: "at-only", refresh: "rt-secret" })).toBe("at-only");
    expect(() => provider.oauth.getApiKey({ refresh: "rt-secret" })).toThrow(/未登录/);
  });
});
