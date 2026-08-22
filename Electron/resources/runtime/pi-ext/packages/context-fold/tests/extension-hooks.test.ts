/*
 * extension-hooks.test.ts — the entry point's hook BODIES, not just their registration.
 *
 * extension-load.test.ts proves the hooks get registered; this file drives each one the way Pi
 * drives it. Everything here is wiring that only exists in index.ts — resume restore,
 * session-switch reset, cache telemetry, and deterministic compaction — so a regression would
 * otherwise surface first in a user's session.
 *
 * Skipped when the Pi CLI is not installed alongside (the adapter imports `typebox`, which Pi
 * injects at runtime — see vitest.config.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { user, assistantText, assistantWithCalls, bigResult, toolResult } from "./helpers";
import type { AgentMessage } from "../src/core/block";

const PI_PRESENT = existsSync(resolve(__dirname, "../node_modules/@earendil-works/pi-coding-agent/node_modules/typebox"));

type Hook = (event: unknown, ctx: unknown) => unknown;
interface Entry {
	customType: string;
	data: unknown;
}

/** A stub ExtensionAPI that keeps every registration so the test can invoke it. */
function stubPi() {
	const hooks = new Map<string, Hook>();
	const tools = new Map<string, { execute(id: string, p: Record<string, unknown>): Promise<{ content: { text: string }[] }> }>();
	const commands = new Map<string, { handler(args: unknown, ctx: unknown): Promise<void> }>();
	const entries: Entry[] = [];
	return {
		hooks,
		tools,
		commands,
		entries,
		api: {
			on: (name: string, fn: Hook) => hooks.set(name, fn),
			registerTool: (t: never) => tools.set((t as { name: string }).name, t),
			registerCommand: (name: string, c: never) => commands.set(name, c),
			appendEntry: (customType: string, data?: unknown) => entries.push({ customType, data }),
			setLabel: () => {},
		} as never,
	};
}

let dir: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
	"CONTEXTFOLD",
	"CONTEXTFOLD_COMPACT",
	"CONTEXTFOLD_SPOOL_RETAIN_DAYS",
	"CONTEXTFOLD_FOLD_AT",
	"CONTEXTFOLD_TAIL",
	"CONTEXTFOLD_L0",
	"CONTEXTFOLD_L0_THRESHOLD",
];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cf-hooks-"));
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
	// Spool GC reaps by mtime across sibling sessions; keep it inert so it can't touch a fixture.
	process.env.CONTEXTFOLD_SPOOL_RETAIN_DAYS = "0";
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
});

/** A ctx shaped like Pi's, backed by a real on-disk session dir. */
function ctxFor(opts: { sessionId?: string; entries?: unknown[]; usage?: { contextWindow: number; tokens: number | null } | null } = {}) {
	const notices: string[] = [];
	const statuses: Record<string, string | undefined> = {};
	return {
		notices,
		statuses,
		ctx: {
			model: { id: "test-model", provider: "test" },
			sessionManager: {
				getSessionDir: () => dir,
				getSessionId: () => opts.sessionId ?? "s1",
				getEntries: () => opts.entries ?? [],
			},
			getContextUsage: () => opts.usage ?? { contextWindow: 200_000, tokens: null },
			ui: {
				notify: (m: string) => notices.push(m),
				setStatus: (key: string, text: string | undefined) => {
					statuses[key] = text;
				},
			},
		},
	};
}

async function load() {
	const { default: contextFold } = await import("../src/adapters/pi/index");
	const s = stubPi();
	contextFold(s.api);
	return s;
}

/** A session heavy enough to cross the ladder's first-fold threshold on an 80k window. */
function heavySession(): AgentMessage[] {
	const messages: AgentMessage[] = [user("build the thing")];
	for (let i = 0; i < 8; i++) {
		messages.push(assistantWithCalls([{ id: `c${i}`, name: "read" }]));
		messages.push(bigResult(`c${i}`, 400));
	}
	messages.push(user("now the newest question"));
	return messages;
}

describe.skipIf(!PI_PRESENT)("context hook", () => {
	it("ignores obsolete L0 settings and delivers a large fresh result unchanged", async () => {
		// CONTEXTFOLD_L0* configured the arrival-time ingestion gate removed in 0.3.0 (see
		// CHANGELOG.md). Stale settings from an older install must stay inert, never resurrect it.
		process.env.CONTEXTFOLD_L0 = "1";
		process.env.CONTEXTFOLD_L0_THRESHOLD = "1";
		const s = await load();
		const { ctx } = ctxFor({ usage: { contextWindow: 80_000, tokens: 79_000 } });
		const messages: AgentMessage[] = [
			user("read it"),
			assistantWithCalls([{ id: "fresh", name: "read" }]),
			bigResult("fresh", 500),
		];

		const out = (await s.hooks.get("context")!({ messages }, ctx)) as { messages: AgentMessage[] };
		expect(out.messages).toBe(messages);
		expect(JSON.stringify(out.messages)).not.toContain("FOLDED");
		expect(s.hooks.has("tool_result")).toBe(false);
		expect(s.entries).toEqual([]);
	});

	it("folds the outgoing messages and leaves the caller's array untouched", async () => {
		const s = await load();
		const { ctx } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });
		const messages = heavySession();

		const out = (await s.hooks.get("context")!({ messages }, ctx)) as { messages: AgentMessage[] };
		const folded = out.messages.filter((m) => JSON.stringify(m).includes("FOLDED"));

		expect(folded.length).toBeGreaterThan(0);
		// The input array is Pi's copy; folding must not mutate it in place.
		expect(JSON.stringify(messages)).not.toContain("FOLDED");
	});

	it("sends context raw rather than failing the turn when the pass throws", async () => {
		const s = await load();
		const messages = heavySession();
		const broken = {
			model: { id: "m" },
			sessionManager: { getSessionDir: () => dir, getSessionId: () => "s1", getEntries: () => [] },
			getContextUsage: () => {
				throw new Error("usage exploded");
			},
		};

		const out = (await s.hooks.get("context")!({ messages }, broken)) as { messages: AgentMessage[] };
		expect(out.messages).toBe(messages); // fail-open: the same array, unfolded
	});

	it("keeps a fold raw when its spool cannot be written", async () => {
		const s = await load();
		const blocker = join(dir, "not-a-directory");
		writeFileSync(blocker, "x");
		const { ctx } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });
		ctx.sessionManager.getSessionDir = () => join(blocker, "session");
		const writes: string[] = [];
		const originalWrite = process.stderr.write;
		process.stderr.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			const messages = heavySession();
			const out = (await s.hooks.get("context")!({ messages }, ctx)) as { messages: AgentMessage[] };
			expect(JSON.stringify(out.messages)).not.toContain("FOLDED");
			expect(s.entries.some((entry) => (entry.data as { kind?: string }).kind === "layer")).toBe(false);
		} finally {
			process.stderr.write = originalWrite;
		}
		expect(writes.join("")).toContain("seed-index emission failed (fold skipped)");
	});
});

describe.skipIf(!PI_PRESENT)("session_start hook", () => {
	it("restores a prior session's frozen layers and spool handles", async () => {
		const first = await load();
		const { ctx } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });
		const messages = heavySession();
		await first.hooks.get("context")!({ messages }, ctx);
		expect(first.entries.some((entry) => (entry.data as { kind?: string }).kind === "spool")).toBe(true);
		expect(first.entries.some((entry) => (entry.data as { kind?: string }).kind === "layer")).toBe(true);

		// A fresh process: only the recorded ledger entries survive.
		const resumed = await load();
		const ledger = first.entries.map((e) => ({ customType: e.customType, data: e.data }));
		const resumedCtx = ctxFor({ entries: ledger, usage: { contextWindow: 80_000, tokens: null } }).ctx;
		await resumed.hooks.get("session_start")!({}, resumedCtx);

		const out = (await resumed.hooks.get("context")!({ messages }, resumedCtx)) as { messages: AgentMessage[] };
		expect(JSON.stringify(out.messages)).toContain("FOLDED");
	});

	it("a session switch drops the previous session's codes (they must not serve another session)", async () => {
		const s = await load();
		const firstCtx = ctxFor({ sessionId: "s1", usage: { contextWindow: 80_000, tokens: null } }).ctx;
		await s.hooks.get("session_start")!({}, firstCtx);
		await s.hooks.get("context")!({ messages: heavySession() }, firstCtx);
		const spoolRecord = s.entries.find((entry) => (entry.data as { kind?: string }).kind === "spool")!;
		const code = (spoolRecord.data as { entry: { code: string } }).entry.code;

		// Switch sessions in the same process, carrying no ledger into the new one.
		await s.hooks.get("session_start")!({}, ctxFor({ sessionId: "s2", entries: [] }).ctx);

		const res = await s.tools.get("recall_folded")!.execute("t1", { codes: [code] });
		expect(res.content.map((c) => c.text).join("")).toContain("no folded block with that code");
	});
});

describe.skipIf(!PI_PRESENT)("session_before_compact hook", () => {
	it("replaces Pi's LLM summary with a deterministic one rendered from the seed index", async () => {
		process.env.CONTEXTFOLD_COMPACT = "det";
		const s = await load();
		const { ctx } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });

		// Drive a fold event first so the seed index has something to render from.
		await s.hooks.get("context")!({ messages: heavySession() }, ctx);

		const prep = {
			messagesToSummarize: heavySession(),
			turnPrefixMessages: [],
			tokensBefore: 40_000,
			firstKeptEntryId: "e9",
		};
		const out = (await s.hooks.get("session_before_compact")!({ preparation: prep }, ctx)) as {
			compaction: { summary: string; firstKeptEntryId: string };
		};

		expect(out.compaction.firstKeptEntryId).toBe("e9");
		expect(out.compaction.summary).toContain("deterministic seed index");
		expect(out.compaction.summary).toContain("no model involved");
	});

	it("carries a previous summary forward but marks it untrusted", async () => {
		process.env.CONTEXTFOLD_COMPACT = "det";
		const s = await load();
		const { ctx } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });
		await s.hooks.get("context")!({ messages: heavySession() }, ctx);

		const out = (await s.hooks.get("session_before_compact")!(
			{
				preparation: {
					messagesToSummarize: heavySession(),
					turnPrefixMessages: [],
					tokensBefore: 40_000,
					firstKeptEntryId: "e9",
					previousSummary: "An earlier model wrote this.",
				},
			},
			ctx,
		)) as { compaction: { summary: string } };

		expect(out.compaction.summary).toContain("An earlier model wrote this.");
		expect(out.compaction.summary).toContain("UNTRUSTED");
	});

	// Pi splits a mid-turn cut into TWO arrays: `messagesToSummarize` (whole turns before the
	// cut's turn) and `turnPrefixMessages` (the cut turn's own head). BOTH leave live history —
	// Pi's native path summarizes the prefix separately, and an extension that returns a summary
	// replaces that path entirely. Reading only `messagesToSummarize` therefore drops the prefix
	// with no summary text and no spool route. When the cut lands inside the FIRST turn,
	// `messagesToSummarize` is empty and the whole session would vanish behind a bare header.
	it("covers turnPrefixMessages, the mid-turn half Pi also drops", async () => {
		process.env.CONTEXTFOLD_COMPACT = "det";
		const s = await load();
		const { ctx } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });

		// Exactly the live shape that lost a session's history: the cut fell inside the opening turn, so
		// everything the session had done sat in the turn prefix and nothing preceded it.
		const prefix: AgentMessage[] = [
			user("trace the overflow path"),
			assistantWithCalls([{ id: "tp0", name: "read" }]),
			toolResult("tp0", `SENTINEL_PREFIX_BODY\n${"line of prefix output\n".repeat(400)}`),
			assistantText("the prefix turn reached this conclusion"),
		];

		const out = (await s.hooks.get("session_before_compact")!(
			{ preparation: { messagesToSummarize: [], turnPrefixMessages: prefix, tokensBefore: 40_000, firstKeptEntryId: "e9" } },
			ctx,
		)) as { compaction: { summary: string } };

		// The prefix must survive as recoverable detail, not just as a header. Assert on the block
		// BODY, never on the search term itself — a miss echoes the term back and would pass.
		const hit = await s.tools.get("recall_folded")!.execute("t1", { search: "SENTINEL_PREFIX_BODY" });
		const hitText = hit.content.map((c) => c.text).join("");
		expect(hitText).toContain("1 matching line");
		const code = /=== (\w+) \(/.exec(hitText)?.[1];
		expect(code).toBeTruthy();
		const body = await s.tools.get("recall_folded")!.execute("t2", { codes: [code!] });
		expect(body.content.map((c) => c.text).join("")).toContain("line of prefix output");
		expect(out.compaction.summary).toContain("trace the overflow path");
	});

	it("does not register a competing hook under CONTEXTFOLD_COMPACT=native", async () => {
		process.env.CONTEXTFOLD_COMPACT = "native";
		const s = await load();

		expect(s.hooks.has("session_before_compact")).toBe(false);
	});
});

describe.skipIf(!PI_PRESENT)("message_end hook and the status command", () => {
	it("records provider usage and reports it through /context-fold", async () => {
		const s = await load();
		const { ctx, notices } = ctxFor();

		await s.hooks.get("message_end")!({ message: { role: "assistant", usage: { input: 1000, cacheRead: 3000, cacheWrite: 0, output: 50 } } }, ctx);
		await s.commands.get("context-fold")!.handler("", ctx);

		expect(notices.join("\n")).toContain("cache read 3.0k");
	});

	it("ignores messages that carry no usage", async () => {
		const s = await load();
		const { ctx, notices } = ctxFor();

		await s.hooks.get("message_end")!({ message: { role: "user" } }, ctx);
		await s.commands.get("context-fold")!.handler("", ctx);

		expect(notices.join("\n")).toContain("no usage yet");
	});

	it("waits for agent_settled before warning that a session is cold", async () => {
		const s = await load();
		const { ctx } = ctxFor();
		const writes: string[] = [];
		const originalWrite = process.stderr.write;
		process.stderr.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 5_000, cacheRead: 30_000, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 40_000, cacheRead: 0, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			expect(writes.join("")).not.toContain("session cold");

			await s.hooks.get("agent_settled")!({}, ctx);
			expect(writes.filter((w) => w.includes("session cold"))).toHaveLength(1);
		} finally {
			process.stderr.write = originalWrite;
		}
	});

	it("does not warn when an intermediate miss recovers before the agent settles", async () => {
		const s = await load();
		const { ctx } = ctxFor();
		const writes: string[] = [];
		const originalWrite = process.stderr.write;
		process.stderr.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 40_000, cacheRead: 0, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 1_000, cacheRead: 40_000, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("agent_settled")!({}, ctx);
			expect(writes.join("")).not.toContain("session cold");
		} finally {
			process.stderr.write = originalWrite;
		}
	});

	it("does not misclassify the expected post-fold cache miss at settlement", async () => {
		const s = await load();
		const { ctx } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });
		await s.hooks.get("message_end")!(
			{ message: { role: "assistant", usage: { input: 5_000, cacheRead: 30_000, cacheWrite: 0, output: 50 } } },
			ctx,
		);
		await s.hooks.get("context")!({ messages: heavySession() }, ctx);

		const writes: string[] = [];
		const originalWrite = process.stderr.write;
		process.stderr.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 40_000, cacheRead: 0, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("agent_settled")!({}, ctx);
			expect(writes.join("")).not.toContain("session cold");
		} finally {
			process.stderr.write = originalWrite;
		}
	});

	it("does not let post-fold suppression reset an existing cold streak", async () => {
		const s = await load();
		const { ctx } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });
		const writes: string[] = [];
		const originalWrite = process.stderr.write;
		process.stderr.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 5_000, cacheRead: 30_000, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 40_000, cacheRead: 0, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("agent_settled")!({}, ctx);

			await s.hooks.get("context")!({ messages: heavySession() }, ctx);
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 40_000, cacheRead: 0, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("agent_settled")!({}, ctx);
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 40_000, cacheRead: 0, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("agent_settled")!({}, ctx);

			expect(writes.filter((w) => w.includes("session cold"))).toHaveLength(1);
		} finally {
			process.stderr.write = originalWrite;
		}
	});

	it("warns again after a genuine warm recovery starts a new cold streak", async () => {
		const s = await load();
		const { ctx } = ctxFor();
		const writes: string[] = [];
		const originalWrite = process.stderr.write;
		process.stderr.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 5_000, cacheRead: 30_000, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 40_000, cacheRead: 0, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("agent_settled")!({}, ctx);

			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 1_000, cacheRead: 40_000, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("agent_settled")!({}, ctx);
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 40_000, cacheRead: 0, cacheWrite: 0, output: 50 } } },
				ctx,
			);
			await s.hooks.get("agent_settled")!({}, ctx);

			expect(writes.filter((w) => w.includes("session cold"))).toHaveLength(2);
		} finally {
			process.stderr.write = originalWrite;
		}
	});
});

describe.skipIf(!PI_PRESENT)("footer status line", () => {
	it("shows idle at session start, then a fold summary with nothing left maskable after a fold event", async () => {
		const s = await load();
		const { ctx, statuses } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });

		await s.hooks.get("session_start")!({}, ctx);
		expect(statuses["context-fold"]).toContain("idle");

		await s.hooks.get("context")!({ messages: heavySession() }, ctx);
		expect(statuses["context-fold"]).toContain("×1");
		expect(statuses["context-fold"]).toContain("tok masked");
		// The fold consumed every eligible block, so the gauge restarts counting toward the next
		// step — an interim state that refills as new observations land, not a terminal one.
		expect(statuses["context-fold"]).toMatch(/next fold: 0\/\S+ maskable/);
	});

	it("names the configured entry threshold while usage is still below it", async () => {
		process.env.CONTEXTFOLD_FOLD_AT = "0.6";
		const s = await load();
		const { ctx, statuses } = ctxFor({ usage: { contextWindow: 80_000, tokens: 30_000 } });

		await s.hooks.get("context")!({ messages: heavySession() }, ctx);
		expect(statuses["context-fold"]).toContain("next fold at 60% ctx");
		expect(statuses["context-fold"]).not.toContain("×");
	});

	it("tracks maskable mass toward the next step once usage is past the threshold", async () => {
		process.env.CONTEXTFOLD_TAIL = "1000"; // shrink the protected tail so one older result is maskable
		const s = await load();
		const { ctx, statuses } = ctxFor({ usage: { contextWindow: 80_000, tokens: 40_000 } });
		const messages: AgentMessage[] = [
			user("build the thing"),
			assistantWithCalls([{ id: "c0", name: "read" }]),
			bigResult("c0", 200),
			assistantWithCalls([{ id: "c1", name: "read" }]),
			bigResult("c1", 200),
			user("now the newest question"),
		];

		// 40k/80k = 50% ≥ the 45% threshold, but only ~2.5k of maskable mass (< the 9.6k step):
		// no fold fires, and the gauge shows progress toward the step instead of the usage threshold.
		await s.hooks.get("context")!({ messages }, ctx);
		expect(statuses["context-fold"]).toMatch(/next fold: \S+\/\S+ maskable/);
		expect(statuses["context-fold"]).not.toContain("×");
	});

	it("shows an empty step gauge past the threshold with nothing maskable yet", async () => {
		const s = await load();
		const { ctx, statuses } = ctxFor({ usage: { contextWindow: 80_000, tokens: 40_000 } });

		// Pure conversation: no tool results or thinking anywhere, so the ladder has nothing to work
		// with even though usage (50%) is past the 45% threshold. Still interim — a big tool result
		// next turn would start filling the gauge — so it counts from zero rather than declaring
		// folding impossible.
		await s.hooks.get("context")!({ messages: [user("hi"), assistantText("a long answer"), user("more")] }, ctx);
		expect(statuses["context-fold"]).toMatch(/next fold: 0\/\S+ maskable/);
		expect(statuses["context-fold"]).not.toContain("×");
	});

	it("declares no more folds possible only when the irreducible floor is over budget", async () => {
		const s = await load();
		// 70k reported of an 80k window is past the 60k budget (0.75 × window), and a pure-text
		// conversation leaves nothing maskable: the terminal state, not an interim one.
		const { ctx, statuses } = ctxFor({ usage: { contextWindow: 80_000, tokens: 70_000 } });

		await s.hooks.get("context")!({ messages: [user("hi"), assistantText("x".repeat(280_000)), user("more")] }, ctx);
		expect(statuses["context-fold"]).toContain("⚠ no more folds possible (over budget)");
	});

	it("survives a ctx whose ui has no setStatus (headless stubs, older hosts)", async () => {
		const s = await load();
		const bare = ctxFor({ usage: { contextWindow: 80_000, tokens: null } }).ctx as { ui?: unknown };
		bare.ui = undefined;

		await expect(Promise.resolve(s.hooks.get("context")!({ messages: heavySession() }, bare))).resolves.toBeTruthy();
	});
});

describe.skipIf(!PI_PRESENT)("wire watchdog (folds that never reach the provider)", () => {
	/** Turn usage where the next turn reads the whole pre-fold prompt back from cache. */
	async function foldThenDeferredTurn(s: Awaited<ReturnType<typeof load>>, ctx: unknown) {
		await s.hooks.get("message_end")!(
			{ message: { role: "assistant", usage: { input: 10_000, cacheRead: 30_000, cacheWrite: 0, output: 50 } } },
			ctx,
		);
		await s.hooks.get("context")!({ messages: heavySession() }, ctx); // fold event fires here
		await s.hooks.get("message_end")!(
			{ message: { role: "assistant", usage: { input: 5_000, cacheRead: 41_000, cacheWrite: 0, output: 50 } } },
			ctx,
		);
	}

	it("warns on stderr once per session and raises the status flag", async () => {
		const s = await load();
		const { ctx, notices } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });

		const writes: string[] = [];
		const originalWrite = process.stderr.write;
		process.stderr.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			await foldThenDeferredTurn(s, ctx);
			// A second deferred turn must not warn again.
			await s.hooks.get("message_end")!(
				{ message: { role: "assistant", usage: { input: 5_000, cacheRead: 46_000, cacheWrite: 0, output: 50 } } },
				ctx,
			);
		} finally {
			process.stderr.write = originalWrite;
		}

		const warnings = writes.filter((w) => w.includes("not observed on the wire"));
		expect(warnings.length).toBe(1);

		await s.commands.get("context-fold")!.handler("", ctx);
		expect(notices.join("\n")).toContain("not observed on the wire");
	});

	it("a fold whose next turn shows the prefix rewrite stays quiet", async () => {
		const s = await load();
		const { ctx, notices } = ctxFor({ usage: { contextWindow: 80_000, tokens: null } });

		await s.hooks.get("message_end")!(
			{ message: { role: "assistant", usage: { input: 10_000, cacheRead: 30_000, cacheWrite: 0, output: 50 } } },
			ctx,
		);
		await s.hooks.get("context")!({ messages: heavySession() }, ctx);
		// Cache read collapses below the pre-fold prompt: the rewrite reached the wire.
		await s.hooks.get("message_end")!(
			{ message: { role: "assistant", usage: { input: 3_000, cacheRead: 12_000, cacheWrite: 25_000, output: 50 } } },
			ctx,
		);

		await s.commands.get("context-fold")!.handler("", ctx);
		expect(notices.join("\n")).not.toContain("not observed on the wire");
	});
});
