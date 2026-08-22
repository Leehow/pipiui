/*
 * handoff.test.ts — the opt-in handoff seed: deterministic index plus the stated goal, with
 * nothing in the file that a model wrote.
 */
import { describe, expect, it } from "vitest";
import { buildHandoffSeed } from "../src/adapters/pi/handoff";

const indexBody = "# Compaction summary (deterministic seed index — no model involved)\n- fact";

describe("handoff seed", () => {
	it("states the goal and carries the index verbatim", () => {
		const seed = buildHandoffSeed({ goal: "port the adapter to another harness", indexBody, at: "2026-07-28" });
		expect(seed).toContain("port the adapter to another harness");
		expect(seed).toContain(indexBody);
		expect(seed).toContain("extracted verbatim");
	});

	it("says so plainly when no goal was given", () => {
		const seed = buildHandoffSeed({ goal: "", indexBody, at: "2026-07-28" });
		expect(seed).toContain("(not stated");
		expect(seed).toContain(indexBody);
	});
});
