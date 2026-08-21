import readline from "node:readline";
import { appendFileSync } from "node:fs";

const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const extuiLogPath = process.env.FAKE_PI_EXTUI_LOG ?? "";

function response(command, id, success, data, error) {
  send({ id, type: "response", command, success, ...(success ? { data } : { error }) });
}

function log(path, value) {
  if (!path) return;
  try { appendFileSync(path, JSON.stringify(value) + "\n"); } catch {}
}

let activeModel = { provider: "fake", id: "fake-1", name: "Fake", reasoning: true };
let activeThinkingLevel = "medium";

function emitUi(message) {
  if (message === "__extui_notify__") {
    send({ type: "extension_ui_request", id: "ui-notify-1", method: "notify", message: "hi", notifyType: "info" });
  } else if (message === "__extui_confirm__") {
    send({ type: "extension_ui_request", id: "ui-confirm-1", method: "confirm", title: "Clear?", message: "All gone." });
  } else if (message === "__extui_select__") {
    send({ type: "extension_ui_request", id: "ui-select-1", method: "select", title: "Pick", options: ["Allow", "Block"] });
  } else if (message === "__extui_input__") {
    send({ type: "extension_ui_request", id: "ui-input-1", method: "input", title: "Name", placeholder: "type" });
  } else if (message === "__extui_widget__") {
    send({
      type: "extension_ui_request",
      id: "ui-widget-1",
      method: "setWidget",
      widgetKey: "demo",
      widgetLines: ["line"],
    });
  }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  const ok = (data) => response(command.type, command.id, true, data);
  if (command.type === "get_available_models") {
    return ok({ models: [{ provider: "fake", id: "fake-1", name: "Fake", reasoning: true }] });
  }
  if (command.type === "get_state") {
    return ok({ model: activeModel, thinkingLevel: activeThinkingLevel });
  }
  if (command.type === "get_available_thinking_levels") return ok({ levels: ["off", "medium", "high"] });
  if (command.type === "set_model") {
    activeModel = { provider: command.provider, id: command.modelId, name: command.modelId, reasoning: true };
    return ok();
  }
  if (command.type === "set_thinking_level") {
    activeThinkingLevel = command.level;
    return ok();
  }
  if (command.type === "get_session_stats") {
    return ok({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 });
  }
  if (command.type === "extension_ui_response") {
    log(extuiLogPath, command);
    return;
  }
  if (command.type === "prompt") {
    ok();
    send({ type: "agent_start" });
    emitUi(command.message ?? "");
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "ok" } });
    send({ type: "agent_settled" });
    return;
  }
  ok();
});
