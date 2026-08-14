import readline from "node:readline";

const map = {
  off: null,
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: null,
};
const xai = { provider: "xai", id: "grok-4.6", name: "Grok 4.6", reasoning: true, thinkingLevelMap: map };
const opencode = {
  provider: "opencode",
  id: "grok-4.6",
  name: "Grok 4.6",
  reasoning: true,
  thinkingLevelMap: { ...map, minimal: null, xhigh: null },
};
let model = xai;
let selectedXaiCount = 0;
let thinkingLevel = "low";
const send = value => process.stdout.write(JSON.stringify(value) + "\n");

readline.createInterface({ input: process.stdin }).on("line", line => {
  const command = JSON.parse(line);
  const respond = data => send({ id: command.id, type: "response", command: command.type, success: true, data });
  if (command.type === "get_available_models") return respond({ models: [xai, opencode] });
  if (command.type === "set_model") {
    if (command.provider === "xai") {
      selectedXaiCount += 1;
      model = selectedXaiCount === 1 ? opencode : xai;
    } else model = opencode;
    return respond(model);
  }
  if (command.type === "get_state") return respond({ model, thinkingLevel });
  if (command.type === "get_available_thinking_levels")
    return respond({ levels: model.provider === "xai" ? ["minimal", "low", "medium", "high", "xhigh"] : ["low", "medium", "high"] });
  if (command.type === "set_thinking_level") { thinkingLevel = command.level; return respond({}); }
  respond({});
});
