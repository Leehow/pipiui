import { execFile } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BashHistoryReader, type BashHistoryPage } from "../src/bash-history.js";

const exec = promisify(execFile);

/** `fs.utimes` drops sub-millisecond stamps; `touch -r` keeps the cache key identical. */
async function rememberStamp(source: string): Promise<string> {
  const stamp = `${source}.stamp`;
  await writeFile(stamp, "");
  await exec("touch", ["-r", source, stamp]);
  return stamp;
}

async function restoreStamp(stamp: string, target: string): Promise<void> {
  await exec("touch", ["-r", stamp, target]);
}

const unavailable: BashHistoryPage = { text: "", totalBytes: 0, truncated: false, state: "unavailable" };

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

function sessionRow(): unknown {
  return { type: "session", version: 3, id: "sess", timestamp: "2026-09-22T00:00:00.000Z" };
}

function message(id: string, parentId: string | null, messageBody: unknown): unknown {
  return { type: "message", id, parentId, timestamp: "2026-09-22T00:00:01.000Z", message: messageBody };
}

function bashCall(id: string, command: string, extra?: Record<string, unknown>): unknown {
  return { type: "toolCall", id, name: "bash", arguments: { command, ...extra } };
}

function bashFile(output: string, user = "go"): string {
  return jsonl([
    sessionRow(),
    message("u", null, { role: "user", content: user }),
    message("a", "u", { role: "assistant", content: [bashCall("c1", "echo")] }),
    message("r", "a", {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "bash",
      isError: false,
      content: [{ type: "text", text: output }],
    }),
  ]);
}

describe("BashHistoryReader", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function tempDir(): Promise<string> {
    root = await mkdtemp(join(tmpdir(), "pipi-bash-history-"));
    return root;
  }

  it("reads only bash fields on the active branch", async () => {
    const dir = await tempDir();
    const file = join(dir, "branch.jsonl");
    await writeFile(file, jsonl([
      sessionRow(),
      message("u0", null, { role: "user", content: "go" }),
      message("a-old", "u0", { role: "assistant", content: [bashCall("old", "echo abandoned")] }),
      message("r-old", "a-old", {
        role: "toolResult",
        toolCallId: "old",
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "abandoned-secret" }],
      }),
      message("u1", "u0", { role: "user", content: "retry" }),
      message("a-new", "u1", {
        role: "assistant",
        content: [
          { type: "toolCall", id: "grep1", name: "grep", arguments: { pattern: "x" } },
          bashCall("run", "echo hi", { timeout: 1 }),
          bashCall("fail", "false"),
        ],
      }),
      message("r-grep", "a-new", {
        role: "toolResult",
        toolCallId: "grep1",
        toolName: "grep",
        isError: false,
        content: [{ type: "text", text: "not-bash" }],
      }),
      message("r-fail", "r-grep", {
        role: "toolResult",
        toolCallId: "fail",
        toolName: "bash",
        isError: true,
        content: "boom",
      }),
      { type: "thinking_level_change", id: "meta", parentId: null, timestamp: "2026-09-22T00:00:02.000Z" },
    ]));
    const reader = new BashHistoryReader();

    expect(await reader.read(file, "old", "output")).toEqual(unavailable);
    expect(await reader.read(file, "old", "input")).toEqual(unavailable);
    expect(await reader.read(file, "grep1", "output")).toEqual(unavailable);
    expect(await reader.read(file, "missing", "input")).toEqual(unavailable);
    expect(await reader.read(file, "run", "input")).toEqual({
      text: '{"command":"echo hi","timeout":1}',
      totalBytes: Buffer.byteLength('{"command":"echo hi","timeout":1}'),
      truncated: false,
      state: "running",
    });
    expect(await reader.read(file, "run", "output")).toEqual({
      text: "",
      totalBytes: 0,
      truncated: false,
      state: "running",
    });
    expect(await reader.read(file, "fail", "input")).toMatchObject({
      text: '{"command":"false"}',
      state: "failed",
    });
    expect(await reader.read(file, "fail", "output")).toEqual({
      text: "boom",
      totalBytes: 4,
      truncated: false,
      state: "failed",
    });
  });

  it("pages from the start on UTF-8 codepoint boundaries", async () => {
    const dir = await tempDir();
    const file = join(dir, "utf8.jsonl");
    const body = `HEAD${"你".repeat(10923)}TAIL`;
    expect(Buffer.byteLength(body)).toBe(4 + 32769 + 4);
    await writeFile(file, bashFile(body));
    const reader = new BashHistoryReader();

    const first = await reader.read(file, "c1", "output");
    expect(first.state).toBe("completed");
    expect(first.totalBytes).toBe(Buffer.byteLength(body));
    expect(first.truncated).toBe(true);
    expect(first.text.startsWith("HEAD")).toBe(true);
    expect(first.text.includes("TAIL")).toBe(false);
    expect(Buffer.byteLength(first.text)).toBeLessThanOrEqual(32 * 1024);
    expect(first.nextOffset).toBe(Buffer.byteLength(first.text));

    const snapped = await reader.read(file, "c1", "output", (first.nextOffset ?? 0) + 1);
    expect(snapped.text.includes("\uFFFD")).toBe(false);
    expect(snapped.text.startsWith("你")).toBe(true);
    expect(Buffer.byteLength(snapped.text)).toBeLessThanOrEqual(32 * 1024);

    let offset: number | undefined = 0;
    let combined = "";
    for (let guard = 0; offset !== undefined && guard < 5; guard++) {
      const page = await reader.read(file, "c1", "output", offset);
      expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(32 * 1024);
      combined += page.text;
      offset = page.nextOffset;
    }
    expect(combined).toBe(body);
    expect(offset).toBeUndefined();
  });

  it("reads a tool result line that spans scan chunks", async () => {
    const dir = await tempDir();
    const file = join(dir, "span.jsonl");
    const body = `START${"p".repeat(300_000)}END`;
    await writeFile(file, bashFile(body));
    const reader = new BashHistoryReader();
    const page = await reader.read(file, "c1", "output");
    expect(page.state).toBe("completed");
    expect(page.truncated).toBe(true);
    expect(page.text.startsWith("START")).toBe(true);
    expect(page.text.includes("END")).toBe(false);
    expect(page.totalBytes).toBe(Buffer.byteLength(body));
    expect(Buffer.byteLength(page.text)).toBe(32 * 1024);
  });

  it("invalidates the index when the file is appended", async () => {
    const dir = await tempDir();
    const file = join(dir, "live.jsonl");
    await writeFile(file, jsonl([
      sessionRow(),
      message("u", null, { role: "user", content: "go" }),
      message("a", "u", { role: "assistant", content: [bashCall("live", "pwd")] }),
    ]));
    const reader = new BashHistoryReader();
    expect(await reader.read(file, "live", "output")).toEqual({
      text: "",
      totalBytes: 0,
      truncated: false,
      state: "running",
    });
    expect(await reader.read(file, "live", "input")).toMatchObject({
      text: '{"command":"pwd"}',
      state: "running",
    });
    await appendFile(file, JSON.stringify(message("r", "a", {
      role: "toolResult",
      toolCallId: "live",
      toolName: "bash",
      isError: false,
      content: [{ type: "text", text: "ok" }],
    })) + "\n");
    expect(await reader.read(file, "live", "output")).toEqual({
      text: "ok",
      totalBytes: 2,
      truncated: false,
      state: "completed",
    });
  });

  it("drops a same-stamp cache entry on clear", async () => {
    const dir = await tempDir();
    const file = join(dir, "stamp.jsonl");
    // Same file size, but the result line moves so a stale offset cannot parse it.
    const before = bashFile("alpha", "xxxx");
    const after = bashFile("beta!!!", "xx");
    expect(Buffer.byteLength(before)).toBe(Buffer.byteLength(after));
    await writeFile(file, before);
    const stamp = await stat(file);
    const remembered = await rememberStamp(file);
    const warm = new BashHistoryReader();
    const cold = new BashHistoryReader();
    expect((await warm.read(file, "c1", "output")).text).toBe("alpha");
    expect((await cold.read(file, "c1", "output")).text).toBe("alpha");

    await writeFile(file, after);
    expect((await stat(file)).size).toBe(stamp.size);
    await restoreStamp(remembered, file);
    expect((await stat(file)).mtimeMs).toBe(stamp.mtimeMs);

    expect((await warm.read(file, "c1", "output")).text).toBe("beta!!!");
    cold.clear();
    expect((await cold.read(file, "c1", "output")).text).toBe("beta!!!");
  });

  it("keeps at most eight file indexes", async () => {
    const dir = await tempDir();
    const reader = new BashHistoryReader();
    const files: string[] = [];
    for (let index = 0; index < 9; index++) {
      const file = join(dir, `${index}.jsonl`);
      await writeFile(file, bashFile(`v${index}`, "uuuu"));
      files.push(file);
      expect((await reader.read(file, "c1", "output")).text).toBe(`v${index}`);
    }
    const oldest = files[0]!;
    const newest = files[8]!;
    const oldestStamp = await rememberStamp(oldest);
    const newestStamp = await rememberStamp(newest);
    const shiftedOldest = bashFile("ZZZZ", "uu");
    const shiftedNewest = bashFile("YYYY", "uu");
    expect(Buffer.byteLength(shiftedOldest)).toBe((await stat(oldest)).size);
    expect(Buffer.byteLength(shiftedNewest)).toBe((await stat(newest)).size);
    await writeFile(oldest, shiftedOldest);
    await writeFile(newest, shiftedNewest);
    await restoreStamp(oldestStamp, oldest);
    await restoreStamp(newestStamp, newest);

    expect(reader.diagnostics.fullBuilds).toBe(9);
    expect((await reader.read(newest, "c1", "output")).text).toBe("YYYY");
    expect((await reader.read(oldest, "c1", "output")).text).toBe("ZZZZ");
    expect(reader.diagnostics.fullBuilds).toBe(11);
  });

  it("redacts the full field before paging so a secret split by the page boundary is removed", async () => {
    const dir = await tempDir();
    const file = join(dir, "redact.jsonl");
    const secret = "SECRET-VALUE";
    const body = `${"A".repeat(32 * 1024 - 6)}${secret}${"B".repeat(40)}`;
    expect(body.slice(32 * 1024 - 6, 32 * 1024)).toBe("SECRET");
    expect(body.slice(32 * 1024, 32 * 1024 + 6)).toBe("-VALUE");
    await writeFile(file, bashFile(body));
    const reader = new BashHistoryReader();
    const raw = await reader.read(file, "c1", "output");
    expect(raw.text.includes("SECRET")).toBe(true);
    expect(raw.text.includes("-VALUE")).toBe(false);

    const transform = (text: string) => text.replaceAll(secret, "[redacted]");
    let offset: number | undefined = 0;
    let combined = "";
    for (let guard = 0; offset !== undefined && guard < 5; guard++) {
      const page = await reader.read(file, "c1", "output", offset, transform);
      expect(page.text.includes(secret)).toBe(false);
      expect(page.text.includes("SECRET")).toBe(false);
      expect(page.totalBytes).toBe(Buffer.byteLength(transform(body)));
      combined += page.text;
      offset = page.nextOffset;
    }
    expect(combined).toBe(transform(body));
    expect(offset).toBeUndefined();
  });

  it("returns unavailable instead of a partial branch when a file exceeds the entry cap", async () => {
    const dir = await tempDir();
    const file = join(dir, "capped.jsonl");
    await writeFile(file, jsonl([
      sessionRow(),
      message("u", null, { role: "user", content: "go" }),
      message("a", "u", { role: "assistant", content: [bashCall("early", "echo leak")] }),
      message("r", "a", {
        role: "toolResult",
        toolCallId: "early",
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "should-not-leak" }],
      }),
      message("tail", "r", { role: "user", content: "later leaf" }),
    ]));
    const capped = new BashHistoryReader({ maxEntries: 3 });
    expect(await capped.read(file, "early", "output")).toEqual(unavailable);
    expect(await capped.read(file, "early", "input")).toEqual(unavailable);
    const allowed = new BashHistoryReader({ maxEntries: 4 });
    expect(await allowed.read(file, "early", "output")).toMatchObject({
      text: "should-not-leak",
      state: "completed",
    });
  });

  it("counts bash tool hits toward the same per-file cap", async () => {
    const dir = await tempDir();
    const file = join(dir, "tools.jsonl");
    await writeFile(file, jsonl([
      sessionRow(),
      message("u", null, { role: "user", content: "go" }),
      message("a", "u", {
        role: "assistant",
        content: [bashCall("t1", "one"), bashCall("t2", "two"), bashCall("t3", "three")],
      }),
    ]));
    const capped = new BashHistoryReader({ maxEntries: 2 });
    expect(await capped.read(file, "t1", "input")).toEqual(unavailable);
    expect(await capped.read(file, "t3", "input")).toEqual(unavailable);
    const allowed = new BashHistoryReader({ maxEntries: 3 });
    expect(await allowed.read(file, "t3", "input")).toMatchObject({
      text: '{"command":"three"}',
      state: "running",
    });
  });

  it("scans only appended bytes while repeatedly paging an old tool and switching branches", async () => {
    const file = join(await tempDir(), "append-pages.jsonl");
    const body = "x".repeat(400_000);
    await writeFile(file, bashFile(body));
    const reader = new BashHistoryReader();
    await reader.read(file, "c1", "output");
    const initialBytes = reader.diagnostics.scannedBytes;
    expect(initialBytes).toBe((await stat(file)).size);
    let addedBytes = 0;
    let parent = "r";
    for (let index = 0; index < 12; index++) {
      const id = `tail-${index}`;
      const added = jsonl([message(id, parent, { role: "user", content: "continue" })]);
      await appendFile(file, added);
      addedBytes += Buffer.byteLength(added);
      const page = await reader.read(file, "c1", "output", index * 32768);
      expect(page.text).toBe(body.slice(index * 32768, (index + 1) * 32768));
      parent = id;
    }
    expect(reader.diagnostics).toEqual({ fullBuilds: 1, appendBuilds: 12, scannedBytes: initialBytes + addedBytes });
    await appendFile(file, jsonl([
      message("new", "u", { role: "assistant", content: [bashCall("new-tool", "pwd")] }),
    ]));
    expect(await reader.read(file, "c1", "output")).toEqual(unavailable);
    expect((await reader.read(file, "new-tool", "input")).text).toBe('{"command":"pwd"}');
    // An append can also return to the old branch, using retained metadata, not old bodies.
    await appendFile(file, jsonl([message("back", "r", { role: "user", content: "back" })]));
    expect((await reader.read(file, "c1", "output")).totalBytes).toBe(body.length);
    expect(await reader.read(file, "new-tool", "input")).toEqual(unavailable);
    expect(reader.diagnostics.fullBuilds).toBe(1);
  });

  it("rescans an incomplete final line without losing or duplicating it", async () => {
    const file = join(await tempDir(), "partial.jsonl");
    const prefix = bashFile("old");
    const row = JSON.stringify(message("next", "r", { role: "assistant", content: [bashCall("next-tool", "echo 你好")] }));
    const bytes = Buffer.from(row);
    const split = bytes.indexOf(Buffer.from("你好")) + 1;
    await writeFile(file, Buffer.concat([Buffer.from(prefix), bytes.subarray(0, split)]));
    const reader = new BashHistoryReader({ maxEntries: 4 });
    expect((await reader.read(file, "c1", "output")).text).toBe("old");
    expect(await reader.read(file, "next-tool", "input")).toEqual(unavailable);
    await appendFile(file, bytes.subarray(split));
    // A valid JSON final line remains readable even before its newline arrives.
    expect((await reader.read(file, "next-tool", "input")).text).toBe('{"command":"echo 你好"}');
    await appendFile(file, "\n");
    expect((await reader.read(file, "next-tool", "input")).text).toBe('{"command":"echo 你好"}');
    expect(reader.diagnostics.fullBuilds).toBe(1);
    expect(reader.diagnostics.scannedBytes).toBe(Buffer.byteLength(prefix) + split + bytes.length * 2 + 1);
  });

  it("rebuilds for inode replacement, shortening, and a growing rewrite", async () => {
    const file = join(await tempDir(), "replace.jsonl");
    await writeFile(file, bashFile("original"));
    const reader = new BashHistoryReader();
    expect((await reader.read(file, "c1", "output")).text).toBe("original");
    const replacement = `${file}.new`;
    await writeFile(replacement, bashFile("replacement"));
    await rename(replacement, file);
    expect((await reader.read(file, "c1", "output")).text).toBe("replacement");
    await writeFile(file, bashFile("short"));
    expect((await reader.read(file, "c1", "output")).text).toBe("short");
    await writeFile(file, bashFile("growing rewrite"));
    expect((await reader.read(file, "c1", "output")).text).toBe("growing rewrite");
    expect(reader.diagnostics.fullBuilds).toBe(4);
    expect(reader.diagnostics.appendBuilds).toBe(0);
  });

  it("checks both the head and the indexed tail before accepting growth", async () => {
    const file = join(await tempDir(), "boundary-rewrite.jsonl");
    const reader = new BashHistoryReader();
    const original = bashFile("x".repeat(20_000));
    await writeFile(file, original);
    await reader.read(file, "c1", "output");
    const suffix = jsonl([message("more", "r", { role: "user", content: "tail" })]);
    // Same head, changed indexed tail, plus appended bytes.
    await writeFile(file, original.replace(/x(?=x{10}"})/, "y") + suffix);
    await reader.read(file, "c1", "output");
    expect(reader.diagnostics.fullBuilds).toBe(2);
    // Same indexed tail, changed head, plus appended bytes: abandon the old root.
    const current = original.replace(/x(?=x{10}"})/, "y") + suffix;
    await writeFile(file, current.replace('"parentId":"u"', '"parentId":"z"') + jsonl([
      message("reroot", "u", { role: "user", content: "new branch" }),
    ]));
    expect(await reader.read(file, "c1", "output")).toEqual(unavailable);
    expect(reader.diagnostics.fullBuilds).toBe(3);
    expect(reader.diagnostics.appendBuilds).toBe(0);
  });

  it("skips oversized appended lines and resumes at the next complete record", async () => {
    const file = join(await tempDir(), "oversized.jsonl");
    await writeFile(file, bashFile("ok"));
    const reader = new BashHistoryReader();
    await reader.read(file, "c1", "output");
    await appendFile(file, "x".repeat(8 * 1024 * 1024 + 1));
    expect((await reader.read(file, "c1", "output")).text).toBe("ok");
    await appendFile(file, "\n" + jsonl([message("valid", "r", {
      role: "assistant", content: [bashCall("after-large", "pwd")],
    })]));
    expect((await reader.read(file, "after-large", "input")).text).toBe('{"command":"pwd"}');
    expect(reader.diagnostics.fullBuilds).toBe(1);
  });

  it("enforces the metadata cap across appends and recovers after truncation", async () => {
    const file = join(await tempDir(), "append-cap.jsonl");
    await writeFile(file, bashFile("ok"));
    const reader = new BashHistoryReader({ maxEntries: 3 });
    expect((await reader.read(file, "c1", "output")).text).toBe("ok");
    await appendFile(file, jsonl([message("extra", "r", { role: "user", content: "cap" })]));
    expect(await reader.read(file, "c1", "output")).toEqual(unavailable);
    await appendFile(file, jsonl([message("extra2", "extra", { role: "user", content: "cap" })]));
    expect(await reader.read(file, "c1", "output")).toEqual(unavailable);
    await writeFile(file, bashFile("ok"));
    expect((await reader.read(file, "c1", "output")).text).toBe("ok");
  });

  it("reports a missing file or a log without the tool as unavailable", async () => {
    const dir = await tempDir();
    const reader = new BashHistoryReader();
    expect(await reader.read(join(dir, "missing.jsonl"), "c1", "output")).toEqual(unavailable);
    const empty = join(dir, "empty.jsonl");
    await writeFile(empty, jsonl([sessionRow()]));
    expect(await reader.read(empty, "c1", "input")).toEqual(unavailable);
    expect(await reader.read(empty, "c1", "output")).toEqual(unavailable);
  });
});
