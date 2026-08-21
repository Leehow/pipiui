import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { GitStatus } from "@pipi/host-api";

const run = promisify(execFile);
/** A toolbar probe must never hang the host or buffer a runaway repository. */
const GIT_TIMEOUT_MS = 5_000, GIT_MAX_BUFFER = 1024 * 1024;
/** Unborn-HEAD add + first commit can exceed the toolbar probe budget. */
const GIT_ENSURE_TIMEOUT_MS = 30_000;

const LOCAL_GIT_NAME = "PipiUI";
const LOCAL_GIT_EMAIL = "pipiui@local";
const LOCAL_INITIAL_COMMIT_MESSAGE = "PipiUI: local initial commit";
/** Written only when the folder has no `.gitignore`, so the first commit skips junk. */
const MINIMAL_GITIGNORE = ["node_modules/", "dist/", ".DS_Store", ".env", ".env.*", ".pi/", ""].join("\n");
/** Extra pathspec so an existing `.gitignore` cannot smuggle `.env` / `.pi` into the first commit. */
const UNBORN_ADD_PATHSPEC = [".", ":(exclude).env", ":(exclude).env.*", ":(exclude).pi/"];

export const EMPTY_GIT_STATUS: GitStatus = Object.freeze({ isRepo: false, isDetached: false, localBranches: [], ahead: 0, behind: 0, isDirty: false, staged: 0, unstaged: 0, untracked: 0 });

/** `git -C <cwd> <args…>` without a shell. Returns stdout, or undefined when git fails. */
async function git(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], { timeout, maxBuffer: GIT_MAX_BUFFER, windowsHide: true });
    return stdout;
  } catch { return undefined }
}

/** Same call, but a failure is the caller's problem (checkout must report why). */
async function gitStrict(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], { timeout, maxBuffer: GIT_MAX_BUFFER, windowsHide: true });
    return stdout;
  } catch (error: any) {
    const detail = String(error?.stderr ?? error?.message ?? "").trim();
    throw new Error(detail || "git command failed");
  }
}

async function headResolves(cwd: string): Promise<boolean> {
  return Boolean((await git(cwd, ["rev-parse", "--verify", "HEAD"]))?.trim());
}

async function writeMinimalGitignore(root: string): Promise<void> {
  const gitignore = join(root, ".gitignore");
  if (existsSync(gitignore)) return;
  await writeFile(gitignore, MINIMAL_GITIGNORE, "utf8");
}

/**
 * `git status --porcelain` → staged / unstaged / untracked counts.
 * `??` is untracked; a non-blank index column is staged, a non-blank worktree
 * column is unstaged, and one path may be both (e.g. `MM`).
 */
export function parsePorcelain(output: string): { staged: number; unstaged: number; untracked: number } {
  let staged = 0, unstaged = 0, untracked = 0;
  for (const line of output.split("\n")) {
    if (line.length < 2) continue;
    const [x, y] = [line[0], line[1]];
    if (x === "?" && y === "?") { untracked += 1; continue }
    if (x === "?" || y === "?") continue;
    if (x !== " ") staged += 1;
    if (y !== " ") unstaged += 1;
  }
  return { staged, unstaged, untracked };
}

/** `git rev-list --left-right --count @{upstream}...HEAD` → behind (left) / ahead (right). */
export function parseUpstreamCounts(output: string): { behind: number; ahead: number } {
  const parts = output.trim().split(/\s+/).filter(Boolean);
  const behind = Number(parts[0]), ahead = Number(parts[1]);
  return Number.isInteger(behind) && Number.isInteger(ahead) ? { behind, ahead } : { behind: 0, ahead: 0 };
}

/** HTTPS/SSH github.com remotes → `https://github.com/owner/repo`. Other hosts → undefined. */
export function githubBrowserURL(remote: string): string | undefined {
  const raw = remote.trim();
  const marker = /github\.com[:/]/i.exec(raw);
  if (!marker) return undefined;
  let path = raw.slice(marker.index + marker[0].length).split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
  if (path.toLowerCase().endsWith(".git")) path = path.slice(0, -4);
  const [owner, repo] = path.split("/").filter(Boolean);
  return owner && repo ? `https://github.com/${owner}/${repo}` : undefined;
}

/** Reject empty names and argv-injection-style names that start with `-`. */
export function validateBranchName(branch: string): string {
  const name = branch.trim();
  if (!name) throw new Error("branch name is empty");
  if (name.startsWith("-")) throw new Error(`invalid branch name: ${branch}`);
  return name;
}

/** Node translation of Swift `GitRepo.probe`. Never throws: an unreadable work tree reports `isRepo: false`. */
export async function probeGit(cwd: string): Promise<GitStatus> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.trim() !== "true") return { ...EMPTY_GIT_STATUS, localBranches: [] };

  const [head, sha, branches, origin, porcelain, upstreamRef] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["rev-parse", "--short", "HEAD"]),
    git(cwd, ["branch", "--format=%(refname:short)"]),
    git(cwd, ["remote", "get-url", "origin"]),
    git(cwd, ["status", "--porcelain"]),
    git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
  ]);

  const headRef = head?.trim() ?? "";
  const counts = parsePorcelain(porcelain ?? "");
  const upstream = upstreamRef?.trim() || undefined;
  const { behind, ahead } = upstream ? parseUpstreamCounts(await git(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]) ?? "") : { behind: 0, ahead: 0 };

  return {
    isRepo: true,
    currentBranch: headRef && headRef !== "HEAD" ? headRef : undefined,
    isDetached: headRef === "HEAD",
    shortSHA: sha?.trim() || undefined,
    localBranches: (branches ?? "").split("\n").map(line => line.trim()).filter(Boolean),
    upstream,
    ahead,
    behind,
    isDirty: counts.staged + counts.unstaged + counts.untracked > 0,
    ...counts,
    githubURL: origin ? githubBrowserURL(origin) : undefined
  };
}

/** Checkout a local branch, then re-probe so the caller reports the real post-checkout state. */
export async function checkoutBranch(cwd: string, branch: string): Promise<GitStatus> {
  await gitStrict(cwd, ["checkout", validateBranchName(branch)]);
  return probeGit(cwd);
}

/**
 * Fill an unborn HEAD so `git worktree add … HEAD` works. GitHub is not required:
 * never add origin, never push, never clone, never touch remotes.
 * Plain (non-git) folders are left unchanged — no init, no `.gitignore`, no commit.
 * Repos that already have HEAD are left unchanged (no extra commit, no history rewrite).
 */
export async function ensureLocalGitForWorktrees(cwd: string): Promise<GitStatus> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside?.trim() !== "true") return probeGit(cwd);
  if (await headResolves(cwd)) return probeGit(cwd);

  const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  const root = top?.trim() || cwd;
  if (await headResolves(root)) return probeGit(cwd);

  await writeMinimalGitignore(root);
  await gitStrict(root, ["add", "-A", "--", ...UNBORN_ADD_PATHSPEC], GIT_ENSURE_TIMEOUT_MS);

  const porcelain = await git(root, ["status", "--porcelain"], GIT_ENSURE_TIMEOUT_MS);
  const commit = [
    "-c", `user.name=${LOCAL_GIT_NAME}`,
    "-c", `user.email=${LOCAL_GIT_EMAIL}`,
    "commit",
    ...(porcelain?.trim() ? [] : ["--allow-empty"]),
    "-m", LOCAL_INITIAL_COMMIT_MESSAGE,
  ];
  await gitStrict(root, commit, GIT_ENSURE_TIMEOUT_MS);
  return probeGit(cwd);
}

/** Same as `ensureLocalGitForWorktrees`: unborn HEAD only. Does not `git init` a plain folder. */
export async function initGit(cwd: string): Promise<GitStatus> {
  return ensureLocalGitForWorktrees(cwd);
}

/** True when a `git` executable answers `--version`. Never throws. */
export async function probeGitBinary(
  exec: (file: string, args: string[], options?: object) => Promise<{ stdout: string }> = run,
): Promise<boolean> {
  try {
    await exec("git", ["--version"], { timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
