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
} from "../agent/paddleocr-mcp-client.ts";

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

function fakeChild(onStdinData?: (written: string[], stdout: PassThrough) => void) {
  const written: string[] = [];
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.on("data", (chunk: Buffer | string) => {
    written.push(String(chunk));
    onStdinData?.(written, stdout);
  });
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null,
    kill() {
      this.exitCode = 0;
      this.emit("close");
    },
  });
  return { child, written };
}

describe("paddleocr newline-delimited MCP client", () => {
  it("spawns uvx paddleocr_mcp, writes NDJSON initialize/initialized/paddleocr_vl, token only in env", async () => {
    let captured: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const result = await callPaddleocrVl({
      filePath: "/tmp/scan.pdf",
      token: "ast-secret-token",
      spawnFn: (command, args, options) => {
        captured.push({ command, args, env: (options.env ?? {}) as NodeJS.ProcessEnv });
        const { child, written } = fakeChild((messages, stdout) => {
          const last = parseNewlineJson(messages.join("")).at(-1);
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
    expect(captured).toHaveLength(1);
    expect(captured[0]?.command).toBe(PADDLEOCR_MCP_COMMAND);
    expect(captured[0]?.args).toEqual([...PADDLEOCR_MCP_ARGS]);
    expect(captured[0]?.env.PADDLEOCR_MCP_MODEL).toBe("PaddleOCR-VL-1.6");
    expect(captured[0]?.env.PADDLEOCR_MCP_PPOCR_SOURCE).toBe("aistudio");
    expect(captured[0]?.env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN).toBe("ast-secret-token");

    // Spawn-time env contract checked again through the standalone helper:
    // the token lives ONLY in the child env, never on the wire or in results.
    expect(paddleocrMcpEnv("t2").PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN).toBe("t2");
  });

  it("keeps the secret off the wire and out of results", async () => {
    let wire = "";
    const result = await callPaddleocrVl({
      filePath: "/tmp/scan.pdf",
      token: "ast-wire-secret",
      spawnFn: (() => {
        const { child, written } = fakeChild((messages, stdout) => {
          const last = parseNewlineJson(messages.join("")).at(-1);
          if (!last) return;
          if (last.method === "initialize") {
            stdout.write(line({ jsonrpc: "2.0", id: last.id, result: {} }));
          }
          if (last.method === "tools/call") {
            wire = messages.join("");
            stdout.write(line({ jsonrpc: "2.0", id: last.id, result: { content: [{ type: "resource", resource: { text: "ok" } }] } }));
          }
        });
        return child as never;
      }) as never,
    });
    expect(result).toEqual({ ok: true, text: "ok" });
    expect(wire).not.toContain("ast-wire-secret");
    expect(wire).not.toMatch(/Content-Length/i);
    const methods = parseNewlineJson(wire).map((msg) => msg.method);
    expect(methods).toContain("initialize");
    expect(methods).toContain("notifications/initialized");
    expect(methods).toContain("tools/call");
    expect(extractMcpText({ content: [{ type: "text", text: "x" }] })).toBe("x");
  });

  it("redacts the token from MCP errors and omits token from env when unset", async () => {
    expect(paddleocrMcpEnv()).not.toHaveProperty("PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN");
    const failed = await callPaddleocrVl({
      filePath: "/tmp/scan.pdf",
      token: "ast-leak-me",
      spawnFn: () => {
        const { child } = fakeChild((messages, stdout) => {
          const last = parseNewlineJson(messages.join("")).at(-1);
          if (last?.method === "initialize") {
            stdout.write(line({ jsonrpc: "2.0", id: last.id, error: { message: "unauthorized ast-leak-me" } }));
          }
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
