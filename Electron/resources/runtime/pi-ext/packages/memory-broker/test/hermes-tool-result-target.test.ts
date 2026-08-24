import test from "node:test";
import assert from "node:assert/strict";
import { rewriteHermesProjectMemoryToolResult } from "../src/hermes-tool-result-target.ts";

test("project memory result retains its logical target in details and serialized JSON", () => {
  const event = {
    type: "tool_result",
    toolName: "memory_add",
    toolCallId: "memory-call-1",
    input: { target: "project", content: "repo convention" },
    content: [{
      type: "text",
      text: JSON.stringify({
        success: false,
        error: "Retry after you consolidate 'memory' manually first.",
        target: "memory",
        note: "ordinary memory prose stays unchanged",
      }),
    }],
    details: {
      success: false,
      error: "Retry after you consolidate 'memory' manually first.",
      target: "memory",
      note: "ordinary memory prose stays unchanged",
    },
    isError: false,
  };

  const patch = rewriteHermesProjectMemoryToolResult(event);
  assert.deepEqual(patch?.details, {
    success: false,
    error: "Retry after you consolidate 'project' manually first.",
    target: "project",
    note: "ordinary memory prose stays unchanged",
  });
  assert.deepEqual(JSON.parse((patch?.content?.[0] as { text: string }).text), patch?.details);
});

test("global memory results and arbitrary text are not rewritten", () => {
  assert.equal(rewriteHermesProjectMemoryToolResult({
    type: "tool_result",
    toolName: "memory_add",
    toolCallId: "memory-call-2",
    input: { target: "memory", content: "global convention" },
    content: [{ type: "text", text: JSON.stringify({ success: false, target: "memory" }) }],
    details: { success: false, target: "memory" },
    isError: false,
  }), undefined);

  assert.equal(rewriteHermesProjectMemoryToolResult({
    type: "tool_result",
    toolName: "memory_add",
    toolCallId: "memory-call-3",
    input: { target: "project", content: "repo convention" },
    content: [{ type: "text", text: "Please consolidate 'memory'; this is arbitrary prose." }],
    details: undefined,
    isError: false,
  }), undefined);
});
