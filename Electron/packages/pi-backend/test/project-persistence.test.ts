import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

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
    expect(await fresh.handle("getProjectPaths", [])).toEqual([fixture.projects.haoli, fixture.projects.other]);
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
    expect(await first.handle("setSubagentModel", ["operator", [{ model: "gpt-5", thinking: "high" }, { model: "claude-sonnet-4", thinking: "medium" }]])).toEqual({
      operator: [{ model: "gpt-5", thinking: "high" }, { model: "claude-sonnet-4", thinking: "medium" }],
    });
    expect(await first.handle("listAgentDefinitions", [])).toEqual(expect.arrayContaining([
	  expect.objectContaining({ name: "computer-use-leader" }),
      expect.objectContaining({ name: "operator" }),
	  expect.objectContaining({ name: "computer-verifier" }),
      expect.objectContaining({ name: "long-test" }),
    ]));
    const fresh = backend(fixture.agent, fixture.sessions);
    expect(await fresh.handle("getComputerUseState", [])).toEqual({ enabled: true });
    expect(await fresh.handle("getSubagentModels", [])).toEqual({
      operator: [{ model: "gpt-5", thinking: "high" }, { model: "claude-sonnet-4", thinking: "medium" }],
    });
  });
});
