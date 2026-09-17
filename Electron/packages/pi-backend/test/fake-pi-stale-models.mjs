import readline from "node:readline";

/**
 * A pi child whose model catalog is frozen at spawn time.
 *
 * `PIPIUI_TEST_KNOWN_MODEL_IDS` is the comma-separated id list this child read
 * from models.json when it started; anything else is rejected exactly the way
 * rpc-mode rejects a ref missing from its availability snapshot. Restarting the
 * child with a longer list is what the host's recovery path must produce.
 */
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const respond = (command, data) => send({ id: command.id, type: "response", command: command.type, success: true, data });
const fail = (command, error) => send({ id: command.id, type: "response", command: command.type, success: false, error });

const known = new Set((process.env.PIPIUI_TEST_KNOWN_MODEL_IDS ?? "").split(",").filter(Boolean));
let activeModel = { provider: "relay", id: "base", name: "Base", reasoning: true };
let thinkingLevel = "medium";

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "set_model") {
    if (!known.has(command.modelId)) {
      fail(command, `Model not found: ${command.provider}/${command.modelId}`);
      return;
    }
    activeModel = { provider: command.provider, id: command.modelId, name: command.modelId, reasoning: true };
    respond(command, activeModel);
    return;
  }
  if (command.type === "set_thinking_level") { thinkingLevel = command.level; respond(command, {}); return; }
  if (command.type === "get_available_models") {
    // Real pi answers with its whole availability snapshot, and the host adopts
    // it as the catalog — so the frozen list has to be what this reports.
    // PIPIUI_TEST_EMPTY_SNAPSHOT isolates that adoption step: it empties only
    // this answer. A real child whose availability refresh threw also rejects
    // every set_model, so it could not reach the host's catalog code at all.
    const reported = process.env.PIPIUI_TEST_EMPTY_SNAPSHOT === "1" ? [] : [...known];
    respond(command, { models: reported.map((id) => ({ provider: "relay", id, name: id, reasoning: true })) });
    return;
  }
  if (command.type === "get_state") { respond(command, { model: activeModel, thinkingLevel }); return; }
  if (command.type === "get_available_thinking_levels") { respond(command, { levels: ["off", "medium", "high"] }); return; }
  respond(command, {});
});
