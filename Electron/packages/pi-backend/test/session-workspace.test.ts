import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiHostBackend } from "../src/index.js";
import {
  assertWorkspaceCwdAllowed,
  clearSessionWorkspaceFile,
  isValidWorkspaceBranch,
  readSessionWorkspace,
  sessionWorkspaceSidecarPath,
  usableSessionWorkspace,
  writeSessionWorkspace,
  type SessionWorkspaceBinding,
} from "../src/session-workspace.js";

const roots: string[] = [];

async function fixture(): Promise<{ sessionsDir: string; projectRoot: string; worktreeArea: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), "pipiui-session-workspace-"));
  roots.push(projectRoot);
  const sessionsDir = join(projectRoot, ".pi", "agent", "sessions");
  const worktreeArea = join(projectRoot, ".pi", "worktrees");
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(join(worktreeArea, "session-fix"), { recursive: true });
  return { sessionsDir, projectRoot, worktreeArea };
}

afterEach(async () => {
  // createPiHostBackend fire-and-forgets a model-catalog probe whose helper child
  // briefly writes cache files into agentDir after close() returns; retry so the
  // teardown doesn't flap on that benign race (same as agent-events.test.ts).
  await Promise.all(roots.splice(0).map(async (root) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true });
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code !== "ENOTEMPTY" && code !== "EPERM") || attempt >= 20) throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  }));
});

function binding(sessionId: string, workspaceCwd: string): SessionWorkspaceBinding {
  return {
    version: 1,
    sessionId,
    workspaceCwd,
    branch: "pipiui/session-fix",
    worktreePath: workspaceCwd,
    boundAt: new Date().toISOString(),
  };
}

describe("session workspace sidecar", () => {
  it("round-trips a binding through the sidecar file", async () => {
    const { sessionsDir, worktreeArea } = await fixture();
    const expected = binding("s1", join(worktreeArea, "session-fix"));
    await writeSessionWorkspace(sessionsDir, expected);
    expect(await readSessionWorkspace(sessionsDir, "s1")).toEqual(expected);
    // Written with the lease-style name beside the session JSONL.
    expect(sessionWorkspaceSidecarPath(sessionsDir, "s1")).toBe(join(sessionsDir, "s1.workspace.json"));
  });

  it("returns null for a missing or malformed sidecar", async () => {
    const { sessionsDir } = await fixture();
    expect(await readSessionWorkspace(sessionsDir, "absent")).toBeNull();
    await writeFile(sessionWorkspaceSidecarPath(sessionsDir, "bad"), "{ not json", "utf8");
    expect(await readSessionWorkspace(sessionsDir, "bad")).toBeNull();
  });

  it("rejects a sidecar whose sessionId does not match the file name", async () => {
    const { sessionsDir, worktreeArea } = await fixture();
    await writeSessionWorkspace(sessionsDir, binding("real", join(worktreeArea, "session-fix")));
    expect(await readSessionWorkspace(sessionsDir, "other")).toBeNull();
  });

  it("clears the sidecar", async () => {
    const { sessionsDir, worktreeArea } = await fixture();
    await writeSessionWorkspace(sessionsDir, binding("s1", join(worktreeArea, "session-fix")));
    await clearSessionWorkspaceFile(sessionsDir, "s1");
    expect(await readSessionWorkspace(sessionsDir, "s1")).toBeNull();
    // Clearing an absent binding is a no-op, matching lease semantics.
    await clearSessionWorkspaceFile(sessionsDir, "absent");
  });
});

describe("workspace validation", () => {
  it("accepts only pipiui/session-* branch labels", () => {
    expect(isValidWorkspaceBranch("pipiui/session-quota-pill")).toBe(true);
    expect(isValidWorkspaceBranch("pipiui/quota-pill")).toBe(false);
    expect(isValidWorkspaceBranch("main")).toBe(false);
    expect(isValidWorkspaceBranch("pipiui/session-")).toBe(false);
    expect(isValidWorkspaceBranch("pipiui/session-a..b")).toBe(false);
    expect(isValidWorkspaceBranch("-pipiui/session-x")).toBe(false);
  });

  it("confines the workspace to the project worktree area", async () => {
    const { projectRoot, worktreeArea } = await fixture();
    expect(() => assertWorkspaceCwdAllowed(projectRoot, join(worktreeArea, "session-fix"))).not.toThrow();
    expect(() => assertWorkspaceCwdAllowed(projectRoot, projectRoot)).toThrow(/outside the project worktree area/);
    expect(() => assertWorkspaceCwdAllowed(projectRoot, join(projectRoot, ".pi"))).toThrow(/outside/);
    expect(() => assertWorkspaceCwdAllowed(projectRoot, "/tmp")).toThrow(/outside/);
    expect(() => assertWorkspaceCwdAllowed(projectRoot, join(worktreeArea, "session-fix", "..", "..", "agent"))).toThrow(/outside/);
  });

  it("rejects a binding whose directory is gone (stale after worktree cleanup)", async () => {
    const { projectRoot, worktreeArea } = await fixture();
    const gone = binding("s1", join(worktreeArea, "session-deleted"));
    expect(await usableSessionWorkspace(gone, projectRoot)).toBeNull();
    const present = binding("s1", join(worktreeArea, "session-fix"));
    expect(await usableSessionWorkspace(present, projectRoot)).toEqual(present);
  });

  it("rejects a binding outside the worktree area even when the directory exists", async () => {
    const { projectRoot } = await fixture();
    expect(await usableSessionWorkspace(binding("s1", projectRoot), projectRoot)).toBeNull();
  });

  it("persists human-readable JSON for debugging", async () => {
    const { sessionsDir, worktreeArea } = await fixture();
    await writeSessionWorkspace(sessionsDir, binding("s1", join(worktreeArea, "session-fix")));
    const raw = JSON.parse(await readFile(sessionWorkspaceSidecarPath(sessionsDir, "s1"), "utf8"));
    expect(raw).toMatchObject({ version: 1, sessionId: "s1", branch: "pipiui/session-fix" });
  });
});

describe("session workspace change notice", () => {
  // Wire contract the renderer's `subscribeExt(host, "git-capability")` consumer depends on:
  // channel, event type, and the sessionId/op payload. Bind/unbind fire this mid-session so
  // the header dual-branch pair repaints without an app restart.
  it("announces bind/unbind on the ext.git-capability channel", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipiui-session-workspace-notify-"));
    roots.push(root);
    const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions") });
    try {
      const events: Array<{ type: string; payload?: unknown }> = [];
      backend.subscribe(frame => {
        if (frame.channel === "ext.git-capability") events.push((frame as { event: { type: string; payload?: unknown } }).event);
      });
      const notify = (backend as unknown as { emitSessionWorkspaceChanged(sessionId: string, op: "bind" | "unbind"): void }).emitSessionWorkspaceChanged.bind(backend);
      notify("session-1", "bind");
      notify("session-1", "unbind");
      expect(events).toEqual([
        { type: "session_workspace_changed", payload: { sessionId: "session-1", op: "bind" } },
        { type: "session_workspace_changed", payload: { sessionId: "session-1", op: "unbind" } },
      ]);
    } finally {
      await backend.close();
    }
  });
});
