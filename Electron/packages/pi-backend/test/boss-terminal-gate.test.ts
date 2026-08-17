import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The main session may operate the shared terminal (open/send/key/close/…).
 * These tests drive the real extension module with a fake pi.
 */
const TERMINAL_EXTENSION = "../../../resources/runtime/extensions/pipiui-electron-terminal.ts";

async function loadTerminalTool() {
  vi.resetModules();
  vi.stubEnv("PIPIUI_BRIDGE_PORT", "4321");
  vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "cap");
  const extension = (await import(TERMINAL_EXTENSION)).default;
  let tool: any;
  extension({ registerTool: (definition: any) => { tool = definition; } } as never);
  return tool;
}

/** Any action that reaches the bridge would call fetch; failing it proves the action was allowed. */
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("bridge reached"); }));
});

const MUTATING = ["send", "key", "close", "open", "resize", "request_private_input"];
const READING = ["list", "observe", "wait"];

describe("terminal tool for the main session", () => {
  it("lets the Boss type into, open, and close a terminal", async () => {
    const tool = await loadTerminalTool();
    for (const action of MUTATING) {
      await expect(tool.execute("id", { action, terminal_id: "t1", snapshot_id: "s1", text: "ls" }))
        .rejects.toThrow("bridge reached");
    }
  });

  it("lets the Boss read a terminal", async () => {
    const tool = await loadTerminalTool();
    for (const action of READING) {
      await expect(tool.execute("id", { action, terminal_id: "t1" })).rejects.toThrow("bridge reached");
    }
  });

  it("advertises the full action set", async () => {
    const tool = await loadTerminalTool();
    expect(tool.description).toMatch(/send/);
    expect(tool.description).toMatch(/open/);
    expect(tool.description).toMatch(/close/);
    expect(tool.description).toMatch(/observe/);
    expect(tool.description).not.toMatch(/cannot type/);
  });

  it("ignores a leftover PIPIUI_BOSS_READ_ONLY marker", async () => {
    vi.resetModules();
    vi.stubEnv("PIPIUI_BRIDGE_PORT", "4321");
    vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "cap");
    vi.stubEnv("PIPIUI_BOSS_READ_ONLY", "1");
    const extension = (await import(TERMINAL_EXTENSION)).default;
    let tool: any;
    extension({ registerTool: (definition: any) => { tool = definition; } } as never);
    await expect(tool.execute("id", { action: "send", terminal_id: "t1", snapshot_id: "s1", text: "ls" }))
      .rejects.toThrow("bridge reached");
  });

  it("keeps rejecting an unknown action", async () => {
    const tool = await loadTerminalTool();
    const result = await tool.execute("id", { action: "exec" });
    expect(result.isError).toBe(true);
  });
});
