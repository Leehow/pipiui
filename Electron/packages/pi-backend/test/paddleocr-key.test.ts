import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIpcHost, PIPI_HOST_PROTOCOL_VERSION } from "@pipi/host-api";
import { secretEnvName } from "../src/extension-settings.js";
import { buildDocumentsOpenedInjection } from "../src/document-inject.js";
import { PADDLEOCR_CONFIG_NAME, readPaddleocrAccessToken, readPaddleocrConfig } from "../src/paddleocr-key.js";
import { listSecretMeta, MIN_SECRET_LEN, resetInMemoryVault } from "../src/secret-vault.js";
import { createPiHostBackend } from "../src/index.js";
import { projectPiAgentDir } from "../src/project-pi-home.js";

/**
 * Legacy PaddleOCR token lifecycle after the pdf-extension cutover:
 * `{projectAgentHome}/paddleocr.json` is the one canonical DURABLE store behind the
 * generic settings channel (`ext.pdf-extension.aistudioAccessToken`) — saves/clears
 * project into it before the memory vault cache, so both survive backend recreation;
 * the vault entry reaches only the enabled agent half as a spawn env var
 * (`secretEnvName(key)`). `web-search.json` (incl. its `firecrawlApiKey`) is never
 * inferred or touched.
 */

const PDF_SECRET_KEY = "ext.pdf-extension.aistudioAccessToken";

const repoRuntime = new URL("../../../resources/runtime/", import.meta.url).pathname;

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

type Probe = { registeredExtensionsForSpawn(root: string): Promise<Array<{ id: string; enabled: boolean; extensionPath?: string; secretEnv?: Record<string, string> }>> };

async function makeBackend() {
  const root = await mkdtemp(join(tmpdir(), "paddle-pdf-settings-"));
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
  return { backend, probe: backend as unknown as Probe, hostAgent };
}

async function addProject(backend: Awaited<ReturnType<typeof makeBackend>>["backend"], name: string, legacyToken?: string) {
  const project = join(roots[roots.length - 1], name);
  await mkdir(project, { recursive: true });
  if (legacyToken !== undefined) {
    const agentHome = projectPiAgentDir(project);
    await mkdir(agentHome, { recursive: true });
    await writeFile(
      join(agentHome, "paddleocr.json"),
      `${JSON.stringify({ aistudioAccessToken: legacyToken }, null, 2)}\n`,
      "utf8",
    );
  }
  const added = (await backend.handle("addProject" as never, [project])) as { id: string };
  return { project, id: added.id };
}

describe("legacy paddleocr.json after the pdf-extension cutover", () => {
  it("is read by the shared read-only helpers and never carries web-search keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "paddle-read-only-"));
    roots.push(root);
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "paddleocr.json"), `${JSON.stringify({ aistudioAccessToken: " ast-from-file " }, null, 2)}\n`);
    expect(await readPaddleocrConfig(agent)).toEqual({ aistudioAccessToken: " ast-from-file " });
    expect(await readPaddleocrAccessToken(agent)).toBe("ast-from-file");
    expect(Object.keys(await readPaddleocrConfig(agent))).not.toContain("firecrawlApiKey");
  });

  it("derives settings presence from the durable file until superseded, without echoing it", async () => {
    const { backend } = await makeBackend();
    const { project, id } = await addProject(backend, "with-legacy-file", "ast-durable-file");
    const got = (await backend.handle("getExtensionSettings" as never, ["pdf-extension", id])) as Record<string, unknown>;
    expect(got[PDF_SECRET_KEY]).toBe(true);
    expect(JSON.stringify(got)).not.toContain("ast-durable-file");
    // Saving through the generic channel durably replaces the canonical store's value.
    const updated = (await backend.handle("updateExtensionSettings" as never, [
      "pdf-extension",
      { [PDF_SECRET_KEY]: "ast-vault-value" },
      id,
    ])) as { ok: boolean };
    expect(updated.ok).toBe(true);
    expect(await readPaddleocrAccessToken(projectPiAgentDir(project))).toBe("ast-vault-value");
    expect(await readFile(join(projectPiAgentDir(project), "paddleocr.json"), "utf8")).not.toContain("ast-durable-file");
    expect((await backend.handle("getExtensionSettings" as never, ["pdf-extension", id])) as Record<string, unknown>)
      .toMatchObject({ [PDF_SECRET_KEY]: true });
    // web-search.json is never projected by the adapter.
  });

  it("stores secrets per project and delivers them only to that project's enabled spawn", async () => {
    const { backend, probe, hostAgent } = await makeBackend();
    const a = await addProject(backend, "proj-a");
    const b = await addProject(backend, "proj-b");
    expect(((await backend.handle("updateExtensionSettings" as never, [
      "pdf-extension",
      { [PDF_SECRET_KEY]: "ast-project-a" },
      a.id,
    ])) as { ok: boolean }).ok).toBe(true);

    const gotA = (await backend.handle("getExtensionSettings" as never, ["pdf-extension", a.id])) as Record<string, unknown>;
    const gotB = (await backend.handle("getExtensionSettings" as never, ["pdf-extension", b.id])) as Record<string, unknown>;
    expect(gotA[PDF_SECRET_KEY]).toBe(true);
    expect(gotB[PDF_SECRET_KEY]).toBeUndefined();
    expect(JSON.stringify([gotA, gotB])).not.toContain("ast-project-a");

    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", true, "project", a.id]);
    const packagesA = await probe.registeredExtensionsForSpawn(a.project);
    const pdfA = packagesA.find((pkg) => pkg.id === "pdf-extension");
    expect(pdfA?.enabled).toBe(true);
    expect(pdfA?.extensionPath).toBe(join(repoRuntime, "extensions", "pdf-extension", "agent", "dist", "index.js"));
    expect(pdfA?.secretEnv).toEqual({ [secretEnvName(PDF_SECRET_KEY)]: "ast-project-a" });

    // Another project of the same host resolves no env secret of its own.
    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", true, "project", b.id]);
    const pdfB = (await probe.registeredExtensionsForSpawn(b.project)).find((pkg) => pkg.id === "pdf-extension");
    expect(pdfB?.secretEnv?.[secretEnvName(PDF_SECRET_KEY)]).toBeUndefined();

    // Namespaced entries never land in the shared app-level vault namespace.
    expect(listSecretMeta(hostAgent).find((meta) => meta.name === PDF_SECRET_KEY)).toBeUndefined();
  });

  it("falls back to the durable file's token until a replacement durably supersedes it", async () => {
    const { backend, probe, hostAgent } = await makeBackend();
    const fixture = await addProject(backend, "with-legacy-fallback", "ast-legacy-fallback");
    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", true, "project", fixture.id]);
    const pdf = (await probe.registeredExtensionsForSpawn(fixture.project)).find((pkg) => pkg.id === "pdf-extension");
    expect(pdf?.secretEnv?.[secretEnvName(PDF_SECRET_KEY)]).toBe("ast-legacy-fallback");

    // A generic save replaces BOTH the run cache and the durable store.
    expect(((await backend.handle("updateExtensionSettings" as never, [
      "pdf-extension",
      { [PDF_SECRET_KEY]: "ast-newer-value" },
      fixture.id,
    ])) as { ok: boolean }).ok).toBe(true);
    expect(await readPaddleocrAccessToken(projectPiAgentDir(fixture.project))).toBe("ast-newer-value");
    const superseded = (await probe.registeredExtensionsForSpawn(fixture.project))
      .find((pkg) => pkg.id === "pdf-extension");
    expect(superseded?.secretEnv?.[secretEnvName(PDF_SECRET_KEY)]).toBe("ast-newer-value");

    // Simulated App restart: a fresh backend has an empty memory vault and must still
    // resolve the replacement from the durable store — never the stale legacy value.
    const restarted = createPiHostBackend({
      agentDir: hostAgent,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      vaultDir: hostAgent,
      runtimeRoot: repoRuntime,
    });
    openBackends.push(restarted);
    await restarted.handle("setExtensionEnabled" as never, ["pdf-extension", true, "project", fixture.id]);
    const restartedPackages = (await (restarted as unknown as Probe).registeredExtensionsForSpawn(fixture.project))
      .filter((pkg) => pkg.id === "pdf-extension");
    expect(restartedPackages[0]?.secretEnv?.[secretEnvName(PDF_SECRET_KEY)]).toBe("ast-newer-value");
  });

  it("routes parser hints by each live session's mount snapshot, not the current overlay", async () => {
    const { backend } = await makeBackend();
    const internals = backend as unknown as {
      extensions: { mountSession(sessionId: string, ids: readonly string[]): void };
      live: Map<string, unknown>;
      pdfParserMounted(sessionId?: string): Promise<boolean>;
    };
    // Two sessions spawned under different enablement snapshots.
    internals.extensions.mountSession("live-with-parser", ["pdf-extension"]);
    internals.extensions.mountSession("live-without-parser", []);
    // Both are known-live children (no real process needed for hint routing).
    internals.live.set("live-with-parser", {});
    internals.live.set("live-without-parser", {});
    // Mid-session disable must not suppress a tool that stays mounted…
    expect(await internals.pdfParserMounted("live-with-parser")).toBe(true);
    // …and mid-session enable must not advertise one the running child lacks.
    expect(await internals.pdfParserMounted("live-without-parser")).toBe(false);
    // Unknown/dead session: the next send respawns under the current overlay
    // (bundled pdf-extension defaults to enabled).
    expect(await internals.pdfParserMounted("unknown-session")).toBe(true);
  });

  it("clearing through the generic channel is durable: no resurrection of the legacy token", async () => {
    const { backend, probe, hostAgent } = await makeBackend();
    const fixture = await addProject(backend, "clear-case", "ast-keep-on-disk");
    await backend.handle("updateExtensionSettings" as never, [
      "pdf-extension",
      { [PDF_SECRET_KEY]: "ast-replace-me" },
      fixture.id,
    ]);
    const cleared = (await backend.handle("updateExtensionSettings" as never, [
      "pdf-extension",
      { [PDF_SECRET_KEY]: null },
      fixture.id,
    ])) as { ok: boolean };
    expect(cleared.ok).toBe(true);
    // The field is gone from the single canonical store — nothing left to fall back to.
    expect(await readPaddleocrAccessToken(projectPiAgentDir(fixture.project))).toBeUndefined();
    const got = (await backend.handle("getExtensionSettings" as never, ["pdf-extension", fixture.id])) as Record<string, unknown>;
    expect(got[PDF_SECRET_KEY]).toBeUndefined();
    // Still absent after backend recreation.
    const restarted = createPiHostBackend({
      agentDir: hostAgent,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      vaultDir: hostAgent,
      runtimeRoot: repoRuntime,
    });
    openBackends.push(restarted);
    const gotAfterRestart = (await restarted.handle("getExtensionSettings" as never, [
      "pdf-extension",
      fixture.id,
    ])) as Record<string, unknown>;
    expect(gotAfterRestart[PDF_SECRET_KEY]).toBeUndefined();
  });

  it("carries Project B saves through the real renderer adapter without falling back into Project A", async () => {
    const { backend } = await makeBackend();
    const a = await addProject(backend, "adapter-a");
    const b = await addProject(backend, "adapter-b");
    // Real renderer adapter (`createIpcHost`) over a main-side-style dispatch into
    // backend.handle — mirrors registerPipiHostIpc's request envelope handling.
    const api = createIpcHost({
      invoke: async (_channel, request) => {
        try {
          return {
            protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
            id: request.id,
            type: "response" as const,
            ok: true as const,
            result: await backend.handle(request.method as never, request.params as never),
          };
        } catch (error) {
          return {
            protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
            id: request.id,
            type: "response" as const,
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      on: () => undefined,
      removeListener: () => undefined,
    });
    expect((await api.updateExtensionSettings!("pdf-extension", { [PDF_SECRET_KEY]: "ast-only-b-has" }, b.id)).ok).toBe(true);
    const gotA = await api.getExtensionSettings!("pdf-extension", a.id);
    const gotB = await api.getExtensionSettings!("pdf-extension", b.id);
    // Project B's token never leaks into Project A's namespace or response payloads.
    expect(gotA[PDF_SECRET_KEY]).toBeUndefined();
    expect(gotB[PDF_SECRET_KEY]).toBe(true);
    expect(JSON.stringify([gotA, gotB])).not.toContain("ast-only-b-has");
    expect(await readPaddleocrAccessToken(projectPiAgentDir(b.project))).toBe("ast-only-b-has");
    expect(JSON.stringify(await readPaddleocrConfig(projectPiAgentDir(a.project)))).not.toContain("ast-only-b-has");
  });

  it("migrates the legacy token idempotently and never imports web-search Firecrawl keys", async () => {
    const { backend, probe, hostAgent } = await makeBackend();
    const firecrawlOnly = await addProject(backend, "firecrawl-only");
    const agentHome = projectPiAgentDir(firecrawlOnly.project);
    await mkdir(agentHome, { recursive: true });
    const webSearchPath = join(agentHome, "web-search.json");
    const webSearchBefore = `${JSON.stringify({ firecrawlApiKey: "fc-must-not-migrate" }, null, 2)}\n`;
    await writeFile(webSearchPath, webSearchBefore, "utf8");

    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", true, "project", firecrawlOnly.id]);
    // A Firecrawl key alone must not look like a configured OCR token…
    const got = (await backend.handle("getExtensionSettings" as never, ["pdf-extension", firecrawlOnly.id])) as Record<string, unknown>;
    expect(got[PDF_SECRET_KEY]).toBeUndefined();
    // …and must reach neither spawn env nor any vault entry.
    const beforeSave = (await probe.registeredExtensionsForSpawn(firecrawlOnly.project)).find(
      (pkg) => pkg.id === "pdf-extension",
    );
    expect(Object.values(beforeSave?.secretEnv ?? {})).not.toContain("fc-must-not-migrate");
    expect(listSecretMeta(hostAgent).map((meta) => meta.name)).not.toContain(PDF_SECRET_KEY);

    // Saving through the generic channel leaves web-search.json byte-identical.
    expect(((await backend.handle("updateExtensionSettings" as never, [
      "pdf-extension",
      { [PDF_SECRET_KEY]: "ast-after-fc-check" },
      firecrawlOnly.id,
    ])) as { ok: boolean }).ok).toBe(true);
    expect(await readFile(webSearchPath, "utf8")).toBe(webSearchBefore);
    const afterSave = (await probe.registeredExtensionsForSpawn(firecrawlOnly.project)).find(
      (pkg) => pkg.id === "pdf-extension",
    );
    expect(afterSave?.secretEnv).toEqual({ [secretEnvName(PDF_SECRET_KEY)]: "ast-after-fc-check" });

    // Migration of an existing legacy value is idempotent: re-saving the SAME value
    // keeps one canonical store entry, reads stable presence, and survives restart.
    const migrated = await addProject(backend, "migrate-idempotent", "ast-same-value");
    for (let round = 0; round < 2; round += 1) {
      const gotRound = (await backend.handle("getExtensionSettings" as never, ["pdf-extension", migrated.id])) as Record<string, unknown>;
      expect(gotRound[PDF_SECRET_KEY]).toBe(true);
      const resaved = (await backend.handle("updateExtensionSettings" as never, [
        "pdf-extension",
        { [PDF_SECRET_KEY]: "ast-same-value" },
        migrated.id,
      ])) as { ok: boolean };
      expect(resaved.ok).toBe(true);
      expect(await readPaddleocrAccessToken(projectPiAgentDir(migrated.project))).toBe("ast-same-value");
      expect(Object.keys(await readPaddleocrConfig(projectPiAgentDir(migrated.project)))).toEqual(["aistudioAccessToken"]);
    }
    const restarted = createPiHostBackend({
      agentDir: hostAgent,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      vaultDir: hostAgent,
      runtimeRoot: repoRuntime,
    });
    openBackends.push(restarted);
    const gotRestart = (await restarted.handle("getExtensionSettings" as never, ["pdf-extension", migrated.id])) as Record<string, unknown>;
    expect(gotRestart[PDF_SECRET_KEY]).toBe(true);
  });

  it("rejects sub-vault-minimum tokens up front instead of half-applying the durable store", async () => {
    const { backend } = await makeBackend();
    const fixture = await addProject(backend, "short-token", "ast-long-lived-legacy");
    const denied = (await backend.handle("updateExtensionSettings" as never, [
      "pdf-extension",
      { [PDF_SECRET_KEY]: "abc" },
      fixture.id,
    ])) as { ok: boolean; error?: { message?: string } };
    expect(denied.ok).toBe(false);
    expect(denied.error?.message ?? "").toContain(String(MIN_SECRET_LEN));
    // The denial must be total: the durable canonical store still holds the legacy value.
    expect(await readPaddleocrAccessToken(projectPiAgentDir(fixture.project))).toBe("ast-long-lived-legacy");
  });

  it("routes parser hints per live mount snapshot across real mid-session enable/disable transitions", async () => {
    const { backend, probe } = await makeBackend();
    const fixture = await addProject(backend, "hint-proj", "ast-hint-env-token");
    const pdfPath = join(fixture.project, "scan.pdf");
    await writeFile(pdfPath, Buffer.from("%PDF-1.4\n"));
    const internals = backend as unknown as {
      extensions: { mountSession(sessionId: string, ids: readonly string[]): void };
      live: Map<string, unknown>;
      pdfParserMounted(sessionId?: string): Promise<boolean>;
    };
    const injectionFor = async (sessionId: string) =>
      buildDocumentsOpenedInjection([pdfPath], { pdfParser: await internals.pdfParserMounted(sessionId) });

    // Session A spawns while the project has pdf-extension disabled.
    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", false, "project", fixture.id]);
    const disabledPackages = await probe.registeredExtensionsForSpawn(fixture.project);
    expect(disabledPackages.find((pkg) => pkg.id === "pdf-extension")?.enabled).toBe(false);
    internals.extensions.mountSession("sess-a", []);
    internals.live.set("sess-a", {});
    expect(await internals.pdfParserMounted("sess-a")).toBe(false);
    expect(await injectionFor("sess-a")).not.toContain("pipiui_firecrawl_pdf");

    // Mid-session enable gives NEW sessions the tool (plus per-project env) —
    // but Session A keeps its original no-parser snapshot.
    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", true, "project", fixture.id]);
    const enabledPackages = await probe.registeredExtensionsForSpawn(fixture.project);
    const enabledPdf = enabledPackages.find((pkg) => pkg.id === "pdf-extension");
    expect(enabledPdf?.enabled).toBe(true);
    expect(enabledPdf?.secretEnv).toEqual({ [secretEnvName(PDF_SECRET_KEY)]: "ast-hint-env-token" });
    internals.extensions.mountSession("sess-b", ["pdf-extension"]);
    internals.live.set("sess-b", {});
    expect(await internals.pdfParserMounted("sess-a")).toBe(false);
    expect(await internals.pdfParserMounted("sess-b")).toBe(true);
    expect(await injectionFor("sess-a")).not.toContain("pipiui_firecrawl_pdf");
    expect(await injectionFor("sess-b")).toContain("pipiui_firecrawl_pdf");

    // Converse: disabling again suppresses only FUTURE spawns. Session B stays
    // mounted and keeps its matching parser hint; a dead/newcomer session that
    // respawns under today's overlay gets neither tool nor hint.
    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", false, "project", fixture.id]);
    const redoneabledPackages = await probe.registeredExtensionsForSpawn(fixture.project);
    expect(redoneabledPackages.find((pkg) => pkg.id === "pdf-extension")?.enabled).toBe(false);
    expect(await internals.pdfParserMounted("sess-b")).toBe(true);
    expect(await injectionFor("sess-b")).toContain("pipiui_firecrawl_pdf");
    expect(await internals.pdfParserMounted("fresh-respawn")).toBe(false);
    expect(await injectionFor("fresh-respawn")).not.toContain("pipiui_firecrawl_pdf");
  });

  it("replaces the mount snapshot when the SAME session id respawns across enable transitions", async () => {
    const { backend, probe } = await makeBackend();
    const fixture = await addProject(backend, "respawn-proj", "ast-respawn-env-token");
    const pdfPath = join(fixture.project, "scan.pdf");
    await writeFile(pdfPath, Buffer.from("%PDF-1.4\n"));
    const sessionId = "sess-respawn";
    const internals = backend as unknown as {
      extensions: { mountSession(sessionId: string, ids: readonly string[]): void };
      live: Map<string, unknown>;
      pdfParserMounted(sessionId?: string): Promise<boolean>;
    };
    const injectionFor = async () =>
      buildDocumentsOpenedInjection([pdfPath], { pdfParser: await internals.pdfParserMounted(sessionId) });

    // Spawn 1: enabled — child carries the tool and its hint.
    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", true, "project", fixture.id]);
    const firstSpawn = (await probe.registeredExtensionsForSpawn(fixture.project)).find(
      (pkg) => pkg.id === "pdf-extension",
    );
    expect(firstSpawn?.enabled).toBe(true);
    internals.extensions.mountSession(sessionId, [firstSpawn!.id]);
    internals.live.set(sessionId, {});
    expect(await internals.pdfParserMounted(sessionId)).toBe(true);
    expect(await injectionFor()).toContain("pipiui_firecrawl_pdf");

    // Process dies, project disables, spawnLive re-registers the SAME session id:
    // the replacement (not union) must leave no stale mount and no advertised hint.
    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", false, "project", fixture.id]);
    const disabledSpawn = (await probe.registeredExtensionsForSpawn(fixture.project)).find(
      (pkg) => pkg.id === "pdf-extension",
    );
    expect(disabledSpawn?.enabled).toBe(false);
    // Mirrors index.ts spawnLive: only enabled+materialized packages reach mountSession.
    internals.extensions.mountSession(sessionId, []);
    expect(await internals.pdfParserMounted(sessionId)).toBe(false);
    expect(await injectionFor()).not.toContain("pipiui_firecrawl_pdf");

    // Re-enable, respawning the SAME session id: the snapshot returns whole.
    await backend.handle("setExtensionEnabled" as never, ["pdf-extension", true, "project", fixture.id]);
    const respawnPackages = (await probe.registeredExtensionsForSpawn(fixture.project)).filter(
      (pkg) => pkg.enabled && pkg.extensionPath,
    );
    expect(respawnPackages.find((pkg) => pkg.id === "pdf-extension")?.secretEnv).toEqual({
      [secretEnvName(PDF_SECRET_KEY)]: "ast-respawn-env-token",
    });
    internals.extensions.mountSession(sessionId, respawnPackages.map((pkg) => pkg.id));
    expect(await internals.pdfParserMounted(sessionId)).toBe(true);
    expect(await injectionFor()).toContain("pipiui_firecrawl_pdf");
  });

  it("keeps app-scoped secrets and other project-scoped extensions fully generic", async () => {
    const { backend, probe, hostAgent } = await makeBackend();
    const fixture = await addProject(backend, "compat-proj");

    // App scope: deepseek saves/clears via the shared vault exactly as before the cutover.
    const updatedApp = (await backend.handle("updateExtensionSettings" as never, [
      "deepseek",
      { "ext.deepseek.apiKey": "sk-app-scoped-secret" },
    ])) as { ok: boolean; data: Record<string, unknown> };
    expect(updatedApp.ok).toBe(true);
    const gotApp = (await backend.handle("getExtensionSettings" as never, ["deepseek"])) as Record<string, unknown>;
    expect(gotApp["ext.deepseek.apiKey"]).toBe(true);
    expect(JSON.stringify([updatedApp.data, gotApp])).not.toContain("sk-app-scoped-secret");
    expect(listSecretMeta(hostAgent).map((meta) => meta.name)).toContain("ext.deepseek.apiKey");

    // Non-PDF project scope persists generically without touching paddleocr.json.
    const updatedProj = (await backend.handle("updateExtensionSettings" as never, [
      "code-retrieval",
      { "ext.code-retrieval.exactProvider": "rg" },
      fixture.id,
    ])) as { ok: boolean };
    expect(updatedProj.ok).toBe(true);
    expect(existsSync(join(projectPiAgentDir(fixture.project), PADDLEOCR_CONFIG_NAME))).toBe(false);
    const gotProj = (await backend.handle("getExtensionSettings" as never, ["code-retrieval", fixture.id])) as Record<string, unknown>;
    expect(gotProj["ext.code-retrieval.exactProvider"]).toBe("rg");

    // Restart proves the generic channels keep their durability guarantees.
    const restarted = createPiHostBackend({
      agentDir: hostAgent,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      vaultDir: hostAgent,
      runtimeRoot: repoRuntime,
    });
    openBackends.push(restarted);
    const restartedProj = (await restarted.handle("getExtensionSettings" as never, ["code-retrieval", fixture.id])) as Record<string, unknown>;
    expect(restartedProj["ext.code-retrieval.exactProvider"]).toBe("rg");
    const restartedApp = (await restarted.handle("getExtensionSettings" as never, ["deepseek"])) as Record<string, unknown>;
    expect(restartedApp["ext.deepseek.apiKey"]).toBe(true);
    // Spawn registration for the PDF extension in this untouched project stays empty.
    expect(((await probe.registeredExtensionsForSpawn(fixture.project)).find((pkg) => pkg.id === "pdf-extension"))?.secretEnv).toBeUndefined();
  });
});
