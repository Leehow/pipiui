import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { JSONLChunkScanner, projectToolResultMessageForParent } from "../../Sources/PipiUI/PiExt/subagent/rpc-stream.ts";

test("parent JSONL scanner handles multi-megabyte tool results in chunk-local passes and projects screenshots closed", async () => {
  const screenshot = "A".repeat(3 * 1024 * 1024);
  const event = {
    type: "tool_result_end",
    message: {
      role: "toolResult",
      toolName: "desktop_observe",
      isError: false,
      content: [
        { type: "text", text: JSON.stringify({ observationId: "safe-observation", element_token: "secret-token", x: 12, y: 34, status: "ok" }) },
        { type: "image", data: screenshot, mimeType: "image/png" },
      ],
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(event)}\n${JSON.stringify({ type: "tail", text: "跨块 UTF-8 正确" })}`, "utf8");
  const lines = [];
  const scanner = new JSONLChunkScanner((line) => lines.push(line));
  for (let offset = 0; offset < bytes.length; offset += 1024) scanner.push(bytes.subarray(offset, offset + 1024));
  scanner.end();
  assert.equal(lines.length, 2, "each complete line is processed exactly once, including the unterminated tail");
  assert.equal(JSON.parse(lines[1]).text, "跨块 UTF-8 正确");

  const projected = projectToolResultMessageForParent(JSON.parse(lines[0]).message);
  const serialized = JSON.stringify(projected);
  assert.match(serialized, /safe-observation/);
  assert.match(serialized, /screenshot omitted from parent result/);
  assert.doesNotMatch(serialized, /AAA{1024}|secret-token|element_token|"x":12|"y":34/);

  const source = await readFile(new URL("../../Sources/PipiUI/PiExt/subagent/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /buffer\s*\+=\s*data\.toString\(\)|buffer\.split\("\\n"\)/);
  assert.match(source, /new JSONLChunkScanner\(processLine\)/);
  assert.match(source, /projectToolResultMessageForParent\(event\.message\)/);
});

test("parent tool-result projection preserves final text and tool errors while dropping binary and coordinates", () => {
  const projected = projectToolResultMessageForParent({
    role: "toolResult",
    toolName: "desktop_act",
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ outcome: "failed", error: "closed tool error", bounds: { x: 1, y: 2 }, value: "kept" }) }],
  });
  assert.equal(projected.isError, true);
  assert.deepEqual(JSON.parse(projected.content[0].text), { outcome: "failed", error: "closed tool error", value: "kept" });
});
