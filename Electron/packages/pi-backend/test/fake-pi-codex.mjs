import readline from "node:readline";

const model = {
  provider: "openai-codex",
  id: "gpt-5.6-luna",
  name: "GPT-5.6 Luna",
  reasoning: true,
};
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
let thinkingLevel = "high";

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
    thinkingLevel = command.level;
    return respond({});
  }
  if (command.type === "set_model") {
    return respond(model);
  }
  respond({});
});
