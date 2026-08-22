// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionHostAPI, ExtInvokeResult } from "@pipiui/extension-api";
import Panel from "../app/panel.js";

afterEach(cleanup);

function apiStub(options: {
  settings?: Record<string, unknown>;
  invoke?: () => Promise<ExtInvokeResult | undefined>;
}): ExtensionHostAPI {
  return {
    subscribeExt: () => () => {},
    settings: {
      get: () => Promise.resolve(options.settings ?? {}),
      update: async () => ({ ok: true, data: {} }),
    },
    invoke: options.invoke ?? (async () => undefined),
  } as unknown as ExtensionHostAPI;
}

/** No active session: invoke fails no_session → the panel degrades to settings-derived info. */
const noSession = () => Promise.resolve({ ok: false, error: { code: "no_session", message: "no session" } });

async function renderPanel(api: ExtensionHostAPI) {
  const view = render(<Panel api={api} />);
  await waitFor(() => expect(screen.getByTestId("grok-build-tier")).toBeTruthy());
  return view;
}

describe("Grok Build panel tier presentation", () => {
  it("shows an explicit configured tier value", async () => {
    await renderPanel(apiStub({
      settings: { "ext.grok-build-oauth.tier": "SuperGrok Heavy" },
      invoke: noSession,
    }));
    expect(screen.getByTestId("grok-build-tier").textContent).toContain("SuperGrok Heavy");
  });

  it("never hides an explicitly EMPTY tier — shows it as restricted", async () => {
    await renderPanel(apiStub({
      settings: { "ext.grok-build-oauth.tier": "" },
      invoke: noSession,
    }));
    const tier = screen.getByTestId("grok-build-tier");
    expect(tier.textContent).toContain("受限");
    expect(tier.textContent).not.toContain("unknown");
  });

  it("shows tier=unknown (not a hidden row) when tier is unset", async () => {
    await renderPanel(apiStub({ settings: {}, invoke: noSession }));
    const tier = screen.getByTestId("grok-build-tier");
    expect(tier.textContent).toContain("unknown");
  });

  it("live session status tier wins over settings and still surfaces empty as restricted", async () => {
    await renderPanel(apiStub({
      settings: { "ext.grok-build-oauth.tier": "SuperGrok Heavy" },
      invoke: async () => ({ ok: true, data: { loggedIn: true, expired: false, tier: "" } }),
    }));
    const tier = screen.getByTestId("grok-build-tier");
    expect(tier.textContent).toContain("受限");
    expect(tier.textContent).not.toContain("SuperGrok Heavy");
  });

  it("renders without an api at all (still shows the unknown tier row)", async () => {
    render(<Panel />);
    expect(screen.getByTestId("grok-build-tier").textContent).toContain("unknown");
  });
});
