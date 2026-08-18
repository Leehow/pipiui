import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, readdir, realpath, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import {
  ensureProjectPiHome,
  migrateSharedProjectModels,
  projectPiAgentDir,
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
        // be absent at the pre-mutation read/verify hooks when this run creates it.
        if (step.name !== "sources-read" && step.name !== "snapshots-verified") {
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
});
