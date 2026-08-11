import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildActionCall,
  CUA_DRIVER_VERSION,
  cuaSocketPath,
  CuaDriverHost,
  selectLaunchWindow,
} from "./cua-driver-host.js";

describe("CuaDriverHost", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("pins the largest app content window instead of a thin title-bar surface", () => {
    expect(
      selectLaunchWindow(
        [
          { pid: 42, window_id: 7, bounds: { x: 0, y: 0, width: 1512, height: 33 } },
          { pid: 42, window_id: 8, bounds: { x: 20, y: 40, width: 230, height: 430 } },
          { pid: 99, window_id: 9, bounds: { x: 0, y: 0, width: 2000, height: 1200 } },
        ],
        42,
      ),
    ).toMatchObject({ window_id: 8 });
  });

  it("keeps the daemon socket below the macOS sockaddr_un byte limit", () => {
    const realisticLongTemp =
      "/var/folders/zz/abcdefghijklmnopqrstuvwxyz0123456789/T/TemporaryItems/Very Long PipiUI Electron Session Name";
    const path = cuaSocketPath(
      realisticLongTemp,
      123456,
      "12345678-1234-1234-1234-123456789abc",
      "darwin",
    );
    expect(path).toBe("/tmp/pcua-123456-12345678123412341234123456789abc.sock");
    expect(Buffer.byteLength(path)).toBeLessThanOrEqual(103);
  });

  it("reports an actionable false state when the packaged helper is absent", async () => {
    const host = new CuaDriverHost("/missing/cua-driver", {
      displayID: 1,
      width: 1440,
      height: 900,
    });
    expect(host.usable()).toBe(false);
    expect(
      await host.handle({
        protocolVersion: 1,
        action: "computer_runtime_capabilities",
      }),
    ).toMatchObject({
      ok: false,
      runtimeError: { code: "driver_unavailable", retryable: false },
    });
  });

  it("rejects unsupported runtime protocol before launching a helper", async () => {
    const host = new CuaDriverHost("/missing/cua-driver", {
      displayID: 1,
      width: 1,
      height: 1,
    });
    expect(
      await host.handle({ protocolVersion: 99, action: "computer_batch" }),
    ).toMatchObject({
      ok: false,
      runtimeError: { code: "unsupported_protocol_version" },
    });
  });

  it("cancels pending calls and tears down owned helper processes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-host-test-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const host: any = new CuaDriverHost(helper, {
      displayID: 1,
      width: 1,
      height: 1,
    });
    let daemonKilled = false,
      proxyKilled = false,
      rejected = "";
    host.daemon = {
      kill: () => {
        daemonKilled = true;
      },
    };
    host.proxy = {
      kill: () => {
        proxyKilled = true;
      },
    };
    host.pending.set(7, {
      timer: setTimeout(() => {}, 10_000),
      resolve: () => {},
      reject: (error: Error) => {
        rejected = error.message;
      },
    });
    host.cancel();
    expect({ daemonKilled, proxyKilled, rejected }).toEqual({
      daemonKilled: true,
      proxyKilled: true,
      rejected: "computer request cancelled",
    });
  });

  it("pins the same version as packaging metadata", async () => {
    const metadata = JSON.parse(
      await readFile(
        new URL("../../../../cua-driver-assets.json", import.meta.url),
        "utf8",
      ),
    );
    expect(metadata.version).toBe(CUA_DRIVER_VERSION);
    expect(metadata.assets["darwin-universal"].sha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it("constructs 0.19.2 target-scoped action arguments", () => {
    const target = { session: "session-a", pid: 42, window_id: 77 };
    expect(
      buildActionCall({ type: "click", coordinate: [10, 20] }, target),
    ).toEqual({
      tool: "click",
      arguments: {
        session: "session-a",
        pid: 42,
        window_id: 77,
        x: 10,
        y: 20,
        button: "left",
        count: 1,
      },
    });
    expect(
      buildActionCall(
        { type: "type", text: "hello", element_token: "token" },
        target,
      ),
    ).toEqual({
      tool: "type_text",
      arguments: {
        session: "session-a",
        pid: 42,
        window_id: 77,
        element_token: "token",
        text: "hello",
      },
    });
    expect(
      buildActionCall({ type: "key", keys: ["CMD", "L"] }, target),
    ).toMatchObject({
      tool: "hotkey",
      arguments: {
        session: "session-a",
        pid: 42,
        window_id: 77,
        keys: ["CMD", "L"],
      },
    });
    expect(
      buildActionCall(
        { type: "scroll", scroll_direction: "down", scroll_amount: 4 },
        target,
      ),
    ).toMatchObject({
      tool: "scroll",
      arguments: {
        session: "session-a",
        pid: 42,
        window_id: 77,
        direction: "down",
        amount: 4,
      },
    });
  });

  it("uses get_window_state after launch and never shares a target across sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-contract-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, {
      displayID: 1,
      width: 1440,
      height: 900,
    });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "launch_app")
        return {
          structuredContent: { pid: 42, windows: [{ pid: 42, window_id: 77 }] },
        };
      if (name === "get_window_state")
        return {
          content: [{ type: "text", text: "Calculator window state" }],
          structuredContent: {
            elements: [],
            screenshot_png_b64: "REALISTIC_PNG_BASE64",
            screenshot_mime_type: "image/png",
            screenshot_width: 900,
            screenshot_height: 700,
          },
        };
      return { structuredContent: {} };
    };
    const opened = await host.handle({
        protocolVersion: 1,
        sessionKey: "a",
        action: "computer_open_application",
        application_name: "Calculator",
      });
    expect(opened).toMatchObject({
      ok: true,
      target: { pid: 42, window_id: 77, session: "a" },
      base64: "REALISTIC_PNG_BASE64",
      mimeType: "image/png",
    });
    expect(opened).not.toHaveProperty("screenshot_png_b64");
    expect(calls.map((call) => call.name)).toEqual([
      "start_session",
      "launch_app",
      "bring_to_front",
      "get_window_state",
    ]);
    expect(calls.find((call) => call.name === "bring_to_front")?.args).toEqual({
      pid: 42,
      window_id: 77,
    });
    expect(calls.at(-1)?.args).toMatchObject({
      session: "a",
      pid: 42,
      window_id: 77,
    });
    expect(
      await host.handle({
        protocolVersion: 1,
        sessionKey: "b",
        action: "computer_batch",
        actions: [{ type: "click", coordinate: [1, 2] }],
      }),
    ).toMatchObject({
      ok: false,
      runtimeError: { code: "target_unavailable" },
    });
    expect(calls.some((call) => call.name === "screenshot")).toBe(false);
  });

  it("uses a separate desktop-scoped session for untargeted observation", async () => {
    const root = await mkdtemp(join(tmpdir(), "cua-desktop-"));
    roots.push(root);
    const helper = join(root, "cua-driver");
    await writeFile(helper, "#!/bin/sh\n");
    await chmod(helper, 0o755);
    const calls: Array<{ name: string; args: any }> = [];
    const host: any = new CuaDriverHost(helper, {
      displayID: 1,
      width: 1440,
      height: 900,
    });
    host.call = async (name: string, args: any) => {
      calls.push({ name, args });
      return name === "get_desktop_state"
        ? {
            content: [{ type: "text", text: "Desktop state" }],
            structuredContent: {
              screenshot_png_b64: "DESKTOP",
              screenshot_mime_type: "image/png",
              screenshot_width: 1440,
              screenshot_height: 900,
            },
          }
        : { structuredContent: {} };
    };
    expect(
      await host.handle({
        protocolVersion: 1,
        sessionKey: "observe",
        action: "computer_batch",
        actions: [{ type: "screenshot" }],
      }),
    ).toMatchObject({
      ok: true,
      base64: "DESKTOP",
      mimeType: "image/png",
      screenshot_width: 1440,
      screenshot_height: 900,
    });
    expect(calls.map((call) => call.name)).toEqual([
      "start_session",
      "get_desktop_state",
    ]);
    const desktopSession = calls[0].args.session;
    expect(calls[0].args).toMatchObject({
      session: desktopSession,
      capture_scope: "desktop",
    });
    expect(desktopSession).not.toBe("observe");
    expect(calls[1].args).toEqual({ session: desktopSession });
  });
});
