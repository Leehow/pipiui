import readline from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.FAKE_AGENT_AGING_STATE_FILE;
const sessionPath = process.env.FAKE_AGENT_AGING_SESSION_FILE;
if (!statePath) throw new Error("FAKE_AGENT_AGING_STATE_FILE is required");

const OLD_CONTEXT_TOKENS = 90_000;
const COMPACTED_CONTEXT_TOKENS = 8_000;
const OLD_CONTEXT_STEP = 192;
const COMPACTED_CONTEXT_STEP = 24;
const REQUEST_OVERHEAD_TOKENS = 256;
const REQUEST_OVERHEAD_BYTES = 64;
const CONTEXT_WINDOW = 262_144;

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

function defaultState() {
  return {
    version: 1,
    contextMode: "old",
    compacted: false,
    turns: 0,
    contextTokens: OLD_CONTEXT_TOKENS,
    requestTokens: OLD_CONTEXT_TOKENS + REQUEST_OVERHEAD_TOKENS,
    requestBytes: (OLD_CONTEXT_TOKENS + REQUEST_OVERHEAD_TOKENS) * 4 + REQUEST_OVERHEAD_BYTES,
  };
}

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (parsed && typeof parsed === "object") return { ...defaultState(), ...parsed };
  } catch {
    // The harness creates this file before spawning Pi. Keep a safe local
    // fallback so an incomplete fixture fails as a normal fake-provider run.
  }
  return defaultState();
}

function writeState(state) {
  writeFileSync(statePath, `${JSON.stringify(state)}\n`, "utf8");
}

function response(command, success = true, data, error) {
  send({
    id: command.id,
    type: "response",
    command: command.type,
    success,
    ...(success ? { data } : { error }),
  });
}

function compactPersistedSession() {
  if (!sessionPath) return;
  try {
    const rows = readFileSync(sessionPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return undefined; }
      })
      .filter(Boolean)
      .filter((row) => row.type === "session" || row.type === "session_info" || row.type === "model_change");
    rows.push({
      type: "pipiui_agent_aging_context",
      id: "aging-compacted-context",
      timestamp: new Date().toISOString(),
      contextMode: "compacted",
      contextTokens: COMPACTED_CONTEXT_TOKENS,
      requestTokens: COMPACTED_CONTEXT_TOKENS + REQUEST_OVERHEAD_TOKENS,
    });
    writeFileSync(sessionPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  } catch {
    // Session rewriting is only a fixture aid. The persisted state file remains
    // authoritative for this fake provider's active request measurement.
  }
}

function compact() {
  const state = readState();
  const next = {
    ...state,
    contextMode: "compacted",
    compacted: true,
    contextTokens: COMPACTED_CONTEXT_TOKENS,
    requestTokens: COMPACTED_CONTEXT_TOKENS + REQUEST_OVERHEAD_TOKENS,
    requestBytes: (COMPACTED_CONTEXT_TOKENS + REQUEST_OVERHEAD_TOKENS) * 4 + REQUEST_OVERHEAD_BYTES,
  };
  writeState(next);
  compactPersistedSession();
}

function promptTurn(message) {
  const state = readState();
  const compacted = state.contextMode === "compacted" || state.compacted === true;
  const contextTokens = Number(state.contextTokens) + (compacted ? COMPACTED_CONTEXT_STEP : OLD_CONTEXT_STEP);
  const requestTokens = contextTokens + REQUEST_OVERHEAD_TOKENS;
  const next = {
    ...state,
    contextMode: compacted ? "compacted" : "old",
    compacted,
    turns: Number(state.turns) + 1,
    contextTokens,
    requestTokens,
    requestBytes: requestTokens * 4 + REQUEST_OVERHEAD_BYTES,
    promptBytes: Buffer.byteLength(String(message ?? ""), "utf8"),
  };
  writeState(next);
  return next;
}

function emitTurn(state) {
  send({ type: "agent_start" });
  send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "aging-think" } });
  send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "aging-answer" } });
  send({ type: "tool_execution_start", toolCallId: "aging-tool", toolName: "fake_read", args: { fixture: true } });
  send({ type: "tool_execution_end", toolCallId: "aging-tool", result: { content: [{ type: "text", text: "ok" }] }, isError: false });
  send({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "aging-answer" }],
      usage: {
        input: state.requestTokens,
        output: 32,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: state.requestTokens + 32,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  });
  send({ type: "agent_settled" });
}

const activeModel = { provider: "aging-fake", id: "aging-model", name: "Aging fake model", reasoning: true };
let activeThinkingLevel = "off";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (!command || typeof command !== "object") return;

  if (command.type === "get_available_models") {
    response(command, true, { models: [activeModel] });
    return;
  }
  if (command.type === "get_state") {
    response(command, true, { model: activeModel, thinkingLevel: activeThinkingLevel });
    return;
  }
  if (command.type === "get_available_thinking_levels") {
    response(command, true, { levels: ["off", "medium", "high"] });
    return;
  }
  if (command.type === "get_session_stats") {
    const state = readState();
    const percent = Math.min(100, (state.contextTokens / CONTEXT_WINDOW) * 100);
    response(command, true, {
      sessionFile: sessionPath ?? "aging-session.jsonl",
      sessionId: "aging-session",
      userMessages: state.turns,
      assistantMessages: state.turns,
      toolCalls: state.turns,
      toolResults: state.turns,
      totalMessages: state.turns * 2,
      tokens: {
        input: state.turns * state.requestTokens,
        output: state.turns * 32,
        cacheRead: 0,
        cacheWrite: 0,
        total: state.turns * (state.requestTokens + 32),
      },
      cost: 0,
      contextUsage: {
        tokens: state.contextTokens,
        contextWindow: CONTEXT_WINDOW,
        percent,
        // These two fields are deliberately fake-provider-only diagnostics.
        // The host ignores them; the harness reads the persisted fixture state.
        requestTokens: state.requestTokens,
        requestBytes: state.requestBytes,
      },
    });
    return;
  }
  if (command.type === "compact") {
    send({ type: "compaction_start", reason: "manual" });
    compact();
    send({
      type: "compaction_end",
      reason: "manual",
      aborted: false,
      willRetry: false,
      result: {
        summary: "aging summary",
        firstKeptEntryId: "aging-compacted-context",
        tokensBefore: OLD_CONTEXT_TOKENS,
        estimatedTokensAfter: COMPACTED_CONTEXT_TOKENS,
      },
    });
    response(command, true, { summary: "aging summary" });
    return;
  }
  if (command.type === "set_model") {
    response(command, true, activeModel);
    return;
  }
  if (command.type === "set_thinking_level") {
    activeThinkingLevel = command.level;
    response(command, true);
    return;
  }
  if (command.type === "set_session_name") {
    response(command, true);
    return;
  }
  if (command.type === "prompt") {
    const state = promptTurn(command.message);
    response(command, true);
    // Keep the provider response after the RPC acknowledgement. This gives the
    // production telemetry seam a real dispatch-accepted → first-stream order.
    setTimeout(() => emitTurn(state), 1);
    return;
  }
  if (command.type === "steer" || command.type === "follow_up" || command.type === "abort") {
    response(command, true);
    return;
  }
  response(command, true, {});
});
