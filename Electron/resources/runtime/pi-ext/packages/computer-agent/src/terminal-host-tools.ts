import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { resolveExistingTerminalPath, resolveTerminalWritePath, validateTerminalStep } from "./terminal-policy.ts";

const execFileAsync = promisify(execFile);
type RegisteredTool = { name: string; label: string; description: string; parameters: Record<string, unknown>; execute(id: string, params: any, signal?: AbortSignal): Promise<any> };
type PiLike = { registerTool(tool: RegisteredTool): void };
type WorkerEnvironment = Record<string, string | undefined>;

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const textResult = (value: Record<string, unknown>) => ({ content: [{ type: "text", text: JSON.stringify(value) }], details: value });

async function requireSingleLinkRegularFile(handle: Awaited<ReturnType<typeof open>>, context: string, expected?: { dev: number; ino: number }): Promise<void> {
  const metadata = await handle.stat();
  if (!metadata.isFile()) throw new Error(`${context} requires a regular file`);
  if (metadata.nlink !== 1) throw new Error(`${context} rejects hard links with unsafe link count`);
  if (expected && (metadata.dev !== expected.dev || metadata.ino !== expected.ino)) throw new Error(`${context} file identity changed before use`);
}

type TerminalConfig = { cwd: string; writeRoots: string[]; allowedExecutables: string[]; maxCommands: number };

function configFromEnvironment(env: WorkerEnvironment): TerminalConfig | undefined {
  try {
    const cwd = env.PIPIUI_TERMINAL_WORKER_CWD;
    if (!cwd || !isAbsolute(cwd)) return undefined;
    const writeRoots = JSON.parse(env.PIPIUI_TERMINAL_WORKER_WRITE_ROOTS ?? "[]");
    const allowedExecutables = JSON.parse(env.PIPIUI_TERMINAL_WORKER_EXECUTABLES ?? "[]");
    const maxCommands = Number(env.PIPIUI_TERMINAL_WORKER_MAX_COMMANDS);
    if (!Array.isArray(writeRoots) || !Array.isArray(allowedExecutables) || !Number.isInteger(maxCommands) || maxCommands < 1) return undefined;
    return { cwd, writeRoots, allowedExecutables, maxCommands };
  } catch { return undefined; }
}

export function toolNamesForTerminalWorkerRole(): string[] {
  return ["terminal_read_file", "terminal_write_file", "terminal_file_status", "terminal_execute"];
}

export function registerComputerTerminalHostTools(pi: PiLike, env: WorkerEnvironment): void {
  const config = configFromEnvironment(env);
  if (!config) return;
  let commandsUsed = 0;
  const resolveReadable = (path: string) => resolveExistingTerminalPath(path, config.cwd, [config.cwd, ...config.writeRoots]);

  pi.registerTool({
    name: "terminal_read_file", label: "Terminal Read File", description: "Read a bounded UTF-8 file without general filesystem access.",
    parameters: objectSchema({ path: { type: "string" }, maxBytes: { type: "integer", minimum: 1, maximum: 65536 } }, ["path"]),
    async execute(_id, params) {
      if (typeof params?.path !== "string" || (params.maxBytes !== undefined && (!Number.isInteger(params.maxBytes) || params.maxBytes < 1 || params.maxBytes > 65_536))) throw new Error("invalid terminal_read_file request");
      const path = await resolveReadable(params.path);
      const maxBytes = Math.min(Number(params.maxBytes ?? 16_384), 65_536);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const expected = await lstat(path);
      const bytes = await (async () => { await requireSingleLinkRegularFile(handle, "terminal read", { dev: expected.dev, ino: expected.ino }); return await handle.readFile(); })().finally(() => handle.close());
      return textResult({ path: basename(path), text: bytes.subarray(0, maxBytes).toString("utf8"), truncated: bytes.byteLength > maxBytes });
    },
  });
  pi.registerTool({
    name: "terminal_write_file", label: "Terminal Write File", description: "Write parameterized UTF-8 content inside the step's bounded write roots.",
    parameters: objectSchema({ path: { type: "string" }, content: { type: "string", maxLength: 1_000_000 } }, ["path", "content"]),
    async execute(_id, params) {
      if (typeof params?.path !== "string" || typeof params.content !== "string" || params.content.length > 1_000_000) throw new Error("invalid terminal_write_file request");
      const path = await resolveTerminalWritePath(params.path, config.cwd, config.writeRoots);
      let expected: { dev: number; ino: number } | undefined;
      try { const before = await lstat(path); expected = { dev: before.dev, ino: before.ino }; } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      await (async () => { await requireSingleLinkRegularFile(handle, "terminal write", expected); await resolveExistingTerminalPath(path, config.cwd, config.writeRoots); await handle.truncate(0); await handle.writeFile(params.content); })().finally(() => handle.close());
      return textResult({ path: basename(path), byteLength: Buffer.byteLength(params.content), written: true });
    },
  });
  pi.registerTool({
    name: "terminal_file_status", label: "Terminal File Status", description: "Inspect bounded file existence, type, size, and modification time.",
    parameters: objectSchema({ path: { type: "string" } }, ["path"]),
    async execute(_id, params) {
      if (typeof params?.path !== "string") throw new Error("invalid terminal_file_status request");
      try {
        const path = await resolveReadable(params.path);
        const value = await lstat(path);
        if (value.isFile() && value.nlink !== 1) throw new Error("terminal status rejects hard links with unsafe link count");
        return textResult({ path: basename(path), exists: true, type: value.isFile() ? "file" : value.isDirectory() ? "directory" : "other", size: value.size, modifiedAt: value.mtime.toISOString() });
      } catch (error: any) {
        if (error?.code === "ENOENT") return textResult({ path: basename(params.path), exists: false });
        throw error;
      }
    },
  });
  pi.registerTool({
    name: "terminal_execute", label: "Terminal Execute", description: "Execute one argv command from the step's executable allowlist, without a shell.",
    parameters: objectSchema({ argv: { type: "array", minItems: 1, maxItems: 32, items: { type: "string", maxLength: 4096 } } }, ["argv"]),
    async execute(_id, params, signal) {
      if (!Array.isArray(params?.argv) || params.argv.length < 1 || params.argv.length > 32 || params.argv.some((item: unknown) => typeof item !== "string" || item.length > 4096)) throw new Error("invalid terminal_execute request");
      if (commandsUsed >= config.maxCommands) throw new Error("terminal command budget exceeded");
      await validateTerminalStep({ ...config, commands: [{ argv: params.argv }] });
      commandsUsed += 1;
      const { stdout, stderr } = await execFileAsync(params.argv[0], params.argv.slice(1), { cwd: config.cwd, signal, timeout: 30_000, maxBuffer: 1_048_576 });
      return textResult({ exitCode: 0, stdout: stdout.slice(-16_384), stderr: stderr.slice(-4_096), truncated: stdout.length > 16_384 || stderr.length > 4_096 });
    },
  });
}
