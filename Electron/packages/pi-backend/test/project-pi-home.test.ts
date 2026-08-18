import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import {
  ensureProjectPiHome,
  projectPiAgentDir,
  projectPiSessionsDir,
  sanitizePiSettings,
  sanitizePiSettingsFile,
} from "../src/project-pi-home.js";

describe("project Pi home", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("places the coding home under the project, not a shared profile", () => {
    expect(projectPiAgentDir("/Users/me/code/pipiui")).toBe("/Users/me/code/pipiui/.pi/agent");
    expect(projectPiSessionsDir("/Users/me/code/pipiui")).toBe("/Users/me/code/pipiui/.pi/agent/sessions");
  });

  it("strips packages and other ambient resource locators from settings", () => {
    expect(sanitizePiSettings({
      defaultProvider: "xai",
      defaultModel: "grok-4.5",
      theme: "light",
      packages: ["/Users/me/code/chatrpgv4"],
      extensions: ["extensions/global.ts"],
      skills: ["skills/global"],
    })).toEqual({
      defaultProvider: "xai",
      defaultModel: "grok-4.5",
      theme: "light",
    });
  });

  it("creates a project home without packages and without touching a planted global home", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-home-"));
    const project = join(root, "pipiui");
    const seed = join(root, "host-profile");
    const globalHome = join(root, "fake-global", ".pi", "agent");
    await mkdir(project, { recursive: true });
    await mkdir(seed, { recursive: true });
    await mkdir(globalHome, { recursive: true });
    await writeFile(join(globalHome, "settings.json"), `${JSON.stringify({ packages: ["must-not-change"] })}\n`);
    await writeFile(join(seed, "settings.json"), `${JSON.stringify({
      defaultProvider: "xai",
      packages: ["/Users/me/code/chatrpgv4"],
      extensions: ["keep-out"],
    })}\n`);
    await writeFile(join(seed, "auth.json"), '{"xai":{"type":"api_key"}}\n');
    await writeFile(join(seed, "models.json"), '{"providers":{}}\n');
    await writeFile(join(seed, ".env"), "XAI_API_KEY=seed\n");

    const home = await ensureProjectPiHome({ projectRoot: project, credentialSeedDir: seed });
    expect(home.agentDir).toBe(join(project, ".pi", "agent"));
    expect(home.sessionsDir).toBe(join(project, ".pi", "agent", "sessions"));

    const settings = JSON.parse(await readFile(join(home.agentDir, "settings.json"), "utf8"));
    expect(settings.defaultProvider).toBe("xai");
    expect(settings).not.toHaveProperty("packages");
    expect(settings).not.toHaveProperty("extensions");
    expect(await readFile(join(home.agentDir, "auth.json"), "utf8")).toBe('{"xai":{"type":"api_key"}}\n');
    expect(await readFile(join(home.agentDir, "models.json"), "utf8")).toBe('{"providers":{}}\n');
    expect(await readFile(join(home.agentDir, ".env"), "utf8")).toBe("XAI_API_KEY=seed\n");
    expect((await lstat(join(home.agentDir, "auth.json"))).isSymbolicLink()).toBe(false);

    expect(await readFile(join(globalHome, "settings.json"), "utf8")).toBe(`${JSON.stringify({ packages: ["must-not-change"] })}\n`);
  });

  it("rewrites an existing project settings file that still lists packages", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-home-sanitize-"));
    const project = join(root, "repo");
    const agentDir = projectPiAgentDir(project);
    await mkdir(agentDir, { recursive: true });
    const dirty = join(agentDir, "settings.json");
    await writeFile(dirty, `${JSON.stringify({ theme: "light", packages: ["/other"] })}\n`);
    await sanitizePiSettingsFile(dirty);
    expect(JSON.parse(await readFile(dirty, "utf8"))).toEqual({ theme: "light" });
  });

  it("does not follow a symlink seed into another home", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-home-symlink-"));
    const project = join(root, "repo");
    const seed = join(root, "seed");
    const realAuth = join(root, "elsewhere", "auth.json");
    await mkdir(join(root, "elsewhere"), { recursive: true });
    await mkdir(seed, { recursive: true });
    await writeFile(realAuth, "secret\n");
    const { symlink } = await import("node:fs/promises");
    await symlink(realAuth, join(seed, "auth.json"));
    await ensureProjectPiHome({ projectRoot: project, credentialSeedDir: seed });
    await expect(readFile(join(projectPiAgentDir(project), "auth.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
