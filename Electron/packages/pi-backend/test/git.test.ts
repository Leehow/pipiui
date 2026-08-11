import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutBranch, createPiHostBackend, githubBrowserURL, parsePorcelain, parseUpstreamCounts, probeGit, validateBranchName } from "../src/index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function repository(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "pipi-git-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "hello\n");
  git("add", "README.md");
  git("commit", "-m", "initial");
  return root;
}

describe("git parsers", () => {
  it("counts staged, unstaged and untracked paths", () => {
    expect(parsePorcelain("M  a.ts\n M b.ts\nMM c.ts\n?? d.ts\n")).toEqual({ staged: 2, unstaged: 2, untracked: 1 });
  });
  it("reads upstream counts as behind/ahead and tolerates junk", () => {
    expect(parseUpstreamCounts("3\t7\n")).toEqual({ behind: 3, ahead: 7 });
    expect(parseUpstreamCounts("")).toEqual({ behind: 0, ahead: 0 });
  });
  it("resolves github remotes only", () => {
    expect(githubBrowserURL("git@github.com:owner/repo.git")).toBe("https://github.com/owner/repo");
    expect(githubBrowserURL("https://github.com/owner/repo")).toBe("https://github.com/owner/repo");
    expect(githubBrowserURL("git@gitlab.com:owner/repo.git")).toBeUndefined();
  });
  it("rejects empty and argv-injection branch names", () => {
    expect(() => validateBranchName("  ")).toThrow();
    expect(() => validateBranchName("--force")).toThrow();
    expect(validateBranchName(" feature ")).toBe("feature");
  });
});

describe("probeGit", () => {
  it("reports a non-repository directory instead of guessing", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-nogit-"));
    expect(await probeGit(root)).toMatchObject({ isRepo: false, localBranches: [] });
  });
  it("reads branch, dirt and local branch list from a real work tree", async () => {
    const cwd = await repository();
    execFileSync("git", ["-C", cwd, "branch", "feature"], { stdio: "pipe" });
    await writeFile(join(cwd, "untracked.txt"), "x\n");
    const status = await probeGit(cwd);
    expect(status).toMatchObject({ isRepo: true, currentBranch: "main", isDetached: false, isDirty: true, untracked: 1, ahead: 0, behind: 0 });
    expect(status.localBranches).toEqual(["feature", "main"]);
    expect(status.shortSHA).toMatch(/^[0-9a-f]{7,}$/);
    expect(status.upstream).toBeUndefined();
  });
  it("checks out a local branch and re-probes", async () => {
    const cwd = await repository();
    execFileSync("git", ["-C", cwd, "branch", "feature"], { stdio: "pipe" });
    expect(await checkoutBranch(cwd, "feature")).toMatchObject({ currentBranch: "feature", isRepo: true });
  });
  it("surfaces a failed checkout instead of reporting success", async () => {
    const cwd = await repository();
    await expect(checkoutBranch(cwd, "missing-branch")).rejects.toThrow(/missing-branch/);
  });
});

describe("PiHostBackend git methods", () => {
  it("advertises the capability and probes/checks out the project work tree", async () => {
    const cwd = await repository();
    execFileSync("git", ["-C", cwd, "branch", "feature"], { stdio: "pipe" });
    const sessions = join(cwd, ".sessions", "project");
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, "session.jsonl"), JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
    const backend = createPiHostBackend({ agentDir: join(cwd, ".agent"), sessionsRoot: join(cwd, ".sessions"), canonicalProjectPaths: async () => undefined });
    await backend.handle("setProjectPaths", [[cwd]]);

    expect(await backend.handle("capabilities", [])).toMatchObject({ git: true });
    const [project] = await backend.handle("listProjects", []) as { id: string }[];
    expect(await backend.handle("gitStatus", [project.id])).toMatchObject({ isRepo: true, currentBranch: "main" });
    expect(await backend.handle("gitCheckout", [project.id, "feature"])).toMatchObject({ currentBranch: "feature" });
    await expect(backend.handle("gitStatus", ["not-a-project"])).rejects.toThrow(/unknown project/);
  });
});
