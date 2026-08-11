import { it } from "vitest";
import { mkdtemp, mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

it("dbg", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipi-dbg-"));
  const cwd = join(root, "project");
  const dir = join(root, "sessions", "--project--");
  await mkdir(dir, { recursive: true });
  const file = await open(join(dir, "large-0.jsonl"), "w");
  try {
    await file.write(JSON.stringify({type:"session",version:3,id:"large-0",timestamp:"2026-08-10T00:00:00.000Z",cwd})+"\n");
    const line = JSON.stringify({type:"message",id:"large-0-m",parentId:null,timestamp:"2026-08-10T00:00:01.000Z",message:{role:"user",content:"x".repeat(60_000)}})+"\n";
    for (let i=0;i<175;i++) await file.write(line);
    await file.write(JSON.stringify({type:"session_info",id:"large-0-name",parentId:null,timestamp:"2026-08-10T01:00:00.000Z",name:"Large 0"})+"\n");
  } finally { await file.close(); }
  const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions") });
  const projects = await backend.handle("listProjects", []);
  process.stderr.write("DBG-PROJECTS " + JSON.stringify(projects) + "\n");
  if (projects.length) {
    const sessions = await backend.handle("listSessions", [projects[0].id]);
    process.stderr.write("DBG-SESSIONS " + JSON.stringify(sessions) + "\n");
  }
  await rm(root, { recursive: true, force: true });
});
