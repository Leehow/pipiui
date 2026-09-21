import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Baseline, ExperimentRecord, SnapshotFile } from "../contracts.js";
import { exclusion, ExperimentError, readRegular, relativePath } from "./paths.js";

const exec = promisify(execFile);
export const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export type SnapshotOptions = { maxSnapshotBytes?: number; maxFileBytes?: number; maxFiles?: number };
export type CapturedSnapshot = Omit<Baseline, "frozenAt"> & { contents: Map<string, Buffer> };
const selectedBy = (file: string, scopes: string[]): boolean => scopes.some((scope) => scope === "." || file === scope || file.startsWith(`${scope}/`));

async function git(root: string, args: string[], signal?: AbortSignal): Promise<string> {
  try {
    return (await exec("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], {
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
      signal,
    })).stdout;
  } catch {
    signal?.throwIfAborted();
    throw new ExperimentError("git-unavailable", "无法读取项目 Git 基线；需要已有提交的本地 Git 项目。");
  }
}

export async function captureSnapshot(root: string, record: ExperimentRecord, options: SnapshotOptions, signal?: AbortSignal): Promise<CapturedSnapshot> {
  signal?.throwIfAborted();
  const [head, index, trackedText, untrackedText, dirtyText] = await Promise.all([
    git(root, ["rev-parse", "--verify", "HEAD"], signal),
    git(root, ["ls-files", "--stage", "-z"], signal),
    git(root, ["ls-files", "--cached", "-z"], signal),
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"], signal),
    git(root, ["diff", "--no-ext-diff", "--name-only", "-z", "HEAD", "--"], signal),
  ]);
  const names = (text: string): string[] => [...new Set(text.split("\0").filter(Boolean))].sort();
  const tracked = names(trackedText);
  const untracked = names(untrackedText);
  const trackedSet = new Set(tracked);
  const explicit = new Set(untracked.filter((file) => selectedBy(file, record.includeUntracked)));
  for (const path of record.includeUntracked) {
    if (!untracked.some((file) => file === path || file.startsWith(`${path}/`))) {
      throw new ExperimentError("input-not-found", `未找到声明的未跟踪输入：${path}`);
    }
  }
  for (const path of explicit) {
    if (!selectedBy(path, record.scopes)) throw new ExperimentError("scope-conflict", `显式输入不在声明范围内：${path}`);
  }
  const candidates = [...new Set([...tracked, ...explicit])].filter((file) => selectedBy(file, record.scopes)).sort();
  const files: SnapshotFile[] = [];
  const contents = new Map<string, Buffer>();
  const removedPaths: string[] = [];
  const excluded: Baseline["excluded"] = [];
  const maxFiles = options.maxFiles ?? 20000;
  const maxBytes = options.maxSnapshotBytes ?? 256 * 1024 * 1024;
  const maxFileBytes = options.maxFileBytes ?? 16 * 1024 * 1024;
  let total = 0;
  if (candidates.length > maxFiles) throw new ExperimentError("snapshot-limit", "基线文件数超过预算，请缩小范围。");
  for (const name of candidates) {
    signal?.throwIfAborted();
    const path = relativePath(name);
    const reason = exclusion(path);
    if (reason) { excluded.push({ path, reason }); continue; }
    const absolute = join(root, path);
    let stat;
    try { stat = await lstat(absolute); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (trackedSet.has(path)) { removedPaths.push(path); continue; }
      throw new ExperimentError("baseline-changed", "冻结期间输入消失，请重试。");
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ExperimentError("unsafe-path", `不支持符号链接、子模块或非普通文件：${path}`);
    }
    const data = await readRegular(root, absolute, maxFileBytes);
    signal?.throwIfAborted();
    total += data.length;
    if (total > maxBytes) throw new ExperimentError("snapshot-limit", "基线总字节数超过预算，请缩小范围。");
    files.push({ path, sha256: sha256(data), bytes: data.length, executable: (stat.mode & 0o111) !== 0, origin: trackedSet.has(path) ? "tracked" : "untracked" });
    contents.set(path, data);
  }
  const source = {
    head: head.trim(),
    indexFingerprint: sha256(index),
    files,
    dirtyPaths: names(dirtyText).filter((file) => selectedBy(file, record.scopes) && !exclusion(file)),
    removedPaths,
    omittedUntracked: untracked.filter((file) => !explicit.has(file) && !exclusion(file)),
    excluded,
  };
  return { ...source, fingerprint: sha256(JSON.stringify(source)), contents };
}
