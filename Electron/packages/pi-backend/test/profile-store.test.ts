import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROJECT_EXTENSION_ENABLED_FILE, readProjectExtensionEnabled } from "../src/extension-registry.js";
import { readProjectProductActivation, writeProjectProductActivation } from "../src/profile-store.js";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("project Product Profile storage", () => {
  it("defaults a fresh project to the base Profile while legacy enablement remains Coding", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-store-base-"));
    expect(await readProjectProductActivation(root, { defaultProfileId: "base" })).toEqual({
      schemaVersion: 2,
      profile: "base",
      overrides: {},
    });
  });

  it("migrates the pre-release empty Profile name to the base product", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-store-empty-migration-"));
    const path = join(root, PROJECT_EXTENSION_ENABLED_FILE);
    await writeFile(path, JSON.stringify({ schemaVersion: 2, profile: "empty", overrides: { "web-access-extension": "disabled" } }), "utf8");

    const activation = await readProjectProductActivation(root, { defaultProfileId: "base" });
    expect(activation).toEqual({ schemaVersion: 2, profile: "base", overrides: { "web-access-extension": "disabled" } });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(activation);
  });

  it("reads a schema 3 overlay that omits profile as the product default without rewriting Pipi Hydra's file", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-store-v3-"));
    const path = join(root, PROJECT_EXTENSION_ENABLED_FILE);
    const original = JSON.stringify({
      schemaVersion: 3,
      overrides: { "hydra-workbench": "enabled" },
    });
    await writeFile(path, original, "utf8");

    const activation = await readProjectProductActivation(root, { defaultProfileId: "coding" });

    expect(activation).toEqual({
      schemaVersion: 2,
      profile: "coding",
      overrides: { "hydra-workbench": "enabled" },
    });
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readProjectExtensionEnabled(root)).toEqual({ "hydra-workbench": true });
  });

  it("keeps an explicit schema 3 profile when reading", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-store-v3-profile-"));
    const path = join(root, PROJECT_EXTENSION_ENABLED_FILE);
    const original = JSON.stringify({
      schemaVersion: 3,
      profile: "base",
      overrides: { "skill-loader-extension": "disabled" },
    });
    await writeFile(path, original, "utf8");

    const activation = await readProjectProductActivation(root, { defaultProfileId: "coding" });
    expect(activation).toEqual({
      schemaVersion: 2,
      profile: "base",
      overrides: { "skill-loader-extension": "disabled" },
    });
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("survives concurrent writes from one process", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-store-concurrent-"));
    const activations = Array.from({ length: 8 }, (_, i) => ({
      schemaVersion: 2 as const,
      profile: "coding",
      overrides: { [`ext-${i}`]: "enabled" as const },
    }));

    await Promise.all(activations.map((activation) => writeProjectProductActivation(root, activation)));

    expect(activations).toContainEqual(await readProjectProductActivation(root, { defaultProfileId: "coding" }));
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("atomically migrates a legacy extension overlay into the coding profile", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-profile-store-"));
    const path = join(root, PROJECT_EXTENSION_ENABLED_FILE);
    await writeFile(path, JSON.stringify({ "code-retrieval": true, "pdf-extension": false }), "utf8");

    const activation = await readProjectProductActivation(root, { defaultProfileId: "coding" });

    expect(activation).toEqual({
      schemaVersion: 2,
      profile: "coding",
      overrides: {
        "code-retrieval": "enabled",
        "pdf-extension": "disabled",
      },
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(activation);
    expect(await readProjectExtensionEnabled(root)).toEqual({
      "code-retrieval": true,
      "pdf-extension": false,
    });
  });
});
