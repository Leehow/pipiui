#!/usr/bin/env node
/**
 * Verify the read-only Boss policy against the REAL Pi binary.
 *
 * The unit tests prove `main-tool-policy.ts` returns the right names. They cannot prove Pi
 * honors them, and they cannot see the failure this script exists for: a tool that registers
 * correctly but is never mentioned in the prompt, so the Boss is never told it has it.
 * `ledger_note` shipped that way once — enabled, callable, and invisible.
 *
 * Two sides, neither of them our argv-building code:
 *
 *   registered — every tool our own extensions actually register, collected by loading each
 *                extension with the env the real spawn sets, so env-gated registrations
 *                behave the same way.
 *   advertised — the system prompt the real Pi binary built from the real assembled argv.
 *
 * Requires a working `pi` on PATH and a configured provider. Deliberately not part of
 * `npm test`: it launches real processes and depends on the developer's Pi installation.
 *
 *   npm run check:boss-tools
 *
 * Node's own type stripping, not tsx: an extension that imports `@earendil-works/pi-ai` at
 * runtime resolves only under ESM, and tsx loads these files as CommonJS, where that package's
 * export map has no `require` condition. Under tsx the three biggest extensions — including
 * the one registering `ledger_note` — silently fall into the "not covered" bucket.
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(electronRoot, "resources", "runtime");
const probe = join(electronRoot, "scripts", "boss-tool-probe.ts");
const CAPTURE_TIMEOUT_MS = 30_000;

const { assemblePiSpawn, resolveSpawnPaths, mergedSpawnEnvironment, resolvePiExecutable, withToolPath } =
	await import(join(electronRoot, "packages/pi-backend/src/spawn-assembly.ts"));
const { DEFAULT_FEATURES } = await import(join(electronRoot, "packages/pi-backend/src/features.ts"));
const { BOSS_MUTATION_TOOL_NAMES, resolveMainSessionExcludedTools } =
	await import(join(electronRoot, "packages/pi-backend/src/main-tool-policy.ts"));

const failures = [];
const fail = (message) => { failures.push(message); console.log(`  FAIL  ${message}`); };
const pass = (message) => console.log(`  ok    ${message}`);
const skip = (message) => console.log(`  skip  ${message}`);

// ---------------------------------------------------------------------------
// advertised: what the real Pi tells the model
// ---------------------------------------------------------------------------

/** Launch one real Pi session with the real assembled argv and return its system prompt. */
async function capturePrompt(features) {
	const root = await mkdtemp(join(tmpdir(), "boss-tool-policy-"));
	const cwd = join(root, "project");
	const out = join(root, "probe.json");
	await mkdir(cwd, { recursive: true });
	try {
		const { args, env } = assemblePiSpawn({ cwd, runtimeRoot, features, resourceMode: "explicit", paths: resolveSpawnPaths(runtimeRoot) });
		/*
		 * Report which binary answered. `resolvePiExecutable` searches PATH first, and under
		 * `npm run` npm puts `node_modules/.bin` at the front — where a stale
		 * `@mariozechner/pi-coding-agent` (the pre-rename scope) can still own the `pi` name.
		 * That build predates `--exclude-tools` and exits 1 on it, which looks exactly like a
		 * policy failure and is not one.
		 */
		const pi = resolvePiExecutable(process.env);
		console.log(`  using ${pi}`);
		const child = spawn(pi, ["--mode", "rpc", "--no-session", "-e", probe, ...args], {
			cwd,
			env: withToolPath(mergedSpawnEnvironment(process.env, {}, { ...env, PIPIUI_TOOL_PROBE_OUT: out }), pi),
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
		const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
		try {
			for (;;) {
				try {
					const { systemPrompt } = JSON.parse(await readFile(out, "utf8"));
					if (systemPrompt) return systemPrompt;
				} catch {}
				if (child.exitCode !== null) {
					const hint = /Unknown option: --exclude-tools/.test(stderr)
						? `\n\n${pi} does not support --exclude-tools. That is an old Pi, not a policy failure — check its version and what owns the \`pi\` name on PATH.`
						: "";
					throw new Error(`pi exited (${child.exitCode})\n${stderr}${hint}`);
				}
				if (Date.now() > deadline) throw new Error(`pi did not report within ${CAPTURE_TIMEOUT_MS}ms\n${stderr}`);
				await new Promise((r) => setTimeout(r, 200));
			}
		} finally { child.kill(); }
	} finally {
		await rm(root, { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * The names Pi itemized under `Available tools:` — the curated list the model reads first.
 * Not the same thing as the tool set: every enabled tool's schema reaches the model either
 * way. This list is what Pi puts in front of it, and it only includes tools that declare a
 * `promptSnippet`.
 *
 * The section ends at the first blank line. Do not anchor that with `$` under `/m`, which
 * matches at the end of the *first* line and silently truncates the list to one entry.
 */
function toolList(systemPrompt) {
	const section = /Available tools:\n([\s\S]*?)(?:\n\s*\n|$)/.exec(systemPrompt);
	if (!section) return null;
	return section[1].split("\n")
		.map((line) => /^-\s*([A-Za-z0-9_]+)\s*:/.exec(line.trim())?.[1])
		.filter(Boolean);
}

/**
 * The philosophy layers are the other place a tool gets introduced, and they do not reach the
 * base prompt captured at session start — the extension composes and injects them per turn.
 * Read them from disk instead, resolving the `{{capability}}` placeholders the layers use in
 * place of bare tool names (that indirection is deliberate: see capabilities.json).
 */
async function philosophyText() {
	const root = join(runtimeRoot, "pi-philosophy");
	const { readdir } = await import("node:fs/promises");
	const layers = await readdir(join(root, "layers"));
	const bodies = await Promise.all(layers.map((name) => readFile(join(root, "layers", name), "utf8")));
	const { capabilities } = JSON.parse(await readFile(join(root, "capabilities.json"), "utf8"));
	let text = bodies.join("\n");
	for (const [placeholder, { tool }] of Object.entries(capabilities)) {
		text = text.replaceAll(`{{${placeholder}}}`, tool);
	}
	return text;
}

// ---------------------------------------------------------------------------
// registered: what our own extensions actually register
// ---------------------------------------------------------------------------

/**
 * Load each PipiUI extension mounted for the main session and record its `registerTool`
 * calls. Extensions that cannot be loaded here are reported rather than skipped silently —
 * a check that quietly narrows its own scope is worse than no check.
 */
async function registeredTools(features) {
	// Same inputs as capturePrompt, deliberately: giving this side a bridge the captured
	// session never had would count bridge-gated tools that were never mounted, and report
	// them as missing from a prompt that was right not to mention them.
	const { args, env } = assemblePiSpawn({ cwd: "/tmp", runtimeRoot, features, resourceMode: "explicit", paths: resolveSpawnPaths(runtimeRoot) });
	const paths = [...new Set(args.filter((_, index) => args[index - 1] === "-e"))];

	const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", join(electronRoot, "scripts/collect-extension-tools.mjs")], {
		cwd: electronRoot,
		stdio: ["pipe", "pipe", "pipe"],
	});
	child.stdin.end(JSON.stringify({ paths, env }));
	let stdout = "", stderr = "";
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	const code = await new Promise((r) => child.on("close", r));
	if (code !== 0 || !stdout) throw new Error(`collect-extension-tools exited ${code}\n${stderr}`);

	const { registered, unloadable } = JSON.parse(stdout);
	return { registered: new Map(registered.map((tool) => [tool.name, tool])), unloadable };
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

const legacyFeatures = { ...DEFAULT_FEATURES, bossReadOnly: false };
const readOnlyPrompt = await capturePrompt(DEFAULT_FEATURES);
const legacyPrompt = await capturePrompt(legacyFeatures);

for (const [label, prompt] of [["read-only Boss", readOnlyPrompt], ["flag off", legacyPrompt]]) {
	console.log(`\n${label}: ${toolList(prompt)?.join(", ") ?? "(no tool list found)"}`);
}

console.log("\n== the mutation set is gone, and only because of the flag ==");
for (const name of BOSS_MUTATION_TOOL_NAMES) {
	toolList(readOnlyPrompt)?.includes(name)
		? fail(`${name} is still offered to a read-only Boss`)
		: pass(`${name} removed`);
	if (!toolList(legacyPrompt)?.includes(name)) {
		fail(`${name} is absent with the flag off too — the check above proves nothing`);
	}
}

console.log("\n== the Boss keeps what it reads and verifies with ==");
for (const name of ["read", "git", "ledger_note"]) {
	toolList(readOnlyPrompt)?.includes(name) ? pass(`${name} kept`) : fail(`${name} is missing from a read-only Boss`);
}

/*
 * The general invariant, and the one a name-by-name assertion never catches: a tool we ship
 * should be named somewhere in the prompt the model reads — itemized under `Available tools:`
 * via a promptSnippet, or named in the prompt body (a philosophy layer counts).
 *
 * A tool named in neither is still callable: its schema reaches the model regardless. What it
 * loses is Pi's own steering — the model meets it only as an entry in a tool array, with no
 * guidance about when it is the right call. For a tool the Boss is supposed to reach for by
 * default, that is the difference between a capability and a coincidence. `ledger_note`
 * shipped that way, which is why this check exists.
 */
console.log("\n== every tool we ship is introduced to the model ==");
const layers = await philosophyText();
const baseline = new Set(JSON.parse(await readFile(join(electronRoot, "scripts/boss-tool-policy-baseline.json"), "utf8")).notIntroduced);
for (const [label, features, prompt] of [["read-only Boss", DEFAULT_FEATURES, readOnlyPrompt], ["flag off", legacyFeatures, legacyPrompt]]) {
	const { registered, unloadable } = await registeredTools(features);
	const excluded = new Set(resolveMainSessionExcludedTools({ bossReadOnly: Boolean(features.bossReadOnly) }));
	const expected = [...registered.keys()].filter((name) => !excluded.has(name));
	if (!expected.length) { fail(`${label}: no tools collected — the loader is not seeing our extensions`); continue; }

	const introduced = (name) => (toolList(prompt) ?? []).includes(name) || new RegExp(`\\b${name}\\b`).test(layers);
	const orphans = expected.filter((name) => !introduced(name));
	const known = orphans.filter((name) => baseline.has(name));
	const regressions = orphans.filter((name) => !baseline.has(name));
	const describe = (name) => `${name} (${registered.get(name).path.slice(runtimeRoot.length + 1)})`;

	regressions.length
		? fail(`${label}: newly callable but never introduced: ${regressions.map(describe).join("; ")} — give it a promptSnippet or name it in a philosophy layer`)
		: pass(`${label}: ${expected.length - orphans.length}/${expected.length} shipped tools introduced, no new gaps`);
	if (known.length) skip(`${label}: known gaps, see boss-tool-policy-baseline.json — ${known.join(", ")}`);
	for (const name of baseline) {
		if (expected.includes(name) && introduced(name)) {
			fail(`${label}: ${name} is introduced now — delete it from boss-tool-policy-baseline.json`);
		}
	}

	for (const { path, reason } of unloadable) {
		skip(`${label}: not covered — ${path.slice(runtimeRoot.length + 1)} (${reason})`);
	}
}

console.log(failures.length ? `\n${failures.length} failure(s).` : "\nAll checks passed.");
process.exit(failures.length ? 1 : 0);
