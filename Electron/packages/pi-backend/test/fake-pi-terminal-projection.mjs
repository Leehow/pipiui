import readline from "node:readline";
import fs from "node:fs";

const send = value => process.stdout.write(JSON.stringify(value) + "\n");
let isStreaming = false;
let pendingMessageCount = 0;

function respond(command, data = {}) {
  send({ id: command.id, type: "response", command: command.type, success: true, data });
}

readline.createInterface({ input: process.stdin }).on("line", line => {
  const command = JSON.parse(line);
  if (command.type === "get_available_models") {
    respond(command, { models: [{ provider: "fake", id: "fake-1", name: "Fake", reasoning: true }] });
    return;
  }
  if (command.type === "get_available_thinking_levels") {
    respond(command, { levels: ["off", "medium"] });
    return;
  }
  if (command.type === "get_state") {
    respond(command, {
      model: { provider: "fake", id: "fake-1", name: "Fake", reasoning: true },
      thinkingLevel: "medium",
      isStreaming,
      pendingMessageCount,
    });
    return;
  }
  if (command.type === "get_session_stats") {
    respond(command, { contextUsage: { tokens: 1, contextWindow: 100, percent: 1 } });
    return;
  }
  if (command.type === "prompt") {
    respond(command);
    isStreaming = true;
    send({ type: "agent_start" });
    if (command.message === "delayed-durable-terminal-agent-replay" || command.message === "terminal-rows-with-orphan-previews") {
      send({ type: "agent_event", event: {
        kind: "start", agentId: "root", runId: "root-run", parentId: null,
        name: "computer-use-leader", role: "computer-use-leader", title: "Run GUI task",
        task: "Run GUI task", depth: 1, at: "2026-08-17T00:00:01.000Z",
      } });
      send({ type: "agent_event", event: {
        kind: "end", agentId: "root", runId: "root-run", ok: false,
        at: "2026-08-17T00:00:02.000Z",
      } });
      send({ type: "agent_event", event: {
        kind: "start", agentId: "operator", runId: "operator-run", parentId: "root",
        name: "operator", role: "operator", title: "Operate GUI",
        task: "Operate GUI", depth: 2, at: "2026-08-17T00:00:03.000Z",
      } });
      send({ type: "agent_event", event: {
        kind: "end", agentId: "operator", runId: "operator-run", ok: true,
        output: JSON.stringify({ outcome: "completed", summary: "done" }),
        at: "2026-08-17T00:00:04.000Z",
      } });
      if (command.message === "terminal-rows-with-orphan-previews") {
        send({ type: "agent_event", event: {
          kind: "log_delta", agentId: "root", runId: "root-run",
          contentIndex: 0, itemType: "thinking", text: "late exact-run preview",
        } });
        send({ type: "agent_event", event: {
          kind: "log_delta", agentId: "root", runId: "orphan-root-preview",
          contentIndex: 0, itemType: "thinking", text: "late preview",
        } });
        send({ type: "agent_event", event: {
          kind: "log_delta", agentId: "operator", runId: "orphan-operator-preview",
          contentIndex: 0, itemType: "text", text: "late preview",
        } });
        send({ type: "agent_event", event: {
          kind: "closeout", agentId: "operator", runId: "operator-run",
          disposition: "cleaned", reason: "cleaned after terminal",
        } });
      }
    } else if (command.message === "final-before-agent-terminal") {
      send({ type: "agent_event", event: {
        kind: "start", agentId: "active", runId: "active-run", parentId: null,
        name: "operator", role: "operator", title: "Finishing operation",
        task: "Finishing operation", depth: 1, at: new Date().toISOString(),
      } });
    } else if (command.message === "final-with-real-running-agent") {
      send({ type: "agent_event", event: {
        kind: "start", agentId: "active", runId: "active-run", parentId: null,
        name: "operator", role: "operator", title: "Still operating",
        task: "Still operating", depth: 1, at: new Date().toISOString(),
      } });
    }
    const finalMessage = {
      role: "assistant",
      content: [{ type: "text", text: "PASS" }],
      stopReason: command.message === "tool-use-still-streaming" ? "toolUse" : "stop",
      timestamp: command.message === "iso-timestamp-without-settled"
        ? new Date().toISOString()
        : Date.now(),
      responseId: `response-${command.message}`,
    };
    const persistFinal = () => {
      if (!process.env.PIPIUI_TEST_SESSION_PATH) return;
      const durableMessage = command.message === "persisted-final-identity-mismatch"
        ? { ...finalMessage, responseId: "different-response" }
        : finalMessage;
      fs.appendFileSync(process.env.PIPIUI_TEST_SESSION_PATH, `${JSON.stringify({
        type: "message",
        id: "durable-assistant-entry",
        parentId: null,
        message: durableMessage,
        timestamp: new Date().toISOString(),
      })}\n`);
    };
    if (command.message.startsWith("persisted-final-") || command.message === "terminal-rows-with-orphan-previews" || command.message === "final-with-real-running-agent" || command.message === "final-before-agent-terminal") {
      persistFinal();
    } else if (command.message === "delayed-persisted-final-stuck-streaming") {
      setTimeout(persistFinal, 50);
    } else if (command.message === "delayed-durable-terminal-agent-replay") {
      setTimeout(persistFinal, 650);
    }
    send({
      type: "message_end",
      message: finalMessage,
    });
    if (command.message === "final-before-agent-terminal") {
      setTimeout(() => send({ type: "agent_event", event: {
        kind: "end", agentId: "active", runId: "active-run", ok: true,
        output: JSON.stringify({ outcome: "completed", summary: "done" }),
        at: new Date().toISOString(),
      } }), 25);
    } else if (command.message === "final-without-settled" || command.message === "iso-timestamp-without-settled") {
      isStreaming = false;
    } else if (command.message === "final-with-reentry") {
      pendingMessageCount = 1;
      setTimeout(() => {
        pendingMessageCount = 0;
        send({ type: "agent_start" });
      }, 25);
    } else if (command.message === "persisted-final-late-settled") {
      setTimeout(() => send({ type: "agent_settled" }), 25);
    } else if (command.message === "final-pending-then-clear") {
      pendingMessageCount = 1;
      persistFinal();
      setTimeout(() => {
        pendingMessageCount = 0;
      }, 80);
    }
    return;
  }
  if (command.type === "abort") {
    respond(command);
    isStreaming = false;
    pendingMessageCount = 0;
    send({ type: "agent_settled" });
    return;
  }
  respond(command);
});
