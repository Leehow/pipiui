import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessTerminalSend } from "../../../resources/runtime/extensions/pipiui-electron-terminal.ts";

/**
 * The main session may operate the shared terminal (open/send/key/close/…).
 * These tests drive the real extension module with a fake pi.
 */
const TERMINAL_EXTENSION = new URL("../../../resources/runtime/extensions/pipiui-electron-terminal.ts", import.meta.url).href;

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

const READING = ["list", "observe", "wait"];

describe("terminal tool for the main session", () => {
  it("rejects last-resort send of dedicated-tool and one-shot commands", async () => {
    const tool = await loadTerminalTool();
    for (const text of ["ls", "git status", "cat file", "npm test", "pwd"]) {
      const result = await tool.execute("id", { action: "send", terminal_id: "t1", snapshot_id: "s1", text });
      expect(result.isError, text).toBe(true);
      expect(result.details.ok).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lets send reach the bridge for long-lived / ssh / declared need", async () => {
    const tool = await loadTerminalTool();
    await expect(tool.execute("id", { action: "send", terminal_id: "t1", snapshot_id: "s1", text: "npm run dev" }))
      .rejects.toThrow("bridge reached");
    await expect(tool.execute("id", { action: "send", terminal_id: "t1", snapshot_id: "s1", text: "ssh host" }))
      .rejects.toThrow("bridge reached");
    await expect(tool.execute("id", {
      action: "send", terminal_id: "t1", snapshot_id: "s1",
      text: "./scripts/dev.sh", need: "long-lived-process",
    })).rejects.toThrow("bridge reached");
  });

  it("lets the Boss open, key, close, and resize a terminal", async () => {
    const tool = await loadTerminalTool();
    for (const action of ["key", "close", "open", "resize", "request_private_input"]) {
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

  it("advertises the full action set and last-resort language", async () => {
    const tool = await loadTerminalTool();
    expect(tool.description).toMatch(/send/);
    expect(tool.description).toMatch(/open/);
    expect(tool.description).toMatch(/close/);
    expect(tool.description).toMatch(/observe/);
    expect(tool.description).toMatch(/last-resort/i);
    expect(tool.description).not.toMatch(/cannot type/);
  });

  it("ignores a leftover PIPIUI_BOSS_READ_ONLY marker for a legitimate send", async () => {
    vi.resetModules();
    vi.stubEnv("PIPIUI_BRIDGE_PORT", "4321");
    vi.stubEnv("PIPIUI_SESSION_CAPABILITY", "cap");
    vi.stubEnv("PIPIUI_BOSS_READ_ONLY", "1");
    const extension = (await import(TERMINAL_EXTENSION)).default;
    let tool: any;
    extension({ registerTool: (definition: any) => { tool = definition; } } as never);
    await expect(tool.execute("id", { action: "send", terminal_id: "t1", snapshot_id: "s1", text: "npm run dev" }))
      .rejects.toThrow("bridge reached");
  });

  it("keeps rejecting an unknown action", async () => {
    const tool = await loadTerminalTool();
    const result = await tool.execute("id", { action: "exec" });
    expect(result.isError).toBe(true);
  });
});

describe("assessTerminalSend", () => {
  it("rejects dedicated tools even when need is set", () => {
    expect(assessTerminalSend("ls", "long-lived-process").ok).toBe(false);
    expect(assessTerminalSend("git status").ok).toBe(false);
    expect(String((assessTerminalSend("cat README") as { error: string }).error)).toMatch(/read/);
    expect(assessTerminalSend("rg foo").ok).toBe(false);
    expect(assessTerminalSend("find .").ok).toBe(false);
    expect(assessTerminalSend("pwd").ok).toBe(false);
  });

  it("rejects one-shot shell and package scripts", () => {
    expect(assessTerminalSend("echo hi").ok).toBe(false);
    expect(assessTerminalSend("npm test").ok).toBe(false);
    expect(assessTerminalSend("npm run build").ok).toBe(false);
    expect(assessTerminalSend("npm install").ok).toBe(false);
    expect(assessTerminalSend("python script.py").ok).toBe(false);
    expect(assessTerminalSend("node ./app.js").ok).toBe(false);
    expect(assessTerminalSend("curl https://example.com").ok).toBe(false);
  });

  it("allows long-lived, ssh, repl, tui, prompts, and live chains", () => {
    expect(assessTerminalSend("").ok).toBe(true);
    expect(assessTerminalSend("y").ok).toBe(true);
    expect(assessTerminalSend("npm run dev").ok).toBe(true);
    expect(assessTerminalSend("pnpm dev").ok).toBe(true);
    expect(assessTerminalSend("yarn dev").ok).toBe(true);
    expect(assessTerminalSend("cd foo && npm run dev").ok).toBe(true);
    expect(assessTerminalSend("ssh host").ok).toBe(true);
    expect(assessTerminalSend("python").ok).toBe(true);
    expect(assessTerminalSend("tail -f log").ok).toBe(true);
    expect(assessTerminalSend("docker compose up").ok).toBe(true);
    expect(assessTerminalSend("htop").ok).toBe(true);
    expect(assessTerminalSend("vite").ok).toBe(true);
  });

  it("rejects a dedicated segment in a chain", () => {
    expect(assessTerminalSend("cd foo && ls").ok).toBe(false);
  });

  it("requires need for unknown commands", () => {
    expect(assessTerminalSend("./scripts/dev.sh").ok).toBe(false);
    expect(assessTerminalSend("./scripts/dev.sh", "long-lived-process").ok).toBe(true);
    expect(assessTerminalSend("make watch", "not-a-need").ok).toBe(false);
  });
});
