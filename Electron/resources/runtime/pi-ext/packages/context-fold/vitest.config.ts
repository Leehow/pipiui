/*
 * vitest.config.ts — test-time resolution for the modules Pi injects at runtime.
 *
 * Pi bundles `typebox` and the `@earendil-works/*` core packages and hands them to extensions as
 * virtual modules, so an extension must NOT vendor its own copies (see the Pi packages docs). The
 * unit suite still has to resolve them to import the adapter, so we point them at the copies
 * inside the installed Pi CLI. Absent (Pi not installed) → the alias is simply not registered and
 * the one test that needs it skips.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const PI_ROOT = resolve(__dirname, "node_modules/@earendil-works/pi-coding-agent");

function bundled(name: string): Record<string, string> {
	const path = resolve(PI_ROOT, "node_modules", name);
	return existsSync(path) ? { [name]: path } : {};
}

export default defineConfig({
	resolve: {
		alias: {
			...bundled("typebox"),
			...bundled("@earendil-works/pi-ai"),
		},
	},
});
