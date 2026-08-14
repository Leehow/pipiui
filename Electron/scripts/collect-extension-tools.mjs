#!/usr/bin/env node --experimental-strip-types
/**
 * Load the extensions named on stdin and report the tools each one registers, as JSON.
 *
 * A separate process because the two halves of `check-boss-tool-policy.mjs` need different
 * TypeScript loaders: pi-backend's sources import each other with `.js` specifiers, which
 * only tsx rewrites, while the runtime extensions import `@earendil-works/pi-ai` at runtime,
 * which resolves only under Node's own ESM type stripping. Running one under the other
 * silently drops whichever half it cannot load.
 *
 * Input  (stdin):  {"paths": ["/abs/ext.ts", "/abs/package-dir"], "env": {...}}
 * Output (stdout): {"registered": [{name, path, promptSnippet}], "unloadable": [{path, reason}]}
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const { paths, env } = JSON.parse(readFileSync(0, "utf8"));
for (const [key, value] of Object.entries(env ?? {})) process.env[key] = value;

/**
 * Resolve a directory mounted with `-e <dir>` the way Pi does: a package declares its entry in
 * package.json, and a plain directory (the subagent extension is one) resolves to index.ts.
 */
function directoryEntrypoint(dir) {
	try {
		const entry = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))?.pi?.extensions?.[0];
		if (entry) return resolve(dir, entry);
	} catch { /* no manifest: fall through to the plain-directory form */ }
	return join(dir, "index.ts");
}

const registered = [];
const unloadable = [];
const noop = () => {};

for (const path of paths) {
	try {
		const module = await import(path.endsWith(".ts") ? path : directoryEntrypoint(path));
		module.default?.({
			registerTool: (definition) => registered.push({
				name: definition.name,
				path,
				promptSnippet: definition.promptSnippet ?? null,
			}),
			registerCommand: noop, registerShortcut: noop, registerFlag: noop, on: noop,
			getFlag: () => undefined,
		});
	} catch (error) {
		unloadable.push({ path, reason: String(error?.message ?? error).split("\n")[0].slice(0, 140) });
	}
}

process.stdout.write(JSON.stringify({ registered, unloadable }));
