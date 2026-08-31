import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCustomProductProfile,
  updateCustomProductProfileExtensions,
} from "../src/project-profile-editor.js";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("project custom Product Profile editor", () => {
  it("creates readable unique custom pack ids and a usable base layout", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-custom-pack-"));
    const first = await createCustomProductProfile(root, "我的扩展包");
    const second = await createCustomProductProfile(root, "我的扩展包");

    expect(first).toMatchObject({
      id: "custom-pack",
      name: "我的扩展包",
      customizable: true,
      extensions: { required: [{ id: "skill-loader-extension", version: "^1.0.0" }], recommended: [] },
      layout: { primarySidebar: "pipi.sessions", center: "pipi.conversation" },
    });
    expect(second.id).toBe("custom-pack-2");
  });

  it("replaces custom membership deterministically", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-custom-pack-members-"));
    const created = await createCustomProductProfile(root, "Lab Tools");
    const updated = await updateCustomProductProfileExtensions(root, created.id, [
      { id: "vision-routing", version: "0.2.0" },
      { id: "document-workbench", version: "1.0.0" },
    ]);

    expect(updated.extensions).toEqual({
      required: [{ id: "skill-loader-extension", version: "^1.0.0" }],
      recommended: [
        { id: "document-workbench", version: "1.0.0" },
        { id: "vision-routing", version: "0.2.0" },
      ],
    });
    expect(JSON.parse(await readFile(join(root, "profiles", created.id, "pipiui-profile.json"), "utf8")))
      .toEqual(updated);
  });

  it("refuses to edit an imported non-customizable profile", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-fixed-pack-"));
    await mkdir(join(root, "profiles", "fixed"), { recursive: true });
    await writeFile(join(root, "profiles", "fixed", "pipiui-profile.json"), JSON.stringify({
      schemaVersion: 1,
      id: "fixed",
      name: "Fixed",
      extensions: { required: [], recommended: [] },
      layout: {},
    }));

    await expect(updateCustomProductProfileExtensions(root, "fixed", []))
      .rejects.toThrow(/not customizable/);
  });
});
