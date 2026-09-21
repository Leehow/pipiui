import { expect, it, vi } from "vitest";
import { createAvailabilityReader } from "../agent/availability.js";
const env = { PIPIUI_BRIDGE_PORT: "54321", PIPIUI_SESSION_CAPABILITY: "test-session-capability" };

it("通过同一bridge查询实时状态，不使用spawn设置快照代替", async () => {
  let enabled = true;
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ schemaVersion: 1, ok: true, mounted: true, enabled, state: enabled ? "enabled" : "disabled" })));
  const read = createAvailabilityReader({ env, fetch: fetcher });
  expect(await read()).toEqual({ enabled: true });
  enabled = false;
  expect(await read()).toEqual({ enabled: false, reason: "extension-disabled" });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ schemaVersion: 1, sessionCapability: env.PIPIUI_SESSION_CAPABILITY, action: "ext.state", extensionId: "experiment-lab" });
});

it("没有host、403、坏协议或超大响应都不允许运行", async () => {
  expect(await createAvailabilityReader({ env: {} })()).toEqual({ enabled: false, reason: "host-unavailable" });
  for (const response of [new Response("", { status: 403 }), new Response('{"ok":true}'), new Response("x".repeat(8193))]) {
    expect((await createAvailabilityReader({ env, fetch: async () => response })()).enabled).toBe(false);
  }
});

it("host声称enabled但未挂载或state不一致时仍拒绝", async () => {
  for (const body of [{ schemaVersion: 1, ok: true, mounted: false, enabled: true, state: "enabled" }, { schemaVersion: 1, ok: true, mounted: true, enabled: true, state: "error" }]) {
    const read = createAvailabilityReader({ env, fetch: async () => new Response(JSON.stringify(body)) });
    expect((await read()).enabled).toBe(false);
  }
});
