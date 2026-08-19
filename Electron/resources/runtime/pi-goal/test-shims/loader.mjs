import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const map = new Map([
  ["@earendil-works/pi-coding-agent", join(here, "pi-coding-agent.mjs")],
  ["@earendil-works/pi-ai", join(here, "pi-ai.mjs")],
  ["@earendil-works/pi-tui", join(here, "pi-tui.mjs")],
  ["typebox", join(here, "typebox.mjs")],
]);

export async function resolve(specifier, context, nextResolve) {
  const mapped = map.get(specifier);
  if (mapped) return { url: pathToFileURL(mapped).href, shortCircuit: true };
  if (specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const asTs = join(parentDir, specifier.replace(/\.js$/u, ".ts"));
    if (existsSync(asTs)) return { url: pathToFileURL(asTs).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
