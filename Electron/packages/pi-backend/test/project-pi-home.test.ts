import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, readdir, realpath, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The project models.json link goes through `node:fs/promises`, so denying it
 * needs its own pass-through mock. Same shape as the `node:fs` one below: a
 * toggle that makes only that one path EPERM, which is Windows without
 * Developer Mode.
 */
const promiseSymlinkDenial = vi.hoisted(() => ({ active: false, crossVolume: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const isProjectModels = (path: unknown) => String(path).includes(".pi") && String(path).includes("models.json");
  return {
    ...actual,
    default: actual,
    symlink: async (target: Parameters<typeof actual.symlink>[0], path: Parameters<typeof actual.symlink>[1], type?: Parameters<typeof actual.symlink>[2]) => {
      if (promiseSymlinkDenial.active && String(path).includes("models.json")) {
        throw Object.assign(new Error("EPERM: operation not permitted, symlink"), { code: "EPERM" });
      }
      return actual.symlink(target, path, type);
    },
    // Profile on C:, project on D: — the case where the hard-link fallback
    // cannot help either, so a replica is the only thing left.
    link: async (existing: Parameters<typeof actual.link>[0], path: Parameters<typeof actual.link>[1]) => {
      if (promiseSymlinkDenial.crossVolume && isProjectModels(path)) {
        throw Object.assign(new Error("EXDEV: cross-device link not permitted, link"), { code: "EXDEV" });
      }
      return actual.link(existing, path);
    },
  };
});

/** Windows without Developer Mode, project on another volume. */
function withoutLinks<T>(run: () => Promise<T>): Promise<T> {
  promiseSymlinkDenial.active = true;
  promiseSymlinkDenial.crossVolume = true;
  return run().finally(() => {
    promiseSymlinkDenial.active = false;
    promiseSymlinkDenial.crossVolume = false;
  });
}

/**
 * ESM exports cannot be spied on, so `node:fs` is mocked with a pass-through that
 * only refuses the two shared-credential symlinks while the toggle is on — exactly
 * what Windows does to an unprivileged account.
 */
const symlinkDenial = vi.hoisted(() => ({ active: false }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: actual,
    symlinkSync: (target: Parameters<typeof actual.symlinkSync>[0], path: Parameters<typeof actual.symlinkSync>[1], type?: Parameters<typeof actual.symlinkSync>[2]) => {
      const name = String(path);
      if (symlinkDenial.active && (name.includes("auth.json") || name.includes(".env"))) {
        throw Object.assign(new Error("EPERM: operation not permitted, symlink"), { code: "EPERM" });
      }
      return actual.symlinkSync(target, path, type);
    },
  };
});
import { rm } from "node:fs/promises";
import {
  ensureProjectPiHome,
  migrateSharedProjectModels,
  projectPiAgentDir,
  refreshProjectModelMirrors,
  projectPiSessionsDir,
  sanitizePiSettings,
  sanitizePiSettingsFile,
} from "../src/project-pi-home.js";

describe("project Pi home", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  it("places sessions under the project but links App-canonical credentials and models", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-home-"));
    const project = join(root, "pipiui");
    const seed = join(root, "host-profile");
    await mkdir(project, { recursive: true });
    await mkdir(seed, { recursive: true });
    await writeFile(join(seed, "settings.json"), JSON.stringify({ defaultProvider: "xai", packages: ["global"], extensions: ["global"] }));
    await writeFile(join(seed, "auth.json"), '{"xai":{"type":"api_key"}}\n');
    await writeFile(join(seed, "models.json"), '{"providers":{}}\n');
    await writeFile(join(seed, "models-store.json"), '{"xai":{"cached":true}}\n');
    await writeFile(join(seed, "trust.json"), '{"trusted":true}\n');
    await writeFile(join(seed, ".env"), "XAI_API_KEY=seed\n");

    const home = await ensureProjectPiHome({ projectRoot: project, credentialSeedDir: seed });
    const realProject = await realpath(project);
    expect(home.realProjectRoot).toBe(realProject);
    expect(home.agentDir).toBe(join(realProject, ".pi", "agent"));
    expect(home.sessionsDir).toBe(join(realProject, ".pi", "agent", "sessions"));
    expect(sanitizePiSettings({ packages: ["x"], skills: ["y"], theme: "light" })).toEqual({ theme: "light" });
    expect(JSON.parse(await readFile(join(home.agentDir, "settings.json"), "utf8"))).toEqual({ defaultProvider: "xai" });
    expect(await readlink(join(home.agentDir, "auth.json"))).toBe(join(seed, "auth.json"));
    expect(await readlink(join(home.agentDir, ".env"))).toBe(join(seed, ".env"));
    expect(await readlink(join(home.agentDir, "models.json"))).toBe(join(await realpath(seed), "models.json"));
    expect((await lstat(join(home.agentDir, "models-store.json"))).isSymbolicLink()).toBe(false);
    expect(await readFile(join(home.agentDir, "models-store.json"), "utf8")).toContain("cached");
    await expect(readFile(join(home.agentDir, "trust.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("falls back to a hard link when the platform refuses symlinks (Windows EPERM)", async () => {
    // Windows without Developer Mode or elevation answers EPERM to every symlink,
    // which used to abort opening a project entirely.
    root = await mkdtemp(join(tmpdir(), "pipi-project-home-nosymlink-"));
    const project = join(root, "project");
    const seed = join(root, "host-profile");
    await mkdir(project, { recursive: true });
    await mkdir(seed, { recursive: true });
    await writeFile(join(seed, "auth.json"), '{"xai":{"type":"api_key"}}\n');
    await writeFile(join(seed, ".env"), "XAI_API_KEY=seed\n");
    await writeFile(join(seed, "models.json"), '{"providers":{}}\n');

    let home: Awaited<ReturnType<typeof ensureProjectPiHome>>;
    symlinkDenial.active = true;
    try {
      home = await ensureProjectPiHome({ projectRoot: project, credentialSeedDir: seed });
    } finally {
      symlinkDenial.active = false;
    }

    for (const name of ["auth.json", ".env"]) {
      const linked = join(home.agentDir, name);
      expect((await lstat(linked)).isSymbolicLink()).toBe(false);
      // A hard link is the same file: one inode, so an OAuth refresh still propagates.
      expect((await stat(linked)).ino).toBe((await stat(join(seed, name))).ino);
      expect(await readFile(linked, "utf8")).toBe(await readFile(join(seed, name), "utf8"));
    }
    // No staging artifact left behind.
    expect((await readdir(home.agentDir)).filter((entry) => entry.includes("pipiui-link-"))).toEqual([]);
  });

  it("keeps existing settings, trust, and models-store project-local", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-local-"));
    const project = join(root, "repo");
    const seed = join(root, "profile");
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await mkdir(seed, { recursive: true });
    await writeFile(join(seed, "models.json"), '{"providers":{}}');
    await writeFile(join(seed, "trust.json"), '{"trusted":true}');
    await writeFile(join(seed, "models-store.json"), '{"seed":true}');
    await writeFile(join(projectPiAgentDir(project), "settings.json"), '{"theme":"dark","packages":["bad"]}');
    await writeFile(join(projectPiAgentDir(project), "trust.json"), '{"trusted":false}');
    await writeFile(join(projectPiAgentDir(project), "models-store.json"), '{"project":true}');

    await ensureProjectPiHome({ projectRoot: project, credentialSeedDir: seed });
    expect(JSON.parse(await readFile(join(projectPiAgentDir(project), "settings.json"), "utf8"))).toEqual({ theme: "dark" });
    expect(await readFile(join(projectPiAgentDir(project), "trust.json"), "utf8")).toBe('{"trusted":false}');
    expect(await readFile(join(projectPiAgentDir(project), "models-store.json"), "utf8")).toBe('{"project":true}');
  });

  it("gives the project a replica when neither a symlink nor a hard link is possible", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-replica-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    await mkdir(seed, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(seed, "models.json"), JSON.stringify({ providers: { alpha: { apiKey: "k" } } }));

    await withoutLinks(() => migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] }));

    const projectModels = join(projectPiAgentDir(await realpath(project)), "models.json");
    expect((await lstat(projectModels)).isSymbolicLink()).toBe(false);
    const canonical = join(await realpath(seed), "models.json");
    expect(await readFile(projectModels, "utf8")).toBe(await readFile(canonical, "utf8"));
    const ledger = JSON.parse(await readFile(join(await realpath(seed), ".pipiui-model-mirrors-v1.json"), "utf8"));
    expect(Object.keys(ledger.mirrors)).toEqual([projectModels]);
  });

  it("never resurrects a provider deleted from canonical out of a stale replica", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-no-resurrect-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    await mkdir(seed, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(seed, "models.json"), JSON.stringify({ providers: { alpha: { apiKey: "k" }, doomed: { apiKey: "d" } } }));
    await withoutLinks(() => migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] }));

    const canonical = join(await realpath(seed), "models.json");
    const projectModels = join(projectPiAgentDir(await realpath(project)), "models.json");
    expect(JSON.parse(await readFile(projectModels, "utf8")).providers.doomed).toBeDefined();

    // The user deletes a provider in the app. The replica is now stale and
    // still carries it — and is exactly what a merge would read back.
    await writeFile(canonical, `${JSON.stringify({ providers: { alpha: { apiKey: "k" } } }, null, 2)}\n`);

    await withoutLinks(() => migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] }));

    expect(JSON.parse(await readFile(canonical, "utf8")).providers.doomed).toBeUndefined();
    expect(JSON.parse(await readFile(projectModels, "utf8")).providers.doomed).toBeUndefined();
  });

  it("refreshes replicas from canonical, drops vanished ones, and keeps a hand edit", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-refresh-"));
    const seed = join(root, "profile");
    const tracked = join(root, "tracked");
    const edited = join(root, "edited");
    await mkdir(seed, { recursive: true });
    await mkdir(tracked, { recursive: true });
    await mkdir(edited, { recursive: true });
    await writeFile(join(seed, "models.json"), JSON.stringify({ providers: { alpha: { apiKey: "k" } } }));
    await withoutLinks(() => migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [tracked, edited] }));

    const canonical = join(await realpath(seed), "models.json");
    const trackedModels = join(projectPiAgentDir(await realpath(tracked)), "models.json");
    const editedModels = join(projectPiAgentDir(await realpath(edited)), "models.json");
    const handEdit = `${JSON.stringify({ providers: { mine: { apiKey: "local" } } }, null, 2)}\n`;
    await writeFile(editedModels, handEdit);

    await writeFile(canonical, `${JSON.stringify({ providers: { alpha: { apiKey: "k" }, beta: { apiKey: "b" } } }, null, 2)}\n`);
    const result = await refreshProjectModelMirrors({ canonicalAgentDir: seed });

    expect(result.refreshed).toEqual([trackedModels]);
    expect(result.skipped).toEqual([editedModels]);
    expect(JSON.parse(await readFile(trackedModels, "utf8")).providers.beta).toBeDefined();
    // Someone else's bytes are never overwritten; the next open merges them.
    expect(await readFile(editedModels, "utf8")).toBe(handEdit);
  });

  it("merges a replica back into canonical once something else writes to it", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-writeback-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    await mkdir(seed, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(seed, "models.json"), JSON.stringify({ providers: { alpha: { apiKey: "k" } } }));
    await withoutLinks(() => migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] }));

    // With a link, a provider added inside a session would land on canonical.
    // With a replica it lands here, and the digest stops matching the ledger —
    // which is precisely what makes the next open treat it as a source again.
    const projectModels = join(projectPiAgentDir(await realpath(project)), "models.json");
    await writeFile(projectModels, `${JSON.stringify({ providers: { alpha: { apiKey: "k" }, added: { apiKey: "n" } } }, null, 2)}\n`);

    await withoutLinks(() => migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] }));

    const canonical = JSON.parse(await readFile(join(await realpath(seed), "models.json"), "utf8"));
    expect(canonical.providers.added).toBeDefined();
    // And it is a recognised replica again, so it will not be merged twice.
    const ledger = JSON.parse(await readFile(join(await realpath(seed), ".pipiui-model-mirrors-v1.json"), "utf8"));
    expect(ledger.mirrors[projectModels]).toBeDefined();
  });

  it("is a no-op for a host with no replicas", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-no-replicas-"));
    const seed = join(root, "profile");
    await mkdir(seed, { recursive: true });
    await expect(refreshProjectModelMirrors({ canonicalAgentDir: seed })).resolves.toEqual({
      refreshed: [], dropped: [], skipped: [],
    });
  });

  it("falls back to a hard link when only the symlink privilege is missing", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-hardlink-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    await mkdir(seed, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(seed, "models.json"), JSON.stringify({ providers: { alpha: { apiKey: "k" } } }));

    // Developer Mode off, but the project is on the same volume: a hard link
    // still gives the one-file guarantee, so no replica and no ledger entry.
    promiseSymlinkDenial.active = true;
    try {
      await migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] });
    } finally {
      promiseSymlinkDenial.active = false;
    }

    const canonical = join(await realpath(seed), "models.json");
    const projectModels = join(projectPiAgentDir(await realpath(project)), "models.json");
    const [canonicalStat, projectStat] = [await lstat(canonical), await lstat(projectModels)];
    expect(projectStat.isSymbolicLink()).toBe(false);
    expect(projectStat.ino).toBe(canonicalStat.ino);
    expect(projectStat.dev).toBe(canonicalStat.dev);
    await expect(readFile(join(await realpath(seed), ".pipiui-model-mirrors-v1.json"), "utf8")).rejects.toThrow();
  });

  it("creates a minimal stable canonical when neither App nor project has a models source", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-minimal-canonical-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    await mkdir(seed, { recursive: true });
    await mkdir(project, { recursive: true });

    await migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] });
    const canonical = join(await realpath(seed), "models.json");
    expect(JSON.parse(await readFile(canonical, "utf8"))).toEqual({ providers: {} });
    expect((await stat(canonical)).mode & 0o777).toBe(0o600);
    expect(await readlink(join(projectPiAgentDir(project), "models.json"))).toBe(canonical);
  });

  it("makes projects resolve models.json to the same canonical inode and repairs a regular replacement", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-links-"));
    const seed = join(root, "profile");
    const first = join(root, "first");
    const second = join(root, "second");
    await mkdir(seed, { recursive: true });
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(join(seed, "models.json"), '{"providers":{}}\n');
    await ensureProjectPiHome({ projectRoot: first, credentialSeedDir: seed });
    await ensureProjectPiHome({ projectRoot: second, credentialSeedDir: seed });
    const canonicalStat = await stat(join(seed, "models.json"));
    expect((await stat(join(projectPiAgentDir(first), "models.json"))).ino).toBe(canonicalStat.ino);
    expect((await stat(join(projectPiAgentDir(second), "models.json"))).ino).toBe(canonicalStat.ino);

    await rm(join(projectPiAgentDir(first), "models.json"));
    await writeFile(join(projectPiAgentDir(first), "models.json"), '{"providers":{"slab":{"models":[{"id":"only"}]}}}');
    await ensureProjectPiHome({ projectRoot: first, credentialSeedDir: seed });
    expect((await lstat(join(projectPiAgentDir(first), "models.json"))).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(join(seed, "models.json"), "utf8")).providers.slab.models[0].id).toBe("only");
  });

  it("merges catalogs deterministically with canonical and real-path ordering priority", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-merge-"));
    const seed = join(root, "profile");
    const alpha = join(root, "alpha");
    const zeta = join(root, "zeta");
    await mkdir(seed, { recursive: true });
    await mkdir(projectPiAgentDir(alpha), { recursive: true });
    await mkdir(projectPiAgentDir(zeta), { recursive: true });
    await writeFile(join(seed, "models.json"), JSON.stringify({
      top: "canonical",
      providers: {
        generic: {
          apiKey: "canonical-secret",
          models: [{ id: "reasoner", name: "Canonical", reasoning: true }],
          modelOverrides: { reasoner: { thinkingLevelMap: { high: "high" } } },
        },
      },
    }));
    await writeFile(join(projectPiAgentDir(alpha), "models.json"), JSON.stringify({
      top: "alpha",
      providers: {
        generic: {
          baseUrl: "alpha-url",
          models: [{ id: "reasoner", name: "Alpha", contextWindow: 131072 }, { id: "alpha-only" }],
          modelOverrides: { reasoner: { thinkingLevelMap: { xhigh: "max" }, compat: { slabOnly: true } } },
        },
      },
    }));
    await writeFile(join(projectPiAgentDir(zeta), "models.json"), JSON.stringify({
      providers: { generic: { baseUrl: "zeta-url", models: [{ id: "reasoner", contextWindow: 64000 }] } },
    }));

    const manifest = await migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [zeta, alpha] });
    const merged = JSON.parse(await readFile(join(seed, "models.json"), "utf8"));
    expect(merged.top).toBe("canonical");
    expect(merged.providers.generic.apiKey).toBe("canonical-secret");
    expect(merged.providers.generic.baseUrl).toBe("alpha-url");
    expect(merged.providers.generic.models).toEqual([
      expect.objectContaining({ id: "reasoner", name: "Canonical", contextWindow: 131072 }),
      { id: "alpha-only" },
    ]);
    expect(merged.providers.generic.modelOverrides.reasoner).toMatchObject({
      thinkingLevelMap: { high: "high", xhigh: "max" },
      compat: { slabOnly: true },
    });
    expect(manifest?.conflictJsonPaths).toEqual(expect.arrayContaining([
      "/top",
      "/providers/generic/baseUrl",
      "/providers/generic/models/reasoner/name",
      "/providers/generic/models/reasoner/contextWindow",
    ]));
  });

  it("canonicalizes and deduplicates project aliases before migration", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-realpath-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    const alias = join(root, "alias");
    await mkdir(seed, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(seed, "models.json"), '{"providers":{}}');
    await writeFile(join(projectPiAgentDir(project), "models.json"), '{"projectOnly":true}');
    await symlink(project, alias);
    const manifest = await migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [alias, project] });
    expect(manifest?.projects).toHaveLength(1);
    expect(manifest?.projects[0].path).toBe(join(await realpath(project), ".pi", "agent", "models.json"));
  });

  it("creates non-overwriting 0600 backups and a value-free manifest, then is idempotent", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-backup-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    await mkdir(seed, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(seed, "models.json"), '{"providers":{"host":{"apiKey":"HOST-SECRET"}}}');
    await writeFile(join(projectPiAgentDir(project), "models.json"), '{"providers":{"project":{"apiKey":"PROJECT-SECRET"}}}');
    await writeFile(join(seed, ".pipiui-shared-models-migration-v1.json"), '{"version":0,"stale":true}\n');
    const manifest = await migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] });
    expect(manifest?.canonical.backupPath).toBeTruthy();
    expect(manifest?.projects[0].backupPath).toBeTruthy();
    expect((await stat(manifest!.canonical.backupPath!)).mode & 0o777).toBe(0o600);
    expect((await stat(manifest!.projects[0].backupPath!)).mode & 0o777).toBe(0o600);
    const serialized = await readFile(join(seed, ".pipiui-shared-models-migration-v1.json"), "utf8");
    expect(serialized).not.toContain("HOST-SECRET");
    expect(serialized).not.toContain("PROJECT-SECRET");
    expect(JSON.parse(serialized)).toMatchObject({ version: 1, canonical: { sourceSha256: expect.any(String), resultSha256: expect.any(String) } });
    const backupsBefore = (await readdir(seed)).filter((name) => name.includes(".bak"));
    expect(await migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] })).toBeNull();
    expect(await readFile(join(seed, ".pipiui-shared-models-migration-v1.json"), "utf8")).toBe(serialized);
    expect((await readdir(seed)).filter((name) => name.includes(".bak"))).toEqual(backupsBefore);
  });

  it("repairs an interrupted canonical-temp link but rejects planted canonical and project symlinks", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-symlink-safety-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    const external = join(root, "external.json");
    await mkdir(seed, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(seed, "models.json"), '{"providers":{}}');
    await symlink(relative(projectPiAgentDir(project), join(seed, "models.json")), join(projectPiAgentDir(project), "models.json"));
    await migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] });
    expect(await readlink(join(projectPiAgentDir(project), "models.json"))).toBe(join(await realpath(seed), "models.json"));
    expect(await migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] })).toBeNull();

    await rm(join(projectPiAgentDir(project), "models.json"));
    const vanishedCanonicalTemp = join(seed, ".models.json-interrupted.tmp");
    await symlink(vanishedCanonicalTemp, join(projectPiAgentDir(project), "models.json"));
    await migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] });
    expect(await readlink(join(projectPiAgentDir(project), "models.json"))).toBe(join(await realpath(seed), "models.json"));
    await expect(lstat(vanishedCanonicalTemp)).rejects.toMatchObject({ code: "ENOENT" });

    await rm(join(projectPiAgentDir(project), "models.json"));
    await writeFile(external, '{"secret":"do-not-read"}');
    await symlink(external, join(projectPiAgentDir(project), "models.json"));
    await expect(migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] })).rejects.toThrow("untrusted project");
    expect(await readFile(external, "utf8")).toBe('{"secret":"do-not-read"}');
    await rm(join(projectPiAgentDir(project), "models.json"));
    const danglingExternal = join(root, "missing-external-models.json");
    await symlink(danglingExternal, join(projectPiAgentDir(project), "models.json"));
    await expect(migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] })).rejects.toThrow("untrusted project");
    expect((await lstat(join(projectPiAgentDir(project), "models.json"))).isSymbolicLink()).toBe(true);
    await rm(join(projectPiAgentDir(project), "models.json"));
    await rm(join(seed, "models.json"));
    await symlink(external, join(seed, "models.json"));
    await expect(migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] })).rejects.toThrow("unsafe canonical");
  });

  const rollbackCases = ([false, true] as const).flatMap((canonicalInitiallyMissing) => ([
    "backups-created",
    "canonical-written",
    "before-project-link",
    "project-link-installed",
    "before-manifest-write",
  ] as const).map((failAt) => ({ canonicalInitiallyMissing, failAt })));

  it.each(rollbackCases)(
    "keeps canonical visible and rolls back at $failAt (initially missing: $canonicalInitiallyMissing)",
    async ({ failAt, canonicalInitiallyMissing }) => {
    root = await mkdtemp(join(tmpdir(), `pipi-model-rollback-${canonicalInitiallyMissing}-${failAt}-`));
    const seed = join(root, "profile");
    const first = join(root, "a-project");
    const second = join(root, "b-project");
    const linkedProject = join(root, "c-linked-project");
    await mkdir(seed, { recursive: true });
    await mkdir(projectPiAgentDir(first), { recursive: true });
    await mkdir(projectPiAgentDir(second), { recursive: true });
    await mkdir(projectPiAgentDir(linkedProject), { recursive: true });
    const canonical = '{"providers":{"canonical":{}}}';
    const firstSource = '{"providers":{"first":{}}}';
    const secondSource = '{"providers":{"second":{}}}';
    if (!canonicalInitiallyMissing) await writeFile(join(seed, "models.json"), canonical);
    await writeFile(join(projectPiAgentDir(first), "models.json"), firstSource);
    await writeFile(join(projectPiAgentDir(second), "models.json"), secondSource);
    const stableCanonical = join(await realpath(seed), "models.json");
    await symlink(stableCanonical, join(projectPiAgentDir(linkedProject), "models.json"));
    const oldManifest = '{"version":0,"resultSha256":"old-manifest"}\n';
    await writeFile(join(seed, ".pipiui-shared-models-migration-v1.json"), oldManifest);
    let injected = false;

    await expect(migrateSharedProjectModels({
      canonicalAgentDir: seed,
      projectRoots: [second, linkedProject, first],
      onMigrationStep: async (step) => {
        // Once published, the stable canonical pathname may never disappear. It can still
        // be absent at the pre-mutation read/verify hooks when this run creates it, and
        // during the controlled quarantine→no-replace-link window of an existing replace.
        if (
          step.name !== "sources-read"
          && step.name !== "snapshots-verified"
          && step.name !== "before-canonical-publish"
          && step.name !== "after-canonical-quarantine"
        ) {
          expect((await lstat(stableCanonical)).isFile()).toBe(true);
          await expect(readFile(stableCanonical, "utf8")).resolves.toBeTruthy();
        }
        if (step.name === "before-project-link") {
          await expect(lstat(step.projectModelsPath)).rejects.toMatchObject({ code: "ENOENT" });
        }
        if (step.name === "project-link-installed") {
          expect(await readlink(step.projectModelsPath)).toBe(stableCanonical);
        }
        if (step.name === failAt) {
          injected = true;
          throw new Error(`injected failure at ${failAt}`);
        }
      },
    })).rejects.toThrow(`injected failure at ${failAt}`);
    expect(injected).toBe(true);
    const canonicalAfterFailure = await readFile(stableCanonical, "utf8");
    expect(() => JSON.parse(canonicalAfterFailure)).not.toThrow();
    if (canonicalInitiallyMissing) {
      expect(JSON.parse(canonicalAfterFailure)).toMatchObject({
        providers: { first: {}, second: {} },
      });
    } else {
      expect(canonicalAfterFailure).toBe(canonical);
    }
    expect(await readFile(join(projectPiAgentDir(first), "models.json"), "utf8")).toBe(firstSource);
    expect(await readFile(join(projectPiAgentDir(second), "models.json"), "utf8")).toBe(secondSource);
    expect((await lstat(join(projectPiAgentDir(first), "models.json"))).isFile()).toBe(true);
    expect((await lstat(join(projectPiAgentDir(second), "models.json"))).isFile()).toBe(true);
    expect((await lstat(join(projectPiAgentDir(linkedProject), "models.json"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(projectPiAgentDir(linkedProject), "models.json"))).toBe(stableCanonical);
    expect((await readdir(seed)).some((name) => name.endsWith(".tmp"))).toBe(false);
    expect((await readdir(projectPiAgentDir(first))).some((name) => name.includes("models-link"))).toBe(false);
    expect((await readdir(projectPiAgentDir(second))).some((name) => name.includes("models-link"))).toBe(false);
    expect(await readFile(join(seed, ".pipiui-shared-models-migration-v1.json"), "utf8")).toBe(oldManifest);
  });

  const unsafeHomeComponents = ([".pi", ".pi/agent"] as const).flatMap((component) => (
    ["external-symlink", "dangling-symlink", "non-directory"] as const
  ).map((kind) => ({ component, kind })));

  it.each(unsafeHomeComponents)(
    "rejects $kind at project $component without traversing outside the project",
    async ({ component, kind }) => {
      root = await mkdtemp(join(tmpdir(), `pipi-project-home-component-${component.replace("/", "-")}-${kind}-`));
      const seed = join(root, "profile");
      const project = join(root, "project");
      const external = join(root, "external");
      const attackedPath = join(project, ...component.split("/"));
      const oldCanonical = '{"providers":{"canonical":{}}}';
      const oldManifest = '{"version":1,"resultSha256":"unchanged"}\n';
      await mkdir(seed, { recursive: true });
      await mkdir(project, { recursive: true });
      await mkdir(external, { recursive: true });
      await writeFile(join(seed, "models.json"), oldCanonical);
      await writeFile(join(seed, ".pipiui-shared-models-migration-v1.json"), oldManifest);
      await writeFile(join(external, "sentinel"), "EXTERNAL-SENTINEL");
      if (component === ".pi/agent") await mkdir(join(project, ".pi"));
      if (kind === "external-symlink") {
        await symlink(external, attackedPath);
      } else if (kind === "dangling-symlink") {
        await symlink(join(root, "missing-external-directory"), attackedPath);
      } else {
        await writeFile(attackedPath, "NOT-A-DIRECTORY");
      }

      await expect(ensureProjectPiHome({ projectRoot: project, credentialSeedDir: seed }))
        .rejects.toThrow("unsafe project");
      await expect(migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] }))
        .rejects.toThrow("unsafe project");
      expect(await readFile(join(external, "sentinel"), "utf8")).toBe("EXTERNAL-SENTINEL");
      expect(await readdir(external)).toEqual(["sentinel"]);
      expect(await readFile(join(seed, "models.json"), "utf8")).toBe(oldCanonical);
      expect(await readFile(join(seed, ".pipiui-shared-models-migration-v1.json"), "utf8")).toBe(oldManifest);
      expect((await readdir(seed)).filter((name) => name.endsWith(".bak"))).toEqual([]);
      expect((await lstat(attackedPath)).isSymbolicLink()).toBe(kind !== "non-directory");
    },
  );

  it.each(["settings.json", "models-store.json"])(
    "rejects external and dangling project %s symlinks without touching targets",
    async (name) => {
      root = await mkdtemp(join(tmpdir(), `pipi-project-file-symlink-${name}-`));
      const seed = join(root, "profile");
      const project = join(root, "project");
      const agentDir = projectPiAgentDir(project);
      const external = join(root, `external-${name}`);
      const projectFile = join(agentDir, name);
      await mkdir(seed, { recursive: true });
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(seed, "models.json"), '{"providers":{}}');
      await writeFile(join(seed, "settings.json"), '{"theme":"light"}');
      await writeFile(join(seed, "models-store.json"), '{"seed":true}');
      await writeFile(external, "EXTERNAL-SENTINEL");
      await symlink(external, projectFile);

      await expect(ensureProjectPiHome({ projectRoot: project, credentialSeedDir: seed }))
        .rejects.toThrow(`unsafe project ${name}`);
      expect(await readFile(external, "utf8")).toBe("EXTERNAL-SENTINEL");
      expect((await lstat(projectFile)).isSymbolicLink()).toBe(true);

      await rm(projectFile);
      const dangling = join(root, `missing-${name}`);
      await symlink(dangling, projectFile);
      await expect(ensureProjectPiHome({ projectRoot: project, credentialSeedDir: seed }))
        .rejects.toThrow(`unsafe project ${name}`);
      expect((await lstat(projectFile)).isSymbolicLink()).toBe(true);
      await expect(lstat(dangling)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(external, "utf8")).toBe("EXTERNAL-SENTINEL");
    },
  );

  it("rewrites dirty project settings and does not follow a symlink credential seed", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-home-sanitize-"));
    const project = join(root, "repo");
    const seed = join(root, "seed");
    const external = join(root, "auth.json");
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await mkdir(seed, { recursive: true });
    await writeFile(join(seed, "models.json"), '{"providers":{}}');
    await writeFile(join(projectPiAgentDir(project), "settings.json"), '{"theme":"light","packages":["other"]}');
    await writeFile(external, "secret\n");
    await symlink(external, join(seed, "auth.json"));
    expect(await sanitizePiSettingsFile(join(projectPiAgentDir(project), "settings.json"))).toBe(true);
    await ensureProjectPiHome({ projectRoot: project, credentialSeedDir: seed });
    expect(JSON.parse(await readFile(join(projectPiAgentDir(project), "settings.json"), "utf8"))).toEqual({ theme: "light" });
    await expect(readFile(join(projectPiAgentDir(project), "auth.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("aborts when project models.json is modified in place after the initial read", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-inplace-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    const external = join(root, "external-sentinel");
    const projectModels = join(projectPiAgentDir(project), "models.json");
    const original = '{"providers":{"old":{}}}\n';
    const newer = '{"providers":{"newer-inplace":{}}}\n';
    await mkdir(seed, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(seed, "models.json"), '{"providers":{"canonical":{}}}\n');
    await writeFile(projectModels, original);
    await writeFile(external, "EXTERNAL-SENTINEL");

    await expect(migrateSharedProjectModels({
      canonicalAgentDir: seed,
      projectRoots: [project],
      onMigrationStep: async (step) => {
        if (step.name === "sources-read") await writeFile(projectModels, newer);
      },
    })).rejects.toThrow("changed project models.json");
    expect(await readFile(projectModels, "utf8")).toBe(newer);
    expect((await lstat(projectModels)).isFile()).toBe(true);
    expect(await readFile(join(seed, "models.json"), "utf8")).toBe('{"providers":{"canonical":{}}}\n');
    expect((await readdir(seed)).filter((name) => name.includes(".bak"))).toEqual([]);
    expect((await readdir(projectPiAgentDir(project))).filter((name) => name.includes(".bak"))).toEqual([]);
    expect(await readFile(external, "utf8")).toBe("EXTERNAL-SENTINEL");
  });

  it("aborts when project models.json is atomically replaced after the initial read", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-atomic-replace-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    const external = join(root, "external-sentinel");
    const projectModels = join(projectPiAgentDir(project), "models.json");
    const original = '{"providers":{"old":{}}}\n';
    const newer = '{"providers":{"newer-replaced":{}}}\n';
    await mkdir(seed, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(seed, "models.json"), '{"providers":{"canonical":{}}}\n');
    await writeFile(projectModels, original);
    await writeFile(external, "EXTERNAL-SENTINEL");

    await expect(migrateSharedProjectModels({
      canonicalAgentDir: seed,
      projectRoots: [project],
      onMigrationStep: async (step) => {
        if (step.name === "sources-read") {
          const replacement = join(projectPiAgentDir(project), ".models-replaced.tmp");
          await writeFile(replacement, newer);
          await rename(replacement, projectModels);
        }
      },
    })).rejects.toThrow("changed project models.json");
    expect(await readFile(projectModels, "utf8")).toBe(newer);
    expect((await lstat(projectModels)).isFile()).toBe(true);
    expect(await readFile(join(seed, "models.json"), "utf8")).toBe('{"providers":{"canonical":{}}}\n');
    expect((await readdir(projectPiAgentDir(project))).filter((name) => name.includes(".bak"))).toEqual([]);
    expect(await readFile(external, "utf8")).toBe("EXTERNAL-SENTINEL");
  });

  it.each(["regular", "symlink"] as const)(
    "keeps a concurrent %s created after quarantine and does not overwrite it",
    async (kind) => {
      root = await mkdtemp(join(tmpdir(), `pipi-model-concurrent-${kind}-`));
      const seed = join(root, "profile");
      const project = join(root, "project");
      const external = join(root, "external-sentinel");
      const projectModels = join(projectPiAgentDir(project), "models.json");
      const original = '{"providers":{"original":{}}}\n';
      const concurrent = '{"providers":{"concurrent":{}}}\n';
      await mkdir(seed, { recursive: true });
      await mkdir(projectPiAgentDir(project), { recursive: true });
      await writeFile(join(seed, "models.json"), '{"providers":{"canonical":{}}}\n');
      await writeFile(projectModels, original);
      await writeFile(external, "EXTERNAL-SENTINEL");

      await expect(migrateSharedProjectModels({
        canonicalAgentDir: seed,
        projectRoots: [project],
        onMigrationStep: async (step) => {
          if (step.name !== "before-project-link") return;
          if (kind === "regular") await writeFile(projectModels, concurrent);
          else await symlink(external, projectModels);
        },
      })).rejects.toThrow(/concurrent models\.json/);
      if (kind === "regular") {
        expect((await lstat(projectModels)).isFile()).toBe(true);
        expect(await readFile(projectModels, "utf8")).toBe(concurrent);
      } else {
        expect((await lstat(projectModels)).isSymbolicLink()).toBe(true);
        expect(await readlink(projectModels)).toBe(external);
      }
      const backups = (await readdir(projectPiAgentDir(project))).filter((name) => name.endsWith(".bak"));
      expect(backups).toHaveLength(1);
      expect(await readFile(join(projectPiAgentDir(project), backups[0]), "utf8")).toBe(original);
      expect((await stat(join(projectPiAgentDir(project), backups[0]))).mode & 0o777).toBe(0o600);
      expect(await readFile(join(seed, "models.json"), "utf8")).toBe('{"providers":{"canonical":{}}}\n');
      expect(await readFile(external, "utf8")).toBe("EXTERNAL-SENTINEL");
    },
  );

  it("repairs a canonical input-alias link to the real stable canonical", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-alias-repair-"));
    const realSeed = join(root, "profile");
    const aliasSeed = join(root, "profile-alias");
    const project = join(root, "project");
    const external = join(root, "external-sentinel");
    await mkdir(realSeed, { recursive: true });
    await symlink(realSeed, aliasSeed);
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(realSeed, "models.json"), '{"providers":{}}\n');
    await writeFile(external, "EXTERNAL-SENTINEL");
    await symlink(join(aliasSeed, "models.json"), join(projectPiAgentDir(project), "models.json"));

    const manifest = await migrateSharedProjectModels({ canonicalAgentDir: aliasSeed, projectRoots: [project] });
    const stable = join(await realpath(realSeed), "models.json");
    expect(await readlink(join(projectPiAgentDir(project), "models.json"))).toBe(stable);
    expect(manifest?.projects).toHaveLength(1);
    expect(await migrateSharedProjectModels({ canonicalAgentDir: aliasSeed, projectRoots: [project] })).toBeNull();
    expect(await readFile(external, "utf8")).toBe("EXTERNAL-SENTINEL");
  });

  it("tightens an unchanged 0644 canonical to 0600 on the already-linked early return", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-canonical-mode-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    await mkdir(seed, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    const canonical = join(seed, "models.json");
    await writeFile(canonical, '{"providers":{}}\n');
    await chmod(canonical, 0o644);
    const stable = join(await realpath(seed), "models.json");
    await symlink(stable, join(projectPiAgentDir(project), "models.json"));
    expect((await stat(canonical)).mode & 0o777).toBe(0o644);

    expect(await migrateSharedProjectModels({ canonicalAgentDir: seed, projectRoots: [project] })).toBeNull();
    expect((await stat(canonical)).mode & 0o777).toBe(0o600);
    expect(await readlink(join(projectPiAgentDir(project), "models.json"))).toBe(stable);
  });

  it("reports rollback failures instead of swallowing them", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-rollback-error-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    const external = join(root, "external-sentinel");
    const agentDir = projectPiAgentDir(project);
    const original = '{"providers":{"original":{}}}\n';
    await mkdir(seed, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(seed, "models.json"), '{"providers":{"canonical":{}}}\n');
    await writeFile(join(agentDir, "models.json"), original);
    await writeFile(external, "EXTERNAL-SENTINEL");

    try {
      await expect(migrateSharedProjectModels({
        canonicalAgentDir: seed,
        projectRoots: [project],
        onMigrationStep: async (step) => {
          if (step.name !== "before-manifest-write") return;
          await chmod(agentDir, 0o000);
          throw new Error("injected failure at before-manifest-write");
        },
      })).rejects.toThrow(/injected failure at before-manifest-write;[\s\S]*rollback failed/);
    } finally {
      await chmod(agentDir, 0o700).catch(() => undefined);
    }
    const backups = (await readdir(agentDir)).filter((name) => name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(agentDir, backups[0]), "utf8")).toBe(original);
    expect(await readFile(external, "utf8")).toBe("EXTERNAL-SENTINEL");
  });

  it("keeps a concurrent create when the initial canonical is missing", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-missing-create-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    const concurrent = '{"providers":{"concurrent":{}}}\n';
    await mkdir(seed, { recursive: true });
    await mkdir(project, { recursive: true });

    await expect(migrateSharedProjectModels({
      canonicalAgentDir: seed,
      projectRoots: [project],
      onMigrationStep: async (step) => {
        if (step.name !== "before-canonical-publish") return;
        await writeFile(join(seed, "models.json"), concurrent);
      },
    })).rejects.toThrow(/concurrent models\.json/);
    expect(await readFile(join(seed, "models.json"), "utf8")).toBe(concurrent);
    expect((await lstat(join(seed, "models.json"))).isFile()).toBe(true);
  });

  it.each(["in-place", "replace"] as const)(
    "keeps a concurrent %s of an existing canonical before publish",
    async (kind) => {
      root = await mkdtemp(join(tmpdir(), `pipi-model-canonical-${kind}-`));
      const seed = join(root, "profile");
      const project = join(root, "project");
      const original = '{"providers":{"canonical":{}}}\n';
      const newer = '{"providers":{"external":{}}}\n';
      await mkdir(seed, { recursive: true });
      await mkdir(projectPiAgentDir(project), { recursive: true });
      await writeFile(join(seed, "models.json"), original);
      await writeFile(join(projectPiAgentDir(project), "models.json"), '{"providers":{"project":{}}}\n');

      await expect(migrateSharedProjectModels({
        canonicalAgentDir: seed,
        projectRoots: [project],
        onMigrationStep: async (step) => {
          if (step.name !== "before-canonical-publish") return;
          if (kind === "in-place") {
            await writeFile(join(seed, "models.json"), newer);
            return;
          }
          const replacement = join(seed, ".models-replaced.tmp");
          await writeFile(replacement, newer);
          await rename(replacement, join(seed, "models.json"));
        },
      })).rejects.toThrow("changed canonical models.json");
      expect(await readFile(join(seed, "models.json"), "utf8")).toBe(newer);
      expect(await readFile(join(projectPiAgentDir(project), "models.json"), "utf8")).toBe('{"providers":{"project":{}}}\n');
    },
  );

  it("does not replace a concurrent occupant after canonical quarantine", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-canonical-eexist-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    const original = '{"providers":{"canonical":{}}}\n';
    const occupant = '{"providers":{"occupant":{}}}\n';
    await mkdir(seed, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(seed, "models.json"), original);
    await writeFile(join(projectPiAgentDir(project), "models.json"), '{"providers":{"project":{}}}\n');

    await expect(migrateSharedProjectModels({
      canonicalAgentDir: seed,
      projectRoots: [project],
      onMigrationStep: async (step) => {
        if (step.name !== "after-canonical-quarantine") return;
        await writeFile(join(seed, "models.json"), occupant);
      },
    })).rejects.toThrow(/concurrent models\.json/);
    expect(await readFile(join(seed, "models.json"), "utf8")).toBe(occupant);
    expect((await lstat(join(seed, "models.json"))).isFile()).toBe(true);
    const backups = (await readdir(seed)).filter((name) => name.includes(".bak") || name.includes(".quarantine"));
    expect(backups.length).toBeGreaterThan(0);
    expect(await readFile(join(seed, backups[0]), "utf8")).toBe(original);
    expect(await readFile(join(projectPiAgentDir(project), "models.json"), "utf8")).toBe('{"providers":{"project":{}}}\n');
  });

  it("keeps an external rewrite during rollback instead of restoring over it", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-rollback-rewrite-"));
    const seed = join(root, "profile");
    const project = join(root, "project");
    const original = '{"providers":{"canonical":{}}}\n';
    const rewritten = '{"providers":{"rewritten":{}}}\n';
    await mkdir(seed, { recursive: true });
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(seed, "models.json"), original);
    await writeFile(join(projectPiAgentDir(project), "models.json"), '{"providers":{"project":{}}}\n');

    await expect(migrateSharedProjectModels({
      canonicalAgentDir: seed,
      projectRoots: [project],
      onMigrationStep: async (step) => {
        if (step.name === "canonical-written") {
          await writeFile(join(seed, "models.json"), rewritten);
        }
        if (step.name === "before-manifest-write") throw new Error("injected failure at before-manifest-write");
      },
    })).rejects.toThrow(/injected failure at before-manifest-write;[\s\S]*concurrent models\.json/);
    expect(await readFile(join(seed, "models.json"), "utf8")).toBe(rewritten);
    const backups = (await readdir(seed)).filter((name) => name.includes(".bak") || name.includes(".quarantine"));
    expect(backups.length).toBeGreaterThan(0);
    expect(await readFile(join(seed, backups[0]), "utf8")).toBe(original);
  });

  it.each([
    { kind: "alias-link" as const, failAt: "project-link-installed" as const },
    { kind: "alias-link" as const, failAt: "before-manifest-write" as const },
    { kind: "stale-temp-link" as const, failAt: "project-link-installed" as const },
    { kind: "stale-temp-link" as const, failAt: "before-manifest-write" as const },
  ])("restores the exact $kind target after $failAt", async ({ kind, failAt }) => {
    root = await mkdtemp(join(tmpdir(), `pipi-model-${kind}-${failAt}-`));
    const realSeed = join(root, "profile");
    const aliasSeed = join(root, "profile-alias");
    const project = join(root, "project");
    await mkdir(realSeed, { recursive: true });
    await symlink(realSeed, aliasSeed);
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(realSeed, "models.json"), '{"providers":{}}\n');
    const projectModels = join(projectPiAgentDir(project), "models.json");
    const rawTarget = kind === "alias-link"
      ? join(aliasSeed, "models.json")
      : join(aliasSeed, ".models.json-interrupted.tmp");
    await symlink(rawTarget, projectModels);

    await expect(migrateSharedProjectModels({
      canonicalAgentDir: aliasSeed,
      projectRoots: [project],
      onMigrationStep: async (step) => {
        if (step.name === failAt) throw new Error(`injected failure at ${failAt}`);
      },
    })).rejects.toThrow(`injected failure at ${failAt}`);
    expect((await lstat(projectModels)).isSymbolicLink()).toBe(true);
    expect(await readlink(projectModels)).toBe(rawTarget);
    expect((await readdir(projectPiAgentDir(project))).some((name) => name.startsWith(".models-alias-"))).toBe(true);
  });

  it("does not restore an alias link over a later occupant", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-model-alias-occupant-"));
    const realSeed = join(root, "profile");
    const aliasSeed = join(root, "profile-alias");
    const project = join(root, "project");
    const occupant = '{"providers":{"occupant":{}}}\n';
    await mkdir(realSeed, { recursive: true });
    await symlink(realSeed, aliasSeed);
    await mkdir(projectPiAgentDir(project), { recursive: true });
    await writeFile(join(realSeed, "models.json"), '{"providers":{}}\n');
    const projectModels = join(projectPiAgentDir(project), "models.json");
    const rawTarget = join(aliasSeed, "models.json");
    await symlink(rawTarget, projectModels);

    await expect(migrateSharedProjectModels({
      canonicalAgentDir: aliasSeed,
      projectRoots: [project],
      onMigrationStep: async (step) => {
        if (step.name !== "before-manifest-write") return;
        await rm(projectModels);
        await writeFile(projectModels, occupant);
        throw new Error("injected failure at before-manifest-write");
      },
    })).rejects.toThrow("injected failure at before-manifest-write");
    expect((await lstat(projectModels)).isFile()).toBe(true);
    expect(await readFile(projectModels, "utf8")).toBe(occupant);
  });
});
