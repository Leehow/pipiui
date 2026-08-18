import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readPathIfDirectory,
  readToolDescription,
  rewriteReadToolText,
  workerCodingToolsArgs,
} from "../../../resources/runtime/extensions/coding-tools.ts";
import codingToolsExtension from "../../../resources/runtime/extensions/pipiui-coding-tools.ts";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-coding-tools-"));
  await mkdir(join(root, ".pi", "boss"), { recursive: true });
  await mkdir(join(root, ".pi", "worktrees"), { recursive: true });
  await writeFile(join(root, ".pi", "agent-slices.json"), "{}\n");
  await writeFile(join(root, "README.md"), "hello\n");
  return root;
}

describe("readPathIfDirectory", () => {
  it("lists a directory instead of throwing EISDIR, and points the model at ls", async () => {
    const cwd = await fixture();
    const text = await readPathIfDirectory(".pi", cwd);
    expect(text).toBeDefined();
    expect(text).not.toMatch(/EISDIR/i);
    expect(text).toMatch(/is a directory/i);
    expect(text).toMatch(/\bls\b/);
    expect(text).toContain("boss/");
    expect(text).toContain("worktrees/");
    expect(text).toContain("agent-slices.json");
  });

  it("leaves a regular file to the real read tool", async () => {
    const cwd = await fixture();
    expect(await readPathIfDirectory("README.md", cwd)).toBeUndefined();
  });

  it("leaves a missing path to the real read tool", async () => {
    const cwd = await fixture();
    expect(await readPathIfDirectory("no-such-path", cwd)).toBeUndefined();
  });
});

describe("rewriteReadToolText", () => {
  it("strips Pi's continue footer after an intentional limit, keeping the window", () => {
    const text =
      "export function mergeAgentSnapshot() {\n  return current\n}\n\n" +
      "[2298 more lines in file. Use offset=320 to continue.]";
    expect(rewriteReadToolText(text, { offset: 240, limit: 80 })).toBe(
      "export function mergeAgentSnapshot() {\n  return current\n}",
    );
  });

  it("turns a hard 50KB/2000-line cap into a grep hint instead of paging", () => {
    const text =
      "const huge = 1\n\n[Showing lines 1-800 of 2662 (50.0KB limit). Use offset=801 to continue.]";
    const rewritten = rewriteReadToolText(text, {});
    expect(rewritten).not.toMatch(/continue/i);
    expect(rewritten).not.toContain("const huge");
    expect(rewritten).toMatch(/grep/i);
    expect(rewritten).toMatch(/offset/i);
    expect(rewritten).toMatch(/limit/i);
  });

  it("tells a still-too-big requested window to shrink, not to keep paging", () => {
    const text = "chunk\n\n[Showing lines 1-2000 of 3506. Use offset=2001 to continue.]";
    const rewritten = rewriteReadToolText(text, { offset: 1, limit: 2000 });
    expect(rewritten).toMatch(/requested line range/i);
    expect(rewritten).toMatch(/smaller limit/i);
    expect(rewritten).not.toMatch(/continue/i);
  });

  it("leaves a complete small-file read alone", () => {
    expect(rewriteReadToolText("hello\n", {})).toBe("hello\n");
  });
});

describe("readToolDescription", () => {
  it("drops continue-until-complete and points large files at grep", () => {
    const description = readToolDescription(
      "Read the contents of a file. Output is truncated to 2000 lines or 50KB. Use offset/limit for large files. When you need the full file, continue with offset until complete.",
    );
    expect(description).not.toMatch(/continue with offset until complete/i);
    expect(description).toMatch(/grep/i);
    expect(description).toMatch(/directory/i);
  });
});

describe("workerCodingToolsArgs", () => {
  it("is the same gate the worker spawn uses", async () => {
    const source = await readFile(new URL("../../../resources/runtime/pi-ext/subagent/index.ts", import.meta.url), "utf8");
    expect(source).toContain('if (PIPIUI_CODING_TOOLS_EXT && !options?.computerWorker) args.push("-e", PIPIUI_CODING_TOOLS_EXT)');
  });

  it("mounts the wrapper on ordinary workers and skips computer workers", () => {
    expect(workerCodingToolsArgs("/runtime/extensions/pipiui-coding-tools.ts")).toEqual([
      "-e",
      "/runtime/extensions/pipiui-coding-tools.ts",
    ]);
    expect(workerCodingToolsArgs("/runtime/extensions/pipiui-coding-tools.ts", { computerWorker: true })).toEqual([]);
    expect(workerCodingToolsArgs(undefined)).toEqual([]);
  });
});

describe("pipiui-coding-tools extension", () => {
  async function loadExtension(active = ["read", "bash", "edit", "write"]) {
    let tool: { name: string; description: string; execute: Function } | undefined;
    const activeTools = [...active];
    const pi = {
      getActiveTools: vi.fn(() => [...activeTools]),
      setActiveTools: vi.fn((names: string[]) => {
        activeTools.splice(0, activeTools.length, ...names);
      }),
      on: vi.fn(),
      registerTool: vi.fn((definition: { name: string; description: string; execute: Function }) => {
        tool = definition;
      }),
    };
    codingToolsExtension(pi as never);
    return { pi, tool, activeTools };
  }

  it("replaces read so a directory path returns a listing, not EISDIR", async () => {
    const cwd = await fixture();
    const { tool } = await loadExtension();
    expect(tool?.name).toBe("read");
    expect(tool?.description).toMatch(/directory/i);
    const result = await tool!.execute("call-1", { path: ".pi" }, undefined, undefined, { cwd });
    const text = result.content[0].text as string;
    expect(text).not.toMatch(/EISDIR/i);
    expect(text).toMatch(/is a directory/i);
    expect(text).toContain("boss/");
  });

  it("still reads a real file through the wrapped tool", async () => {
    const cwd = await fixture();
    const { tool } = await loadExtension();
    const result = await tool!.execute("call-2", { path: "README.md" }, undefined, undefined, { cwd });
    expect(result.content[0].text).toContain("hello");
  });

  it("refuses a bare oversize read instead of inviting a page-through", async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, "big.ts"), Array.from({ length: 2500 }, (_, i) => `line ${i + 1} ${"x".repeat(48)}`).join("\n") + "\n");
    const { tool } = await loadExtension();
    const result = await tool!.execute("call-4", { path: "big.ts" }, undefined, undefined, { cwd });
    const text = result.content[0].text as string;
    expect(text).not.toMatch(/Use offset=\d+ to continue/);
    expect(text).toMatch(/grep/i);
    expect(text).toMatch(/read cap/i);
  });

  it("does not tell the model to keep paging after a bounded read", async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, "long.ts"), Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
    const { tool } = await loadExtension();
    expect(tool?.description).not.toMatch(/continue with offset until complete/i);
    expect(tool?.description).toMatch(/grep/i);
    const result = await tool!.execute("call-3", { path: "long.ts", offset: 10, limit: 20 }, undefined, undefined, { cwd });
    const text = result.content[0].text as string;
    expect(text).toContain("line 10");
    expect(text).toContain("line 29");
    expect(text).not.toMatch(/Use offset=\d+ to continue/);
    expect(text).not.toMatch(/more lines in file/);
  });

  // 1b3158ab removed the session_start force-activation: replaying a getActiveTools()
  // snapshot raced with worker tool registration and locked subagent sessions read-only.
  // Inspection tools come from --tools now, so this extension must never touch the
  // active tool set — not during loading, and not from a lifecycle hook afterwards.
  it("never touches the active tool set — it only replaces the read tool", () => {
    const loadingError = new Error(
      "Failed to load extension: Extension runtime not initialized. Action methods cannot be called during extension loading. Hint: Start without extensions using \"pi -ne\".",
    );
    const pi = {
      getActiveTools: vi.fn(() => { throw loadingError; }),
      setActiveTools: vi.fn(() => { throw loadingError; }),
      on: vi.fn(),
      registerTool: vi.fn(),
    };
    expect(() => codingToolsExtension(pi as never)).not.toThrow();
    expect(pi.setActiveTools).not.toHaveBeenCalled();
    expect(pi.getActiveTools).not.toHaveBeenCalled();
    expect(pi.on).not.toHaveBeenCalled();
    expect(pi.registerTool).toHaveBeenCalledOnce();
    expect((pi.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0].name).toBe("read");
  });
});
