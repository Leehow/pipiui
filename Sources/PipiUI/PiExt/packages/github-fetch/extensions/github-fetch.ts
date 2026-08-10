// PipiUI bundled local Pi package: pipiui-github-fetch.
// Source of truth is this checked-in package file; Pi loads the package manifest
// from the Application Support copy. No runtime npm install is required.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function text(t: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: t }],
    details: {},
    ...(isError ? { isError: true } : {}),
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  return (nl > max * 0.8 ? cut.slice(0, nl) : cut) + "\n\n[truncated]";
}

// ---------------------------------------------------------------------------
// GitHub repository/blob/tree routes. Rendered GitHub HTML is noisy for agents,
// so code URLs use the Contents API or a bounded, throwaway shallow clone.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

type GitHubTarget = { kind: "repo" | "blob" | "tree"; owner: string; repo: string; ref?: string; path?: string; refCandidates?: Array<{ ref: string; path: string }>; candidateOverflow?: boolean };
const GITHUB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GITHUB_REF_PART = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const NOISY_GITHUB_DIRS = new Set([".git", "node_modules", ".build", "build", "dist", "vendor"]);
const MAX_GITHUB_ENTRIES = 120;
const MAX_GITHUB_FILES = 8;
const MAX_GITHUB_FILE_CHARS = 6000;
const MAX_GITHUB_REF_CANDIDATES = 3;
const GITHUB_TOTAL_BUDGET_MS = 30000;

// Clone only public HTTPS GitHub URLs. Do not let a caller's shell turn that
// into an authenticated or externally hooked Git invocation.
const GIT_CLONE_ENV_DENYLIST = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
]);

function isUnsafeGitCloneEnvironmentName(name: string): boolean {
  return GIT_CLONE_ENV_DENYLIST.has(name)
    || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)
    || name.startsWith("GIT_HTTP_");
}

function gitCloneEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !isUnsafeGitCloneEnvironmentName(name)) env[name] = value;
  }
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

function safeGitHubPath(parts: string[]): string | null {
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.includes("..") || part.includes("/") || part.includes("\\") || part.includes("\0"))) return null;
  return parts.join("/");
}

function parseGitHubCodeURL(url: URL): GitHubTarget | null {
  if (url.hostname.toLowerCase() !== "github.com") return null;
  let parts: string[];
  try { parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent); } catch { throw new Error("GitHub URL has invalid escaping"); }
  if (parts.some((part) => part === "." || part === ".." || part.includes("..") || part.includes("\\") || part.includes("\0"))) throw new Error("GitHub URL contains an unsafe path");
  if (parts.length < 2 || !GITHUB_NAME.test(parts[0]) || !GITHUB_NAME.test(parts[1])) throw new Error("GitHub URL must contain a valid owner and repository");
  const owner = parts[0];
  const repo = parts[1].endsWith(".git") ? parts[1].slice(0, -4) : parts[1];
  if (!repo || owner.includes("..") || repo.includes("..") || !GITHUB_NAME.test(repo)) throw new Error("GitHub URL must contain a valid owner and repository");
  if (parts.length === 2) return { kind: "repo", owner, repo };
  const kind = parts[2];
  // Issues, pull requests, discussions, wiki, releases, actions, etc. return null so
  // the tool can clearly direct the agent to web_fetch instead of treating them as code.
  if (kind !== "blob" && kind !== "tree") return null;
  const remainder = parts.slice(3);
  if (!remainder.length || remainder.some((part) => !part || part === "." || part === ".." || part.includes("..") || part.includes("/") || part.includes("\\") || part.includes("\0"))) throw new Error("GitHub URL has an unsafe ref or path");
  // GitHub does not delimit refs: a branch may contain '/'. A long URL has too many
  // plausible splits to resolve safely, so route it to the generic page fetch instead.
  const allCandidates: Array<{ ref: string; path: string }> = [];
  const finalRefIndex = kind === "blob" ? remainder.length - 1 : remainder.length;
  for (let i = 1; i <= finalRefIndex; i++) {
    const ref = remainder.slice(0, i).join("/");
    const path = remainder.slice(i);
    if (GITHUB_REF_PART.test(ref) && (kind === "tree" || safeGitHubPath(path))) allCandidates.push({ ref, path: path.join("/") });
  }
  if (!allCandidates.length) throw new Error("GitHub URL has an invalid ref or path");
  if (allCandidates.length > MAX_GITHUB_REF_CANDIDATES) return { kind, owner, repo, candidateOverflow: true };
  const candidates = [...allCandidates].reverse(); // longest ref first; ambiguity is rejected after bounded probes.
  return { kind, owner, repo, ref: candidates[0].ref, path: candidates[0].path, refCandidates: candidates };
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  return { Accept: "application/vnd.github+json", "User-Agent": "PipiUI-github-fetch", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function isBinary(data: Buffer): boolean {
  return data.includes(0) || data.subarray(0, Math.min(data.length, 4096)).filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length > 32;
}

function remainingGitHubBudget(deadline: number): number {
  return deadline - Date.now();
}

async function fetchGitHubBlob(target: GitHubTarget, maxLength: number, deadline: number): Promise<string> {
  const candidates = target.refCandidates || [];
  const matches: Array<{ ref: string; path: string; body: string }> = [];
  for (const candidate of candidates) {
    const remaining = remainingGitHubBudget(deadline);
    if (remaining <= 0) throw new Error("GitHub specialized fetch exceeded its shared 30s budget");
    const api = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${candidate.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(candidate.ref)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);
    let res: Response;
    try { res = await fetch(api, { headers: githubHeaders(), signal: controller.signal }); }
    catch (err: any) { throw new Error(err?.name === "AbortError" ? "GitHub Contents API timed out (30s)" : err?.message || String(err)); }
    finally { clearTimeout(timeout); }
    if (res.status === 404) continue;
    if (res.status === 403) throw new Error(`GitHub API denied request${res.headers.get("x-ratelimit-remaining") === "0" ? " (rate limit exceeded; set GH_TOKEN or GITHUB_TOKEN if available)" : ""}`);
    if (!res.ok) throw new Error(`GitHub Contents API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const item = await res.json() as { type?: string; content?: string; encoding?: string; name?: string };
    if (item.type !== "file" || item.encoding !== "base64" || typeof item.content !== "string") throw new Error("GitHub Contents API response is not a regular file");
    const bytes = Buffer.from(item.content.replace(/\n/g, ""), "base64");
    if (isBinary(bytes)) throw new Error(`GitHub file ${candidate.path} appears binary and was not returned`);
    const body = bytes.toString("utf8");
    if (/^version https:\/\/git-lfs.github.com\/spec\/v1/m.test(body)) throw new Error(`GitHub file ${candidate.path} is a Git LFS pointer; fetch the LFS object separately`);
    matches.push({ ref: candidate.ref, path: candidate.path, body });
  }
  if (!matches.length) throw new Error(`GitHub file not found in ${target.owner}/${target.repo}`);
  if (matches.length > 1) throw new Error("GitHub URL is ambiguous because its branch/ref may contain '/'; use a URL whose ref/path split is unambiguous");
  const match = matches[0];
  return truncate(`# GitHub file: ${target.owner}/${target.repo}\n\nref: ${match.ref}\npath: ${match.path}\n\n${match.body}`, maxLength);
}

function runGit(args: string[], cwd: string, deadline: number): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const remaining = remainingGitHubBudget(deadline);
    if (remaining <= 0) { reject(new Error("GitHub specialized fetch exceeded its shared 30s budget")); return; }
    const child = spawn("git", args, { cwd, shell: false, stdio: ["ignore", "ignore", "pipe"], env: gitCloneEnvironment() });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk).slice(0, 1000); });
    const timeout = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 1000); }, remaining);
    child.once("error", (err) => { clearTimeout(timeout); reject(err); });
    child.once("close", (code) => { clearTimeout(timeout); code === 0 ? resolveRun() : reject(new Error(`git clone failed${code === null ? " (timed out)" : ` (exit ${code})`}: ${stderr.trim() || "no diagnostic"}`)); });
  });
}

function insideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${process.platform === "win32" ? "\\\\" : "/"}`));
}

async function collectGitHubTree(root: string, requestedPath: string, maxLength: number): Promise<string> {
  const target = resolve(root, requestedPath || ".");
  if (!insideRoot(root, target)) throw new Error("GitHub path escapes repository root");
  let targetReal: string;
  try { targetReal = await realpath(target); } catch { throw new Error(`GitHub path not found: ${requestedPath}`); }
  if (!insideRoot(await realpath(root), targetReal)) throw new Error("GitHub path escapes repository root through a symlink");
  const lines: string[] = [];
  const files: string[] = [];
  async function walk(dir: string, depth: number, prefix: string): Promise<void> {
    if (lines.length >= MAX_GITHUB_ENTRIES || depth > 3) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (lines.length >= MAX_GITHUB_ENTRIES || NOISY_GITHUB_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) { lines.push(`${prefix}${entry.name} -> [skipped symlink]`); continue; }
      lines.push(`${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`);
      if (entry.isDirectory()) await walk(full, depth + 1, `${prefix}  `);
      else if (entry.isFile() && files.length < MAX_GITHUB_FILES) files.push(full);
    }
  }
  await walk(targetReal, 0, "");
  const rootReadme = (await readdir(targetReal, { withFileTypes: true })).find((entry) => entry.isFile() && /^readme(?:\.[a-z0-9]+)?$/i.test(entry.name));
  if (rootReadme) {
    const readmePath = join(targetReal, rootReadme.name);
    const index = files.indexOf(readmePath);
    if (index >= 0) files.splice(index, 1);
    files.unshift(readmePath);
  }
  const snippets: string[] = [];
  for (const file of files) {
    const info = await stat(file);
    if (info.size > 256 * 1024) continue;
    const bytes = await readFile(file);
    if (isBinary(bytes)) continue;
    const body = bytes.toString("utf8");
    if (/^version https:\/\/git-lfs.github.com\/spec\/v1/m.test(body)) continue;
    const rel = relative(root, file);
    if (snippets.length < 3) snippets.push(`## ${rel}\n\n${truncate(body, MAX_GITHUB_FILE_CHARS)}`);
  }
  return truncate(`## Directory tree\n\n${lines.join("\n") || "(empty)"}${snippets.length ? `\n\n## Selected text files\n\n${snippets.join("\n\n")}` : ""}`, maxLength);
}

async function fetchGitHubRepoOrTree(target: GitHubTarget, maxLength: number, deadline: number): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "pipiui-github-"));
  try {
    if (target.candidateOverflow) throw new Error("GitHub URL has too many ambiguous ref/path splits for the specialized fetch");
    const candidates = target.kind === "repo" ? [{ ref: "", path: "" }] : target.refCandidates || [];
    const matches: Array<{ ref: string; path: string; content: string }> = [];
    for (const [index, candidate] of candidates.entries()) {
      if (remainingGitHubBudget(deadline) <= 0) throw new Error("GitHub specialized fetch exceeded its shared 30s budget");
      const checkout = join(tempRoot, `repo-${index}-${candidate.ref.replace(/[^A-Za-z0-9]/g, "_")}`);
      const args = ["clone", "--depth", "1", "--single-branch", ...(candidate.ref ? ["--branch", candidate.ref] : []), `https://github.com/${target.owner}/${target.repo}.git`, checkout];
      try {
        await runGit(args, tempRoot, deadline);
        const content = await collectGitHubTree(checkout, candidate.path, maxLength);
        matches.push({ ...candidate, content });
      } catch (err) {
        if (target.kind === "repo") throw err;
      }
    }
    if (!matches.length) throw new Error(`GitHub ${target.kind} not found in ${target.owner}/${target.repo}`);
    if (matches.length > 1) throw new Error("GitHub URL is ambiguous because its branch/ref may contain '/'; use a URL whose ref/path split is unambiguous");
    const match = matches[0];
    return truncate(`# GitHub ${target.kind}: ${target.owner}/${target.repo}\n\nref: ${match.ref || "default"}${match.path ? `\npath: ${match.path}` : ""}\n\n${match.content}`, maxLength);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function fetchGitHubCode(target: GitHubTarget, maxLength: number, deadline: number): Promise<string> {
  if (target.candidateOverflow) throw new Error("GitHub URL has too many ambiguous ref/path splits for the specialized fetch");
  return target.kind === "blob" ? fetchGitHubBlob(target, maxLength, deadline) : fetchGitHubRepoOrTree(target, maxLength, deadline);
}


// ---------------------------------------------------------------------------
// Lightweight generic fallback
// ---------------------------------------------------------------------------
// The generic web core remains owned by PipiUI's web_fetch extension. This
// package keeps a deliberately small fallback only for a specialized GitHub
// repo/blob/tree retrieval that could not complete; it avoids a runtime package
// dependency or copying the core HTML/RSC extractor.

const MAX_FALLBACK_RESPONSE_BYTES = 5 * 1024 * 1024;

function decodeFallbackEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function lightweightHTMLToText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/main)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  const plain = decodeFallbackEntities(body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const heading = decodeFallbackEntities(title).replace(/\s+/g, " ").trim();
  return heading && !plain.startsWith(heading) ? `# ${heading}\n\n${plain}` : plain;
}

async function readFallbackTextWithLimit(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_FALLBACK_RESPONSE_BYTES) {
    throw new Error(`response exceeds ${MAX_FALLBACK_RESPONSE_BYTES} byte limit`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_FALLBACK_RESPONSE_BYTES) {
        throw new Error(`response exceeds ${MAX_FALLBACK_RESPONSE_BYTES} byte limit`);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

async function fetchGenericGitHubURL(parsed: URL, maxLength: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(parsed.href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/json,application/xml,text/plain;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || "response"}`);
    const raw = await readFallbackTextWithLimit(res);
    const extracted = /(?:text\/html|application\/xhtml\+xml)/i.test(res.headers.get("content-type") || "")
      ? lightweightHTMLToText(raw)
      : raw;
    if (!extracted.trim()) {
      throw new Error("page returned no extractable text content (possibly JS-rendered)");
    }
    return truncate(extracted, maxLength);
  } catch (err: any) {
    throw new Error(err?.name === "AbortError" ? "request timed out (30s)" : err?.message || String(err));
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "github_fetch",
    label: "GitHub Fetch",
    description:
      "Fetch a GitHub repository root, code file (/blob/), or directory tree (/tree/) with " +
      "GitHub-aware APIs and a bounded throwaway shallow clone. Use github_fetch for GitHub " +
      "repo/blob/tree URLs. Use web_fetch for GitHub issues, pull requests, discussions, wikis, " +
      "releases, and other rendered GitHub pages.",
    promptSnippet: "Fetch GitHub repository, blob, or tree URLs with GitHub-aware retrieval",
    promptGuidelines: [
      "Use github_fetch for GitHub repository roots and /blob/ or /tree/ URLs.",
      "Use web_fetch, not github_fetch, for GitHub issues, pull requests, discussions, wikis, releases, and other rendered GitHub pages.",
      "github_fetch accepts GH_TOKEN or GITHUB_TOKEN when available but never requires a token.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Absolute GitHub repository, blob, or tree URL (https://github.com/... )." }),
      max_length: Type.Optional(
        Type.Number({ description: "Maximum characters to return (default 20000)." }),
      ),
    }),
    async execute(_id, params) {
      const url = (params.url || "").trim();
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return text("github_fetch: url must be an absolute HTTP(S) GitHub URL.", true);
      }
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.hostname.toLowerCase() !== "github.com") {
        return text("github_fetch: url must be an absolute HTTP(S) URL on github.com.", true);
      }

      const maxLength = Math.min(Math.max(Math.round(params.max_length || 20000), 1000), 100000);
      let target: GitHubTarget | null;
      try {
        target = parseGitHubCodeURL(parsed);
      } catch (err: any) {
        return text(`github_fetch GitHub rejected: ${err?.message || String(err)}`, true);
      }
      if (!target) {
        return text(
          "github_fetch supports GitHub repository, /blob/, and /tree/ URLs. " +
          "Use web_fetch for issues, pull requests, discussions, wikis, releases, actions, and other rendered GitHub pages.",
          true,
        );
      }

      try {
        return text(await fetchGitHubCode(target, maxLength, Date.now() + GITHUB_TOTAL_BUDGET_MS));
      } catch {
        // One bounded generic fallback only; it never re-enters the GitHub router.
        try {
          return text(await fetchGenericGitHubURL(parsed, maxLength));
        } catch (err: any) {
          return text(`github_fetch failed: ${err?.message || String(err)}`, true);
        }
      }
    },
  });
}
