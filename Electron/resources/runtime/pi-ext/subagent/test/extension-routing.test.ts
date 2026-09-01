import test from "node:test";
import assert from "node:assert/strict";

import {
	resolvePipiUIExtensionRouting,
	selectPipiUIExtensionRoutes,
	WEB_ACCESS_EXTENSION_ID,
} from "../desktop-tool-policy.mjs";

const WEB_ACCESS_PATH = "/runtime/extensions/web-access-extension/agent/index.ts";
const ARXIV_PATH = "/runtime/pi-ext/packages/arxiv-fetch";
const FETCH_TRIO = ["fetch_content", "source_check", "get_search_content"];

test("legacy exports keep mounting both the web-access route and the bare arxiv package", () => {
	const routing = resolvePipiUIExtensionRouting({
		webAccessExtension: WEB_ACCESS_PATH,
		arxivExtension: ARXIV_PATH,
		mountedExtensionIds: ["terminal-extension", "vision-routing"],
	});
	assert.deepEqual(routing.routes.map((route) => route.path), [WEB_ACCESS_PATH, ARXIV_PATH]);
	assert.deepEqual(routing.extensionOnlyTools, [...FETCH_TRIO, "arxiv_fetch"]);
});

test("registry-mounted web-access suppresses the bare arxiv route but keeps its tools selectable", () => {
	// Regression: assemblePiSpawn leaves PIPIUI_WEB_ACCESS_EXT unset when
	// web-access-extension is a registered extension, while PIPIUI_ARXIV_EXT is
	// still exported for routing discovery. The worker must not mount the bare
	// package on top of the registry snapshot — pi aborts extension loading on
	// the duplicate arxiv_fetch registration and the worker dies at turns=0.
	const routing = resolvePipiUIExtensionRouting({
		arxivExtension: ARXIV_PATH,
		mountedExtensionIds: [WEB_ACCESS_EXTENSION_ID, "vision-routing"],
	});
	assert.deepEqual(routing.routes, []);
	assert.deepEqual(routing.extensionOnlyTools, [...FETCH_TRIO, "arxiv_fetch"]);
});

test("registry-mounted web-access without the arxiv feature export keeps only the fetch trio", () => {
	const routing = resolvePipiUIExtensionRouting({
		mountedExtensionIds: [WEB_ACCESS_EXTENSION_ID],
	});
	assert.deepEqual(routing.routes, []);
	assert.deepEqual(routing.extensionOnlyTools, [...FETCH_TRIO]);
});

test("bare arxiv package still routes when neither web-access channel is present", () => {
	const routing = resolvePipiUIExtensionRouting({
		arxivExtension: ARXIV_PATH,
		mountedExtensionIds: ["terminal-extension"],
	});
	assert.deepEqual(routing.routes.map((route) => route.path), [ARXIV_PATH]);
	assert.deepEqual(routing.extensionOnlyTools, ["arxiv_fetch"]);
});

test("selection allowing arxiv_fetch yields no -e routes in the registry world", () => {
	const routing = resolvePipiUIExtensionRouting({
		arxivExtension: ARXIV_PATH,
		mountedExtensionIds: [WEB_ACCESS_EXTENSION_ID],
	});
	const routes = selectPipiUIExtensionRoutes(routing, {
		flag: "--tools",
		names: ["arxiv_fetch", "web_search", "fetch_content"],
	});
	assert.deepEqual(routes, []);
});
