import readline from "node:readline";

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
    send({
      type: "message_end",
      message: {
        id: "assistant-final",
        role: "assistant",
        content: [{ type: "text", text: "PASS" }],
        stopReason: "stop",
      },
    });
    if (command.message === "final-without-settled") {
      isStreaming = false;
    } else if (command.message === "final-with-reentry") {
      pendingMessageCount = 1;
      setTimeout(() => {
        pendingMessageCount = 0;
        send({ type: "agent_start" });
      }, 25);
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
