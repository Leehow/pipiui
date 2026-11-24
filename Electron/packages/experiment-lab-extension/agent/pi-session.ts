import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { ExperimentError } from "./paths.js";
import { sha256 } from "./snapshot.js";

export type PiRuntime = { nodePath: string; cliPath: string; version: string; cliFingerprint: string };
export type PiProfile = {
  id: string;
  provider: string;
  model: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  tools: string[];
  extensions?: string[];
  skills?: string[];
  systemPrompt?: string;
};
export type PiRunEvent = { sequence: number; at: string; type: string; data: Record<string, unknown> };
export type PiRunResult = {
  state: "completed" | "failed" | "cancelled" | "timed-out";
  reason?: string;
  pid: number | undefined;
  runtime: PiRuntime;
  profile: PiProfile;
  profileFingerprint: string;
  effectiveSystemPromptFingerprint?: string;
  sessionId?: string;
  startedAt: string;
  endedAt: string;
  totalMs: number;
  answer: string;
  stopReason?: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; cost: number | null; source: "pi-session" } | null;
  toolCalls: number;
  stderr: string;
  outputTruncated: boolean;
  transportExit: { code: number | null; signal: string | null };
};
export type PiRunRequest = {
  runtime: PiRuntime;
  profile: PiProfile;
  workspace: string;
  /** Unique, initially empty per-trial state directory owned by the caller. */
  stateDirectory: string;
  prompt: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Already authorized values only; never implicitly inherit the host environment. */
  environment?: Record<string, string>;
  redactValues?: string[];
  onEvent?: (event: PiRunEvent) => void;
};
export type PiRunHandle = {
  pid: number | undefined;
  result: Promise<PiRunResult>;
  cancel(): void;
  respond(id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }): void;
};

export async function resolvePiRuntime(cliPath = process.argv[1], nodePath = process.execPath): Promise<PiRuntime> {
  if (!cliPath || !isAbsolute(cliPath) || !isAbsolute(nodePath)) throw new ExperimentError("pi-runtime-unavailable", "需要显式的目标 Pi 和 Node 路径，不能回退到全局 PATH。");
  const cli = await realpath(cliPath);
  const node = await realpath(nodePath);
  const pkg = JSON.parse(await readFile(join(dirname(dirname(cli)), "package.json"), "utf8"));
  if (pkg.name !== "@earendil-works/pi-coding-agent" || typeof pkg.version !== "string") throw new ExperimentError("pi-runtime-unavailable", "目标入口不是已识别的 Pi runtime。");
  return { nodePath: node, cliPath: cli, version: pkg.version, cliFingerprint: sha256(await readFile(cli)) };
}

/** RPC is LF-delimited; U+2028/U+2029 inside JSON are not record boundaries. */
export function createPiJsonlReader(onLine: (line: string) => void, maxLineBytes = 4 * 1024 * 1024) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  return (chunk: Buffer) => {
    pending += decoder.write(chunk);
    let at: number;
    while ((at = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, at).replace(/\r$/, "");
      pending = pending.slice(at + 1);
      if (Buffer.byteLength(line) > maxLineBytes) throw new Error("Pi RPC record exceeds the bounded reader limit");
      if (line) onLine(line);
    }
    if (Buffer.byteLength(pending) > maxLineBytes) throw new Error("Pi RPC record exceeds the bounded reader limit");
  };
}

const OBSERVER = `import {writeFileSync} from 'node:fs'; import {createHash} from 'node:crypto';
export default function(pi) {
  // The dedicated IPC channel is an owner-liveness capability, not a PID probe.
  // Loss of the coordinator must not leave an orphan issuing more model calls.
  process.once('disconnect', () => process.exit(71));
  if (!process.connected) process.exit(71);
  pi.on('project_trust', () => ({ trusted: 'yes', remember: false }));
  pi.on('session_start', () => { writeFileSync(new URL('./effective-profile.json',import.meta.url),JSON.stringify({tools:pi.getActiveTools(),experimentChild:process.env.PIPIUI_EXPERIMENT_CHILD}),{mode:0o600}); });
  pi.on('before_agent_start', event => { writeFileSync(new URL('./effective-prompt.json',import.meta.url),JSON.stringify({fingerprint:createHash('sha256').update(event.systemPrompt).digest('hex')}),{mode:0o600}); });
}`;

/** Thin process adapter, not another scheduler. The batch owns persistence and concurrency. */
export async function startPiSession(input: PiRunRequest): Promise<PiRunHandle> {
  if (process.env.PIPIUI_EXPERIMENT_CHILD === "1") throw new ExperimentError("nested-experiment-not-allowed", "被测 Pi 不得递归创建实验 Pi；请由外层协调器安排新的批次。");
  input.signal?.throwIfAborted();
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 86400000) throw new ExperimentError("invalid-timeout", "Pi 单轮需要有界超时。");
  if (!input.prompt.trim() || input.prompt.length > 100000) throw new ExperimentError("invalid-prompt", "Pi 任务必须非空且有界。");
  const runtime = await resolvePiRuntime(input.runtime.cliPath, input.runtime.nodePath);
  if (runtime.cliFingerprint !== input.runtime.cliFingerprint) throw new ExperimentError("runtime-changed", "目标 Pi 入口在冻结后改变。");
  const profile = structuredClone(input.profile);
  if (!profile.provider || !profile.model || !Array.isArray(profile.tools) || profile.tools.some((tool) => !/^[a-zA-Z][\w-]*$/.test(tool))) throw new ExperimentError("invalid-profile", "Pi profile 需要明确模型与工具集合。");
  const workspace = await realpath(input.workspace);
  const state = resolve(input.stateDirectory);
  // A state directory is single-use: no old auth/settings/session can leak into another trial.
  await mkdir(state, { recursive: false, mode: 0o700 });
  const home = join(state, "home"), agent = join(state, "agent"), sessions = join(state, "sessions");
  await Promise.all([home, agent, sessions].map((path) => mkdir(path, { mode: 0o700 })));
  const observer = join(state, "observer.mjs");
  await writeFile(observer, OBSERVER, { flag: "wx", mode: 0o600 });
  const resourceHashes: Array<{ path: string; sha256: string }> = [];
  const resources = async (paths: string[]) => Promise.all(paths.map(async (path) => {
    if (!isAbsolute(path)) throw new ExperimentError("invalid-profile", "显式扩展和 Skill 需要已解析的绝对文件路径。");
    const actual = await realpath(path);
    resourceHashes.push({ path: actual, sha256: sha256(await readFile(actual)) });
    return actual;
  }));
  const extensions = await resources(profile.extensions ?? []), skills = await resources(profile.skills ?? []);
  const profileFingerprint = sha256(JSON.stringify({ profile, resources: resourceHashes.sort((a, b) => a.path.localeCompare(b.path)), observer: sha256(OBSERVER), runtime }));
  const argv = [runtime.cliPath, "--mode", "rpc", "--session-dir", sessions, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--provider", profile.provider, "--model", profile.model, "--thinking", profile.thinking];
  argv.push(...(profile.tools.length ? ["--tools", profile.tools.join(",")] : ["--no-tools"]));
  const extensionReceipts: string[] = [];
  for (const [index, extension] of extensions.entries()) {
    const wrapper = join(state, `extension-${index}.mjs`), receipt = join(state, `extension-${index}.loaded`);
    await writeFile(wrapper, `import load from ${JSON.stringify(extension)}; import {writeFileSync} from 'node:fs'; export default async function(pi) { await load(pi); writeFileSync(${JSON.stringify(receipt)},'loaded',{mode:0o600}); }`, { flag: "wx", mode: 0o600 });
    extensionReceipts.push(receipt);
    argv.push("-e", wrapper);
  }
  for (const skill of skills) argv.push("--skill", skill);
  if (profile.systemPrompt !== undefined) {
    const promptFile = join(state, "system-prompt.txt");
    await writeFile(promptFile, profile.systemPrompt, { flag: "wx", mode: 0o600 });
    argv.push("--system-prompt", promptFile);
  }
  argv.push("-e", observer);
  const environment = { ...(input.environment ?? {}) };
  for (const key of Object.keys(environment)) {
    if (/^(NODE_OPTIONS|ELECTRON_|PIPIUI_|PI_CODING_AGENT_DIR|HOME|TMPDIR)/.test(key)) throw new ExperimentError("invalid-environment", "实验环境不能覆盖运行身份或注入 Node 启动选项。");
  }
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", ...environment, HOME: home, TMPDIR: state, PI_CODING_AGENT_DIR: agent, ELECTRON_RUN_AS_NODE: "1", PIPIUI_EXPERIMENT_CHILD: "1", PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" };
  const secrets = [...new Set([...(input.redactValues ?? []), ...Object.entries(environment).filter(([key]) => /key|token|secret|password|authorization/i.test(key)).map(([, value]) => value)].filter(Boolean))].sort((a, b) => b.length - a.length);
  const secretForms = [...new Set(secrets.flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]))].sort((a, b) => b.length - a.length);
  const redact = (text: string) => secretForms.reduce((out, secret) => out.split(secret).join("[REDACTED]"), text);
  const sanitize = (value: unknown): unknown => typeof value === "string" ? redact(value) : Array.isArray(value) ? value.map(sanitize) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), sanitize(item)])) : value;
  input.signal?.throwIfAborted();
  const start = performance.now(), startedAt = new Date().toISOString();
  const child = spawn(runtime.nodePath, argv, { cwd: workspace, env, stdio: ["pipe", "pipe", "pipe", "ipc"], detached: process.platform !== "win32" }) as import("node:child_process").ChildProcessWithoutNullStreams;
  let sequence = 0, requestSequence = 0, stderr = "", answer = "", stopReason: string | undefined;
  let sessionId: string | undefined, effectiveSystemPromptFingerprint: string | undefined, toolCalls = 0, truncated = false, closed = false, settled = false;
  let finishReason: string | undefined, finalError: string | undefined, activeTools: string[] | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let usage: PiRunResult["usage"] = null;
  const pending = new Map<string, { resolve: (data: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const uiRequests = new Set<string>();
  const emit = (type: string, data: Record<string, unknown>) => {
    if (closed && type !== "terminal") return;
    const cleaned = sanitize(data) as Record<string, unknown>;
    try { input.onEvent?.({ sequence: ++sequence, at: new Date().toISOString(), type, data: cleaned }); } catch { /* Observation cannot stop a running trial. */ }
  };
  const write = (value: unknown) => { if (!closed && child.stdin.writable) child.stdin.write(JSON.stringify(value) + "\n"); };
  const command = (type: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    if (closed) { reject(new Error("Pi process already exited")); return; }
    const id = `control-${++requestSequence}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Pi ${type} response timed out`)); }, Math.min(10000, input.timeoutMs));
    pending.set(id, { resolve, reject, timer });
    write({ id, type, ...params });
  });
  const signalOwned = (signal: NodeJS.Signals) => {
    if (!child.pid || closed) return;
    try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") emit("stop_error", { message: String(error) }); }
  };
  const stop = () => {
    if (closed || killTimer) return;
    signalOwned("SIGTERM");
    killTimer = setTimeout(() => signalOwned("SIGKILL"), 1000);
  };
  const cancel = (reason = "cancelled") => {
    if (closed || settled || finishReason) return;
    finishReason = reason;
    write({ type: "abort" });
    stop();
  };
  const aborted = () => cancel("cancelled");
  input.signal?.addEventListener("abort", aborted, { once: true });
  const deadline = setTimeout(() => cancel("timed-out"), input.timeoutMs);
  let done!: (result: PiRunResult) => void;
  const result = new Promise<PiRunResult>((resolve) => { done = resolve; });
  child.stdin.on("error", () => { /* close/error is authoritative */ });
  child.on("error", (error) => { finalError = error.message; });
  const stderrDecoder = new StringDecoder("utf8");
  let stderrPending = "";
  const stderrLine = (line: string) => {
    const text = redact(line);
    if (stderr.length + text.length > 65536) truncated = true;
    stderr = (stderr + text).slice(-65536);
    emit("stderr", { text: text.slice(-4096) });
  };
  const completeRun = () => {
    if (settled || finishReason || closed) return;
    settled = true;
    void command("get_session_stats").then(async (stats) => {
      const promptEvidence = JSON.parse(await readFile(join(state, "effective-prompt.json"), "utf8").catch(() => "{}"));
      if (/^[a-f0-9]{64}$/.test(promptEvidence.fingerprint)) effectiveSystemPromptFingerprint = promptEvidence.fingerprint;
      const tokens = stats?.tokens;
      if (tokens && ["input", "output", "cacheRead", "cacheWrite", "total"].every((key) => typeof tokens[key] === "number" && Number.isFinite(tokens[key]) && tokens[key] >= 0)) {
        usage = { input: tokens.input, output: tokens.output, cacheRead: tokens.cacheRead, cacheWrite: tokens.cacheWrite, total: tokens.total, cost: typeof stats.cost === "number" && Number.isFinite(stats.cost) && stats.cost >= 0 ? stats.cost : null, source: "pi-session" };
      }
    }).catch((error) => emit("usage-unavailable", { message: String(error) })).finally(stop);
  };
  child.stderr.on("data", (chunk: Buffer) => {
    stderrPending += stderrDecoder.write(chunk);
    let at: number;
    while ((at = stderrPending.indexOf("\n")) >= 0) { stderrLine(stderrPending.slice(0, at + 1)); stderrPending = stderrPending.slice(at + 1); }
    if (stderrPending.length > 4 * 1024 * 1024) { stderrPending = ""; truncated = true; finalError = "Pi stderr record exceeds limit"; stop(); }
  });
  const parse = createPiJsonlReader((line) => {
    let event: Record<string, any>;
    try { event = JSON.parse(line); } catch { emit("unstructured_output", { text: redact(line).slice(0, 4096) }); return; }
    if (event.type === "response") {
      const request = pending.get(event.id);
      if (request) { clearTimeout(request.timer); pending.delete(event.id); event.success ? request.resolve(event.data) : request.reject(new Error(String(event.error ?? "Pi command failed"))); }
      return;
    }
    if (event.type === "tool_execution_start") toolCalls++;
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const message = event.message;
      const text = (message.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("");
      if (text.length > 65536) truncated = true;
      answer = redact(text).slice(0, 65536);
      stopReason = message.stopReason;
      if (message.stopReason === "error" || message.stopReason === "aborted") finalError = String(message.errorMessage ?? `Pi assistant ${message.stopReason}`);
    }
    if (event.type === "extension_error") finalError = String(event.error ?? "Pi extension error");
    if (event.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(event.method)) {
      uiRequests.add(event.id);
      emit("waiting-input", { id: event.id, method: event.method, title: event.title, options: event.options });
    } else if (event.type !== "message_update") emit(String(event.type), event.type === "message_end" ? { role: event.message?.role, stopReason: event.message?.stopReason } : event);
    if (event.type === "agent_settled") completeRun();
  });
  child.stdout.on("data", (chunk: Buffer) => { try { parse(chunk); } catch (error) { finalError = String(error); stop(); } });
  child.once("close", (code, signal) => {
    stderrLine(stderrPending + stderrDecoder.end());
    stderrPending = "";
    closed = true;
    clearTimeout(deadline); if (killTimer) clearTimeout(killTimer);
    input.signal?.removeEventListener("abort", aborted);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Pi process exited")); }
    pending.clear();
    const finalState = finishReason === "cancelled" || finishReason === "timed-out" ? finishReason : settled && !finalError ? "completed" : "failed";
    const reason = finishReason ?? finalError ?? (!settled ? "pi-exited-before-settled" : undefined);
    const value: PiRunResult = { state: finalState, ...(reason ? { reason: redact(reason) } : {}), pid: child.pid, runtime, profile: sanitize(profile) as PiProfile, profileFingerprint, ...(effectiveSystemPromptFingerprint ? { effectiveSystemPromptFingerprint } : {}), ...(sessionId ? { sessionId } : {}), startedAt, endedAt: new Date().toISOString(), totalMs: performance.now() - start, answer, ...(stopReason ? { stopReason } : {}), usage, toolCalls, stderr, outputTruncated: truncated, transportExit: { code, signal } };
    emit("terminal", { state: finalState, reason: value.reason });
    done(value);
  });
  // Handshake confirms actual model/tools before the task can incur model usage.
  void (async () => {
    const current = await command("get_state");
    sessionId = current?.sessionId;
    activeTools = JSON.parse(await readFile(join(state, "effective-profile.json"), "utf8")).tools;
    for (const receipt of extensionReceipts) if (await readFile(receipt, "utf8").catch(() => "") !== "loaded") throw new Error("A declared Pi extension failed to load");
    if (skills.length) {
      const available = await command("get_commands");
      for (const skill of skills) if (!available?.commands?.some((entry: any) => entry.source === "skill" && typeof (entry.sourceInfo?.path ?? entry.path) === "string" && resolve(entry.sourceInfo?.path ?? entry.path) === skill)) throw new Error(`A declared Pi skill failed to load: ${skill}; commands=${JSON.stringify(available?.commands?.filter((entry: any) => entry.source === "skill") ?? [])}`);
    }
    if (current?.model?.provider !== profile.provider || current?.model?.id !== profile.model || current?.thinkingLevel !== profile.thinking) throw new Error("Requested Pi model/thinking did not become effective");
    if (!activeTools || JSON.stringify([...activeTools].sort()) !== JSON.stringify([...profile.tools].sort())) throw new Error("Requested Pi tool set did not become effective");
    emit("ready", { pid: child.pid, sessionId, model: current.model.id, provider: current.model.provider, thinking: current.thinkingLevel, tools: activeTools });
    if (finishReason || closed) return;
    const receipt = await command("prompt", { message: input.prompt });
    if (receipt?.disposition === "handled") {
      stopReason = "handled";
      completeRun();
    }
  })().catch((error) => { if (!closed && !finishReason) { finalError = String(error); stop(); } });
  return { pid: child.pid, result, cancel: () => cancel(), respond(id, response) {
    if (!uiRequests.delete(id) || closed) throw new ExperimentError("input-not-pending", "该输入请求已结束或不属于此运行。");
    write({ type: "extension_ui_response", id, ...response });
    emit("input-response", { id, manual: true });
  } };
}
