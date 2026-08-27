/**
 * Host-authority pin validation: transport semantics and wire contract.
 *
 * The ONLY acceptance path for an explicit dispatch pin is one batched
 * `model_pin_validate` RPC over the loopback bridge. This suite drives the REAL runtime
 * helper against REAL HTTP servers and proves every non-decision outcome — missing
 * capability/protocol, connection refused, hard timeout, HTTP errors, malformed bodies,
 * unknown schemas — fails closed with the same stable shape, plus that zero-pin calls never
 * touch the network at all. Canonical v1 only: the legacy bridge shape has no endpoint and
 * must never receive one.
 *
 * Each node:test FILE runs in its own process, so the bridge env pinned below is captured
 * by index.ts exactly once, before its single dynamic import.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.PIPIUI_AGENT_DEPTH = "0";
delete process.env.PIPIUI_AGENT_ID;
delete process.env.PIPIUI_AGENT_RUN_ID;
delete process.env.PIPIUI_MAIN_MODEL;
delete process.env.PIPIUI_SUBAGENT_MODELS_FILE;

// ---- Phase 1: pure encoder/parser units (no module-level state) -------------------------
const { encodeModelPinValidateBridgeRequestV1, parseModelPinValidateDecisionV1 } = await import("../host-bridge.ts");
const ENV_CANONICAL = {
	PIPIUI_HOST_PROTOCOL: "1",
	PIPIUI_SESSION_KEY: "legacy-key",
	PIPIUI_SESSION_CAPABILITY: "cap-abc",
};
const LEGACY_ENV = { PIPIUI_SESSION_KEY: "legacy-key" };
const BLANK_ENV = {};

test("encoder: canonical v1 only — legacy/blank environments fail closed", () => {
	const ok = encodeModelPinValidateBridgeRequestV1(["prov/model-a"], ENV_CANONICAL);
	assert.deepEqual(ok, {
		schemaVersion: 1,
		sessionCapability: "cap-abc",
		action: "model_pin_validate",
		event: { schemaVersion: 1, refs: ["prov/model-a"] },
	});
	assert.equal(encodeModelPinValidateBridgeRequestV1(["prov/model-a"], LEGACY_ENV), undefined);
	assert.equal(encodeModelPinValidateBridgeRequestV1(["prov/model-a"], BLANK_ENV), undefined);
	// Missing capability under an otherwise canonical envelope is also a refusal.
	assert.equal(
		encodeModelPinValidateBridgeRequestV1(["prov/model-a"], { PIPIUI_HOST_PROTOCOL: "1" }),
		undefined,
	);
});

test("encoder: ref hygiene bounds are enforced client-side", () => {
	const many = Array.from({ length: 1000 }, (_, i) => `prov/m-${i}`);
	assert.ok(encodeModelPinValidateBridgeRequestV1(many, ENV_CANONICAL));
	assert.equal(encodeModelPinValidateBridgeRequestV1([...many, "prov/one-too-many"], ENV_CANONICAL), undefined);
	assert.equal(encodeModelPinValidateBridgeRequestV1([], ENV_CANONICAL), undefined);
	assert.equal(encodeModelPinValidateBridgeRequestV1([`prov/${"x".repeat(300)}`], ENV_CANONICAL), undefined);
	assert.equal(encodeModelPinValidateBridgeRequestV1(["prov/a", 42 as unknown as string], ENV_CANONICAL), undefined);
	// A blank-after-trim ref would produce a pointless RPC — refused up front.
	assert.equal(encodeModelPinValidateBridgeRequestV1(["   "], ENV_CANONICAL), undefined);
});

test("parser: only exact v1 decision envelopes pass", () => {
	assert.deepEqual(parseModelPinValidateDecisionV1({ schemaVersion: 1, decision: "allow", authorityRevision: 7 }), {
		schemaVersion: 1,
		decision: "allow",
		authorityRevision: 7,
	});
	const deny = { schemaVersion: 1, decision: "deny", code: "model_unavailable", invalidIndex: 2, authorityRevision: 9, retryable: false };
	assert.deepEqual(parseModelPinValidateDecisionV1(deny), deny);
	for (const junk of [
		null,
		undefined,
		"ok",
		{},
		{ schemaVersion: 2, decision: "allow", authorityRevision: 1 },
		{ schemaVersion: 1, decision: "maybe", authorityRevision: 1 },
		{ schemaVersion: 1, decision: "deny", code: "shrug", authorityRevision: 1, retryable: true },
		{ schemaVersion: 1, decision: "deny", code: "model_unavailable", authorityRevision: 1 },
		{ schemaVersion: 1, decision: "allow", authorityRevision: "seven" },
	]) {
		assert.equal(parseModelPinValidateDecisionV1(junk), undefined, JSON.stringify(junk));
	}
});

// ---- Phase 2: end-to-end helper against live servers ------------------------------------
const ALLOW = { schemaVersion: 1, decision: "allow", authorityRevision: 1234 } as const;
let currentBehavior: ServerBehavior = (_req, _body, res) => {
	res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(ALLOW));
};
const started = await new Promise<{ server: http.HttpServer; port: number }>((resolve) => {
	const server = http.createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (c: Buffer) => chunks.push(c));
		request.on("end", () => currentBehavior(request, Buffer.concat(chunks).toString("utf8"), response));
	});
	server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port }));
});
process.env.PIPIUI_BRIDGE_PORT = String(started.port);
process.env.PIPIUI_HOST_PROTOCOL = "1";
process.env.PIPIUI_SESSION_CAPABILITY = "pin-rpc-fixture-capability";
const { validateDispatchModelPinsViaHost } = await import("../index.ts");

/** Swap the fixture behavior between scenarios. */
function setBehavior(next: ServerBehavior): void {
	currentBehavior = next;
}

test("allow decision carries the authority revision into every branded pin", async () => {
	let seen: Record<string, unknown> | undefined;
	setBehavior((_req, body, res) => {
		seen = JSON.parse(body);
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(ALLOW));
	});
	const result = await validateDispatchModelPinsViaHost([
		{ label: "model", model: "prov/one" },
		{ label: "tasks[0].model", model: "prov/two" },
		{ label: "chain[3].model", model: " prov/three " },
	]);
	assert.equal(result.ok, true);
	assert.equal(result.pins!.get("prov/three")!.ref, "prov/three");
	assert.equal(result.pins!.get("prov/one")!.authorityRevision, 1234);
	assert.ok(seen);
	assert.deepEqual(Object.keys(seen!).sort(), ["action", "event", "schemaVersion", "sessionCapability"]);
	assert.equal(seen!.action, "model_pin_validate");
	assert.equal(seen!.sessionCapability, "pin-rpc-fixture-capability");
	const event = seen!.event as Record<string, unknown>;
	assert.deepEqual((event.refs as string[]).sort(), ["prov/one", "prov/three", "prov/two"]);
	// Wire contract leaks nothing project-shaped or secret-shaped.
	const serialized = JSON.stringify(seen);
	for (const banned of ["agentDir", "cwd", "projectRoot", "catalogFile", "apiKey", "authPath"]) {
		assert.equal(serialized.includes(banned), false, `wire body must not carry ${banned}`);
	}
});

test("logical denies surface stable codes and name the offending label/ref", async () => {
	setBehavior((_req, _body, res) => {
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
			schemaVersion: 1,
			decision: "deny",
			code: "model_unavailable",
			invalidIndex: 0,
			authorityRevision: 55,
			retryable: false,
		}));
	});
	const denied = await validateDispatchModelPinsViaHost([
		{ label: "tasks[4].model", model: "prov/gone" },
		{ label: "model", model: "prov/live" },
	]);
	assert.equal(denied.ok, false);
	assert.match(denied.problem, /\[model_unavailable\]/);
	assert.match(denied.problem, /tasks\[4\]\.model/);
	assert.match(denied.problem, /prov\/gone/);

	setBehavior((_req, _body, res) => {
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
			schemaVersion: 1,
			decision: "deny",
			code: "catalog_unavailable",
			authorityRevision: -1,
			retryable: true,
		}));
	});
	const closed = await validateDispatchModelPinsViaHost([{ label: "model", model: "prov/one" }]);
	assert.equal(closed.ok, false);
	assert.match(closed.problem, /\[model_catalog_unavailable\]/);
	assert.match(closed.problem, /重试|省略/);
});

test("transport failures all collapse to model_pin_host_unavailable — never a default fallback", async () => {
	// HTTP 403 (forged capability) is still sanitized into the transport-shaped refusal.
	setBehavior((_req, _body, res) => {
		res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: "unauthorized bridge capability" }));
	});
	let out = await validateDispatchModelPinsViaHost([{ label: "model", model: "prov/one" }]);
	assert.equal(out.ok, false);
	assert.match(out.problem, /\[model_pin_host_unavailable\]/);

	// HTTP 500.
	setBehavior((_req, _body, res) => {
		res.writeHead(500).end("boom");
	});
	out = await validateDispatchModelPinsViaHost([{ label: "model", model: "prov/one" }]);
	assert.match(out.problem, /\[model_pin_host_unavailable\]/);

	// Malformed body.
	setBehavior((_req, _body, res) => {
		res.writeHead(200, { "content-type": "application/json" }).end("<html>not json</html>");
	});
	out = await validateDispatchModelPinsViaHost([{ label: "model", model: "prov/one" }]);
	assert.match(out.problem, /\[model_pin_host_unavailable\]/);

	// Wrong/incomplete decision schema.
	setBehavior((_req, _body, res) => {
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, decision: "sure" }));
	});
	out = await validateDispatchModelPinsViaHost([{ label: "model", model: "prov/one" }]);
	assert.match(out.problem, /\[model_pin_host_unavailable\]/);

	// Hard timeout: a silently hanging host must cut off at 1500 ms (bounded slack).
	setBehavior(() => {/* never respond */});
	const t0 = Date.now();
	out = await validateDispatchModelPinsViaHost([{ label: "model", model: "prov/one" }]);
	const elapsed = Date.now() - t0;
	assert.match(out.problem, /\[model_pin_host_unavailable\]/);
	assert.ok(elapsed < 4000, `timeout path took ${elapsed}ms`);

	// Connection refused: the server itself is gone entirely.
	await new Promise<void>((resolve) => started.server.close(() => resolve()));
	out = await validateDispatchModelPinsViaHost([{ label: "model", model: "prov/one" }]);
	assert.equal(out.ok, false);
	assert.match(out.problem, /\[model_pin_host_unavailable\]/);

	// And with NO host at all, a zero-pin batch succeeds WITHOUT touching any network —
	// default resolution stays unblocked and free.
	const noPins = await validateDispatchModelPinsViaHost([
		{ label: "model", model: undefined },
		{ label: "tasks[0].model", model: null },
	]);
	assert.equal(noPins.ok, true);
	assert.equal(noPins.pins?.size ?? 0, 0);
});
