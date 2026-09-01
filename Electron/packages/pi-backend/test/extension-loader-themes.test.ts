import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensionLoader } from "../src/extension-loader.js";
import { createExtensionRegistry } from "../src/extension-registry.js";

const TOKENS = Object.fromEntries(
  ["--bg", "--surface", "--surface-raised", "--surface-hover", "--surface-input", "--border", "--border-strong", "--text", "--text-strong", "--muted", "--subtle", "--selection", "--accent", "--accent-soft", "--danger", "--warning", "--success"].map((key) => [key, "#112233"]),
);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("extension themes penetration (loadOne → scan → list)", () => {
  it("a bundled theme pack's app.ui.themes reaches the list descriptor verbatim", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipi-ext-themes-"));
    roots.push(root);
    const packDir = join(root, "runtime", "extensions", "pipiui-theme-pack");
    await mkdir(packDir, { recursive: true });
    const themes = [
      { id: "forest", name: "护眼绿", description: "深绿", scheme: "dark", tokens: TOKENS },
      { id: "paper", name: "暖米白", description: "米白", scheme: "light", tokens: TOKENS },
    ];
    await writeFile(join(packDir, "pipiui-extension.json"), JSON.stringify({
      id: "pipiui-theme-pack",
      name: "主题包",
      version: "1.0.0",
      capabilities: [],
      app: { ui: { themes } },
    }));

    const loader = createExtensionLoader({
      registry: createExtensionRegistry([]),
      builtinRoot: join(root, "runtime", "extensions"),
      appRoot: join(root, "agent", "extensions"),
    });
    loader.scan();

    const item = loader.list().find((entry) => entry.id === "pipiui-theme-pack");
    expect(item, "主题包应被扫出且不在 error 态").toBeTruthy();
    expect(item?.error).toBeUndefined();
    expect(item?.ui?.themes).toEqual(themes);
  });
});
