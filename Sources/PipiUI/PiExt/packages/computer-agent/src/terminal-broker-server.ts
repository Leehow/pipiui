import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { registerComputerTerminalHostTools } from "./terminal-host-tools.ts";
import type { TerminalBrokerFailureCode } from "./terminal-broker.ts";
import type { TerminalStepPolicy } from "./terminal-policy.ts";

type ObservedFile = { path: string; exists: boolean; type?: string; digest?: string };
type Entry = { taskId: string; stepId: string; runId: string; tools: Map<string, any>; records: HostTerminalExecutionRecord[]; observedFiles: Map<string, ObservedFile>; controllers: Set<AbortController> };
export type HostTerminalExecutionRecord = { kind: "write_parameterized_file"; path: string; byteLength: number; contentDigest: string; observationId: string; observedAt: string };

function closedFailureCode(error: unknown): TerminalBrokerFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/path|root|symlink|hard link|file identity/i.test(message)) return "terminal_path_policy_rejected";
  if (/command|executable|argv|budget|GUI substitution/i.test(message)) return "terminal_command_policy_rejected";
  if (/request|JSON|too large|invalid terminal_/i.test(message)) return "terminal_request_invalid";
  return "terminal_operation_failed";
}

export class TerminalWorkerBrokerServer {
  #server?: Server; #url?: string; readonly #entries = new Map<string, Entry>();
  async start(): Promise<string> {
    if (this.#url) return this.#url;
    const server = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method !== "POST" || request.url !== "/v1/terminal-worker") { response.statusCode = 404; response.end(JSON.stringify({ ok: false, error: "not_found" })); return; }
      try {
        const chunks: Buffer[] = []; let total = 0;
        for await (const chunk of request) { const bytes = Buffer.from(chunk); total += bytes.length; if (total > 1_100_000) throw new Error("terminal broker request too large"); chunks.push(bytes); }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const token = String(request.headers.authorization ?? "").match(/^Bearer (.+)$/)?.[1] ?? "";
        const entry = this.#entries.get(token);
        const toolName = body.operation === "read" ? "terminal_read_file" : body.operation === "write" ? "terminal_write_file" : body.operation === "status" ? "terminal_file_status" : body.operation === "execute" ? "terminal_execute" : "";
        const tool = entry?.tools.get(toolName);
        if (!entry || !tool) { response.statusCode = 401; response.end(JSON.stringify({ ok: false, error: "unknown or revoked terminal step token" })); return; }
        const controller = new AbortController(); entry.controllers.add(controller);
        const params = body.operation === "execute" ? { argv: body.argv } : body.operation === "read" ? { path: body.path, maxBytes: body.maxBytes } : body.operation === "write" ? { path: body.path, content: body.content } : { path: body.path };
        const result = await tool.execute(randomUUID(), params, controller.signal).finally(() => entry.controllers.delete(controller));
        const details = result.details ?? {}; const artifactId = `artifact:terminal:${randomUUID()}`;
        let projected: Record<string, unknown>;
        if (body.operation === "read") { const bytes = Buffer.from(String(details.text ?? "")); const digest = createHash("sha256").update(bytes).digest("hex"); projected = { operation: "read", artifactId, digest, byteLength: bytes.length, truncated: details.truncated === true }; entry.observedFiles.set(String(body.path), { path: String(body.path), exists: true, type: "file", digest }); }
        else if (body.operation === "write") { const content = String(body.content); const contentDigest = createHash("sha256").update(content).digest("hex"); projected = { operation: "write", artifactId, digest: contentDigest, byteLength: Number(details.byteLength), written: true }; entry.records.push({ kind: "write_parameterized_file", path: String(body.path), byteLength: Number(details.byteLength), contentDigest, observationId: `file:${randomUUID()}`, observedAt: new Date().toISOString() }); entry.observedFiles.set(String(body.path), { path: String(body.path), exists: true, type: "file", digest: contentDigest }); }
        else if (body.operation === "status") { projected = { operation: "status", artifactId, exists: details.exists === true, ...(details.type ? { kind: details.type } : {}), ...(Number.isInteger(details.size) ? { byteLength: details.size } : {}) }; entry.observedFiles.set(String(body.path), { path: String(body.path), exists: details.exists === true, ...(typeof details.type === "string" ? { type: details.type } : {}) }); }
        else projected = { operation: "execute", artifactId, exitCode: Number(details.exitCode ?? 0), stdoutDigest: createHash("sha256").update(String(details.stdout ?? "")).digest("hex"), stderrDigest: createHash("sha256").update(String(details.stderr ?? "")).digest("hex"), truncated: details.truncated === true };
        response.end(JSON.stringify(projected));
      } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ ok: false, code: closedFailureCode(error) })); }
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    this.#server = server; const address = server.address() as AddressInfo; this.#url = `http://127.0.0.1:${address.port}/v1/terminal-worker`; return this.#url;
  }
  issue(input: { taskId: string; stepId: string; runId: string; policy: Omit<TerminalStepPolicy, "commands"> }) {
    if (!this.#url) throw new Error("terminal worker broker is not started");
    const token = randomBytes(32).toString("base64url"); const tools = new Map<string, any>();
    registerComputerTerminalHostTools({ registerTool: (tool) => tools.set(tool.name, tool) }, {
      PIPIUI_TERMINAL_WORKER_CWD: input.policy.cwd,
      PIPIUI_TERMINAL_WORKER_WRITE_ROOTS: JSON.stringify(input.policy.writeRoots),
      PIPIUI_TERMINAL_WORKER_EXECUTABLES: JSON.stringify(input.policy.allowedExecutables),
      PIPIUI_TERMINAL_WORKER_MAX_COMMANDS: String(input.policy.maxCommands),
    });
    this.#entries.set(token, { taskId: input.taskId, stepId: input.stepId, runId: input.runId, tools, records: [], observedFiles: new Map(), controllers: new Set() });
    return { token, environment: { PIPIUI_TERMINAL_WORKER_BROKER_URL: this.#url, PIPIUI_TERMINAL_WORKER_BROKER_TOKEN: token } };
  }
  consumeExecutions(taskId: string, stepId: string) { const output: HostTerminalExecutionRecord[] = []; for (const entry of this.#entries.values()) if (entry.taskId === taskId && entry.stepId === stepId) { output.push(...entry.records); entry.records.length = 0; } return structuredClone(output); }
  consumeFileObservations(taskId: string, stepId: string) { const output: ObservedFile[] = []; for (const entry of this.#entries.values()) if (entry.taskId === taskId && entry.stepId === stepId) { output.push(...entry.observedFiles.values()); entry.observedFiles.clear(); } return structuredClone(output); }
  revokeStep(taskId: string, stepId: string) { for (const [token, entry] of this.#entries) if (entry.taskId === taskId && entry.stepId === stepId) { for (const controller of entry.controllers) controller.abort(); this.#entries.delete(token); } }
  revokeTask(taskId: string) { for (const [token, entry] of this.#entries) if (entry.taskId === taskId) { for (const controller of entry.controllers) controller.abort(); this.#entries.delete(token); } }
  async stop() { const server = this.#server; this.#server = undefined; this.#url = undefined; this.#entries.clear(); if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
