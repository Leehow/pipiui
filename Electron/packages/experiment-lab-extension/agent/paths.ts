import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class ExperimentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ExperimentError";
  }
}

export function semanticId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) || value.length > 64) {
    throw new ExperimentError("invalid-id", "身份须为不超过64字符的小写语义 slug，例如 search-contrast。");
  }
  return value;
}

export function relativePath(value: unknown, rootAllowed = false): string {
  if (typeof value !== "string" || !value || value.length > 1024 || /[\x00-\x1f\\]/.test(value) || isAbsolute(value) || /^[a-z]:/i.test(value)) {
    throw new ExperimentError("invalid-path", "仅接受项目内的相对路径。");
  }
  if (rootAllowed && value === ".") return value;
  if (value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new ExperimentError("invalid-path", "路径不能含空段、. 或 ..。");
  }
  return value;
}

export function exclusion(path: string): string | undefined {
  const parts = path.split("/");
  if (parts.some((part) => [".git", ".pi", ".ssh", ".aws"].includes(part))) return "metadata";
  if (parts.some((part) => ["node_modules", "dist", "build", "coverage", ".cache", ".next"].includes(part))) return "generated";
  const name = parts.at(-1) ?? "";
  if (/^\.env(?:\.|$)/i.test(name) || /\.(?:pem|p12|pfx|key)$/i.test(name) || /^id_(?:rsa|ed25519)(?:\.|$)/.test(name)) return "sensitive";
  return undefined;
}

export function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Do not follow a project-controlled symlink while creating the private data tree. */
export async function safeDirectory(root: string, target: string, create = true): Promise<void> {
  if (!contained(root, target)) throw new ExperimentError("unsafe-path", "目录超出本项目。");
  const parts = relative(root, target).split(sep).filter(Boolean);
  let cursor = root;
  for (const part of parts) {
    cursor = join(cursor, part);
    let stat;
    try { stat = await lstat(cursor); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !create) throw error;
      try { await mkdir(cursor, { mode: 0o700 }); } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
      }
      stat = await lstat(cursor);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory() || resolve(await realpath(cursor)) !== resolve(cursor)) {
      throw new ExperimentError("unsafe-path", "实验路径不能经过符号链接或非目录。");
    }
  }
}

export async function readRegular(root: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  await safeDirectory(root, dirname(path), false);
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new ExperimentError("unsafe-path", "仅允许普通文件。");
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new ExperimentError("unsafe-path", "拒绝符号链接文件。");
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ExperimentError("unsafe-path", "仅允许普通文件。");
    if (stat.size > maxBytes) throw new ExperimentError("snapshot-limit", "文件超过实验读取预算。");
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      signal?.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1024, stat.size + 1), maxBytes + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw new ExperimentError("snapshot-limit", "文件超过实验读取预算。");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}

/** A complete event becomes visible once, without replacing an earlier event. */
export async function immutableJson(root: string, target: string, value: unknown, maxBytes: number): Promise<void> {
  await safeDirectory(root, dirname(target));
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > maxBytes) throw new ExperimentError("record-limit", "事件超过记录上限。");
  const temporary = join(dirname(target), `.event-${randomUUID()}`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    try { await link(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readRegular(root, target, maxBytes);
      if (!existing.equals(bytes)) throw new ExperimentError("event-conflict", "已有事件内容不同，拒绝覆盖。");
    }
  } finally { await rm(temporary, { force: true }); }
}

export async function atomicJson(root: string, target: string, value: unknown, options: { signal?: AbortSignal; beforeCommit?: (target: string) => Promise<void> } = {}): Promise<void> {
  options.signal?.throwIfAborted();
  await safeDirectory(root, dirname(target));
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ExperimentError("unsafe-path", "实验记录必须是普通文件。");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(dirname(target), `.write-${randomUUID()}`);
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600, signal: options.signal });
    await options.beforeCommit?.(target);
    options.signal?.throwIfAborted();
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}
