/**
 * Per-session workspace binding: the generic extension point that lets a mounted
 * capability (today: git-capability's session worktree) point ONE Boss session's
 * tool cwd at an isolated tree while project identity (home, sessions, memory,
 * plans, trust) stays anchored at the canonical project root.
 *
 * The host owns persistence and validation only — it knows nothing about git.
 * Bindings are a per-session sidecar beside the session JSONL, mirroring the
 * `<id>.lease.json` pattern, so they survive App restarts and die with the session.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export interface SessionWorkspaceBinding {
  version: 1;
  sessionId: string;
  /** Absolute path the session's tools run in. Must stay inside the project's worktree area. */
  workspaceCwd: string;
  /** Opaque branch label owned by the requesting capability (e.g. `pipiui/session-<slug>`). */
  branch: string;
  /** The tree the binding points at. Equals workspaceCwd today; explicit for future splits. */
  worktreePath: string;
  boundAt: string;
}

export function sessionWorkspaceSidecarPath(sessionsDir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "");
  return join(sessionsDir, `${safe}.workspace.json`);
}

/** Branch labels the host will persist: capability-namespaced, no git metacharacters. */
export function isValidWorkspaceBranch(branch: unknown): branch is string {
  return typeof branch === "string"
    && /^pipiui\/session-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(branch)
    && !branch.includes("..");
}

function normalizeBinding(raw: unknown): SessionWorkspaceBinding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.sessionId !== "string" || !candidate.sessionId) return null;
  if (typeof candidate.workspaceCwd !== "string" || !candidate.workspaceCwd) return null;
  if (!isValidWorkspaceBranch(candidate.branch)) return null;
  if (typeof candidate.worktreePath !== "string" || !candidate.worktreePath) return null;
  if (typeof candidate.boundAt !== "string" || !candidate.boundAt) return null;
  return {
    version: 1,
    sessionId: candidate.sessionId,
    workspaceCwd: candidate.workspaceCwd,
    branch: candidate.branch,
    worktreePath: candidate.worktreePath,
    boundAt: candidate.boundAt,
  };
}

/**
 * Containment gate: a binding may only point inside `{projectRoot}/.pi/worktrees/`.
 * This is what keeps the extension point generic but safe — no capability can steer
 * a session's tools at an arbitrary directory through this channel.
 */
export function assertWorkspaceCwdAllowed(realProjectRoot: string, workspaceCwd: string): void {
  const root = resolve(realProjectRoot);
  const target = resolve(workspaceCwd);
  const area = join(root, ".pi", "worktrees") + sep;
  if (!target.startsWith(area)) {
    throw new Error(`session workspace ${target} is outside the project worktree area ${area}`);
  }
}

async function isExistingDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Validate containment + existence. Returns the binding when usable, null when stale. */
export async function usableSessionWorkspace(
  binding: SessionWorkspaceBinding,
  realProjectRoot: string,
): Promise<SessionWorkspaceBinding | null> {
  try {
    assertWorkspaceCwdAllowed(realProjectRoot, binding.workspaceCwd);
  } catch {
    return null;
  }
  if (!(await isExistingDirectory(binding.workspaceCwd))) return null;
  return binding;
}

export async function readSessionWorkspace(
  sessionsDir: string,
  sessionId: string,
): Promise<SessionWorkspaceBinding | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(sessionWorkspaceSidecarPath(sessionsDir, sessionId), "utf8"));
  } catch {
    return null;
  }
  const binding = normalizeBinding(raw);
  if (!binding || binding.sessionId !== sessionId) return null;
  return binding;
}

export async function writeSessionWorkspace(
  sessionsDir: string,
  binding: SessionWorkspaceBinding,
): Promise<void> {
  await mkdir(sessionsDir, { recursive: true });
  const path = sessionWorkspaceSidecarPath(sessionsDir, binding.sessionId);
  const temporary = join(sessionsDir, `.${randomUUID()}.workspace.tmp`);
  await writeFile(temporary, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function clearSessionWorkspaceFile(sessionsDir: string, sessionId: string): Promise<void> {
  await rm(sessionWorkspaceSidecarPath(sessionsDir, sessionId), { force: true });
}
