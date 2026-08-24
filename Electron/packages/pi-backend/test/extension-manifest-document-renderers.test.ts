import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import {
  EXTENSION_CAPABILITIES,
  validateExtensionManifest,
} from "../src/extension-manifest.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function manifest(extra: Record<string, unknown> = {}) {
  return {
    id: "probe",
    name: "Probe Renderer",
    version: "1.0.0",
    capabilities: [],
    ...extra,
  };
}

function withRenderers(documentRenderers: unknown) {
  return validateExtensionManifest(manifest({ app: { ui: { documentRenderers } } }));
}

describe("app.ui.documentRenderers manifest validation (T2)", () => {
  it("parses a legal declaration and normalizes extensions to lowercase", () => {
    const result = withRenderers([
      {
        id: "diagram-view",
        entry: "app/dist/diagram.js",
        kinds: ["diagram"],
        extensions: [".SVG", ".Vsd"],
        mimeTypes: ["image/svg+xml"],
        priority: 10,
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const renderers = result.manifest.ui?.documentRenderers ?? [];
    expect(renderers).toHaveLength(1);
    expect(renderers[0]).toEqual({
      id: "diagram-view",
      entry: "app/dist/diagram.js",
      kinds: ["diagram"],
      extensions: [".svg", ".vsd"],
      mimeTypes: ["image/svg+xml"],
      priority: 10,
    });
  });

  it("defaults optional fields and keeps the entry required", () => {
    const ok = withRenderers([{ id: "min", entry: "app/dist/min.js", extensions: [".dotfile"] }]);
    expect(ok.ok).toBe(true);

    const missingEntry = withRenderers([{ id: "min", extensions: [".dotfile"] }]);
    expect(missingEntry.ok).toBe(false);
    if (missingEntry.ok) return;
    expect(missingEntry.errors.join("; ")).toMatch(/missing entry/);
  });

  it("requires an id", () => {
    const result = withRenderers([{ entry: "app/dist/x.js", extensions: [".dotfile"] }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toMatch(/missing id/);
  });

  it("requires at least one matcher", () => {
    const none = withRenderers([{ id: "empty", entry: "app/dist/x.js" }]);
    expect(none.ok).toBe(false);
    if (none.ok) return;
    expect(none.errors.join("; ")).toMatch(/must declare at least one of kinds, extensions, mimeTypes/);

    const emptyArrays = withRenderers([{ id: "empty", entry: "app/dist/x.js", kinds: [], extensions: [] }]);
    expect(emptyArrays.ok).toBe(false);
    if (emptyArrays.ok) return;
    expect(emptyArrays.errors.join("; ")).toMatch(/must declare at least one of kinds, extensions, mimeTypes/);
  });

  it("rejects extensions without a leading dot", () => {
    const result = withRenderers([{ id: "dotless", entry: "app/dist/x.js", extensions: ["svg"] }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toMatch(/extensions entries must start with a dot/);
  });

  it("rejects a duplicate renderer id within one manifest", () => {
    const result = withRenderers([
      { id: "dup", entry: "app/dist/a.js", extensions: [".a"] },
      { id: "dup", entry: "app/dist/b.js", extensions: [".b"] },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toMatch(/duplicate document renderer id 'dup'/);
  });

  it("rejects malformed kinds and priority", () => {
    const kinds = withRenderers([{ id: "k", entry: "app/dist/k.js", kinds: ["ok", 42] }]);
    expect(kinds.ok).toBe(false);
    if (kinds.ok) return;
    expect(kinds.errors.join("; ")).toMatch(/kinds must be an array of non-empty strings/);

    const priority = withRenderers([{ id: "p", entry: "app/dist/p.js", extensions: [".p"], priority: "high" }]);
    expect(priority.ok).toBe(false);
    if (priority.ok) return;
    expect(priority.errors.join("; ")).toMatch(/priority must be a finite number/);
  });

  it("rejects a non-array documentRenderers value", () => {
    const result = withRenderers({ id: "not-an-array" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toMatch(/app\.ui\.documentRenderers must be an array/);
  });

  it("stays fully backward compatible for manifests without documentRenderers", () => {
    const legacy = validateExtensionManifest(manifest({ app: { ui: { panels: [{ slot: "toolPanel", id: "p", title: "P" }] } } }));
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    expect(legacy.manifest.ui?.panels).toHaveLength(1);
    expect(legacy.manifest.ui?.documentRenderers).toBeUndefined();

    const bare = validateExtensionManifest(manifest());
    expect(bare.ok).toBe(true);
  });

  it("introduces no document.preview capability — renderer contributions are the grant", () => {
    expect(EXTENSION_CAPABILITIES).not.toContain("document.preview");
    const result = validateExtensionManifest(manifest({ capabilities: ["document.preview"] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toMatch(/unknown capability 'document\.preview'/);
  });
});

describe("document renderer contribution flows to the renderer descriptor", () => {
  it("surfaces manifest documentRenderers on the ExtensionListItem ui summary", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ext-renderer-"));
    const runtime = join(root, "runtime");
    const pkg = join(runtime, "extensions", "diagrams");
    await mkdir(pkg, { recursive: true });
    await writeFile(
      join(pkg, "pipiui-extension.json"),
      JSON.stringify(
        manifest({
          id: "diagrams",
          app: {
            ui: {
              documentRenderers: [
                { id: "diagram-view", entry: "app/dist/diagram.js", kinds: ["diagram"], extensions: [".SVG"], priority: 5 },
              ],
            },
          },
        }),
        null,
        2,
      ),
    );
    const backend = await createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: runtime,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    try {
      const listed = (await backend.handle("listExtensions" as never, [])) as Array<{
        id: string;
        ui?: { documentRenderers?: Array<{ id: string; entry: string; extensions?: string[] }> };
      }>;
      const item = listed.find((entry) => entry.id === "diagrams");
      expect(item?.ui?.documentRenderers).toEqual([
        { id: "diagram-view", entry: "app/dist/diagram.js", kinds: ["diagram"], extensions: [".svg"], priority: 5 },
      ]);
    } finally {
      await backend.close();
    }
  });
});
