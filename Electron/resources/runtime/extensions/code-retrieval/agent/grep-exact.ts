import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { truncateLine } from "./truncate.js";
import type { UnassignedHit } from "./types.js";

const DEFAULT_TOP_K = 20;
const CONTEXT_RADIUS = 8;
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".pi",
  ".worktrees",
  "target",
  "__pycache__",
  ".venv",
]);

export type ExactSearchArgs = {
  query: string;
  projectRoot: string;
  path?: string;
  glob?: string;
  topK?: number;
  excludeGlobs?: string[];
  signal?: AbortSignal;
};

const queryCache = new Map<string, { at: number; hits: UnassignedHit[] }>();
const CACHE_TTL_MS = 15_000;

export function cacheKey(args: ExactSearchArgs): string {
  return JSON.stringify({
    q: args.query,
    p: args.path ?? "",
    g: args.glob ?? "",
    k: args.topK ?? DEFAULT_TOP_K,
    x: args.excludeGlobs ?? [],
    root: args.projectRoot,
  });
}

export function clearExactCache(): void {
  queryCache.clear();
}

export async function exactSearch(args: ExactSearchArgs): Promise<UnassignedHit[]> {
  const key = cacheKey(args);
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.hits.map((hit) => ({ ...hit }));

  const topK = Math.max(1, Math.min(args.topK ?? DEFAULT_TOP_K, 100));
  let hits: UnassignedHit[];
  try {
    hits = await rgSearch(args, topK);
  } catch {
    hits = await nodeGrep(args, topK);
  }
  queryCache.set(key, { at: Date.now(), hits });
  return hits.map((hit) => ({ ...hit }));
}

function rgAvailable(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("rg", ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(null));
    child.on("exit", (code) => resolve(code === 0 ? "rg" : null));
  });
}

async function rgSearch(args: ExactSearchArgs, topK: number): Promise<UnassignedHit[]> {
  const bin = await rgAvailable();
  if (!bin) throw new Error("rg missing");
  const searchRoot = args.path ? join(args.projectRoot, args.path) : args.projectRoot;
  const rgArgs = [
    "--json",
    "--no-heading",
    "--line-number",
    "--color",
    "never",
    "--max-count",
    "3",
    "-e",
    args.query,
  ];
  if (args.glob) rgArgs.push("--glob", args.glob);
  for (const exclude of args.excludeGlobs ?? []) {
    rgArgs.push("--glob", exclude.startsWith("!") ? exclude : `!${exclude}`);
  }
  rgArgs.push(searchRoot);

  const raw = await runCapture("rg", rgArgs, args.projectRoot, args.signal);
  const hits: UnassignedHit[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let parsed: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      continue;
    }
    if (parsed.type !== "match" || !parsed.data?.path?.text || !parsed.data.line_number) continue;
    const abs = parsed.data.path.text;
    const rel = toProjectPath(args.projectRoot, abs);
    const lineNo = parsed.data.line_number;
    const dedupe = `${rel}:${lineNo}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const preview = truncateLine((parsed.data.lines?.text ?? "").replace(/\n$/, "")).text;
    hits.push({
      path: rel,
      startLine: Math.max(1, lineNo - CONTEXT_RADIUS),
      endLine: lineNo + CONTEXT_RADIUS,
      score: 1,
      text: preview,
    });
    if (hits.length >= topK) break;
  }
  return hits;
}

function runCapture(cmd: string, argv: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", () => undefined);
    const onAbort = () => {
      child.kill("SIGTERM");
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0 || code === 1) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

async function nodeGrep(args: ExactSearchArgs, topK: number): Promise<UnassignedHit[]> {
  let regex: RegExp;
  try {
    regex = new RegExp(args.query);
  } catch {
    regex = new RegExp(escapeRegExp(args.query));
  }
  const searchRoot = args.path ? join(args.projectRoot, args.path) : args.projectRoot;
  const hits: UnassignedHit[] = [];
  await walk(searchRoot, args.projectRoot, async (abs, rel) => {
    if (hits.length >= topK) return;
    if (args.glob && !globMatch(rel, args.glob)) return;
    if ((args.excludeGlobs ?? []).some((g) => globMatch(rel, g.replace(/^!/, "")))) return;
    let text: string;
    try {
      text = await readFile(abs, "utf8");
    } catch {
      return;
    }
    if (text.includes("\0")) return;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && hits.length < topK; i++) {
      if (!regex.test(lines[i]!)) continue;
      hits.push({
        path: rel,
        startLine: Math.max(1, i + 1 - CONTEXT_RADIUS),
        endLine: i + 1 + CONTEXT_RADIUS,
        score: 1,
        text: truncateLine(lines[i]!).text,
      });
    }
  });
  return hits;
}

async function walk(
  dir: string,
  projectRoot: string,
  visit: (abs: string, rel: string) => Promise<void>,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let info;
    try {
      info = await stat(abs);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      await walk(abs, projectRoot, visit);
      continue;
    }
    if (!info.isFile()) continue;
    await visit(abs, toProjectPath(projectRoot, abs));
  }
}

function toProjectPath(projectRoot: string, abs: string): string {
  const rel = relative(projectRoot, abs);
  return rel && !rel.startsWith("..") ? rel.split("\\").join("/") : abs.split("\\").join("/");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globMatch(rel: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${escaped}$`).test(rel) || new RegExp(escaped).test(rel);
}
