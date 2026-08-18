import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";
import { projectPiAgentDir, projectPiSessionsDir } from "../src/project-pi-home.js";

describe("isolated project Pi homes", () => {
  let root = "";
  let backend: ReturnType<typeof createPiHostBackend> | undefined;
  afterEach(async () => {
    await backend?.close().catch(() => undefined);
    backend = undefined;
    if (!root) return;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    root = "";
  });

  it("writes new sessions and spawns Pi inside the opened project, not a shared host profile", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-project-isolation-"));
    const host = join(root, "host-profile");
    const project = join(root, "pipiui");
    const leftoverDir = join(root, "host-sessions", encodeURIComponent(project));
    await mkdir(project, { recursive: true });
    await mkdir(host, { recursive: true });
    await mkdir(leftoverDir, { recursive: true });
    await writeFile(join(host, "settings.json"), `${JSON.stringify({
      defaultProvider: "xai",
      packages: ["/Users/me/code/chatrpgv4"],
    })}\n`);
    await writeFile(join(leftoverDir, "old.jsonl"), `${JSON.stringify({
      type: "session",
      version: 3,
      id: "legacy-host-session",
      timestamp: "2026-08-10T00:00:00.000Z",
      cwd: project,
    })}\n`);

    const captured: Array<{ env: NodeJS.ProcessEnv }> = [];
    backend = createPiHostBackend({
      agentDir: host,
      sessionsRoot: join(root, "host-sessions"),
      runtimeRoot: join(root, "runtime"),
      profileMode: "isolated",
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      spawn: (_bin, _args, options) => {
        captured.push({ env: options.env });
        return spawn(
          process.execPath,
          [new URL("./fake-pi.mjs", import.meta.url).pathname],
          options,
        ) as any;
      },
    });

    const added = await backend.handle("addProject", [project]) as { id: string };
    const created = await backend.handle("newSession", [added.id, "Project local"]) as { id: string };
    const listed = await backend.handle("listSessions", [added.id]) as Array<{ id: string }>;
    expect(listed.map((session) => session.id).sort()).toEqual(["legacy-host-session", created.id].sort());

    const projectSessions = projectPiSessionsDir(project);
    const files = (await readdir(projectSessions)).filter((name) => name.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const firstLine = (await readFile(join(projectSessions, files[0]), "utf8")).split("\n")[0];
    expect(JSON.parse(firstLine)).toEqual(expect.objectContaining({ id: created.id, cwd: project }));

    const projectSettings = JSON.parse(await readFile(join(projectPiAgentDir(project), "settings.json"), "utf8"));
    expect(projectSettings).not.toHaveProperty("packages");

    await backend.handle("sendPrompt", [created.id, "go"]);
    const env = captured.find((item) => item.env.PIPIUI_SESSION_KEY === created.id)?.env ?? captured.at(-1)?.env;
    expect(env?.PI_CODING_AGENT_DIR).toBe(projectPiAgentDir(project));
    expect(env?.PI_CODING_AGENT_SESSION_DIR).toBe(projectSessions);
    expect(env?.PI_CODING_AGENT_DIR).not.toBe(host);
  });
});
