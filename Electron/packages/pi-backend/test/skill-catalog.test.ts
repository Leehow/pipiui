import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSkillCatalog } from "../src/skill-catalog.js";
import { createPiHostBackend } from "../src/index.js";

async function writeSkill(dir: string, name: string, description: string, extra = ""): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n${extra}---\n# ${name}\n`,
  );
}

describe("collectSkillCatalog", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("reads frontmatter, splits auto vs heavier, and keeps separate sources", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-skill-catalog-"));
    const builtin = join(root, "built-in-skills");
    const ext = join(root, "quota", "skills", "hello");
    const project = join(root, "project-skills");
    await writeSkill(join(builtin, "tdd"), "tdd", "Test-driven development.");
    await writeSkill(join(builtin, "to-spec"), "to-spec", '"Turn the conversation into a spec."', "disable-model-invocation: true\n");
    await writeSkill(ext, "hello", "Quota hello skill.");
    await writeSkill(join(project, "local-flow"), "local-flow", "Project-only workflow.");
    await mkdir(join(builtin, "empty"), { recursive: true });
    await writeFile(join(builtin, "empty", "SKILL.md"), "# no frontmatter\n");

    const catalog = collectSkillCatalog([
      { origin: "builtin", sourceId: "built-in-skills", sourceName: "Built-in Skills", root: builtin, available: true },
      { origin: "extension", sourceId: "quota", sourceName: "Quota", root: join(root, "quota", "skills"), available: false },
      { origin: "project", sourceId: "project", sourceName: "当前项目", root: project, available: true },
    ]);

    expect(catalog.map((item) => item.name)).toEqual(["tdd", "to-spec", "hello", "local-flow"]);
    expect(catalog.find((item) => item.name === "tdd")).toMatchObject({
      origin: "builtin",
      sourceId: "built-in-skills",
      userInvoked: false,
      available: true,
      description: "Test-driven development.",
    });
    expect(catalog.find((item) => item.name === "to-spec")).toMatchObject({ userInvoked: true });
    expect(catalog.find((item) => item.name === "hello")).toMatchObject({
      origin: "extension",
      sourceId: "quota",
      available: false,
    });
    expect(JSON.stringify(catalog)).not.toContain(root);
  });

  it("does not follow a symlink that escapes the skill root", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-skill-catalog-jail-"));
    const outside = join(root, "outside");
    const jail = join(root, "skills");
    await writeSkill(join(outside, "secret"), "secret", "Should not appear.");
    await mkdir(jail, { recursive: true });
    await symlink(outside, join(jail, "escape"));
    const catalog = collectSkillCatalog([
      { origin: "project", sourceId: "project", sourceName: "当前项目", root: jail, available: true },
    ]);
    expect(catalog).toEqual([]);
  });
});

describe("listSkillCatalog host method", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("returns builtin and extension skills without filesystem paths", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-skill-catalog-host-"));
    const runtime = join(root, "runtime");
    const agent = join(root, "agent");
    await writeSkill(join(runtime, "built-in-skills", "tdd"), "tdd", "Test-driven development.");
    const quota = join(agent, "extensions", "quota");
    await mkdir(join(quota, "skills", "hello"), { recursive: true });
    await writeFile(join(quota, "pipiui-extension.json"), `${JSON.stringify({
      id: "quota",
      name: "Quota",
      version: "1.0.0",
      capabilities: [],
      agent: { skills: ["skills/hello"] },
    }, null, 2)}\n`);
    await writeSkill(join(quota, "skills", "hello"), "hello", "Quota hello skill.");
    const host = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: runtime,
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
    });
    const catalog = await host.handle("listSkillCatalog" as never, []) as Array<{ name: string; origin: string; sourceId: string }>;
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "tdd", origin: "builtin", sourceId: "built-in-skills" }),
      expect.objectContaining({ name: "hello", origin: "extension", sourceId: "quota" }),
    ]));
    expect(JSON.stringify(catalog)).not.toContain(root);
    await host.close?.();
  });
});
