import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeContext, type Model, type Tool } from "@earendil-works/pi-ai";
import { streamQoder } from "../agent/vendor/stream.js";

vi.mock("../agent/vendor/cosy.js", () => ({
  buildAuthHeaders: () => ({}), getMachineId: () => "test-machine",
  getQoderChatURL: () => "https://qoder.invalid/chat", getQoderMode: () => "global",
  getQoderCNDirectModel: (id: string) => id, getQoderUserEmailFallback: () => "",
  isQoderCNMode: () => false,
}));
vi.mock("../agent/vendor/models.js", () => ({ getCachedModelConfig: () => undefined }));
vi.mock("../agent/vendor/oauth.js", () => ({ getCachedCredentials: () => undefined }));
// Keep the actual request assembly; expose the body before transport encoding.
vi.mock("../agent/vendor/qoder-encoding.js", () => ({
  qoderEncodeBody: (body: Buffer) => body.toString("utf8"),
}));

afterEach(() => vi.unstubAllGlobals());

const model = { id: "auto", provider: "qoder", api: "qoder-api" } as Model<any>;
const tool = (name: string): Tool => ({ name, description: name, parameters: { type: "object", properties: {} } as Tool["parameters"] });

describe("Qoder requests with Pi transcript contexts", () => {
  it("sends the leading prompt and tool declarations from a normalized context", async () => {
    const fetch = vi.fn(async () => new Response("data: [DONE]\n\n"));
    vi.stubGlobal("fetch", fetch);
    const context = normalizeContext({ systemPrompt: "Follow project rules.", tools: [tool("read")],
      messages: [{ role: "user", content: "inspect the file", timestamp: 1 }] });
    expect(context).not.toHaveProperty("systemPrompt");
    expect(context).not.toHaveProperty("tools");
    const result = await streamQoder(model, context, { apiKey: "test-only", sessionId: "test-session" }).result();
    expect(result.stopReason).toBe("stop");
    const body = JSON.parse(Buffer.from((fetch.mock.calls[0] as any)[1].body).toString());
    expect(body.messages).toEqual([
      { role: "system", content: "Follow project rules." },
      { role: "user", content: "inspect the file" },
    ]);
    expect(body.tools.map((t: any) => t.function.name)).toEqual(["read"]);
  });

  it.each([true, false])("replays later prompt sections and tool removals (add replacement: %s)", async (addReplacement) => {
    const fetch = vi.fn(async () => new Response("data: [DONE]\n\n"));
    vi.stubGlobal("fetch", fetch);
    const context = normalizeContext({ messages: [
      { role: "system", content: "Base rules.", sections: { task: "Old task." }, toolsAdded: [tool("read")], timestamp: 1 },
      { role: "user", content: "first", timestamp: 2 },
      { role: "system", content: "New guidance.", sections: { task: "Current task." }, toolsRemoved: [{ name: "read" }],
        toolsAdded: addReplacement ? [tool("browser")] : [], timestamp: 3 },
      { role: "user", content: "continue", timestamp: 4 },
    ] });
    const original = JSON.stringify(context);
    const result = await streamQoder(model, context, { apiKey: "test-only", sessionId: "test-session" }).result();
    expect(result.stopReason).toBe("stop");
    const body = JSON.parse(Buffer.from((fetch.mock.calls[0] as any)[1].body).toString());
    expect(body.messages.map((m: any) => m.role)).toEqual(["system", "user", "user"]);
    expect(body.messages[0].content).toContain("Base rules.");
    expect(body.messages[0].content).toContain("New guidance.");
    expect(body.messages[0].content).toContain("Current task.");
    expect(body.messages[0].content).not.toContain("Old task.");
    expect(body.tools.map((t: any) => t.function.name)).toEqual(addReplacement ? ["browser"] : []);
    expect(JSON.stringify(context)).toBe(original);
  });
});
