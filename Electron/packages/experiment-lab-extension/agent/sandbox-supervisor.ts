// Trusted, one-shot Node supervisor. The workload never receives the IPC descriptor.
import { spawn } from "node:child_process";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SandboxProbe, SandboxRunRequest, SandboxRunResult } from "./sandbox-contract.js";

const VERSION = "0.0.77";
const PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const vendor = fileURLToPath(new URL("../../vendor/sandbox-runtime/node_modules/@anthropic-ai/sandbox-runtime/", import.meta.url));
type Manager = {
  isSupportedPlatform(): boolean;
  checkDependenciesAsync(): Promise<{ errors: string[]; warnings: string[] }>;
  initialize(config: unknown, ask?: unknown, monitor?: boolean): Promise<void>;
  wrapWithSandbox(command: string, shell?: string): Promise<string>;
  getProxyAuthToken(): string | undefined;
  cleanupAfterCommand(): void;
  reset(): Promise<void>;
};
let manager: Manager | undefined;
let workloadPid: number | undefined;
let stopped: "cancelled" | "timed-out" | undefined;
let endWorkload: (() => void) | undefined;
const send = (message: unknown) => { if (process.connected) process.send?.(message); };
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const inside = (root: string, value: string) => { const rel = relative(root, value); return rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel)); };
function kill(signal: NodeJS.Signals) {
  if (!workloadPid || workloadPid <= 1) return;
  try { process.kill(-workloadPid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}
function cancel(state: "cancelled" | "timed-out" = "cancelled") {
  stopped ??= state;
  kill("SIGTERM");
  endWorkload?.();
}

async function probe(): Promise<SandboxProbe> {
  const result: SandboxProbe = { available: false, version: VERSION, platform: process.platform, errors: [], warnings: [] };
  try {
    if (process.platform !== "darwin" && process.platform !== "linux") throw new Error(`Unsupported sandbox platform: ${process.platform}`);
    const pkg = JSON.parse(await readFile(join(vendor, "package.json"), "utf8"));
    if (pkg.version !== VERSION) throw new Error(`Expected sandbox-runtime ${VERSION}, found ${pkg.version}`);
    await access(join(vendor, "LICENSE"));
    // Absolute, extension-owned entry: cannot resolve a checkout/global node_modules by accident.
    manager = (await import(pathToFileURL(join(vendor, "dist/index.js")).href)).SandboxManager as Manager;
    if (!manager.isSupportedPlatform()) throw new Error("Sandbox platform is unavailable");
    const dependencies = await manager.checkDependenciesAsync();
    result.errors = dependencies.errors; result.warnings = dependencies.warnings;
    result.available = result.errors.length === 0;
  } catch (error) { result.errors.push(error instanceof Error ? error.message : String(error)); }
  return result;
}

async function run(request: SandboxRunRequest): Promise<SandboxRunResult> {
  const started = performance.now();
  const capability = await probe();
  const result: SandboxRunResult = { state: "sandbox-unavailable", exitCode: null, signal: null, stdout: "", stderr: "", stdoutBytes: 0, stderrBytes: 0,
    stdoutTruncated: false, stderrTruncated: false, totalWallMs: 0, workloadWallMs: null,
    sandbox: { applied: false, version: VERSION, platform: process.platform, warnings: capability.warnings } };
  if (!capability.available) { result.reason = capability.errors.join("; "); return result; }
  let runningAt: number | undefined;
  try {
    const workspace = await realpath(request.workspaceRoot);
    const home = await realpath(request.homeRoot);
    const temp = await realpath(request.tempRoot);
    const cwd = await realpath(request.cwd);
    if (!inside(workspace, cwd)) throw new Error("Sandbox cwd must remain inside workspace");
    const trusted = await Promise.all(request.trustedReadRoots.map(async root => {
      if ((await lstat(root)).isSymbolicLink()) throw new Error("Trusted read input must not be a symlink");
      return realpath(root);
    }));
    const protectedRoots = await Promise.all(request.protectedReadRoots.map(root => realpath(root)));
    // A workspace nested under a protected project is legitimate. It is carved out narrowly.
    for (const writable of [workspace, home, temp]) {
      if (writable === "/" || protectedRoots.some(root => inside(writable, root))) throw new Error("Writable root contains protected data");
    }
    for (const input of trusted) {
      if (input === "/" || protectedRoots.some(root => inside(input, root))) throw new Error("Trusted read root contains protected data");
      if (protectedRoots.some(root => inside(root, input)) && !(await stat(input)).isFile()) throw new Error("Protected read carve-out must be an exact regular file");
      if (input.split("/").some(part => /^(?:\.env(?:\..*)?|auth\.json|trust\.json|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i.test(part))) {
        throw new Error("Credentials cannot be trusted read inputs");
      }
    }
    const systemReads = process.platform === "darwin"
      ? ["/bin", "/sbin", "/usr/bin", "/usr/sbin", "/usr/lib", "/usr/libexec", "/System/Library", "/Library/Apple", "/dev", "/private/var/select/sh", "/private/etc/ssl"]
      : ["/bin", "/sbin", "/usr/bin", "/usr/sbin", "/usr/lib", "/usr/lib64", "/lib", "/lib64", "/dev", "/proc", "/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ssl/certs"];
    // Deny '/' converts srt's default-open reads to explicit carve-outs. Do not denyWrite
    // the formal parent: workspace may be nested beneath it and writes default to denied.
    await manager!.initialize({
      network: { allowedDomains: request.allowedDomains, deniedDomains: [], strictAllowlist: true, allowLocalBinding: false },
      filesystem: { denyRead: ["/", ...protectedRoots], allowRead: [...systemReads, workspace, home, temp, ...trusted],
        allowWrite: [workspace, home, temp], denyWrite: ["/tmp/claude", "/private/tmp/claude", ...trusted] },
    }, undefined, false);
    const token = manager!.getProxyAuthToken();
    if (token) send({ type: "secret", value: token });
    if (stopped) { result.state = stopped; return result; }
    const env: Record<string, string> = { PATH, HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp, LANG: "C.UTF-8", ELECTRON_RUN_AS_NODE: "1" };
    for (const [key, value] of Object.entries(request.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /^(?:PIPIUI|PI_|NODE_|DYLD_|LD_|ELECTRON_|SRT_|SANDBOX_|VAULT|.*PROXY$)/i.test(key)
        || ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "ENV", "BASH_ENV", "BASHOPTS", "SHELLOPTS", "CDPATH", "GLOBIGNORE"].includes(key)) {
        throw new Error(`Forbidden workload environment key: ${key}`);
      }
      env[key] = value;
    }
    const command = request.command.shell
      ? `/bin/sh -c ${quote(request.command.executable)} pipiui-trial ${request.command.args.map(quote).join(" ")}`
      : [request.command.executable, ...request.command.args].map(quote).join(" ");
    // srt supplies proxy variables but also overwrites TMPDIR and bypasses localhost.
    // Restore the per-trial scratch and require explicit localhost access through its proxy.
    const wrapped = await manager!.wrapWithSandbox(`/usr/bin/env TMPDIR=${quote(temp)} NO_PROXY= no_proxy= ${command}`, "/bin/sh");
    // srt's Basic-auth username may include encoded command attribution. Register
    // the complete credential too, so verbose clients cannot leak its base64 form.
    for (const match of wrapped.matchAll(/(?:https?|socks5h?):\/\/([^\s'"@]+)@/g)) {
      send({ type: "secret", value: decodeURIComponent(match[1]) });
    }
    if (stopped) { result.state = stopped; return result; }
    // Prove the OS backend can actually enter this policy before interpreting a
    // workload exit status. Missing namespace privileges / sandbox-exec failures
    // are unavailable, not measured candidate failures.
    const preflight = spawn("/bin/sh", ["-c", await manager!.wrapWithSandbox("/usr/bin/true", "/bin/sh")], {
      cwd, env, detached: true, stdio: ["ignore", "ignore", "pipe"],
    });
    workloadPid = preflight.pid;
    if (workloadPid) send({ type: "workload", pid: workloadPid });
    preflight.stderr.pipe(process.stderr);
    const entered = await new Promise<boolean>(resolve => {
      endWorkload = () => resolve(false);
      preflight.once("error", () => resolve(false));
      preflight.once("exit", code => resolve(code === 0));
      if (stopped) cancel(stopped);
    });
    kill("SIGKILL");
    if (!entered || stopped) {
      result.state = stopped ?? "sandbox-unavailable";
      result.reason = "OS sandbox preflight could not enter the requested policy";
      return result;
    }
    const child = spawn("/bin/sh", ["-c", wrapped], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    workloadPid = child.pid;
    if (workloadPid) send({ type: "workload", pid: workloadPid });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    runningAt = performance.now();
    send({ type: "progress", phase: "running" });
    await new Promise<void>(resolve => {
      endWorkload = resolve;
      child.once("error", error => { result.reason = error.message; resolve(); });
      child.once("exit", (code, signal) => { result.exitCode = code; result.signal = signal; resolve(); });
      if (stopped) cancel(stopped);
    });
    result.workloadWallMs = performance.now() - runningAt;
    // A successful sandbox shell launch plus a nonzero workload is a real measured exit,
    // not an infrastructure error. Sandbox initialization/wrapper errors remain unavailable.
    result.sandbox.applied = true;
    result.state = stopped ?? (result.reason ? "failed" : "exited");
  } catch (error) {
    result.reason = error instanceof Error ? error.message : String(error);
    result.state = stopped ?? "sandbox-unavailable";
  } finally {
    send({ type: "progress", phase: "cleaning" });
    if (workloadPid) {
      kill("SIGTERM");
      await new Promise(resolve => setTimeout(resolve, Math.min(2000, Math.max(50, request.terminationGraceMs ?? 250))));
      kill("SIGKILL");
    }
    manager?.cleanupAfterCommand();
    await manager?.reset();
    result.totalWallMs = performance.now() - started;
  }
  return result;
}

if (process.env.PIPIUI_EXPERIMENT_SANDBOX_SUPERVISOR === "1" && process.send) {
  let accepted = false;
  process.on("SIGTERM", () => cancel());
  process.on("SIGINT", () => cancel());
  process.on("disconnect", () => {
    cancel();
    setTimeout(() => {
      kill("SIGKILL");
      // This supervisor is itself a detached leader; include its owned proxy helpers.
      process.kill(-process.pid, "SIGKILL");
    }, 2500);
  });
  process.on("message", async (message: any) => {
    if (message?.type === "cancel") { cancel(message.state); return; }
    if (accepted || (message?.type !== "probe" && message?.type !== "run")) return;
    accepted = true;
    try {
      const result = message.type === "probe" ? await probe() : await run(message.request);
      if (message.type === "probe") await manager?.reset();
      if (process.connected) process.send?.({ type: "result", result }, () => process.exit(0));
      else process.exit(0);
    } catch (error) {
      // Parent classifies missing trusted result as unavailable. Do not print private configs.
      kill("SIGKILL");
      process.stderr.write(error instanceof Error ? error.message : "Sandbox supervisor failed");
      process.exit(1);
    }
  });
}
