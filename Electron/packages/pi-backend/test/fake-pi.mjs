import readline from "node:readline";
import { appendFileSync } from "node:fs";

const send = value => process.stdout.write(JSON.stringify(value) + "\n");
/** Tests pass FAKE_PI_PROMPT_LOG to assert which prompt commands reached the child. */
const promptLogPath = process.env.FAKE_PI_PROMPT_LOG ?? "";
function logPrompt(message) {
  if (!promptLogPath) return;
  try { appendFileSync(promptLogPath, message + "\n"); } catch {}
}
let prompted = false;
/** When set, later emitTurn cycles must not end the long-running background agent. */
let durableAgent = false;
let omitUsage = false;
let failStats = false;
let heldTurn = false;
/** Abort acks but does not settle — reproduces a stuck cut-in / sending item. */
let silentAbort = false;
/** Delay abort RPC ack so host stop must not wait on it. */
let slowAbort = false;
/** Context occupancy the next get_session_stats reports; drives proactive compaction. */
let contextTokens = null;
let failCompact = false;
let slowCompact = false;
/** Real Pi rejects `prompt` while `_compactionAbortController` is set. */
let compacting = false;
let activeModel = { provider: "fake", id: "fake-1", name: "Fake", reasoning: true };
let activeThinkingLevel = "medium";

function response(command, id, success, data, error) {
  send({ id, type: "response", command, success, ...(success ? { data } : { error }) });
}

function emitTurn(message, images) {
  if (images) {
    send({ type: "agent_event", event: { kind: "log", agentId: "agent-images", name: "capture", items: [{ itemType: "text", text: "IMAGES=" + JSON.stringify(images) }] } });
  }
  if (!durableAgent) {
    send({ type: "agent_event", event: { kind: "start", agentId: "agent-1", runId: "run-1", parentId: null, name: "builder", role: "general-purpose", title: "Build fixture", task: "implement fixture", depth: 1, at: "2026-08-10T00:00:02.000Z", worktreePath: "/tmp/fake-worktree", worktreeBranch: "pipiui/fake", worktreeLifecycle: "active" } });
    send({ type: "agent_event", event: { kind: "end", agentId: "agent-1", runId: "run-1", ok: true, worktreePath: "/tmp/fake-worktree", worktreeBranch: "pipiui/fake", worktreeLifecycle: "pendingReview" } });
  }
  send({ type: "agent_start" });
  send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "think" } });
  send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" } });
  send({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: "{\"command\":\"ls -la\"}" } });
  send({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { id: "tool-1", name: "fake_tool" } } });
  send({ type: "tool_execution_end", toolCallId: "tool-1", result: { content: [{ type: "text", text: "ok" }] }, isError: false });
  if (message === "ledger-usage") {
    send({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "ledger response" }],
        api: "fake",
        provider: "fake",
        model: "fake-1",
        usage: {
          input: 1200,
          output: 340,
          cacheRead: 800,
          cacheWrite: 100,
          totalTokens: 2440,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.00123 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    });
  }
  if (message === "__segments__") {
    // A second assistant message restarts contentIndex at 0 — the host must tag
    // its thinking with a fresh segment so the UI keeps the blocks apart.
    send({ type: "message_end" });
    send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "reflect" } });
  }
  if (message !== "__hold__" && message !== "__hold_stuck__") send({ type: "agent_settled" });
  else {
    heldTurn = true;
    silentAbort = message === "__hold_stuck__";
  }
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
    compacting = true;
    send({ type: "compaction_start", reason: "manual" });
    contextTokens = 12000;
    const finish = () => {
      compacting = false;
      send({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, result: { summary: "…", firstKeptEntryId: "entry-1", tokensBefore: 240000, estimatedTokensAfter: 12000 } });
      ok({ summary: "…" });
    };
    if (slowCompact) setTimeout(finish, 120);
    else finish();
    return;
  }
  if (command.type === "prompt") {
    if (compacting) {
      return response(command.type, command.id, false, undefined, "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.");
    }
    if (command.message === "__release_hold__") {
      // Ends a parked __hold__ turn without abort: settles so the host can
      // drain the queue into real follow-up turns.
      heldTurn = false;
      ok();
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__no_ack__") return;
    if (command.message === "__queue_fail__") return response(command.type, command.id, false, undefined, "queue dispatch failed");
    if (heldTurn && !command.streamingBehavior) {
      return response(command.type, command.id, false, undefined, "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.");
    }
    if (command.message === "__slow_abort__") slowAbort = true;
    prompted = true;
    if (command.message === "no-usage") omitUsage = true;
    if (command.message === "fail-stats") failStats = true;
    // Park the session above the 80% high watermark so the host's idle-time
    // compaction has something to react to.
    if (command.message === "fill-context") contextTokens = 240000;
    if (command.message === "fill-context-no-compact") { contextTokens = 240000; failCompact = true }
    if (command.message === "fill-context-slow") { contextTokens = 240000; slowCompact = true }
    // Refuse the next compact RPC only, keeping context low so the scheduler
    // stays quiet — isolates a failed MANUAL compact from scheduler activity.
    if (command.message === "__fail_compact_once__") failCompact = true;
    // Re-arm compaction and park high again after a refused compact.
    if (command.message === "__allow_compact__") { failCompact = false; contextTokens = 240000 }
    ok();
    logPrompt(command.message);
    if (command.message === "__agent_running__" || command.message === "__hold_agent_running__") {
      // A background subagent starts and never ends. `__hold_agent_running__`
      // also parks the Boss turn so cut-in must abort it without sweeping.
      // 200000/262144 ≈ 76%: meets the 200k proactive floor but stays below
      // this suite's 80% ordinary watermark, so only the wait-for-subagents
      // path can arm (when a test injects a lower waitWatermark).
      contextTokens = 200000;
      durableAgent = true;
      send({ type: "agent_event", event: { kind: "start", agentId: "agent-1", runId: "run-1", parentId: null, name: "builder", role: "general-purpose", title: "Sweep fixture", task: "long task", depth: 1, at: new Date().toISOString() } });
      send({ type: "agent_start" });
      if (command.message === "__hold_agent_running__") heldTurn = true;
      else send({ type: "agent_settled" });
      return;
    }
    if (command.message === "/subagent_abort_all") {
      // The runtime extension aborts every worker; simulate its terminal events.
      durableAgent = false;
      send({ type: "agent_event", event: { kind: "end", agentId: "agent-1", runId: "run-1", ok: false, aborted: true, at: new Date().toISOString() } });
      return;
    }
    if (command.message === "__user_followup__") {
      send({
        type: "message_end",
        message: {
          id: "u-done",
          role: "user",
          content: [{ type: "text", text: "[subagent-done] agentId=a1 name=explore ok=true" }],
        },
      });
      send({ type: "queue_update", followUp: ["[subagent-done] agentId=a1 name=explore ok=true"] });
      send({ type: "agent_start" });
      return;
    }
    if (command.message === "__custom_followup__") {
      send({
        type: "message_end",
        message: {
          id: "c-done",
          role: "custom",
          customType: "pipiui-subagent-complete-v1",
          display: false,
          content: "[subagent-done] agentId=a1 name=explore ok=true",
        },
      });
      send({ type: "queue_update", followUp: ["[subagent-done] agentId=a1 name=explore ok=true"] });
      send({ type: "agent_start" });
      return;
    }
    if (command.message === "__file_sources_end__") {
      send({ type: "agent_start" });
      send({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{
            type: "text",
            text: "Based on the upload. See [[1]](https://docs.example)",
            annotations: [
              { type: "file_citation", file_id: "file-secret", filename: "/secret/report.pdf" },
              { type: "url_citation", url: "https://docs.example", title: "Docs" },
            ],
          }],
          citations: [
            { type: "file_citation", fileId: "file-2", fileName: "C:\\Users\\haoli\\notes.md" },
          ],
          stopReason: "stop",
        },
      });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__hosted_search__") {
      send({ type: "agent_start" });
      send({
        type: "message_update",
        assistantMessageEvent: {
          type: "hosted_search",
          callId: "ws_live",
          kind: "web_search",
          phase: "searching",
          query: "pipiui",
          outputIndex: 1,
        },
      });
      send({
        type: "message_update",
        assistantMessageEvent: {
          type: "hosted_search",
          callId: "ws_live",
          kind: "web_search",
          phase: "completed",
          query: "pipiui",
          outputIndex: 1,
        },
      });
      send({
        type: "message_update",
        assistantMessageEvent: {
          type: "citations",
          citations: [{ url: "https://docs.example", title: "Docs", startIndex: 0, endIndex: 4, type: "url_citation" }],
        },
      });
      send({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 3,
          toolCall: { id: "read-1", name: "read", arguments: { path: "README.md" } },
        },
      });
      send({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "See [[1]](https://docs.example)" }],
          stopReason: "stop",
        },
      });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__tool_start_only__") {
      // Real Pi emits toolcall_start as soon as the first tool token arrives.
      // The host must surface a card then — waiting for toolcall_end is the
      // "freeze then dump a pile of tools" bug.
      send({ type: "agent_start" });
      send({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1 } });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__no_stream_text__") {
      // openai-codex-responses often omits text_delta and only persists the
      // conclusion on message_end. The host must flush that text live.
      send({ type: "agent_start" });
      send({
        type: "message_end",
        message: {
          id: "a-final",
          role: "assistant",
          content: [{ type: "thinking", thinking: "" }, { type: "text", text: "我把两条链路都梳理了一遍。" }],
          stopReason: "stop",
        },
      });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__silent_think__") {
      // kimi k3 silent thinking: not one thinking_delta streams, yet message_end
      // persists the full reasoning block — the host must surface it live.
      send({ type: "agent_start" });
      send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "hello" } });
      send({
        type: "message_end",
        message: {
          id: "silent-think-1",
          role: "assistant",
          content: [{ type: "thinking", thinking: "hidden reasoning", thinkingSignature: "sig" }, { type: "text", text: "hello" }],
          stopReason: "stop",
        },
      });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__partial_think__") {
      // Only the first thinking_delta made it through before the stream dropped;
      // the final block completes "think more" — message_end must backfill " more".
      send({ type: "agent_start" });
      send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "think" } });
      send({
        type: "message_end",
        message: {
          id: "partial-think-1",
          role: "assistant",
          content: [{ type: "thinking", thinking: "think more", thinkingSignature: "sig" }, { type: "text", text: "answer" }],
          stopReason: "stop",
        },
      });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__healthy_think__") {
      // Everything streamed and persisted intact — message_end must not duplicate it.
      send({ type: "agent_start" });
      send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "all good" } });
      send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "done" } });
      send({
        type: "message_end",
        message: {
          id: "healthy-think-1",
          role: "assistant",
          content: [{ type: "thinking", thinking: "all good", thinkingSignature: "sig" }, { type: "text", text: "done" }],
          stopReason: "stop",
        },
      });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__auto_retry__") {
      // Provider hiccup inside the turn: pi auto-retries with backoff, then
      // recovers. The host must forward auto_retry_start/end so the UI can
      // show the retrying wait instead of a silent gap.
      ok();
      send({ type: "agent_start" });
      send({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 50, errorMessage: "Codex error: transient 500" });
      setTimeout(() => {
        send({ type: "auto_retry_end", success: true, attempt: 1 });
        send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "recovered" } });
        send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "recovered" }], stopReason: "stop" } });
        send({ type: "agent_settled" });
      }, 80);
      return;
    }
    if (command.message === "__fail_turn__") {
      // Provider failure: the assistant message ends with stopReason "error",
      // an errorMessage, and no content. Real Pi can omit agent_settled here;
      // message_end itself must release the host turn instead of waiting for the watchdog.
      send({ type: "agent_start" });
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
      return;
    }
    if (command.message === "__compaction_end_only__") {
      // Orphan end: no matching start. Host must not invent an operationId.
      ok();
      send({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false });
      send({ type: "agent_start" });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__compaction_start_no_end__") {
      // Start without end, then settle; a late end must not pair-duplicate.
      ok();
      send({ type: "agent_start" });
      send({ type: "compaction_start", reason: "manual" });
      send({ type: "agent_settled" });
      send({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false });
      return;
    }
    if (command.message === "__overflow_compact__") {
      // pi's own provider-overflow recovery: compaction before the turn continues.
      ok();
      send({ type: "compaction_start", reason: "overflow" });
      send({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: true, result: { summary: "…", firstKeptEntryId: "entry-1", tokensBefore: 300000, estimatedTokensAfter: 12000 } });
      contextTokens = 12000;
      send({ type: "agent_start" });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__midturn_compact__") {
      // Mid-turn tool-loop guard: fires while the host has the turn marked busy.
      ok();
      send({ type: "agent_start" });
      send({ type: "compaction_start", reason: "threshold" });
      send({ type: "compaction_end", reason: "threshold", aborted: false, willRetry: false, result: { summary: "…", firstKeptEntryId: "entry-1", tokensBefore: 280000, estimatedTokensAfter: 12000 } });
      contextTokens = 12000;
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__threshold_preprompt__") {
      // pi's pre-prompt _checkCompaction: fires before any turn is busy.
      send({ type: "compaction_start", reason: "threshold" });
      send({ type: "compaction_end", reason: "threshold", aborted: false, willRetry: false, result: { summary: "…", firstKeptEntryId: "entry-1", tokensBefore: 260000, estimatedTokensAfter: 12000 } });
      contextTokens = 12000;
      ok();
      send({ type: "agent_start" });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__pi_self_compact__") {
      // pi-side compaction with reason "manual" that no host RPC initiated
      // (an extension calling session.compact()): classification may read only
      // a live intent, never one left behind by a failed RPC.
      send({ type: "compaction_start", reason: "manual" });
      send({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, result: { summary: "…", firstKeptEntryId: "entry-1", tokensBefore: 200000, estimatedTokensAfter: 12000 } });
      contextTokens = 12000;
      ok();
      send({ type: "agent_start" });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__fold_tool__") {
      // The real idle path: pi-ext's idle-fold timer queues a hidden nudge
      // custom message that triggers its own short turn; the model answers by
      // calling the context_manage tool, whose execution fingerprint is the
      // only fold signal the host sees.
      ok();
      send({ type: "agent_start" });
      send({ type: "message_end", message: { id: "nudge-1", role: "custom", customType: "pipiui-context-manage-nudge", display: false, content: "[context-manage-nudge] Context is above the idle-fold watermark." } });
      send({ type: "tool_execution_start", toolCallId: "fold-1", toolName: "context_manage", args: { action: "fold", ids: ["b-1"] } });
      send({ type: "tool_execution_end", toolCallId: "fold-1", result: { content: [{ type: "text", text: "folded 1 block(s): b-1" }], details: { status: "ok", foldedIds: ["b-1"], skipped: [], llm: false } }, isError: false });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__fold_tool_no_nudge__") {
      // Same tool and fingerprint, but inside a normal (non-nudge) turn: the
      // agent tidying context on its own — must classify auto_fold, never idle.
      ok();
      send({ type: "agent_start" });
      send({ type: "tool_execution_start", toolCallId: "fold-2", toolName: "context_manage", args: { action: "fold", ids: ["b-2"] } });
      send({ type: "tool_execution_end", toolCallId: "fold-2", result: { content: [{ type: "text", text: "folded 1 block(s): b-2" }], details: { status: "ok", foldedIds: ["b-2"], skipped: [], llm: false } }, isError: false });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__fold_other_tool__") {
      // A different tool returning the exact fold fingerprint: the details
      // shape alone must never surface as a fold.
      ok();
      send({ type: "agent_start" });
      send({ type: "tool_execution_start", toolCallId: "other-1", toolName: "bash", args: { command: "ls" } });
      send({ type: "tool_execution_end", toolCallId: "other-1", result: { content: [{ type: "text", text: "folded 1 block(s): b-1" }], details: { status: "ok", foldedIds: ["b-1"], skipped: [], llm: false } }, isError: false });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__fold_unpaired_end__") {
      // A fold-fingerprinted result with no tool_execution_start pairing: the
      // tool identity is unknown, so no fold may be claimed.
      ok();
      send({ type: "agent_start" });
      send({ type: "tool_execution_end", toolCallId: "ghost-1", result: { content: [{ type: "text", text: "folded 1 block(s): b-1" }], details: { status: "ok", foldedIds: ["b-1"], skipped: [], llm: false } }, isError: false });
      send({ type: "agent_settled" });
      return;
    }
    if (command.message === "__telemetry__") {
      // Deliberately spaced evidence for deterministic host timing tests. The
      // sensitive-looking values prove the telemetry recorder keeps only
      // counts/bytes/timestamps, never stream or tool payload bodies.
      send({ type: "agent_start" });
      setTimeout(() => send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "private reasoning body" } }), 5);
      setTimeout(() => send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "visible answer body" } }), 10);
      setTimeout(() => send({ type: "tool_execution_start", toolCallId: "telemetry-tool", toolName: "read", args: { path: "/private/document/path" } }), 13);
      setTimeout(() => send({ type: "tool_execution_end", toolCallId: "telemetry-tool", result: { content: [{ type: "text", text: "tool result secret body" }] }, isError: false }), 16);
      setTimeout(() => send({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "visible answer body" }],
          usage: { input: 120, output: 20 },
          stopReason: "stop",
        },
      }), 24);
      setTimeout(() => send({ type: "agent_settled" }), 28);
      return;
    }
    emitTurn(command.message, command.images);
    if (command.message === "__late_queue_update__") send({ type: "queue_update", followUp: [] });
    return;
  }
  if (command.type === "steer") {
    if (command.message === "__steer_fail__") return response(command.type, command.id, false, undefined, "steer rejected");
    if (typeof command.message === "string" && command.message.startsWith("__steer_echo__")) {
      // Real pi drains the steering queue into the run loop and persists the
      // injected text as a user message; echo it so the host can confirm delivery.
      ok();
      send({ type: "message_end", message: { id: "steer-echo", role: "user", content: [{ type: "text", text: command.message }] } });
      return;
    }
    ok();
    return;
  }
  if (command.type === "follow_up") {
    if (command.message === "__no_ack__") return;
    ok();
    send({ type: "queue_update", followUp: [command.message] });
    return;
  }
  if (command.type === "abort") {
    heldTurn = false;
    const finish = () => {
      ok();
      if (!silentAbort) send({ type: "agent_settled" });
      silentAbort = false;
      slowAbort = false;
    };
    if (slowAbort) setTimeout(finish, 200);
    else finish();
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
