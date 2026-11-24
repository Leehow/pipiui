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
  it("routes contributed models through HTTPS openai-responses + OAuth access", async () => {
    const provider = await createAuthProvider({ authPath: "/nonexistent/grok-test-auth.json" });
    expect(provider.oauth.name).toBe(createGrokBuildProvider().oauth.name);
    expect(GROK_BUILD_PROVIDER_ID).toBe("grok-build");
    expect(provider.api).toBe("openai-responses");
    expect(provider.baseUrl).toBe("https://api.x.ai/v1");
    expect(provider.authHeader).toBe(true);
    expect(provider.models.map((model) => model.id)).toEqual([...GROK_BUILD_CONVERSATION_MODEL_IDS]);
    expect(provider.models.find((model) => model.id === "grok-4.6")?.contextWindow).toBe(500000);
    expect(provider.models.every((model) => model.capabilities?.nativeSearch.tools.includes("web_search"))).toBe(true);
    expect(provider.models.every((model) => model.capabilities?.nativeSearch.tools.includes("x_search"))).toBe(true);
    expect(provider.models.every((model) => model.capabilities?.hostedTools.tools.includes("code_interpreter"))).toBe(true);
    expect(provider.models.every((model) => model.capabilities?.structuredOutputs === true)).toBe(true);
    expect(provider.models.every((model) => model.capabilities?.inputFiles === true)).toBe(true);
    expect(conversationProviderTransport()).toEqual({
      api: "openai-responses",
      baseUrl: "https://api.x.ai/v1",
      authHeader: true,
    });

    const catalogModel = provider.models[0];
    const request = buildConversationRequest({
      modelId: catalogModel.id,
      credentials: { access: "at-secret", refresh: "rt-secret" },
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", name: "image_gen" },
        { type: "function", name: "web_search" },
      ],
      capabilities: catalogModel.capabilities,
    });
    expect(request.url).toBe("https://api.x.ai/v1/responses");
    expect(request.headers.authorization).toBe("Bearer at-secret");
    expect(request.body.model).toBe(catalogModel.id);
    expect(request.body.stream).toBe(true);
    expect(request.body.input).toEqual([{ role: "user", content: "hi" }]);
    expect(request.body.tools).toEqual([
      { type: "function", name: "image_gen" },
      { type: "web_search" },
      { type: "x_search" },
      { type: "code_interpreter" },
    ]);
    expect(request.body.include).toEqual(["code_interpreter_call.outputs"]);
    expect(request.body).not.toHaveProperty("text");
    expect(JSON.stringify(request.body)).not.toContain("at-secret");
    expect(JSON.stringify(request.body)).not.toContain("rt-secret");
  });

  it("applies Responses text.format only when structuredOutputs is declared", () => {
    const tools = [{ type: "function", name: "image_gen" }];
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    };
    const request = buildConversationRequest({
      modelId: "grok-4.6",
      credentials: { access: "at-secret" },
      input: [{ role: "user", content: "hi" }],
      tools,
      capabilities: {
        structuredOutputs: true,
        hostedTools: { tools: ["code_interpreter"] },
      },
      structuredOutput: { name: "flag", schema, description: "ok flag" },
    });
    expect(request.body.stream).toBe(true);
    expect(request.body.input).toEqual([{ role: "user", content: "hi" }]);
    expect(request.body.tools).toEqual([
      { type: "function", name: "image_gen" },
      { type: "code_interpreter" },
    ]);
    expect(request.body.include).toEqual(["code_interpreter_call.outputs"]);
    expect(request.body.text).toEqual({
      format: {
        type: "json_schema",
        name: "flag",
        schema,
        strict: true,
        description: "ok flag",
      },
    });
    expect(JSON.stringify(request.body.tools)).not.toContain("flag");
    expect(() =>
      buildConversationRequest({
        modelId: "grok-4.6",
        credentials: { access: "at-secret" },
        messages: [{ role: "user", content: "hi" }],
        structuredOutput: { name: "flag", schema },
      }),
    ).toThrow(/未声明 structuredOutputs/);
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

  it("composes search → code → structured → input files on /responses", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    };
    const userInput = [
      { role: "assistant", content: "prev" },
      {
        role: "user",
        content: [
          { type: "input_text", text: "look" },
          { type: "input_image", image_url: "https://example.com/a.png" },
        ],
      },
    ];
    const withoutFiles = buildConversationRequest({
      modelId: "grok-4.6",
      credentials: { access: "at-secret" },
      input: userInput,
      tools: [{ type: "function", name: "image_gen" }],
      capabilities: {
        nativeSearch: { tools: ["web_search", "x_search"] },
        hostedTools: { tools: ["code_interpreter"] },
        structuredOutputs: true,
        inputFiles: true,
      },
      structuredOutput: { name: "flag", schema },
    });
    expect(withoutFiles.url).toBe("https://api.x.ai/v1/responses");
    expect(withoutFiles.body.input).toBe(userInput);
    expect(withoutFiles.body.input).toEqual(userInput);

    const request = buildConversationRequest({
      modelId: "grok-4.6",
      credentials: { access: "at-secret" },
      input: userInput,
      tools: [{ type: "function", name: "image_gen" }],
      capabilities: {
        nativeSearch: { tools: ["web_search", "x_search"] },
        hostedTools: { tools: ["code_interpreter"] },
        structuredOutputs: true,
        inputFiles: true,
      },
      structuredOutput: { name: "flag", schema },
      inputFiles: [{ type: "input_file", file_id: "file-abc" }],
    });
    expect(request.url).toBe("https://api.x.ai/v1/responses");
    expect(request.body.stream).toBe(true);
    expect(request.body.tools).toEqual([
      { type: "function", name: "image_gen" },
      { type: "web_search" },
      { type: "x_search" },
      { type: "code_interpreter" },
    ]);
    expect(request.body.include).toEqual(["code_interpreter_call.outputs"]);
    expect(request.body.text).toEqual({
      format: { type: "json_schema", name: "flag", schema, strict: true },
    });
    expect(request.body.input).toEqual([
      { role: "assistant", content: "prev" },
      {
        role: "user",
        content: [
          { type: "input_text", text: "look" },
          { type: "input_image", image_url: "https://example.com/a.png" },
          { type: "input_file", file_id: "file-abc" },
        ],
      },
    ]);
    expect(() =>
      buildConversationRequest({
        modelId: "grok-4.6",
        credentials: { access: "at-secret" },
        input: userInput,
        inputFiles: [{ type: "input_file", file_id: "file-abc" }],
      }),
    ).toThrow(/未声明 inputFiles/);
    expect(() =>
      buildConversationRequest({
        modelId: "grok-4.6",
        credentials: { access: "at-secret" },
        input: userInput,
        capabilities: { inputFiles: { upload: true } },
        inputFiles: [{ type: "input_file", file_id: "file-abc" }],
      }),
    ).toThrow(/未声明 inputFiles/);
  });

  it("fails closed: missing catalog capabilities do not inject search, code, files, or text.format", () => {
    const bare = buildConversationRequest({
      modelId: "grok-4.6",
      credentials: { access: "at-secret" },
      input: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", name: "image_gen" }],
    });
    expect(bare.body.tools).toEqual([{ type: "function", name: "image_gen" }]);
    expect(bare.body).not.toHaveProperty("include");
    expect(bare.body).not.toHaveProperty("text");
    expect(JSON.stringify(bare.body.input)).not.toContain("input_file");

    const searchOnly = buildConversationRequest({
      modelId: "grok-4.6",
      credentials: { access: "at-secret" },
      input: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", name: "image_gen" }],
      capabilities: { nativeSearch: { tools: ["web_search"] } },
    });
    expect(searchOnly.body.tools).toEqual([{ type: "function", name: "image_gen" }, { type: "web_search" }]);
    expect(searchOnly.body).not.toHaveProperty("include");
    expect(searchOnly.body).not.toHaveProperty("text");
  });

  it("getApiKey is fail-closed and returns only the access token", () => {
    const provider = createGrokBuildProvider();
    expect(provider.oauth.getApiKey({ access: "at-only", refresh: "rt-secret" })).toBe("at-only");
    expect(() => provider.oauth.getApiKey({ refresh: "rt-secret" })).toThrow(/未登录/);
  });
});
