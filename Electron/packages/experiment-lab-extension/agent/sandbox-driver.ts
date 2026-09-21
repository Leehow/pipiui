import { spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SandboxDriver, SandboxProbe, SandboxProgress, SandboxRunRequest, SandboxRunResult } from "./sandbox-contract.js";

export const SANDBOX_VERSION = "0.0.77";
export const SANDBOX_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const identity = "PIPIUI_EXPERIMENT_SANDBOX_SUPERVISOR";
const helper = fileURLToPath(new URL("./sandbox-supervisor.js", import.meta.url));

/** Signals only a detached group created by this invocation, never the host group. */
function signalGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid || pid <= 1 || pid === process.pid) return;
  try { process.kill(-pid, signal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function unavailable(reason: string): SandboxRunResult {
  return { state: "sandbox-unavailable", exitCode: null, signal: null, stdout: "", stderr: "", stdoutBytes: 0, stderrBytes: 0,
    stdoutTruncated: false, stderrTruncated: false, totalWallMs: 0, workloadWallMs: null,
    sandbox: { applied: false, version: SANDBOX_VERSION, platform: process.platform, warnings: [] }, reason };
}

/** No dependency installation, model invocation or raw-command fallback happens here. */
export function createSandboxDriver(): SandboxDriver {
  async function invoke(request?: SandboxRunRequest, options?: { signal?: AbortSignal; onProgress?: (progress: SandboxProgress) => void }): Promise<SandboxRunResult | SandboxProbe> {
    const started = performance.now();
    const fail = (reason: string) => request ? unavailable(reason) : {
      available: false, version: SANDBOX_VERSION, platform: process.platform, errors: [reason], warnings: [],
    };
    if (process.env[identity]) return fail("Sandbox supervisor recursion is forbidden");
    if (process.platform !== "darwin" && process.platform !== "linux") return fail(`Unsupported sandbox platform: ${process.platform}`);
    if (options?.signal?.aborted) return request ? { ...unavailable("Cancelled before start"), state: "cancelled" } : fail("Probe cancelled");
    // AF_UNIX paths on macOS are limited to 104 bytes. Project/trial paths can be
    // arbitrarily deep, so proxy sockets use a short, invocation-owned scratch root.
    const supervisorRoot = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "pipiui-srt-"));
    try {
      const home = request?.homeRoot ?? join(supervisorRoot, "home");
      const temp = join(supervisorRoot, "tmp");
      if (request) await mkdir(request.tempRoot, { recursive: true });
      await mkdir(home, { recursive: true });
      await mkdir(temp, { recursive: true });
      const grace = Math.min(2000, Math.max(50, request?.terminationGraceMs ?? 250));
      const cap = Math.min(1024 * 1024, Math.max(0, request?.maxOutputBytes ?? 64 * 1024));
      const secrets = new Set((request?.redactValues ?? []).filter(Boolean));
      // All authorized env values are private by default; short values would erase all output.
      for (const value of Object.values(request?.env ?? {})) if (value.length >= 8) secrets.add(value);
      const buffers = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      const counts = { stdout: 0, stderr: 0 };
      let workloadPid: number | undefined;
      let lastProgress: SandboxProgress = { phase: "preparing", elapsedMs: 0, stdoutBytes: 0, stderrBytes: 0 };
      let final: SandboxRunResult | SandboxProbe | undefined;
      let stopped: "timed-out" | "cancelled" | undefined;
      const child = spawn(process.execPath, [helper], {
        cwd: await realpath(home), detached: true,
        env: { PATH: SANDBOX_PATH, HOME: await realpath(home), TMPDIR: await realpath(temp), LANG: "C.UTF-8",
          ELECTRON_RUN_AS_NODE: "1", [identity]: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const collect = (stream: "stdout" | "stderr", data: Buffer) => {
        counts[stream] += data.length;
        const extra = Math.max(4096, ...[...secrets].map(value => Buffer.byteLength(value) * 4));
        const remaining = cap + extra - buffers[stream].length;
        if (remaining > 0) buffers[stream] = Buffer.concat([buffers[stream], data.subarray(0, remaining)]);
      };
      child.stdout!.on("data", data => collect("stdout", data));
      child.stderr!.on("data", data => collect("stderr", data));
      let killer: ReturnType<typeof setTimeout> | undefined;
      const stop = (state: "timed-out" | "cancelled") => {
        if (stopped || final) return;
        stopped = state;
        if (child.connected) child.send({ type: "cancel", state });
        signalGroup(workloadPid, "SIGTERM");
        killer = setTimeout(() => {
          signalGroup(workloadPid, "SIGKILL");
          signalGroup(child.pid, "SIGKILL");
        }, grace + 1000);
      };
      const abort = () => stop("cancelled");
      options?.signal?.addEventListener("abort", abort, { once: true });
      if (options?.signal?.aborted) abort();
      const timeout = setTimeout(() => stop("timed-out"), request?.timeoutMs ?? 15_000);
      const progressTimer = setInterval(() => {
        try { options?.onProgress?.({ ...lastProgress, elapsedMs: performance.now() - started, stdoutBytes: counts.stdout, stderrBytes: counts.stderr }); } catch { /* observer cannot strand a process */ }
      }, 100);
      try {
        await new Promise<void>(resolve => {
          child.on("message", (message: any) => {
            if (message?.type === "workload") { workloadPid = message.pid; if (stopped) signalGroup(workloadPid, "SIGTERM"); }
            if (message?.type === "secret" && typeof message.value === "string") {
              secrets.add(message.value);
              secrets.add(Buffer.from(message.value).toString("base64"));
              secrets.add(Buffer.from(`srt:${message.value}`).toString("base64"));
            }
            if (message?.type === "progress") lastProgress.phase = message.phase;
            if (message?.type === "result") final = message.result;
          });
          child.once("error", error => { final = fail(error.message); resolve(); });
          child.once("exit", () => resolve());
          child.send({ type: request ? "run" : "probe", request }, error => { if (error) { final = fail(error.message); signalGroup(child.pid, "SIGTERM"); } });
        });
      } finally {
        clearTimeout(timeout); clearTimeout(killer); clearInterval(progressTimer);
        options?.signal?.removeEventListener("abort", abort);
        // Also catches an unexpected supervisor death. PID is the group's original leader.
        signalGroup(workloadPid, "SIGKILL");
        signalGroup(child.pid, "SIGKILL");
        child.stdout?.destroy(); child.stderr?.destroy();
        if (child.connected) child.disconnect();
      }
      const redact = (text: string) => {
        for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join("[REDACTED]");
        return text.replace(/(https?|socks5h?):\/\/[^\s/@]+:[^\s/@]+@/gi, "$1://[REDACTED]@")
          .replace(/(proxy-authorization:\s*)[^\r\n]+/gi, "$1[REDACTED]");
      };
      if (!request) return final ?? fail("Sandbox supervisor exited without a probe result");
      const result = (final ?? unavailable("Sandbox supervisor exited without a result")) as SandboxRunResult;
      if (stopped) result.state = stopped;
      for (const stream of ["stdout", "stderr"] as const) {
        const sanitized = Buffer.from(redact(buffers[stream].toString("utf8")));
        result[stream] = sanitized.subarray(0, cap).toString("utf8");
        result[`${stream}Bytes`] = counts[stream];
        result[`${stream}Truncated`] = counts[stream] > cap || sanitized.length > cap;
      }
      if (result.reason) result.reason = redact(result.reason).slice(0, 4096);
      result.sandbox.warnings = result.sandbox.warnings.map(warning => redact(warning).slice(0, 1024)).slice(0, 10);
      result.totalWallMs = performance.now() - started;
      return result;
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    } finally {
      await rm(supervisorRoot, { recursive: true, force: true });
    }
  }
  return {
    probe: signal => invoke(undefined, { signal }) as Promise<SandboxProbe>,
    run: (request, options) => invoke(request, options) as Promise<SandboxRunResult>,
  };
}
