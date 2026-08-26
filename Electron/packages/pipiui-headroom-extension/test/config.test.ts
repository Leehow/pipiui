import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, HEADROOM_SETTINGS_ENV, loadHeadroomConfig } from "../agent/config.js";

describe("pipiui-headroom project-isolated settings", () => {
  it("uses the loopback-only defaults without reading a global Headroom home", () => {
    const loaded = loadHeadroomConfig({});
    expect(loaded.config).toMatchObject({
      baseUrl: "http://127.0.0.1:8787",
      managed: false,
      minContextTokens: 20_000,
      minResultChars: 4_000,
      protectRecentToolResults: 2,
      requestTimeoutMs: 30_000,
    });
    expect(loaded.config.protectedTools).toEqual(expect.arrayContaining(["read", "write", "headroom_retrieve"]));
    expect(loaded.warnings).toEqual([]);
  });

  it("reads only PipiUI's per-project settings snapshot", () => {
    const loaded = loadHeadroomConfig({
      [HEADROOM_SETTINGS_ENV]: JSON.stringify({
        "ext.pipiui-headroom.baseUrl": "http://localhost:9797/",
        "ext.pipiui-headroom.minResultChars": 8_000,
        "ext.pipiui-headroom.protectRecentToolResults": 0,
      }),
    });
    expect(loaded.config.baseUrl).toBe("http://localhost:9797");
    expect(loaded.config.minResultChars).toBe(8_000);
    expect(loaded.config.protectRecentToolResults).toBe(0);
  });

  it("accepts only the host-injected managed lifecycle receipt", () => {
    const loaded = loadHeadroomConfig({
      [HEADROOM_SETTINGS_ENV]: JSON.stringify({
        "ext.pipiui-headroom.baseUrl": "http://127.0.0.1:43123",
        "ext.pipiui-headroom.managed": true,
        "ext.pipiui-headroom.managedState": "installing",
        "ext.pipiui-headroom.managedStatePath": "/tmp/project/.pi/agent/headroom/service.json",
      }),
    });
    expect(loaded.config).toMatchObject({
      baseUrl: "http://127.0.0.1:43123",
      managed: true,
      managedState: "installing",
      managedStatePath: "/tmp/project/.pi/agent/headroom/service.json",
    });
    expect(loaded.warnings).toEqual([]);
  });

  it("rejects remote endpoints and malformed numeric settings", () => {
    const loaded = loadHeadroomConfig({
      [HEADROOM_SETTINGS_ENV]: JSON.stringify({
        "ext.pipiui-headroom.baseUrl": "https://headroom.example.com",
        "ext.pipiui-headroom.minContextTokens": -1,
      }),
    });
    expect(loaded.config.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
    expect(loaded.config.minContextTokens).toBe(DEFAULT_CONFIG.minContextTokens);
    expect(loaded.warnings.join("\n")).toMatch(/回环|正整数/);
  });
});
