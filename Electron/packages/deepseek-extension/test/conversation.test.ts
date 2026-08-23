import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rewriteDeepSeekPayload } from "../agent/client.js";
import {
  apiKeyFromCredentials,
  buildConversationRequest,
  conversationProviderTransport,
  resolveDeepSeekApiKey,
} from "../agent/conversation.js";
import {
  createAuthProvider,
  createDeepSeekProvider,
  DEEPSEEK_CONVERSATION_MODEL_IDS,
  DEEPSEEK_PROVIDER_ID,
  DEEPSEEK_VISION_MODEL_ID,
} from "../agent/provider.js";
import { JSON_CONSTRAINT_TEXT } from "../agent/json-output.js";

const SETTINGS_ENV = "PIPIUI_EXT_SETTINGS_DEEPSEEK";

describe("deepseek conversation request adapter", () => {
  beforeEach(() => {
    delete process.env[SETTINGS_ENV];
  });
  afterEach(() => {
    delete process.env[SETTINGS_ENV];
  });

  it("routes contributed models through HTTPS openai-responses + stored API key", () => {
    const provider = createAuthProvider();
    expect(createAuthProvider).toBe(createDeepSeekProvider);
    expect(DEEPSEEK_PROVIDER_ID).toBe("deepseek");
    expect(provider.api).toBe("openai-responses");
    expect(provider.baseUrl).toBe("https://api.deepseek.com");
    expect(provider.authHeader).toBe(true);
    expect(provider.apiKey).toBeUndefined();
    expect(provider.models.map((model) => model.id)).toEqual([...DEEPSEEK_CONVERSATION_MODEL_IDS]);
    expect(provider.models[0]?.id).toBe(DEEPSEEK_VISION_MODEL_ID);
    expect(provider.models[0]?.input).toEqual(["text", "image"]);
    expect(provider.models[0]?.contextWindow).toBe(1_000_000);
    expect(provider.models[0]?.maxTokens).toBe(384_000);
    expect(provider.models.every((model) => model.capabilities?.hostedTools.tools.includes("web_search"))).toBe(true);
    expect(conversationProviderTransport()).toEqual({
      api: "openai-responses",
      baseUrl: "https://api.deepseek.com",
      authHeader: true,
    });

    const request = buildConversationRequest({
      modelId: DEEPSEEK_VISION_MODEL_ID,
      credentials: { type: "api_key", key: "sk-secret" },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(request.url).toBe("https://api.deepseek.com/responses");
    expect(request.headers.authorization).toBe("Bearer sk-secret");
    expect(request.body.model).toBe(DEEPSEEK_VISION_MODEL_ID);
    expect(request.body.input).toEqual([{ role: "user", content: "hi" }]);
    expect(JSON.stringify(request.body)).not.toContain("sk-secret");
  });

  it("builds a stateless Responses request and drops previous_response_id", () => {
    const request = buildConversationRequest({
      modelId: "deepseek-v4-flash",
      credentials: { key: "sk-secret" },
      endpoint: "responses",
      input: [{ role: "user", content: "hi" }],
      extra: { previous_response_id: "resp_should_not_leak" },
    });
    expect(request.url).toBe("https://api.deepseek.com/responses");
    expect(request.body.previous_response_id).toBeUndefined();
    expect(request.body.input).toEqual([{ role: "user", content: "hi" }]);
  });

  it("prefers the Pi credential store and falls back to ext.deepseek.apiKey", () => {
    process.env[SETTINGS_ENV] = JSON.stringify({ "ext.deepseek.apiKey": "sk-settings" });
    expect(resolveDeepSeekApiKey({ type: "api_key", key: "sk-stored" })).toBe("sk-stored");
    expect(resolveDeepSeekApiKey({})).toBe("sk-settings");
    expect(resolveDeepSeekApiKey()).toBe("sk-settings");
    expect(createDeepSeekProvider().apiKey).toBe("sk-settings");
    expect(createDeepSeekProvider({ apiKey: "sk-explicit" }).apiKey).toBe("sk-explicit");
  });

  it("honors ext.deepseek.baseUrl", () => {
    process.env[SETTINGS_ENV] = JSON.stringify({ "ext.deepseek.baseUrl": "https://relay.example.com/deepseek" });
    expect(createDeepSeekProvider().baseUrl).toBe("https://relay.example.com/deepseek");
    expect(
      buildConversationRequest({
        modelId: "deepseek-v4-flash",
        credentials: { key: "sk" },
        messages: [],
      }).url,
    ).toBe("https://relay.example.com/deepseek/responses");
  });

  it("fails closed without a key and never echoes secrets", () => {
    expect(() => apiKeyFromCredentials({ refresh: "rt-secret" })).toThrow(/未配置/);
    try {
      apiKeyFromCredentials({ key: "", refresh: "rt-secret" });
      throw new Error("expected fail-closed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("rt-secret");
      expect(message).toMatch(/未配置/);
    }
    expect(() =>
      buildConversationRequest({
        modelId: "deepseek-v4-flash",
        credentials: {},
      }),
    ).toThrow(/未配置/);
  });

  it("applies JSON + image rewrites on a combined payload", () => {
    const payload = rewriteDeepSeekPayload({
      model: DEEPSEEK_VISION_MODEL_ID,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image", data: "abc", mimeType: "image/jpeg" },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });
    expect(payload.response_format).toEqual({ type: "json_object" });
    expect(payload.messages[0]).toEqual({ role: "system", content: JSON_CONSTRAINT_TEXT });
    expect(payload.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,abc" },
    });
  });
});
