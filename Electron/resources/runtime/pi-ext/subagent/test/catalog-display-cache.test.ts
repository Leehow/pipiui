/**
 * Host-written catalog DISPLAY cache semantics (v3, presentation only).
 *
 * The old v2 epoch-sidecar pairing was a cross-process SECURITY protocol; explicit pins are
 * now validated authoritatively over the host bridge (`model_pin_validate`), so this file
 * merely pins down the loader's presentation behavior: valid snapshots advertise refs,
 * everything else (tombstone, unknown version, torn file, stale `.epoch` leftovers)
 * advertises NOTHING. None of these outcomes can widen or narrow what is actually pinnable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PIPIUI_AGENT_DEPTH = "0";
delete process.env.PIPIUI_AGENT_ID;
delete process.env.PIPIUI_AGENT_RUN_ID;
delete process.env.PIPIUI_MAIN_MODEL;
delete process.env.PIPIUI_SUBAGENT_MODELS_FILE;

const { loadSubagentModelCatalog } = await import("../index.ts");

const SNAP_VERSION = 3; // must match pi-backend's SUBAGENT_MODEL_CATALOG_SNAPSHOT_VERSION
const ALPHA = "pinprov/model-alpha";

function harness(): { dir: string; file: string; cleanup: () => void } {
	const dir = join(mkdtempSync(join(tmpdir(), "pipi-catalog-display-")), "agent");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "pipiui-subagent-model-catalog-runtime.json");
	return {
		dir,
		file,
		cleanup: () => rmSync(dir.slice(0, dir.lastIndexOf("agent")), { recursive: true, force: true, maxRetries: 3 }),
	};
}

test("a healthy v3 snapshot advertises exact provider/id refs for the prompt", () => {
	const { file, cleanup } = harness();
	try {
		writeFileSync(file, JSON.stringify({
			version: SNAP_VERSION,
			models: [
				{ id: ALPHA, name: "Alpha" },
				{ id: "pinprov/model-beta" },
				{ id: ALPHA }, // duplicates collapse
				{ id: "" }, // degenerate entries skipped
			],
		}));
		const display = loadSubagentModelCatalog(file);
		assert.deepEqual(display, { available: true, refs: [ALPHA, "pinprov/model-beta"] });
	} finally {
		cleanup();
	}
});

test("tombstones, unknown versions and unreadable files advertise nothing — and that is fine", () => {
	const { file, cleanup } = harness();
	try {
		// Tombstone while the authoritative catalog refreshes / failed a load.
		writeFileSync(file, JSON.stringify({ version: SNAP_VERSION, available: false, reason: "unavailable", models: [] }));
		assert.deepEqual(loadSubagentModelCatalog(file), { available: false, refs: [] });

		// A version this runtime does not know is not permission to guess.
		writeFileSync(file, JSON.stringify({ version: 99, models: [{ id: ALPHA }] }));
		assert.equal(loadSubagentModelCatalog(file).available, false);

		// Torn/corrupt file.
		writeFileSync(file, "{ not json");
		assert.deepEqual(loadSubagentModelCatalog(file), { available: false, refs: [] });

		// Stale epoch sidecar from the retired v2 protocol is ignored entirely: it is no
		// longer part of any contract and never gates the display either way.
		writeFileSync(`${file}.epoch`, "999\n");
		writeFileSync(file, JSON.stringify({ version: SNAP_VERSION, models: [{ id: ALPHA }] }));
		const withLeftover = loadSubagentModelCatalog(file);
		assert.equal(withLeftover.available, true);
		assert.deepEqual(withLeftover.refs, [ALPHA]);
	} finally {
		cleanup();
	}
});

test("missing/unset catalog path renders the empty display without I/O", () => {
	const { file, cleanup } = harness();
	try {
		assert.deepEqual(loadSubagentModelCatalog(undefined), { available: false, refs: [] });
		assert.deepEqual(loadSubagentModelCatalog(file), { available: false, refs: [] });
	} finally {
		cleanup();
	}
});
