/*
 * recall-reflood.test.ts — regression for a live recall failure: a spooled
 * payload whose content is ONE enormous line (shell wrappers echoing a file as a single string,
 * minified JS, JSONL, base64) must not ride through any recall cap on an "always keep at least
 * one line" rule. Measured live: `recall {code} lines=2-2` returned a 40KB line and re-flooded
 * the folded payload. Every recall surface — whole, lines=, grep=, search= — must hold
 * its cap against this input class, while grep stays USEFUL: the match is windowed, not cut off.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextFoldEngine } from "../src/adapters/pi/store";
import { FoldLadderPolicy } from "../src/core/policy/fold-ladder";
import { MapSpoolRegistry } from "../src/core/spool-registry";
import { SpoolStore } from "../src/adapters/pi/spool";
import { foldCode } from "../src/core/digest";
import type { AgentMessage } from "../src/core/block";
import { user, assistantText, assistantWithCalls, toolResult } from "./helpers";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// ~48KB in THREE lines: a small header, one enormous middle line with a needle buried deep
// (char ~30k), and a small footer — the exact shape of the live failure.
const NEEDLE = "MARKER_C0FFEE_the_buried_answer_is_8931";
const HUGE_LINE = "x".repeat(30_000) + ` ${NEEDLE} ` + "y".repeat(15_000);
const PAYLOAD = ["header line", HUGE_LINE, "footer line"].join("\n");

/** Hard ceiling for any single recall result, with slack for notes. */
const FLOOD_CEILING_CHARS = 9_000;

function setup() {
	dir = mkdtempSync(join(tmpdir(), "contextfold-reflood-"));
	const registry = new MapSpoolRegistry();
	const spool = new SpoolStore(dir);
	const blockId = "r:call-1";
	const code = foldCode(blockId);
	const written = spool.write({ blockId, code, tool: "exec", input: undefined, isError: false, content: PAYLOAD });
	registry.set({
		blockId,
		code,
		fullTokens: written.envelope.estTokens + 4,
		tool: "exec",
		isError: false,
		bytes: written.envelope.bytes,
		fullEstTokens: written.envelope.estTokens,
		spoolPath: spool.pathFor(code),
	});
	const messages: AgentMessage[] = [
		user("read the file"),
		assistantWithCalls([{ id: "call-1", name: "exec" }]),
		toolResult("call-1", PAYLOAD, "exec"),
		assistantText("finished reading", "after-report"),
		user("now the newest question"),
	];
	const e = new ContextFoldEngine(new FoldLadderPolicy(), { tailTarget: 100 }, registry);
	e.process(messages, { contextWindow: 20_000, tokens: null });
	return { e, code };
}

describe("single-huge-line recall caps", () => {
	it("lines= covering the huge line clips it instead of re-flooding", () => {
		const { e, code } = setup();
		const { matches } = e.resolveRecall([code], { lines: "2-2" });
		expect(matches).toHaveLength(1);
		expect(matches[0].text.length).toBeLessThan(FLOOD_CEILING_CHARS);
		expect(matches[0].note).toContain("clipped");
	});

	it("whole recall clips the huge line too", () => {
		const { e, code } = setup();
		const { matches } = e.resolveRecall([code]);
		expect(matches[0].text.length).toBeLessThan(FLOOD_CEILING_CHARS);
	});

	it("grep= finds the needle deep inside the line and windows AROUND it", () => {
		const { e, code } = setup();
		const { matches } = e.resolveRecall([code], { grep: NEEDLE });
		expect(matches[0].text).toContain(NEEDLE); // match visible, not cut off by a head-clip
		expect(matches[0].text.length).toBeLessThan(2_000);
	});

	it("search= sweep windows the match the same way", () => {
		const { e } = setup();
		const sweep = e.searchFolded(NEEDLE);
		expect(sweep.hits).toHaveLength(1);
		expect(sweep.hits[0].lines[0]).toContain(NEEDLE);
		expect(sweep.hits[0].lines[0].length).toBeLessThan(2_000);
	});
});
