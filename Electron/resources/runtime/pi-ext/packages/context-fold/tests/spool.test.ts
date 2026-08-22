/*
 * spool.test.ts — fold spool envelopes: write/read, sha256 dedup, corrupt/missing paths.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpoolStore, SpoolError, sha256Hex } from "../src/adapters/pi/spool";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cf-spool-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("SpoolStore write/read", () => {
	it("round-trips content byte-for-byte with a verified envelope", () => {
		const store = new SpoolStore(dir);
		const content = "line 1\nERROR: boom\n" + "x".repeat(5000);
		const res = store.write({
			blockId: "r:call-1",
			code: "aaaaaa",
			tool: "read",
			input: { path: "/x/y.log" },
			isError: false,
			content,
			now: 1234,
		});
		expect(res.code).toBe("aaaaaa");
		expect(res.dedupOf).toBeUndefined();

		const env = store.read("aaaaaa");
		expect(env.content).toBe(content);
		expect(env.tool).toBe("read");
		expect(env.blockId).toBe("r:call-1");
		expect(env.bytes).toBe(Buffer.byteLength(content, "utf8"));
		expect(env.sha256).toBe(sha256Hex(content));
		expect(env.estTokens).toBeGreaterThan(0);
		expect(env.createdAt).toBe(1234);
	});

	it("carries fullOutputPath and input through the envelope", () => {
		const store = new SpoolStore(dir);
		store.write({
			blockId: "r:c2",
			code: "bbbbbb",
			tool: "bash",
			input: { command: "git log" },
			isError: false,
			content: "commit abc\ncommit def",
			fullOutputPath: "/tmp/full.txt",
		});
		const env = store.read("bbbbbb");
		expect(env.fullOutputPath).toBe("/tmp/full.txt");
		expect((env.input as any).command).toBe("git log");
	});
});

describe("SpoolStore dedup", () => {
	it("stores identical payloads once and aliases the duplicate code", () => {
		const store = new SpoolStore(dir);
		const content = "identical payload " + "z".repeat(3000);
		const first = store.write({ blockId: "r:a", code: "code01", tool: "read", input: {}, isError: false, content });
		const dup = store.write({ blockId: "r:b", code: "code02", tool: "read", input: {}, isError: false, content });

		expect(first.dedupOf).toBeUndefined();
		expect(dup.dedupOf).toBe("code01");
		// The dup's own file is a thin alias (no duplicated content on disk).
		const rawDup = JSON.parse(readFileSync(join(dir, "code02.json"), "utf8"));
		expect(rawDup.aliasOf).toBe("code01");
		expect(rawDup.content).toBe("");
		// But reading the dup code resolves to the full original content.
		expect(store.read("code02").content).toBe(content);
	});

	it("does not treat different payloads as dedup", () => {
		const store = new SpoolStore(dir);
		const a = store.write({ blockId: "r:a", code: "c1", tool: "read", input: {}, isError: false, content: "aaa" });
		const b = store.write({ blockId: "r:b", code: "c2", tool: "read", input: {}, isError: false, content: "bbb" });
		expect(a.dedupOf).toBeUndefined();
		expect(b.dedupOf).toBeUndefined();
	});
});

describe("SpoolStore failure paths", () => {
	it("throws a SpoolError naming the path when the file is missing", () => {
		const store = new SpoolStore(dir);
		try {
			store.read("missing");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(SpoolError);
			expect((e as SpoolError).path).toBe(join(dir, "missing.json"));
			expect((e as SpoolError).code).toBe("missing");
		}
	});

	it("throws a SpoolError on a corrupt (bad JSON) file", () => {
		const store = new SpoolStore(dir);
		store.write({ blockId: "r:a", code: "corr01", tool: "read", input: {}, isError: false, content: "ok" });
		writeFileSync(join(dir, "corr01.json"), "{not json", "utf8");
		expect(() => store.read("corr01")).toThrow(SpoolError);
	});

	it("throws a SpoolError on an sha256 mismatch (tampered content)", () => {
		const store = new SpoolStore(dir);
		store.write({ blockId: "r:a", code: "tamp01", tool: "read", input: {}, isError: false, content: "original" });
		const p = join(dir, "tamp01.json");
		const env = JSON.parse(readFileSync(p, "utf8"));
		env.content = "tampered";
		writeFileSync(p, JSON.stringify(env), "utf8");
		expect(() => store.read("tamp01")).toThrow(/integrity/);
	});
});
