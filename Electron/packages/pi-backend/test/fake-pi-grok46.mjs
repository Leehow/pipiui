import readline from "node:readline";

const model = {
  provider: "xai",
  id: "grok-4.6",
  name: "Grok 4.6",
  api: "openai-completions",
  reasoning: true,
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
  },
  input: ["text", "image"],
};
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
let thinkingLevel = "off";
let ignoredRestore = false;

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  const respond = (data) => send({
    id: command.id,
    type: "response",
    command: command.type,
    success: true,
    data,
  });
  if (command.type === "get_available_models") return respond({ models: [model] });
  if (command.type === "get_state") return respond({ model, thinkingLevel });
  if (command.type === "get_available_thinking_levels")
    return respond({ levels: ["off", "minimal", "low", "medium", "high"] });
  if (command.type === "set_thinking_level") {
    if (!ignoredRestore) {
      ignoredRestore = true;
      return respond({});
    }
    thinkingLevel = command.level;
    return respond({});
  }
  respond({});
});
