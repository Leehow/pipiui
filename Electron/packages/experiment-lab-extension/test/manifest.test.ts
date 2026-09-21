import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { validateExtensionManifest } from "../../pi-backend/src/extension-manifest.js";
import { BUNDLED_MANIFEST_EXTENSIONS } from "../../pi-backend/src/runtime-install.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
it("真实manifest合同接受可选双半扩展，运行时保留编译入口", async () => {
  const manifest = JSON.parse(await readFile(join(root, "pipiui-extension.json"), "utf8"));
  const result = validateExtensionManifest(manifest);
  expect(result).toMatchObject({ ok: true });
  expect(manifest).toMatchObject({ id: "experiment-lab", category: "coding", defaultEnabled: false, capabilities: ["bridge.emit", "invoke.agent", "data.read"] });
  expect(BUNDLED_MANIFEST_EXTENSIONS).toContain("experiment-lab");
  for (const entry of [manifest.agent.extension, manifest.app.ui.panels[0].entry]) {
    expect(await readFile(join(root, entry), "utf8")).not.toBe("");
  }
  const panel = await readFile(join(root, manifest.app.ui.panels[0].entry), "utf8");
  expect(panel).toContain("export function createComponent");
  expect(panel).not.toMatch(/from ["']react(?:\/jsx-runtime)?["']/);
  const mirror = join(root, "../../resources/runtime/extensions/experiment-lab");
  expect(await readFile(join(mirror, "pipiui-extension.json"), "utf8")).toBe(await readFile(join(root, "pipiui-extension.json"), "utf8"));
});
