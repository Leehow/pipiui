import readline from "node:readline";

const send = value => process.stdout.write(JSON.stringify(value) + "\n");
let prompted = false;
let omitUsage = false;
let failStats = false;
let heldTurn = false;
/** Context occupancy the next get_session_stats reports; drives proactive compaction. */
let contextTokens = null;
let failCompact = false;
let slowCompact = false;
let activeModel = { provider: "fake", id: "fake-1", name: "Fake", reasoning: true };
let activeThinkingLevel = "medium";

function response(command, id, success, data, error) {
  send({ id, type: "response", command, success, ...(success ? { data } : { error }) });
}

function emitTurn(message, images) {
  if (images) {
    send({ type: "agent_event", event: { kind: "log", agentId: "agent-images", name: "capture", items: [{ itemType: "text", text: "IMAGES=" + JSON.stringify(images) }] } });
  }
  send({ type: "agent_event", event: { kind: "start", agentId: "agent-1", runId: "run-1", parentId: null, name: "builder", role: "general-purpose", title: "Build fixture", task: "implement fixture", depth: 1, at: "2026-08-10T00:00:02.000Z", worktreePath: "/tmp/fake-worktree", worktreeBranch: "pipiui/fake", worktreeLifecycle: "active" } });
  send({ type: "agent_event", event: { kind: "end", agentId: "agent-1", runId: "run-1", ok: true, worktreePath: "/tmp/fake-worktree", worktreeBranch: "pipiui/fake", worktreeLifecycle: "pendingReview" } });
  send({ type: "agent_start" });
  send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "think" } });
  send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" } });
  send({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: "{\"command\":\"ls -la\"}" } });
  send({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { id: "tool-1", name: "fake_tool" } } });
  send({ type: "tool_execution_end", toolCallId: "tool-1", result: { content: [{ type: "text", text: "ok" }] }, isError: false });
  if (message === "__segments__") {
    // A second assistant message restarts contentIndex at 0 — the host must tag
    // its thinking with a fresh segment so the UI keeps the blocks apart.
    send({ type: "message_end" });
    send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "reflect" } });
  }
  if (message !== "__hold__") send({ type: "agent_settled" });
  else heldTurn = true;
}

readline.createInterface({ input: process.stdin }).on("line", line => {
  const command = JSON.parse(line);
  const ok = data => response(command.type, command.id, true, data);
  if (command.type === "get_available_models") return ok({ models: [{ provider: "fake", id: "fake-1", name: "Fake", reasoning: true }] });
  if (command.type === "get_state") return ok({ model: activeModel, thinkingLevel: activeThinkingLevel });
  if (command.type === "get_available_thinking_levels") return ok({ levels: ["off", "medium", "high"] });
  if (command.type === "get_session_stats") {
    if (failStats) return response(command.type, command.id, false, undefined, "stats unavailable");
    return ok({
      sessionFile: "/tmp/fake-session.jsonl",
      sessionId: "session-1",
      userMessages: prompted ? 2 : 0,
      assistantMessages: prompted ? 1 : 0,
      toolCalls: prompted ? 1 : 0,
      toolResults: prompted ? 1 : 0,
      totalMessages: prompted ? 5 : 1,
      tokens: { input: prompted ? 1200 : 0, output: prompted ? 340 : 0, cacheRead: prompted ? 800 : 0, cacheWrite: prompted ? 100 : 0, total: prompted ? 2440 : 0 },
      cost: prompted ? 0.00123 : 0,
      contextUsage: omitUsage ? undefined : { tokens: contextTokens ?? (prompted ? 15000 : 0), contextWindow: 262144, percent: prompted ? 5.7 : 0 },
    });
  }
  if (command.type === "compact") {
    if (failCompact) return response(command.type, command.id, false, undefined, "Nothing to compact (session too small)");
    send({ type: "compaction_start", reason: "manual" });
    contextTokens = 12000;
    const finish = () => {
      send({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, result: { summary: "…", firstKeptEntryId: "entry-1", tokensBefore: 240000, estimatedTokensAfter: 12000 } });
      ok({ summary: "…" });
    };
    if (slowCompact) setTimeout(finish, 120);
    else finish();
    return;
  }
  if (command.type === "prompt") {
    if (command.message === "__queue_fail__") return response(command.type, command.id, false, undefined, "queue dispatch failed");
    prompted = true;
    if (command.message === "no-usage") omitUsage = true;
    if (command.message === "fail-stats") failStats = true;
    // Park the session above the 80% high watermark so the host's idle-time
    // compaction has something to react to.
    if (command.message === "fill-context") contextTokens = 240000;
    if (command.message === "fill-context-no-compact") { contextTokens = 240000; failCompact = true }
    if (command.message === "fill-context-slow") { contextTokens = 240000; slowCompact = true }
    ok();
    if (command.message === "__user_followup__") {
      send({
        type: "message_end",
        message: {
          id: "u-done",
          role: "user",
          content: [{ type: "text", text: "[subagent-done] agentId=a1 name=explore ok=true" }],
        },
      });
      send({ type: "agent_start" });
      return;
    }
    if (command.message === "__fail_turn__") {
      // Provider failure: the assistant message ends with stopReason "error",
      // an errorMessage, and no content — the host must forward it to the UI.
      send({
        type: "message_end",
        message: {
          id: "fail-1",
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "Codex error: Invalid schema for function 'subagent': ...",
        },
      });
      send({ type: "agent_settled" });
      return;
    }
    emitTurn(command.message, command.images);
    if (command.message === "__late_queue_update__") send({ type: "queue_update", followUp: [] });
    return;
  }
  if (command.type === "steer") {
    if (command.message === "__steer_fail__") return response(command.type, command.id, false, undefined, "steer rejected");
    ok();
    return;
  }
  if (command.type === "follow_up") {
    ok();
    send({ type: "queue_update", followUp: [command.message] });
    return;
  }
  if (command.type === "abort") {
    heldTurn = false;
    ok();
    send({ type: "agent_settled" });
    return;
  }
  if (command.type === "set_model") {
    activeModel = { provider: command.provider, id: command.modelId, name: command.modelId, reasoning: true };
    return ok(activeModel);
  }
  if (command.type === "set_thinking_level") {
    activeThinkingLevel = command.level;
    return ok();
  }
  ok({});
});
