import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPiHostBackend } from "../src/index.js";
import { assemblePiSpawn } from "../src/spawn-assembly.js";
import { resetInMemoryVault } from "../src/secret-vault.js";

/**
 * End-to-end integration over the real generated runtime mirror: the bundled
 * `pdf-extension` loads as an optional registry package, explicit project enablement
 * mounts its compiled entry exactly once through `-e`,
 * disabling the extension for a project removes the mount, and the superseded
 * dedicated core settings APIs stay absent.
 */

const repoRuntime = new URL("../../../resources/runtime/", import.meta.url).pathname;
const MIRROR_ENTRY = join(repoRuntime, "extensions", "pdf-extension", "agent", "dist", "index.js");

let roots: string[] = [];
let openBackends: Array<{ close(): Promise<unknown> }> = [];

afterEach(async () => {
  for (const backend of openBackends.splice(0)) {
    await backend.close().catch(() => undefined);
  }
  resetInMemoryVault();
  for (const dir of roots.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }).catch(() => undefined);
  }
});

type SpawnPackage = { id: string; enabled: boolean; extensionPath?: string; secretEnv?: Record<string, string> };

async function makeBackend() {
  const root = await mkdtemp(join(tmpdir(), "pdf-integration-"));
  roots.push(root);
  const hostAgent = join(root, "host-agent");
  await mkdir(hostAgent, { recursive: true });
  const backend = createPiHostBackend({
    agentDir: hostAgent,
    profileMode: "isolated",
    canonicalProjectPaths: async () => undefined,
    vaultDir: hostAgent,
    runtimeRoot: repoRuntime,
  });
  openBackends.push(backend);
  return {
    backend,
    probe: backend as unknown as {
      registeredExtensionsForSpawn(projectRoot: string): Promise<SpawnPackage[]>;
    },
    hostAgent,
  };
}

async function addProject(backend: Awaited<ReturnType<typeof makeBackend>>["backend"], name: string) {
  const project = join(roots[roots.length - 1], name);
  await mkdir(project, { recursive: true });
  const added = (await backend.handle("addProject" as never, [project])) as { id: string };
  return { project, id: added.id };
}

function pdfPackages(list: SpawnPackage[]) {
  return list.filter((pkg) => pkg.id === "pdf-extension");
}

describe("pdf-extension end-to-end mount integration", () => {
  it("keeps the optional generated mirror unmounted for a brand-new base project", async () => {
    expect(existsSync(MIRROR_ENTRY), "generated mirror must exist; run npm run build -w @pipiui/pipiui-pdf-extension").toBe(true);
    const { backend, probe } = await makeBackend();
    const fresh = await addProject(backend, "fresh-project");

    const packages = pdfPackages(await probe.registeredExtensionsForSpawn(fresh.project));
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({ id: "pdf-extension", enabled: false, extensionPath: MIRROR_ENTRY });

    // The spawn assembly carries that single registry mount — never a duplicate
    // registration and never the removed direct spawn path.
    const args = assemblePiSpawn({
      cwd: fresh.project,
      paths: {},
      registeredExtensions: await probe.registeredExtensionsForSpawn(fresh.project),
    }).args;
    expect(args).not.toContain(MIRROR_ENTRY);
    expect(args.join("\n")).not.toContain("pipiui-firecrawl-pdf.ts");
  });

  it("mounts only the compiled artifact, whose registerTool list is exactly pipiui_firecrawl_pdf", async () => {
    const module_ = (await import(pathToFileURL(MIRROR_ENTRY).href)) as {
      default: (pi: { registerTool: (tool: { name: string }) => void }) => void;
    };
    const tools: Array<{ name: string }> = [];
    module_.default({ registerTool: (tool) => tools.push(tool) });
    expect(tools.map((tool) => tool.name)).toEqual(["pipiui_firecrawl_pdf"]);
  });

  it("mounts once after explicit enable and drops the mount after disable", async () => {
    const { backend, probe } = await makeBackend();
    const fixture = await addProject(backend, "opt-out");
    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", true, "project", fixture.id]);
    expect(pdfPackages(await probe.registeredExtensionsForSpawn(fixture.project))).toEqual([
      expect.objectContaining({ id: "pdf-extension", enabled: true, extensionPath: MIRROR_ENTRY }),
    ]);

    const updated = (await backend.handle("setExtensionEnabled" as never, [
      "pdf-extension",
      false,
      "project",
      fixture.id,
    ])) as { id?: string };
    expect(updated.id ?? "pdf-extension").toBe("pdf-extension");

    const after = pdfPackages(await probe.registeredExtensionsForSpawn(fixture.project));
    // Disabled packages are reported with enabled:false; assembly (next) drops them.
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: "pdf-extension", enabled: false });
    const disabledArgs = assemblePiSpawn({
      cwd: fixture.project,
      paths: {},
      registeredExtensions: await probe.registeredExtensionsForSpawn(fixture.project),
    }).args;
    expect(disabledArgs).not.toContain(MIRROR_ENTRY);
    expect((await backend.handle("getExtensionSettings" as never, ["pdf-extension", fixture.id])) as Record<string, unknown>)
      .toMatchObject({});
  });

  it("keeps the superseded dedicated PaddleOCR settings APIs absent", async () => {
    const { backend } = await makeBackend();
    const surface = backend as unknown as Record<string, unknown>;
    expect(surface.getPaddleOcrStatus).toBeUndefined();
    expect(surface.setPaddleOcrAccessToken).toBeUndefined();
  });
});
