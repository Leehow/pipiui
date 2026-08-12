import readline from "node:readline";

const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const respond = (command, data) => send({
  id: command.id,
  type: "response",
  command: command.type,
  success: true,
  data,
});
let activeModel = { provider: "fake", id: "fake-1", name: "Fake", reasoning: true };
let thinkingLevel = "medium";

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "set_model") {
    if (process.env.PIPIUI_TEST_EXIT_ON_SET_MODEL === "1") {
      process.stderr.write("fatal: model runtime was replaced while Pi was running\n");
      setImmediate(() => process.exit(23));
      return;
    }
    activeModel = { provider: command.provider, id: command.modelId, name: command.modelId, reasoning: true };
    respond(command, activeModel);
    return;
  }
  if (command.type === "set_thinking_level") {
    thinkingLevel = command.level;
    respond(command, {});
    return;
  }
  if (command.type === "get_available_models") {
    respond(command, { models: [activeModel] });
    return;
  }
  if (command.type === "get_state") {
    respond(command, { model: activeModel, thinkingLevel });
    return;
  }
  if (command.type === "get_available_thinking_levels") {
    respond(command, { levels: ["off", "medium", "high"] });
    return;
  }
  respond(command, {});
});
