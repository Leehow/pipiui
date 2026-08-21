import readline from "node:readline";
import { appendFileSync } from "node:fs";

const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const settingsLogPath = process.env.FAKE_PI_SETTINGS_LOG ?? "";
const invokeLogPath = process.env.FAKE_PI_INVOKE_LOG ?? "";

function response(command, id, success, data, error) {
  send({ id, type: "response", command, success, ...(success ? { data } : { error }) });
}

function log(path, value) {
  if (!path) return;
  try { appendFileSync(path, JSON.stringify(value) + "\n"); } catch {}
}

let activeModel = { provider: "fake", id: "fake-1", name: "Fake", reasoning: true };
let activeThinkingLevel = "medium";

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
  if (command.type === "prompt") {
    ok();
    send({ type: "agent_start" });
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "ok" } });
    send({ type: "agent_settled" });
    return;
  }
  if (command.type === "ext.settings_changed") {
    log(settingsLogPath, command);
    return ok();
  }
  if (command.type === "invokeExtension") {
    log(invokeLogPath, command);
    if (command.method === "hang") return;
    if (command.method === "fail") {
      return response(command.type, command.id, false, undefined, "agent boom");
    }
    return ok({ echoed: command.params, extensionId: command.extensionId, method: command.method });
  }
  ok();
});
