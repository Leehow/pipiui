/**
 * Boss ledger seed template and first-dispatch write.
 * Pure move from index.ts — behavior preserved.
 */

import * as fs from "node:fs";
import * as path from "node:path";

let seededLedger = false;

/**
 * Seed the boss ledger the first time this session actually dispatches.
 *
 * The layout used to live in the system prompt — roughly 380 tokens of template resident on
 * every turn so that it would be correct on the few turns that write it. Creating the file
 * with its sections already laid out puts the format where it is used and costs nothing per
 * turn. Never overwrites: an existing ledger is the session's own state.
 */
export function seedBossLedger(mainCwd: string | undefined, sessionKey: string | undefined): void {
	if (seededLedger || !mainCwd) return;
	seededLedger = true;
	const key = sessionKey?.trim() || "terminal";
	const dir = path.join(mainCwd, ".pi", "boss");
	const file = path.join(dir, `ledger-${key}.md`);
	try {
		if (fs.existsSync(file)) return;
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			file,
			[
				"# Ledger",
				"<one-line session goal>",
				"",
				"## Decisions",
				"<!-- user mid-course changes / additions / cancellations: time + content + affected task IDs -->",
				"",
				"## Tasks",
				"| ID | title | status | agent | wave | notes | blocked-by |",
				"| -- | ----- | ------ | ----- | ---- | ----- | ---------- |",
				"<!-- status: pending | in-flight | blocked | done | cancelled -->",
				"<!-- blocked-by: machine-readable dependency tags (task/agentId short names); informational only -->",
				"",
				"## Done",
				"<!-- one line per finished task: conclusion + key evidence (file paths / command results) -->",
				"",
				"## Risks & open questions",
				"",
				"## Closeout dispositions",
				"| item | disposition | evidence/reason |",
				"| ---- | ----------- | --------------- |",
				"<!-- disposition: cleaned | retained | needs-fixer | needs-user -->",
				"",
			].join("\n"),
			"utf-8",
		);
	} catch {
		// The boss can still create it itself; never fail a dispatch over bookkeeping.
	}
}
