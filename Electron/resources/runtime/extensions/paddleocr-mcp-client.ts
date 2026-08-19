import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";

export const PADDLEOCR_VL_TOOL = "paddleocr_vl";
export const PADDLEOCR_MCP_COMMAND = "uvx";
export const PADDLEOCR_MCP_ARGS = ["--from", "paddleocr-mcp", "paddleocr_mcp"];
export const PADDLEOCR_MCP_MODEL = "PaddleOCR-VL-1.6";
export const PADDLEOCR_MCP_SOURCE = "aistudio";

const INIT_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 180_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;

export type PaddleocrSpawnFn = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => ChildProcessWithoutNullStreams;

export function paddleocrMcpEnv(token?: string, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...parent,
    PADDLEOCR_MCP_MODEL,
    PADDLEOCR_MCP_PPOCR_SOURCE: PADDLEOCR_MCP_SOURCE,
    PATH: parent.PATH ?? process.env.PATH ?? "",
    HOME: parent.HOME ?? process.env.HOME ?? homedir(),
  };
  if (token) env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN = token;
  else delete env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN;
  return env;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function extractMcpText(result: unknown): string {
  const object = asObject(result);
  const content = object?.content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        const rec = asObject(item);
        if (!rec) return "";
        if (typeof rec.text === "string") return rec.text;
        if (rec.type === "resource" && asObject(rec.resource)?.text) return String(asObject(rec.resource)!.text);
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof object?.markdown === "string") return object.markdown.trim();
  if (typeof result === "string") return result.trim();
  return "";
}

export function redactSecret(text: string, secret?: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

/** Official MCP stdio for this server: one JSON-RPC object per newline, not Content-Length. */
class NewlineStdioMcpClient {
  private buffer = "";
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding?.("utf8");
    child.stderr.setEncoding?.("utf8");
    child.stdout.on("data", (chunk: Buffer | string) => this.onStdout(String(chunk)));
    child.stderr.on("data", () => {
      // Diagnostics only — never treat as protocol, never log secrets.
    });
    child.stdout.on("error", () => this.failAll(new Error("stdio read error")));
    child.stdin.on("error", () => this.failAll(new Error("stdio write error")));
    child.on("error", (err) => this.failAll(err instanceof Error ? err : new Error(String(err))));
    child.on("close", () => this.failAll(new Error("mcp process closed")));
  }

  static spawn(token: string, spawnFn: PaddleocrSpawnFn = spawn as PaddleocrSpawnFn, parentEnv?: NodeJS.ProcessEnv): NewlineStdioMcpClient {
    const child = spawnFn(PADDLEOCR_MCP_COMMAND, [...PADDLEOCR_MCP_ARGS], {
      env: paddleocrMcpEnv(token, parentEnv ?? process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new NewlineStdioMcpClient(child);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line.trim()) continue;
      try {
        this.dispatch(JSON.parse(line));
      } catch {
        // ignore malformed lines (partial logs mixed on stdout)
      }
    }
  }

  private dispatch(msg: { id?: unknown; error?: { message?: string }; result?: unknown }): void {
    if (msg.id === undefined || msg.id === null) return;
    const pending = this.pending.get(Number(msg.id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(Number(msg.id));
    if (msg.error) pending.reject(new Error(msg.error.message ?? "jsonrpc error"));
    else pending.resolve(msg.result);
  }

  private failAll(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private write(payload: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("mcp closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params: params ?? {} });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return;
    try {
      this.write({ jsonrpc: "2.0", method, params: params ?? {} });
    } catch {
      // ignore
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("mcp closed"));
    }
    this.pending.clear();
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    const killer = setTimeout(() => {
      try {
        if (this.child.exitCode === null) this.child.kill();
      } catch {
        // ignore
      }
    }, SHUTDOWN_TIMEOUT_MS);
    killer.unref?.();
  }
}

export async function callPaddleocrVl(options: {
  filePath: string;
  token: string;
  spawnFn?: PaddleocrSpawnFn;
  env?: NodeJS.ProcessEnv;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const client = NewlineStdioMcpClient.spawn(options.token, options.spawnFn ?? (spawn as PaddleocrSpawnFn), options.env);
  try {
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pipiui-paddleocr", version: "1.0.0" },
    }, INIT_TIMEOUT_MS);
    client.notify("notifications/initialized", {});
    const result = await client.request("tools/call", {
      name: PADDLEOCR_VL_TOOL,
      arguments: { file: options.filePath, file_path: options.filePath, input: options.filePath },
    }, CALL_TIMEOUT_MS);
    const text = extractMcpText(result);
    if (!text) return { ok: false, error: "PaddleOCR 未返回可用正文" };
    return { ok: true, text };
  } catch (error) {
    const raw = `PaddleOCR MCP 调用失败：${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, error: redactSecret(raw, options.token) };
  } finally {
    client.close();
  }
}
