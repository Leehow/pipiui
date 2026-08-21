import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutBranch, createPiHostBackend, ensureLocalGitForWorktrees, githubBrowserURL, initGit, parsePorcelain, parseUpstreamCounts, probeGit, probeGitBinary, validateBranchName } from "../src/index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

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
  it("leaves a plain folder as a non-repository", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-initgit-"));
    expect(await probeGit(root)).toMatchObject({ isRepo: false });
    expect(await initGit(root)).toMatchObject({ isRepo: false });
    expect(existsSync(join(root, ".git"))).toBe(false);
  });
});

function localConfig(cwd: string, key: string): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, "config", "--local", "--get", key], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

describe("ensureLocalGitForWorktrees", () => {
  it("is a no-op on a plain folder: still not a repo, no .git", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ensure-plain-"));
    await writeFile(join(root, "app.ts"), "export const n = 1;\n");
    const status = await ensureLocalGitForWorktrees(root);
    expect(status).toMatchObject({ isRepo: false });
    expect(existsSync(join(root, ".git"))).toBe(false);
    expect(existsSync(join(root, ".gitignore"))).toBe(false);
  });

  it("is a no-op when HEAD already resolves", async () => {
    const cwd = await repository();
    const before = execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const countBefore = execFileSync("git", ["-C", cwd, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim();
    const status = await ensureLocalGitForWorktrees(cwd);
    expect(status.isRepo).toBe(true);
    expect(execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(before);
    expect(execFileSync("git", ["-C", cwd, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim()).toBe(countBefore);
  });

  it("creates HEAD for an unborn git init without origin or persistent identity", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ensure-unborn-"));
    execFileSync("git", ["-C", root, "init"], { stdio: "pipe" });
    await writeFile(join(root, "app.ts"), "export const n = 1;\n");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
    expect((await probeGit(root)).shortSHA).toBeUndefined();
    const status = await ensureLocalGitForWorktrees(root);
    expect(status.isRepo).toBe(true);
    expect(status.shortSHA).toMatch(/^[0-9a-f]{7,}$/);
    expect(status.githubURL).toBeUndefined();
    const tracked = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" });
    expect(tracked).toContain("app.ts");
    expect(tracked).toContain(".gitignore");
    expect(tracked).not.toContain("node_modules");
    expect(execFileSync("git", ["-C", root, "remote"], { encoding: "utf8" }).trim()).toBe("");
    expect(localConfig(root, "user.name")).toBeUndefined();
    expect(localConfig(root, "user.email")).toBeUndefined();
  });

  it("does not commit .env when an existing gitignore omits that exclude", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-ensure-gitignore-"));
    execFileSync("git", ["-C", root, "init"], { stdio: "pipe" });
    await writeFile(join(root, ".gitignore"), "node_modules/\n");
    await writeFile(join(root, "app.ts"), "export const n = 1;\n");
    await writeFile(join(root, ".env"), "SECRET=1\n");
    await writeFile(join(root, ".env.local"), "SECRET=2\n");
    await mkdir(join(root, ".pi"), { recursive: true });
    await writeFile(join(root, ".pi", "secret.txt"), "nope\n");
    const status = await ensureLocalGitForWorktrees(root);
    expect(status.isRepo).toBe(true);
    expect(status.shortSHA).toMatch(/^[0-9a-f]{7,}$/);
    const tracked = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" });
    expect(tracked).toContain("app.ts");
    expect(tracked).toContain(".gitignore");
    expect(tracked.split("\n")).not.toContain(".env");
    expect(tracked.split("\n")).not.toContain(".env.local");
    expect(tracked).not.toContain(".pi/");
  });
});

describe("probeGitBinary", () => {
  it("reports true when git --version succeeds", async () => {
    expect(await probeGitBinary(async () => ({ stdout: "git version 2.50.0\n" }))).toBe(true);
  });

  it("reports false when git cannot run", async () => {
    expect(await probeGitBinary(async () => { throw new Error("ENOENT"); })).toBe(false);
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
  it("probes a freshly picked non-repo directory and does not turn it into a git repo", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pick-"));
    const backend = createPiHostBackend({ agentDir: join(root, ".agent"), sessionsRoot: join(root, ".sessions"), canonicalProjectPaths: async () => undefined });
    expect(await backend.handle("probeDirectoryGit", [root])).toMatchObject({ isRepo: false });
    expect(await backend.handle("gitInitDirectory", [root])).toMatchObject({ isRepo: false });
    expect(await backend.handle("probeDirectoryGit", [root])).toMatchObject({ isRepo: false });
    expect(existsSync(join(root, ".git"))).toBe(false);
  });
  it("refuses probe/init outside an existing absolute directory", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-pick-"));
    const backend = createPiHostBackend({ agentDir: join(root, ".agent"), sessionsRoot: join(root, ".sessions"), canonicalProjectPaths: async () => undefined });
    await expect(backend.handle("probeDirectoryGit", ["relative/path"])).rejects.toThrow(/绝对路径/);
    await expect(backend.handle("probeDirectoryGit", [join(root, "missing")])).rejects.toThrow(/目录不存在或不是文件夹/);
    await expect(backend.handle("gitInitDirectory", [42])).rejects.toThrow(/绝对路径/);
  });

  it("reports whether a git executable is installed", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-gitbin-"));
    const backend = createPiHostBackend({ agentDir: join(root, ".agent"), sessionsRoot: join(root, ".sessions"), canonicalProjectPaths: async () => undefined });
    expect(await backend.handle("probeGitBinary", [])).toBe(true);
  });
});
