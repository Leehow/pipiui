import { describe, expect, it } from "vitest";
import {
  PIPI_HOST_PROTOCOL_VERSION,
  createHostBackendSession,
  type HostBackend,
  type HostEvent,
  type HostMethod,
  type HostWireFrame,
  type Unsubscribe,
} from "../src/index.js";

describe("Host API setStructuredOutput dispatcher", () => {
  it("forwards sessionId + request through the real host method", async () => {
    const calls: Array<{ method: HostMethod; params: unknown[] }> = [];
    const backend: HostBackend = {
      async handle(method, params) {
        calls.push({ method, params });
        return undefined;
      },
      subscribe(_listener: (event: HostEvent) => void): Unsubscribe {
        return () => undefined;
      },
    };
    const frames: HostWireFrame[] = [];
    const session = createHostBackendSession(backend, (frame) => { frames.push(frame); });
    session.receive({
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      id: "req-1",
      type: "request",
      method: "setStructuredOutput",
      params: ["sess-a", { name: "flag", schema: { type: "object" }, strict: true }],
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual([{
      method: "setStructuredOutput",
      params: ["sess-a", { name: "flag", schema: { type: "object" }, strict: true }],
    }]);
    expect(frames).toEqual([
      { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, id: "req-1", type: "response", ok: true, result: undefined },
    ]);
    await session.close();
  });
});
