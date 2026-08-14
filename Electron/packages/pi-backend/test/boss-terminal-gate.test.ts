import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The terminal tool is the second shell: `--exclude-tools bash` does not touch it, so a
 * read-only Boss that kept `terminal.send` would still be able to run any command. These
 * tests drive the real extension module with a fake pi and assert the action-level gate.
 */
const TERMINAL_EXTENSION = "../../../resources/runtime/extensions/pipiui-electron-terminal.ts";

async function loadTerminalTool(readOnly: boolean) {
  vi.resetModules();
  vi.stubEnv("PIPIUI_BRIDGE_PORT", "4321");
  vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "cap");
  vi.stubEnv("PIPIUI_BOSS_READ_ONLY", readOnly ? "1" : "");
  const extension = (await import(TERMINAL_EXTENSION)).default;
  let tool: any;
  extension({ registerTool: (definition: any) => { tool = definition; } } as never);
  return tool;
}

/** Any action that reaches the bridge would call fetch; failing it proves nothing escaped. */
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("bridge reached"); }));
});

const MUTATING = ["send", "key", "close", "open", "resize", "request_private_input"];
const READING = ["list", "observe", "wait"];

describe("terminal tool under a read-only Boss", () => {
  it("refuses every action that types into or changes a terminal", async () => {
    const tool = await loadTerminalTool(true);
    for (const action of MUTATING) {
      const result = await tool.execute("id", { action, terminal_id: "t1", snapshot_id: "s1", text: "rm -rf /" });
      expect(result.isError, `${action} should be refused`).toBe(true);
      expect(result.details.error).toMatch(/does not run commands/);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still lets the Boss read a terminal the user is pointing at", async () => {
    const tool = await loadTerminalTool(true);
    for (const action of READING) {
      // Reaching the bridge is the pass condition here: the gate let the action through.
      await expect(tool.execute("id", { action, terminal_id: "t1" })).rejects.toThrow("bridge reached");
    }
  });

  it("advertises only the read actions, so the model is not told about ones it cannot use", async () => {
    const tool = await loadTerminalTool(true);
    expect(tool.description).not.toMatch(/send/);
    expect(tool.description).toMatch(/observe/);
  });

  it("leaves the full tool intact when the Boss is not read-only", async () => {
    const tool = await loadTerminalTool(false);
    expect(tool.description).toMatch(/send/);
    for (const action of MUTATING) {
      await expect(tool.execute("id", { action, terminal_id: "t1", snapshot_id: "s1", text: "ls" }))
        .rejects.toThrow("bridge reached");
    }
  });

  it("keeps rejecting an unknown action, gate or no gate", async () => {
    for (const readOnly of [true, false]) {
      const tool = await loadTerminalTool(readOnly);
      const result = await tool.execute("id", { action: "exec" });
      expect(result.isError).toBe(true);
    }
  });
});
