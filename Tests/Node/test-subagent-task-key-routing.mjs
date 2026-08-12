import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../Sources/PipiUI/PiExt/subagent/index.ts", import.meta.url), "utf8");
const start = source.indexOf("// PIPIUI_PURE_TASK_KEY_ROUTING_BEGIN");
const end = source.indexOf("// PIPIUI_PURE_TASK_KEY_ROUTING_END");
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const body = source.slice(start, end)
  .replace(/export /g, "")
  .replace(/function selectTaskKeyAgentIdentity\([^\n]+/, "function selectTaskKeyAgentIdentity(taskKey, requestedAgentId, requestedName, entries) {");
const select = new Function("TASK_KEY_PATTERN", `${body}; return selectTaskKeyAgentIdentity;`)(/^[a-z0-9][a-z0-9._:-]{1,63}$/);

const stored = [{ taskKey: "electron.ui.acceptance", agentId: "electron-ui-acceptance", name: "explore" }];
assert.deepEqual(select("electron.ui.acceptance", undefined, undefined, stored), { agentId: "electron-ui-acceptance", name: "explore" });
assert.deepEqual(select("electron.ui.acceptance", "electron-ui-acceptance", "explore", stored), { agentId: "electron-ui-acceptance", name: "explore" });
assert.match(select("electron.ui.acceptance", "new-worker", undefined, stored).problem, /already belongs/);
assert.match(select("electron.ui.acceptance", undefined, "general-purpose", stored).problem, /agent profile/);
assert.match(select("different.slice", undefined, undefined, stored).problem, /first dispatch/);
assert.deepEqual(select("different.slice", "different-worker", "general-purpose", stored), { agentId: "different-worker", name: "general-purpose" });

console.log("subagent task-key routing tests passed");
