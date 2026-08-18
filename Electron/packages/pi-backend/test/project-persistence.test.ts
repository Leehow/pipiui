import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

async function setup(paths = ["haoli"]): Promise<{ agent: string; sessions: string; projects: Record<string, string> }> {
  root = await mkdtemp(join(tmpdir(), "pipi-project-paths-"));
  const agent = join(root, "agent");
  const sessions = join(root, "sessions");
  const projects: Record<string, string> = {};
  await mkdir(agent, { recursive: true });
  for (const name of paths) {
    const cwd = join(root, name);
    projects[name] = cwd;
    await mkdir(cwd, { recursive: true });
    const sessionDir = join(sessions, encodeURIComponent(cwd));
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, `${name}.jsonl`), JSON.stringify({ type: "session", version: 3, id: `${name}-session`, timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
  }
  return { agent, sessions, projects };
}

function backend(agent: string, sessions: string, canonicalProjectPaths: () => Promise<string[] | undefined> = async () => undefined) { return createPiHostBackend({ agentDir: agent, sessionsRoot: sessions, canonicalProjectPaths }); }

describe("explicit sidebar project persistence", () => {
  it("starts empty despite historical JSONL cwd values and records the presence sentinel", async () => {
    const fixture = await setup(["haoli", "other"]);
    const first = backend(fixture.agent, fixture.sessions);
    expect(await first.handle("listProjects", [])).toEqual([]);
    const settings = JSON.parse(await readFile(join(fixture.agent, "pipiui-settings.json"), "utf8"));
    expect(settings).toMatchObject({ projectPathsVersion: 1, projectPaths: [] });
    expect(await first.handle("getProjectPaths", [])).toEqual([]);
  });

  it("does not resurrect a removed project from JSONL after a new backend instance", async () => {
    const fixture = await setup();
    const first = backend(fixture.agent, fixture.sessions);
    const project = await first.handle("addProject", [fixture.projects.haoli]) as any;
    await first.handle("removeProject", [project.id]);
    // Removing a sidebar entry is non-destructive: the historical session stays on disk.
    expect(await readFile(join(fixture.sessions, encodeURIComponent(fixture.projects.haoli), "haoli.jsonl"), "utf8")).toContain("haoli-session");
    expect(await backend(fixture.agent, fixture.sessions).handle("listProjects", [])).toEqual([]);
  });

  it("keeps an explicitly saved empty list empty instead of re-running migration", async () => {
    const fixture = await setup();
    const first = backend(fixture.agent, fixture.sessions);
    expect(await first.handle("setProjectPaths", [[]])).toEqual([]);
    expect(await backend(fixture.agent, fixture.sessions).handle("listProjects", [])).toEqual([]);
  });

  it("adds a path back to the sidebar and lists its existing sessions", async () => {
    const fixture = await setup();
    const first = backend(fixture.agent, fixture.sessions);
    await first.handle("setProjectPaths", [[]]);
    const added = await first.handle("addProject", [fixture.projects.haoli]) as any;
    expect(added.path).toBe(fixture.projects.haoli);
    const fresh = backend(fixture.agent, fixture.sessions);
    expect(await fresh.handle("listProjects", [])).toEqual([expect.objectContaining({ id: added.id, path: fixture.projects.haoli })]);
    expect(await fresh.handle("listSessions", [added.id])).toEqual([expect.objectContaining({ id: "haoli-session", projectId: added.id })]);
  });

  it("moves a session to another project's real cwd without changing its transcript", async () => {
    const fixture = await setup(["haoli", "other"]);
    const first = backend(fixture.agent, fixture.sessions);
    await first.handle("setProjectPaths", [[fixture.projects.haoli, fixture.projects.other]]);
    const projects = await first.handle("listProjects", []) as any[];
    const source = projects.find(project => project.path === fixture.projects.haoli);
    const target = projects.find(project => project.path === fixture.projects.other);
    const sourceFile = join(fixture.sessions, encodeURIComponent(fixture.projects.haoli), "haoli.jsonl");
    await writeFile(sourceFile, (await readFile(sourceFile, "utf8")) + JSON.stringify({ type: "message", id: "u1", timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "keep this" } }) + "\n");

    const moved = await first.handle("moveSession", ["haoli-session", target.id]) as any;

    expect(moved).toMatchObject({ id: "haoli-session", projectId: target.id });
    expect(await first.handle("listSessions", [source.id])).toEqual([]);
    expect(await first.handle("listSessions", [target.id])).toEqual(expect.arrayContaining([expect.objectContaining({ id: "haoli-session" })]));
    const rows = (await readFile(sourceFile, "utf8")).trim().split("\n").map(JSON.parse);
    expect(rows[0]).toMatchObject({ id: "haoli-session", cwd: fixture.projects.other });
    expect(rows[1]).toMatchObject({ id: "u1", message: { content: "keep this" } });
    expect((await readdir(dirname(sourceFile))).filter(name => name.includes(".tmp-"))).toEqual([]);
    await expect(first.handle("moveSession", ["haoli-session", "missing-project"])).rejects.toThrow("unknown project");
  });

  it("creates a session without waiting for the optional network model catalog", async () => {
    const fixture = await setup();
    const stalledCatalog = new Promise<never>(() => undefined);
    const first = createPiHostBackend({
      agentDir: fixture.agent,
      sessionsRoot: fixture.sessions,
      canonicalProjectPaths: async () => undefined,
      authRuntime: {
        getProviders: async () => [],
        getAvailable: () => stalledCatalog,
        login: async () => undefined,
        logout: async () => undefined,
      },
    });
    const project = await first.handle("addProject", [fixture.projects.haoli]) as any;

    const created = await Promise.race([
      first.handle("newSession", [project.id]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("newSession waited for model catalog")), 100)),
    ]) as any;

    expect(created).toMatchObject({ projectId: project.id, name: "New session" });
    expect(await first.handle("listSessions", [project.id])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id }),
    ]));
  });

  it("replaces one legacy polluted list once from the canonical Swift plist source, then keeps explicit Host edits", async () => {
    const fixture = await setup(["haoli", "other"]);
    await writeFile(join(fixture.agent, "pipiui-settings.json"), JSON.stringify({ projectPathsVersion: 1, projectPaths: [fixture.projects.haoli, fixture.projects.other, "/old/discovered"] }));
    const canonical = async () => [fixture.projects.haoli];
    const migrated = backend(fixture.agent, fixture.sessions, canonical);
    expect(await migrated.handle("getProjectPaths", [])).toEqual([fixture.projects.haoli]);
    const settings = JSON.parse(await readFile(join(fixture.agent, "pipiui-settings.json"), "utf8"));
    expect(settings).toMatchObject({ projectPathsVersion: 1, projectPaths: [fixture.projects.haoli], projectPathsCanonicalMigrationVersion: 1, projectPathsCanonicalMigrationSource: "com.leehow.pipiui:pipiui.projects" });
    await migrated.handle("addProject", [fixture.projects.other]);
    const fresh = backend(fixture.agent, fixture.sessions, async () => []);
    expect(await fresh.handle("getProjectPaths", [])).toEqual([fixture.projects.other, fixture.projects.haoli]);
  });

  it("atomically merges project paths with hidden IDs and unrelated queue settings fields", async () => {
    const fixture = await setup();
    await writeFile(join(fixture.agent, "pipiui-settings.json"), JSON.stringify({ hiddenModelIds: ["openai/gpt-5"], queue: { retained: true }, futureQueueField: ["keep"] }) + "\n");
    const first = backend(fixture.agent, fixture.sessions);
    await first.handle("listProjects", []); // initialization must preserve existing fields
    expect(await first.handle("setHiddenModelIds", [["anthropic/claude-sonnet-4"]])).toEqual(["anthropic/claude-sonnet-4"]);
    const settings = JSON.parse(await readFile(join(fixture.agent, "pipiui-settings.json"), "utf8"));
    expect(settings).toMatchObject({
      hiddenModelIds: ["anthropic/claude-sonnet-4"],
      projectPathsVersion: 1,
      projectPaths: [],
      queue: { retained: true },
      futureQueueField: ["keep"],
    });
  });

  it("persists Computer Use and ordered subagent model chains without replacing other settings", async () => {
    const fixture = await setup();
    const first = backend(fixture.agent, fixture.sessions);
    expect(await first.handle("getComputerUseState", [])).toEqual({ enabled: false });
    expect(await first.handle("setComputerUseEnabled", [true])).toEqual({ enabled: true });
    expect(await first.handle("setSubagentModel", ["operator", [{ model: "openai/gpt-5", thinking: "high" }, { model: "anthropic/claude-sonnet-4", thinking: "medium" }]])).toEqual({
      operator: [{ model: "openai/gpt-5", thinking: "high" }, { model: "anthropic/claude-sonnet-4", thinking: "medium" }],
    });
    expect(await first.handle("listAgentDefinitions", [])).toEqual(expect.arrayContaining([
	  expect.objectContaining({ name: "computer-use-leader" }),
      expect.objectContaining({ name: "operator" }),
	  expect.objectContaining({ name: "computer-verifier" }),
    ]));
    const fresh = backend(fixture.agent, fixture.sessions);
    expect(await fresh.handle("getComputerUseState", [])).toEqual({ enabled: true });
    expect(await fresh.handle("getSubagentModels", [])).toEqual({
      operator: [{ model: "openai/gpt-5", thinking: "high" }, { model: "anthropic/claude-sonnet-4", thinking: "medium" }],
    });
  });

  it("persists a provider-qualified Hermes review model and clears back to follow-main", async () => {
    const fixture = await setup();
    const first = backend(fixture.agent, fixture.sessions);
    expect(await first.handle("getMemoryReviewModel", [])).toBeNull();
    expect(await first.handle("setMemoryReviewModel", ["anthropic/claude-sonnet-4"])).toBe("anthropic/claude-sonnet-4");
    expect(await backend(fixture.agent, fixture.sessions).handle("getMemoryReviewModel", [])).toBe("anthropic/claude-sonnet-4");
    await expect(first.handle("setMemoryReviewModel", ["claude-sonnet-4"])).rejects.toThrow(/provider\/model/);
    expect(await first.handle("setMemoryReviewModel", [null])).toBeNull();
    expect(await backend(fixture.agent, fixture.sessions).handle("getMemoryReviewModel", [])).toBeNull();
    const settings = JSON.parse(await readFile(join(fixture.agent, "pipiui-settings.json"), "utf8"));
    expect(settings.memoryReviewModel).toBeUndefined();
  });

  it("renames the stored display name without changing the folder path", async () => {
    const fixture = await setup();
    const first = backend(fixture.agent, fixture.sessions);
    const added = await first.handle("addProject", [fixture.projects.haoli]) as any;
    expect(added).toMatchObject({ path: fixture.projects.haoli, name: "haoli" });

    const renamed = await first.handle("renameProject", [added.id, "  我的仓库  "]) as any;
    expect(renamed).toMatchObject({ id: added.id, path: fixture.projects.haoli, name: "我的仓库" });
    expect(await first.handle("listProjects", [])).toEqual([expect.objectContaining({ id: added.id, path: fixture.projects.haoli, name: "我的仓库" })]);

    const settings = JSON.parse(await readFile(join(fixture.agent, "pipiui-settings.json"), "utf8"));
    expect(settings.projectNames[fixture.projects.haoli]).toBe("我的仓库");
    expect(settings.projectPaths).toEqual([fixture.projects.haoli]);

    const fresh = backend(fixture.agent, fixture.sessions);
    expect(await fresh.handle("listProjects", [])).toEqual([expect.objectContaining({ id: added.id, path: fixture.projects.haoli, name: "我的仓库" })]);
    await expect(first.handle("renameProject", [added.id, "   "])).rejects.toThrow("项目名称不能为空");
  });

  it("reveals the project folder through the injectable file-manager opener", async () => {
    const fixture = await setup();
    const revealed: string[] = [];
    const first = createPiHostBackend({
      agentDir: fixture.agent,
      sessionsRoot: fixture.sessions,
      canonicalProjectPaths: async () => undefined,
      revealPath: async (path) => { revealed.push(path); },
    });
    const added = await first.handle("addProject", [fixture.projects.haoli]) as any;
    await first.handle("revealProject", [added.id]);
    expect(revealed).toEqual([fixture.projects.haoli]);
    await expect(first.handle("revealProject", ["missing"])).rejects.toThrow("unknown project");
  });
});
