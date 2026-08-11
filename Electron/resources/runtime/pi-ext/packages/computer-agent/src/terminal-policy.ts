import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type TerminalCommand = { argv: string[]; writes?: string[] };
export type TerminalStepPolicy = {
  cwd: string;
  writeRoots: string[];
  maxCommands: number;
  allowedExecutables: string[];
  commands: TerminalCommand[];
};

const FORBIDDEN_EXECUTABLES = new Set([
  "open", "osascript", "cliclick", "pyautogui", "nutjs", "xdotool",
  "sh", "bash", "zsh", "fish", "python", "python3", "node", "ruby", "perl",
]);
const SAFE_EXECUTABLES = new Set(["stat", "file", "shasum", "md5", "wc", "printf", "ls", "head", "tail"]);
const APPROVED_EXECUTABLE_PATHS = new Set([
  "/usr/bin/stat", "/usr/bin/file", "/usr/bin/shasum", "/sbin/md5", "/usr/bin/wc",
  "/usr/bin/printf", "/bin/ls", "/usr/bin/head", "/usr/bin/tail",
]);

export function validateTerminalBoundaryShape(value: Omit<TerminalStepPolicy, "commands">): void {
  if (!value || !isAbsolute(value.cwd)) throw new Error("terminal cwd must be absolute");
  if (!Array.isArray(value.writeRoots) || value.writeRoots.some((root) => typeof root !== "string" || !isAbsolute(root))) throw new Error("terminal write roots must be absolute");
  if (!Array.isArray(value.allowedExecutables) || value.allowedExecutables.length === 0 || value.allowedExecutables.some((path) => typeof path !== "string" || !isAbsolute(path) || !APPROVED_EXECUTABLE_PATHS.has(path))) throw new Error("terminal allowedExecutables must contain approved exact canonical system paths");
  if (!Number.isInteger(value.maxCommands) || value.maxCommands < 1) throw new Error("terminal command budget must be positive");
}
const FORBIDDEN_SCRIPT_PATTERNS = [
  /\b(?:apple|java)?script\b/i,
  /\bpyautogui\b/i,
  /\bcliclick\b/i,
  /@nut-tree|\bnutjs\b/i,
  /\bAXUIElement\b|ApplicationServices/i,
  /\b(?:playwright|selenium|puppeteer)\b/i,
];

function inside(path: string, root: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

async function canonicalRoots(roots: string[]): Promise<string[]> {
  const values: string[] = [];
  for (const root of roots) {
    if (!isAbsolute(root)) throw new Error("terminal bounded roots must be absolute");
    const configured = await lstat(root);
    if (configured.isSymbolicLink()) throw new Error(`terminal bounded root symlink is forbidden: ${root}`);
    const canonical = await realpath(root);
    const metadata = await lstat(canonical);
    if (!metadata.isDirectory()) throw new Error(`terminal bounded root is not a directory: ${root}`);
    values.push(canonical);
  }
  return values;
}

function lexicalCandidate(path: string, cwd: string, roots: string[]): string {
  const candidate = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  if (!roots.map((root) => resolve(root)).some((root) => inside(candidate, root))) {
    throw new Error(`terminal path is outside bounded roots: ${path}`);
  }
  return candidate;
}

export async function resolveExistingTerminalPath(path: string, cwd: string, roots: string[]): Promise<string> {
  const candidate = lexicalCandidate(path, cwd, roots);
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink()) throw new Error(`terminal path symlink is forbidden: ${path}`);
  const canonical = await realpath(candidate);
  const approvedRoots = await canonicalRoots(roots);
  if (!approvedRoots.some((root) => inside(canonical, root))) {
    throw new Error(`terminal canonical path is outside bounded roots: ${path}`);
  }
  return canonical;
}

export async function resolveTerminalWritePath(path: string, cwd: string, writeRoots: string[]): Promise<string> {
  const candidate = lexicalCandidate(path, cwd, writeRoots);
  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) throw new Error(`terminal write symlink is forbidden: ${path}`);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  const canonicalParent = await realpath(dirname(candidate));
  const approvedRoots = await canonicalRoots(writeRoots);
  if (!approvedRoots.some((root) => inside(canonicalParent, root))) {
    throw new Error(`terminal canonical write path is outside bounded roots: ${path}`);
  }
  return candidate;
}

async function validateExecutable(command: TerminalCommand, policy: TerminalStepPolicy): Promise<string> {
  const requested = command.argv[0];
  if (!isAbsolute(requested)) throw new Error("terminal executable identity requires an absolute canonical path");
  const metadata = await lstat(requested);
  if (metadata.isSymbolicLink()) throw new Error(`terminal executable symlink is forbidden: ${requested}`);
  if (!metadata.isFile()) throw new Error(`terminal executable identity is not a file: ${requested}`);
  const canonical = await realpath(requested);
  if (canonical !== resolve(requested)) throw new Error(`terminal executable identity is not canonical: ${requested}`);
  const executable = canonical.split("/").at(-1)?.toLowerCase() ?? "";
  if (FORBIDDEN_EXECUTABLES.has(executable)) throw new Error(`forbidden GUI substitution executable: ${executable}`);
  if (!SAFE_EXECUTABLES.has(executable)) throw new Error(`terminal executable is forbidden by the Computer Task safety ceiling: ${executable}`);
  if (!APPROVED_EXECUTABLE_PATHS.has(canonical)) throw new Error(`terminal executable identity is not an approved canonical system executable: ${canonical}`);
  const allowlist = policy.allowedExecutables;
  if (allowlist.some((item) => !isAbsolute(item))) throw new Error("host executable allowlist must contain exact absolute canonical paths");
  if (!allowlist.includes(canonical)) throw new Error(`terminal executable identity is not allowed for this step: ${canonical}`);
  return executable;
}

async function validateArguments(executable: string, args: string[], policy: TerminalStepPolicy): Promise<void> {
  if (FORBIDDEN_SCRIPT_PATTERNS.some((pattern) => pattern.test(args.join(" ")))) {
    throw new Error("terminal command contains forbidden GUI substitution");
  }
  if (executable === "printf") return;
  for (const argument of args) {
    if (argument.startsWith("-")) throw new Error(`terminal command option is not allowed: ${argument}`);
    await resolveExistingTerminalPath(argument, policy.cwd, [policy.cwd, ...policy.writeRoots])
      .catch((error) => { throw new Error(`terminal command argument is outside bounded roots or unsafe: ${argument}: ${error.message}`); });
  }
}

export async function validateTerminalStep(policy: TerminalStepPolicy): Promise<TerminalStepPolicy> {
  validateTerminalBoundaryShape(policy);
  if (policy.commands.length > policy.maxCommands) throw new Error("terminal command budget exceeded");
  await canonicalRoots([policy.cwd, ...policy.writeRoots]);
  for (const command of policy.commands) {
    if (!Array.isArray(command.argv) || command.argv.length === 0 || command.argv.some((part) => typeof part !== "string")) {
      throw new Error("terminal commands require an argv array");
    }
    const executable = await validateExecutable(command, policy);
    await validateArguments(executable, command.argv.slice(1), policy);
    for (const path of command.writes ?? []) await resolveTerminalWritePath(path, policy.cwd, policy.writeRoots);
  }
  return structuredClone(policy);
}
