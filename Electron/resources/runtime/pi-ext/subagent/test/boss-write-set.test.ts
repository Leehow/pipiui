/**
 * The Boss's write set: parsing, overlap reporting, and fail-open behaviour.
 *
 * The failure this guards against is silent. A worker branches from HEAD, so it cannot see the
 * Boss's uncommitted edits; when both touch one file in different hunks Git merges them cleanly
 * and reports success while the result is incoherent. `preflightMerge` cannot see it either —
 * it compares committed trees. This module is the only place that knows the working tree exists.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	BOSS_WRITE_SET_ID,
	bossWriteSet,
	formatBossWriteOverlapWarning,
	parsePorcelainZ,
} from "../boss-write-set.ts";

const z = (...entries: string[]) => entries.join("\0") + "\0";
const ok = (stdout: string) => () => ({ ok: true, stdout });

describe("parsePorcelainZ", () => {
	it("reads ordinary staged, unstaged and untracked entries", () => {
		assert.deepEqual(
			parsePorcelainZ(z("M  src/a.ts", " M src/b.ts", "?? src/c.ts")),
			["src/a.ts", "src/b.ts", "src/c.ts"],
		);
	});

	it("keeps both sides of a rename", () => {
		// The Boss holds the old path as a deletion and the new one as an addition; a worker
		// touching either would collide, so reporting only one side hides half the conflict.
		assert.deepEqual(
			parsePorcelainZ(z("R  src/new.ts", "src/old.ts", "M  src/other.ts")),
			["src/new.ts", "src/old.ts", "src/other.ts"],
		);
	});

	it("survives paths with spaces and quotes without a de-quoting step", () => {
		// This is the whole reason for `-z`: porcelain v1 quotes and escapes unusual paths, and
		// a parser that has to undo that is a parser that gets a path wrong under pressure.
		assert.deepEqual(parsePorcelainZ(z('M  src/a b "c".ts')), ["src/a b \"c\".ts"]);
	});

	it("ignores empty and truncated records", () => {
		assert.deepEqual(parsePorcelainZ(""), []);
		assert.deepEqual(parsePorcelainZ(z("M")), []);
	});
});

describe("bossWriteSet", () => {
	it("reports a dirty tree as a scoped agent under the reserved id", () => {
		const set = bossWriteSet("/repo", ok(z("M  src/a.ts")));
		assert.equal(set?.agentId, BOSS_WRITE_SET_ID);
		assert.deepEqual(set?.scope, ["src/a.ts"]);
	});

	it("reserves an id no caller-chosen agentId can collide with", () => {
		// agentIds are 2-24 chars of lowercase/digits/-/_ — parentheses are outside that set.
		assert.match(BOSS_WRITE_SET_ID, /[()]/);
	});

	it("returns null for a clean tree", () => {
		assert.equal(bossWriteSet("/repo", ok("")), null);
	});

	it("fails open on a git failure, a throw, or no cwd", () => {
		// A dispatch must never be blocked because Git was slow, missing, or unexpected: the
		// worst acceptable outcome is exactly the behaviour that shipped before this module.
		assert.equal(bossWriteSet("/repo", () => ({ ok: false, stdout: "" })), null);
		assert.equal(bossWriteSet("/repo", () => { throw new Error("no git"); }), null);
		assert.equal(bossWriteSet(undefined, ok(z("M  src/a.ts"))), null);
		assert.equal(bossWriteSet("   ", ok(z("M  src/a.ts"))), null);
	});
});

describe("formatBossWriteOverlapWarning", () => {
	const boss = bossWriteSet("/repo", ok(z("M  src/quota/pill.ts", "M  docs/readme.md")));

	it("warns when a dispatch scope overlaps what the Boss is editing", () => {
		const text = formatBossWriteOverlapWarning([{ agentId: "quota-pill", scope: ["src/quota/"] }], boss);
		assert.match(text, /\[boss-write-overlap\]/);
		assert.match(text, /agentId=quota-pill/);
		assert.match(text, /src\/quota\/pill\.ts/);
		// The remedy differs from the worker-vs-worker one: the Boss cannot fold itself into a
		// dispatch, so "couple them onto one worker" would be wrong advice here.
		assert.doesNotMatch(text, /couple shared files onto one worker/);
		assert.match(text, /not both/);
	});

	it("says nothing when scopes are disjoint, absent, or the tree is clean", () => {
		assert.equal(formatBossWriteOverlapWarning([{ agentId: "elsewhere", scope: ["src/other/"] }], boss), "");
		assert.equal(formatBossWriteOverlapWarning([{ agentId: "no-scope" }], boss), "");
		assert.equal(formatBossWriteOverlapWarning([{ agentId: "x", scope: ["src/quota/"] }], null), "");
	});

	it("caps the reported paths and says how many it withheld", () => {
		const many = bossWriteSet("/repo", ok(z(...Array.from({ length: 20 }, (_, i) => `M  src/f${i}.ts`))));
		const text = formatBossWriteOverlapWarning([{ agentId: "wide", scope: ["src/"] }], many);
		assert.match(text, /\(\+8 more\)/);
	});

	it("names every overlapping dispatch in a wave, not just the first", () => {
		const text = formatBossWriteOverlapWarning(
			[{ agentId: "a", scope: ["src/quota/"] }, { agentId: "b", scope: ["docs/"] }],
			boss,
		);
		assert.match(text, /agentId=a/);
		assert.match(text, /agentId=b/);
	});
});
