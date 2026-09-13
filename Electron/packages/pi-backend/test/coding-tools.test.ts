import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  capCompositeOutput,
  editMismatchHint,
  filterGrepLines,
  globToRegExp,
  grepCountSummary,
  grepFilesSummary,
  parseGrepOutput,
  pathMatchesExcludes,
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
    expect(source).toContain('if (PIPIUI_CODING_TOOLS_EXT) args.push("-e", PIPIUI_CODING_TOOLS_EXT)');
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
  interface RegisteredTool {
    name: string;
    description: string;
    promptGuidelines?: string[];
    execute: Function;
  }
  async function loadExtension(active = ["read", "bash", "edit", "write"]) {
    const tools = new Map<string, RegisteredTool>();
    const activeTools = [...active];
    const pi = {
      getActiveTools: vi.fn(() => [...activeTools]),
      setActiveTools: vi.fn((names: string[]) => {
        activeTools.splice(0, activeTools.length, ...names);
      }),
      on: vi.fn(),
      registerTool: vi.fn((definition: RegisteredTool) => {
        tools.set(definition.name, definition);
      }),
    };
    codingToolsExtension(pi as never);
    return { pi, tools, tool: tools.get("read"), activeTools };
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
  it("never touches the active tool set — it only replaces existing coding tools", () => {
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
    expect(pi.registerTool).toHaveBeenCalledTimes(4);
    const names = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].name);
    expect(names).toEqual(["read", "grep", "ls", "edit"]);
  });

  describe("edit mismatch recovery", () => {
    it("shows the actual quote difference, keeps a failed batch atomic, and accepts a corrected retry", async () => {
      const cwd = await fixture();
      const path = join(cwd, "example.ts");
      const original = 'const version = 1;\nconst visible = ["player-safe", "revealable"];\n';
      await writeFile(path, original);
      const { tools } = await loadExtension();
      const edit = tools.get("edit")!;
      const edits = [
        { oldText: "const version = 1;", newText: "const version = 2;" },
        { oldText: "const visible = ['player-safe', 'revealable'];\n", newText: "const visible = ['public'];\n" },
      ];
      let failure: Error | undefined;
      try {
        await edit.execute("failed-edit", { path: "example.ts", edits }, undefined, undefined, { cwd });
      } catch (error) { failure = error as Error; }
      expect(failure?.message).toContain("Could not find edits[1]");
      expect(failure?.message).toContain("No changes were written by this edit call.");
      expect(failure?.message).toContain("First difference at file line 2");
      expect(failure?.message).toContain("Do not resend an unchanged failed edit.");
      expect(await readFile(path, "utf8")).toBe(original);

      // Recover from the returned source text, as an agent would, without
      // asking the executor to normalize quotes or guess a replacement.
      const encoded = failure!.message.split("preserve its exact characters in oldText):\n")[1].split("\n")[0];
      const currentText = JSON.parse(encoded);
      expect(currentText).toBe('const visible = ["player-safe", "revealable"];\n');
      const result = await edit.execute("corrected-edit", {
        path: "example.ts", edits: [edits[0], { ...edits[1], oldText: currentText }],
      }, undefined, undefined, { cwd });
      expect(result.content[0].text).toMatch(/Successfully/);
      expect(await readFile(path, "utf8")).toBe("const version = 2;\nconst visible = ['public'];\n");
    });

    it("requires a new read when quote-normalized candidates are ambiguous", () => {
      expect(editMismatchHint('const x = "value";\n  const x = "value";\n', "const x = 'value';")).toBeUndefined();
    });

    it("keeps missing-file and cancellation failures separate from text mismatches", async () => {
      const cwd = await fixture();
      const { tools } = await loadExtension();
      const edit = tools.get("edit")!;
      const input = { path: "absent.ts", edits: [{ oldText: "old", newText: "new" }] };
      await expect(edit.execute("missing", input, undefined, undefined, { cwd })).rejects.toThrow(/Could not edit file/);
      const signal = AbortSignal.abort();
      await expect(edit.execute("aborted", input, signal, undefined, { cwd })).rejects.toThrow("Operation aborted");
    });

    it("bounds diagnostic source output and points large blocks back to read", () => {
      const actual = `const value = "${"x".repeat(5000)}";`;
      const hint = editMismatchHint(actual, actual.replaceAll('"', "'"))!;
      expect(hint).toContain("Read that line range");
      expect(hint.length).toBeLessThan(1000);
    });
  });

  describe("composite grep", () => {
    async function grepFixture() {
      const cwd = await fixture();
      await mkdir(join(cwd, "src"), { recursive: true });
      await mkdir(join(cwd, "node_modules", "dep"), { recursive: true });
      await writeFile(join(cwd, "src", "alpha.ts"), "export const heartbeat = 1\nexport const cadence = 2\nexport const heartbeatWorker = 3\n");
      await writeFile(join(cwd, "src", "beta.ts"), "export const heartbeat = 9\n");
      await writeFile(join(cwd, "node_modules", "dep", "index.js"), "module.exports.heartbeat = true\n");
      const { tools } = await loadExtension();
      const grep = tools.get("grep")!;
      return { cwd, grep };
    }

    it("advertises the composite parameters in description and guidelines", async () => {
      const { grep } = await grepFixture();
      expect(grep.description).toMatch(/patterns/i);
      expect(grep.description).toMatch(/paths/i);
      expect(grep.description).toMatch(/count/);
      expect(grep.description).toMatch(/exclude/i);
      expect(grep.promptGuidelines?.join("\n")).toMatch(/never run `cd` \+ grep in bash/i);
      expect(grep.promptGuidelines?.join("\n")).toMatch(/mode=count or mode=files/i);
    });

    it("delegates a simple search unchanged to the base tool", async () => {
      const { cwd, grep } = await grepFixture();
      const result = await grep.execute("c1", { pattern: "cadence" }, undefined, undefined, { cwd });
      const text = result.content[0].text as string;
      expect(text).toContain("src/alpha.ts:2:");
      expect(text).not.toMatch(/^===/m);
    });

    it("searches several absolute paths in one call without cd", async () => {
      const { cwd, grep } = await grepFixture();
      const result = await grep.execute(
        "c2",
        { pattern: "heartbeat", paths: [join(cwd, "src"), join(cwd, "node_modules")] },
        undefined,
        undefined,
        { cwd: "/tmp" },
      );
      const text = result.content[0].text as string;
      expect(text).toContain(`--- in ${join(cwd, "src")} ---`);
      expect(text).toContain(`--- in ${join(cwd, "node_modules")} ---`);
      expect(text).toContain("alpha.ts:1:");
      expect(text).toContain("dep/index.js:1:");
    });

    it("runs several patterns as labeled sections", async () => {
      const { cwd, grep } = await grepFixture();
      const result = await grep.execute("c3", { patterns: ["cadence", "heartbeatWorker"], path: "src" }, undefined, undefined, { cwd });
      const text = result.content[0].text as string;
      expect(text).toContain("=== pattern: cadence ===");
      expect(text).toContain("=== pattern: heartbeatWorker ===");
      expect(text).toContain("alpha.ts:2:");
      expect(text).toContain("alpha.ts:3:");
    });

    it("reports per-file counts with mode=count like grep -c", async () => {
      const { cwd, grep } = await grepFixture();
      const result = await grep.execute("c4", { pattern: "heartbeat", path: "src", mode: "count" }, undefined, undefined, { cwd });
      const text = result.content[0].text as string;
      // Paths are relative to the searched directory, same as the base tool.
      expect(text).toContain("alpha.ts: 2");
      expect(text).toContain("beta.ts: 1");
      expect(text).toContain("total: 3 matches in 2 files");
    });

    it("lists matching files with mode=files like grep -l", async () => {
      const { cwd, grep } = await grepFixture();
      const result = await grep.execute("c5", { pattern: "heartbeat", path: ".", mode: "files" }, undefined, undefined, { cwd });
      const text = result.content[0].text as string;
      expect(text).toContain("src/alpha.ts");
      expect(text).toContain("src/beta.ts");
      expect(text).toContain("node_modules/dep/index.js");
      expect(text).toMatch(/3 files/);
    });

    it("skips exclude globs instead of piping through grep -v", async () => {
      const { cwd, grep } = await grepFixture();
      const result = await grep.execute("c6", { pattern: "heartbeat", path: ".", exclude: ["node_modules"] }, undefined, undefined, { cwd });
      const text = result.content[0].text as string;
      expect(text).toContain("src/alpha.ts:1:");
      expect(text).not.toContain("node_modules");
    });

    it("reports an empty composite search as no matches, not an error", async () => {
      const { cwd, grep } = await grepFixture();
      const result = await grep.execute("c7", { patterns: ["no-such-token-xyz"], paths: ["src", "node_modules"] }, undefined, undefined, { cwd });
      const text = result.content[0].text as string;
      expect(text).toMatch(/No matches found/);
    });
  });

  describe("composite read/ls", () => {
    it("reads several files as labeled sections instead of cat-chaining", async () => {
      const cwd = await fixture();
      await writeFile(join(cwd, "a.json"), '{"a":1}\n');
      await writeFile(join(cwd, "b.json"), '{"b":2}\n');
      const { tools } = await loadExtension();
      const read = tools.get("read")!;
      const result = await read.execute("c8", { paths: ["a.json", "b.json", "missing.json"] }, undefined, undefined, { cwd });
      const text = result.content[0].text as string;
      expect(text).toContain("=== a.json ===");
      expect(text).toContain('{"a":1}');
      expect(text).toContain("=== b.json ===");
      expect(text).toContain('{"b":2}');
      expect(text).toContain("=== missing.json ===");
      expect(text).toMatch(/read failed/i);
    });

    it("lists several directories in one call instead of ls-chaining", async () => {
      const cwd = await fixture();
      const { tools } = await loadExtension();
      const ls = tools.get("ls")!;
      expect(ls?.description).toMatch(/paths/);
      const result = await ls.execute("c9", { paths: [".pi", join(cwd, ".pi", "boss")] }, undefined, undefined, { cwd });
      const text = result.content[0].text as string;
      expect(text).toContain("--- .pi ---");
      expect(text).toContain("boss/");
      expect(text).toContain(`--- ${join(cwd, ".pi", "boss")} ---`);
    });
  });
});

describe("composite grep helpers", () => {
  it("parses base grep output into matches with context grouping", () => {
    const lines = parseGrepOutput(
      "src/a.ts-9- before line\nsrc/a.ts:10: match line\nsrc/a.ts-11- after line\n\n[100 matches limit reached. Use limit=200 for more, or refine pattern]",
    );
    expect(lines.map((l) => l.kind)).toEqual(["before", "match", "after"]);
    expect(lines[1]).toMatchObject({ path: "src/a.ts", lineNumber: 10 });
  });

  it("treats 'No matches found' and empty output as no lines", () => {
    expect(parseGrepOutput("No matches found")).toEqual([]);
    expect(parseGrepOutput("")).toEqual([]);
  });

  it("matches exclude globs on paths and ancestor directories", () => {
    expect(pathMatchesExcludes("node_modules/dep/index.js", ["node_modules"])).toBe(true);
    expect(pathMatchesExcludes("deep/nested/node_modules/x.js", ["**/node_modules"])).toBe(true);
    expect(pathMatchesExcludes("docs/plan.jsonl", ["*.jsonl"])).toBe(true);
    expect(pathMatchesExcludes("src/alpha.ts", ["node_modules", "*.jsonl"])).toBe(false);
    expect(globToRegExp("*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("*.ts").test("a.tsx")).toBe(false);
  });

  it("drops excluded matches together with their context lines", () => {
    const lines = parseGrepOutput(
      "keep.ts-4- pre\nkeep.ts:5: kept\nkeep.ts-6- post\ndrop/node_modules/x.js-1- pre\ndrop/node_modules/x.js:2: dropped\ndrop/node_modules/x.js-3- post",
    );
    const out = filterGrepLines(lines, ["node_modules"]);
    expect(out).toEqual(["keep.ts-4- pre", "keep.ts:5: kept", "keep.ts-6- post"]);
  });

  it("summarizes counts and files", () => {
    const lines = parseGrepOutput("a.ts:1: x\na.ts:7: x\nb.ts:2: x");
    expect(grepCountSummary(lines)).toBe("a.ts: 2\nb.ts: 1\n\ntotal: 3 matches in 2 files");
    expect(grepFilesSummary(lines)).toBe("a.ts\nb.ts\n\n2 files");
    expect(grepCountSummary([])).toBe("No matches found");
  });

  it("caps composite output with an actionable notice", () => {
    const capped = capCompositeOutput("x".repeat(65 * 1024));
    expect(capped).toMatch(/truncated to 64KB/);
    expect(capped).toMatch(/Narrow paths/);
    expect(capCompositeOutput("small")).toBe("small");
  });
});
