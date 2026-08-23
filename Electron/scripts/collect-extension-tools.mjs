#!/usr/bin/env node --experimental-transform-types
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
import { register } from "node:module";
import { join, resolve } from "node:path";

// Our sources import each other with `.js` specifiers that only exist after `tsc`. See the
// hook for why this is a resolve hook and not a different loader.
register("./ts-specifier-resolve-hook.mjs", import.meta.url);

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
		// A bundled manifest extension mounts its own compiled entry file (`agent/dist/index.js`),
		// so "not a .ts path" no longer implies "a directory". Treat anything with a module
		// extension as the entry it already is; only a bare path is resolved as a package.
		const isEntryFile = /\.(m?[jt]s)$/.test(path);
		const module = await import(isEntryFile ? path : directoryEntrypoint(path));
		module.default?.({
			registerTool: (definition) => registered.push({
				name: definition.name,
				path,
				promptSnippet: definition.promptSnippet ?? null,
			}),
			registerCommand: noop, registerShortcut: noop, registerFlag: noop, on: noop,
			// Anything an extension touches at registration time needs a stub, or the module
			// throws and every tool it declares is reported as uncovered rather than checked.
			// `registerProvider` is the bundled manifest extensions; `events` is pi-goal,
			// which subscribes to its managed-run bus before it registers a single tool.
			registerProvider: noop,
			events: { on: noop, off: noop, emit: noop },
			getFlag: () => undefined,
		});
	} catch (error) {
		unloadable.push({ path, reason: String(error?.message ?? error).split("\n")[0].slice(0, 140) });
	}
}

process.stdout.write(JSON.stringify({ registered, unloadable }));
