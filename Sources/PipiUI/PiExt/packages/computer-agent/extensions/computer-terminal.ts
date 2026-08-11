import type { TerminalBrokerRequest, TerminalBrokerResult, TerminalBrokerTransport } from "../src/terminal-broker.ts";

type RegisteredTool = { name: string; label: string; description: string; parameters: Record<string, unknown>; execute(id: string, params: any, signal?: AbortSignal): Promise<any> };
type PiLike = { registerTool(tool: RegisteredTool): void };
type WorkerEnvironment = Record<string, string | undefined>;

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const textResult = (value: TerminalBrokerResult) => ({ content: [{ type: "text", text: JSON.stringify(value) }], details: value });
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const artifact = (value: unknown) => typeof value === "string" && /^artifact:[A-Za-z0-9:-]{1,160}$/.test(value);

function brokerConfig(env: WorkerEnvironment): { endpoint: string; token: string } | undefined {
  const endpoint = env.PIPIUI_TERMINAL_WORKER_BROKER_URL;
  const token = env.PIPIUI_TERMINAL_WORKER_BROKER_TOKEN;
  if (!endpoint || !token || token.length < 16) return undefined;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" || !["127.0.0.1", "::1", "localhost"].includes(url.hostname)) return undefined;
    return { endpoint: url.toString(), token };
  } catch { return undefined; }
}

function decodeResult(value: unknown, operation: TerminalBrokerRequest["operation"]): TerminalBrokerResult {
  if (!value || typeof value !== "object" || (value as any).operation !== operation || !artifact((value as any).artifactId)) throw new Error("Terminal broker returned an invalid result");
  const item = value as any;
  if (operation === "read" && digest(item.digest) && Number.isInteger(item.byteLength) && typeof item.truncated === "boolean") return { operation, artifactId: item.artifactId, digest: item.digest.toLowerCase(), byteLength: item.byteLength, truncated: item.truncated };
  if (operation === "write" && digest(item.digest) && Number.isInteger(item.byteLength) && item.written === true) return { operation, artifactId: item.artifactId, digest: item.digest.toLowerCase(), byteLength: item.byteLength, written: true };
  if (operation === "status" && typeof item.exists === "boolean" && (item.kind === undefined || ["file", "directory", "other"].includes(item.kind)) && (item.byteLength === undefined || Number.isInteger(item.byteLength)) && (item.digest === undefined || digest(item.digest))) return { operation, artifactId: item.artifactId, exists: item.exists, ...(item.kind ? { kind: item.kind } : {}), ...(item.byteLength !== undefined ? { byteLength: item.byteLength } : {}), ...(item.digest ? { digest: item.digest.toLowerCase() } : {}) };
  if (operation === "execute" && Number.isInteger(item.exitCode) && typeof item.truncated === "boolean" && (item.stdoutDigest === undefined || digest(item.stdoutDigest)) && (item.stderrDigest === undefined || digest(item.stderrDigest))) return { operation, artifactId: item.artifactId, exitCode: item.exitCode, ...(item.stdoutDigest ? { stdoutDigest: item.stdoutDigest.toLowerCase() } : {}), ...(item.stderrDigest ? { stderrDigest: item.stderrDigest.toLowerCase() } : {}), truncated: item.truncated };
  throw new Error("Terminal broker returned an invalid result");
}

const fetchTransport: TerminalBrokerTransport = async ({ endpoint, token, request, signal }) => {
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(request), signal });
  if (!response.ok) throw new Error(`Terminal broker rejected request (${response.status})`);
  return decodeResult(await response.json(), request.operation);
};

export function toolNamesForTerminalWorkerRole(): string[] { return ["terminal_read_file", "terminal_write_file", "terminal_file_status", "terminal_execute"]; }

export function registerComputerTerminalTools(pi: PiLike, env: WorkerEnvironment = process.env, transport: TerminalBrokerTransport = fetchTransport): void {
  const config = brokerConfig(env);
  if (!config) return;
  const proxy = async (request: TerminalBrokerRequest, signal?: AbortSignal) => textResult(decodeResult(await transport({ ...config, request, signal }), request.operation));
  pi.registerTool({ name: "terminal_read_file", label: "Terminal Read File", description: "Request a bounded file artifact from the authenticated host Terminal broker.", parameters: objectSchema({ path: { type: "string" }, maxBytes: { type: "integer", minimum: 1, maximum: 65536 } }, ["path"]), async execute(_id, params, signal) { if (typeof params?.path !== "string" || (params.maxBytes !== undefined && (!Number.isInteger(params.maxBytes) || params.maxBytes < 1 || params.maxBytes > 65_536))) throw new Error("invalid terminal_read_file request"); return await proxy({ operation: "read", path: params.path, maxBytes: params.maxBytes ?? 16_384 }, signal); } });
  pi.registerTool({ name: "terminal_write_file", label: "Terminal Write File", description: "Request a bounded write from the authenticated host Terminal broker.", parameters: objectSchema({ path: { type: "string" }, content: { type: "string", maxLength: 1_000_000 } }, ["path", "content"]), async execute(_id, params, signal) { if (typeof params?.path !== "string" || typeof params.content !== "string" || params.content.length > 1_000_000) throw new Error("invalid terminal_write_file request"); return await proxy({ operation: "write", path: params.path, content: params.content }, signal); } });
  pi.registerTool({ name: "terminal_file_status", label: "Terminal File Status", description: "Request bounded metadata from the authenticated host Terminal broker.", parameters: objectSchema({ path: { type: "string" } }, ["path"]), async execute(_id, params, signal) { if (typeof params?.path !== "string") throw new Error("invalid terminal_file_status request"); return await proxy({ operation: "status", path: params.path }, signal); } });
  pi.registerTool({ name: "terminal_execute", label: "Terminal Execute", description: "Request bounded argv execution from the authenticated host Terminal broker.", parameters: objectSchema({ argv: { type: "array", minItems: 1, maxItems: 32, items: { type: "string", maxLength: 4096 } } }, ["argv"]), async execute(_id, params, signal) { if (!Array.isArray(params?.argv) || params.argv.length < 1 || params.argv.length > 32 || params.argv.some((item: unknown) => typeof item !== "string" || item.length > 4096)) throw new Error("invalid terminal_execute request"); return await proxy({ operation: "execute", argv: params.argv }, signal); } });
}

export default function (pi: PiLike): void { registerComputerTerminalTools(pi); }
