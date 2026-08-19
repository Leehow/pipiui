import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  PADDLEOCR_MCP_ARGS,
  PADDLEOCR_MCP_COMMAND,
  PADDLEOCR_VL_TOOL,
  callPaddleocrVl,
  extractMcpText,
  paddleocrMcpEnv,
} from "../../../resources/runtime/extensions/paddleocr-mcp-client.ts";

function parseNewlineJson(raw: string): Array<Record<string, unknown>> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function line(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`;
}

describe("paddleocr newline-delimited MCP client", () => {
  it("spawns uvx paddleocr_mcp, writes NDJSON initialize/initialized/paddleocr_vl, token only in env", async () => {
    const written: string[] = [];
    const spawnCalls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const result = await callPaddleocrVl({
      filePath: "/tmp/scan.pdf",
      token: "ast-secret-token",
      spawnFn: (command, args, options) => {
        spawnCalls.push({ command, args, env: (options.env ?? {}) as NodeJS.ProcessEnv });
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const child = Object.assign(new EventEmitter(), {
          stdin,
          stdout,
          stderr,
          exitCode: null as number | null,
          signalCode: null,
          kill() {
            this.exitCode = 0;
            this.emit("close");
          },
        });
        stdin.on("data", (chunk: Buffer | string) => {
          written.push(String(chunk));
          const messages = parseNewlineJson(written.join(""));
          const last = messages.at(-1);
          if (!last) return;
          if (last.method === "initialize") {
            stdout.write(line({ jsonrpc: "2.0", id: last.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "paddleocr" } } }));
          }
          if (last.method === "tools/call") {
            expect(last.params).toMatchObject({ name: PADDLEOCR_VL_TOOL });
            const argsObj = (last.params as { arguments?: Record<string, unknown> }).arguments;
            expect(argsObj?.file_path ?? argsObj?.file).toBe("/tmp/scan.pdf");
            stdout.write("noise before\n");
            stdout.write(line({
              jsonrpc: "2.0",
              id: last.id,
              result: { content: [{ type: "text", text: "recognized page" }] },
            }));
          }
        });
        return child as never;
      },
    });
    expect(result).toEqual({ ok: true, text: "recognized page" });
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.command).toBe(PADDLEOCR_MCP_COMMAND);
    expect(spawnCalls[0]?.args).toEqual([...PADDLEOCR_MCP_ARGS]);
    expect(spawnCalls[0]?.env.PADDLEOCR_MCP_MODEL).toBe("PaddleOCR-VL-1.6");
    expect(spawnCalls[0]?.env.PADDLEOCR_MCP_PPOCR_SOURCE).toBe("aistudio");
    expect(spawnCalls[0]?.env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN).toBe("ast-secret-token");

    const wire = written.join("");
    expect(wire).not.toMatch(/Content-Length/i);
    expect(wire).not.toContain("ast-secret-token");
    const methods = parseNewlineJson(wire).map((msg) => msg.method);
    expect(methods).toContain("initialize");
    expect(methods).toContain("notifications/initialized");
    expect(methods).toContain("tools/call");
    expect(JSON.stringify(result)).not.toContain("ast-secret-token");
    expect(extractMcpText({ content: [{ type: "text", text: "x" }] })).toBe("x");
  });

  it("redacts the token from MCP errors and omits token from env when unset", async () => {
    expect(paddleocrMcpEnv()).not.toHaveProperty("PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN");
    const failed = await callPaddleocrVl({
      filePath: "/tmp/scan.pdf",
      token: "ast-leak-me",
      spawnFn: () => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const child = Object.assign(new EventEmitter(), {
          stdin,
          stdout,
          stderr: new PassThrough(),
          exitCode: null,
          signalCode: null,
          kill() {
            this.emit("close");
          },
        });
        stdin.on("data", () => {
          stdout.write(line({ jsonrpc: "2.0", id: 1, error: { message: "unauthorized ast-leak-me" } }));
        });
        return child as never;
      },
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toContain("[redacted]");
      expect(failed.error).not.toContain("ast-leak-me");
    }
  });
});
