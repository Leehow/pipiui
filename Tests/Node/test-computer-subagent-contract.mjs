import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  resolveSubagentToolSelection,
  sanitizeDisabledToolNames,
} from "../../Sources/PipiUI/PiExt/subagent/desktop-tool-policy.mjs";

const subagentURL = new URL(
  "../../Sources/PipiUI/PiExt/subagent/index.ts",
  import.meta.url,
);
const chatSessionURL = new URL(
  "../../Sources/PipiUI/ChatSession.swift",
  import.meta.url,
);
const spawnAssemblyURL = new URL(
  "../../Sources/PipiUI/PipiSpawnAssembly.swift",
  import.meta.url,
);

test("globally enabled subagent Pi loads both desktop tools", async () => {
  const [subagent, assembly] = await Promise.all([
    readFile(subagentURL, "utf8"),
    readFile(spawnAssemblyURL, "utf8"),
  ]);

  assert.match(
    assembly,
    /env\["PIPIUI_COMPUTER_EXT"\]\s*=\s*p/,
  );
  assert.match(
    assembly,
    /env\["PIPIUI_COMPUTER_RUNTIME_PROTOCOL"\]\s*=/,
  );
  assert.match(subagent, /args\.push\("-e", PIPIUI_COMPUTER_EXT\)/);
  assert.match(subagent, /resolveSubagentToolSelection\(\{/);
  assert.match(subagent, /sanitizeDisabledToolNames\(out\)/);

  const staleJSON = JSON.parse(JSON.stringify({
    disabledTools: ["computer", "open_application", "bash"],
  }));
  assert.deepEqual(
    sanitizeDisabledToolNames(staleJSON.disabledTools),
    ["bash"],
  );
  const selected = resolveSubagentToolSelection({
    declaredTools: ["read", "bash"],
    disabledTools: staleJSON.disabledTools,
    hasDesktopCapability: true,
    allowRecursiveDelegation: true,
  });
  assert.equal(selected.flag, "--tools");
  assert.deepEqual(
    new Set(selected.names),
    new Set(["read", "computer", "open_application"]),
  );

  const unrestricted = resolveSubagentToolSelection({
    declaredTools: [],
    disabledTools: staleJSON.disabledTools,
    hasDesktopCapability: true,
    allowRecursiveDelegation: false,
  });
  assert.equal(unrestricted.flag, "--exclude-tools");
  assert.deepEqual(unrestricted.names, ["bash", "subagent"]);
});

test("desktop capability reaches only the dispatched Pi child", async () => {
  const subagent = await readFile(subagentURL, "utf8");

  assert.match(
    subagent,
    /if \(!preserveComputerCapability\)\s*\{\s*delete env\.PIPIUI_COMPUTER_CAPABILITY;/,
  );
  const childEnvStart = subagent.indexOf(
    "const childEnv = pipiuiChildProcessEnv({",
  );
  const childSpawnStart = subagent.indexOf(
    "const proc = spawn(invocation.command",
    childEnvStart,
  );
  assert.ok(childEnvStart >= 0 && childSpawnStart > childEnvStart);
  assert.match(
    subagent.slice(childEnvStart, childSpawnStart),
    /\}, true\);\s*$/,
  );

  const withoutCapability = resolveSubagentToolSelection({
    declaredTools: ["read"],
    disabledTools: ["computer", "open_application"],
    hasDesktopCapability: false,
    allowRecursiveDelegation: true,
  });
  assert.deepEqual(withoutCapability, {
    flag: "--tools",
    names: ["read"],
  });

  const helperCalls = [...subagent.matchAll(/pipiuiChildProcessEnv\(/g)];
  assert.ok(
    helperCalls.length >= 4,
    "expected helper definition, verifier/git calls, and dispatched Pi call",
  );
});

test("selected strategy path and runtime capabilities reach nested Pi without duplicate mounting", async () => {
  const [subagent, assembly, chatSession] = await Promise.all([
    readFile(subagentURL, "utf8"),
    readFile(spawnAssemblyURL, "utf8"),
    readFile(chatSessionURL, "utf8"),
  ]);
  const topLevelMounts = assembly.match(
    /if f\.isEnabled\(\.computerUse\),\s*input\.computerDescriptor != nil,\s*let p = input\.paths\.computerUse \{\s*args \+= \["-e", p\]/g,
  ) ?? [];
  const nestedMounts = subagent.match(
    /args\.push\("-e", PIPIUI_COMPUTER_EXT\)/g,
  ) ?? [];
  assert.equal(topLevelMounts.length, 1);
  assert.equal(nestedMounts.length, 1);
  assert.match(chatSession, /let assembly = PipiSpawnAssembly\.assemble\(/);
  assert.match(
    assembly,
    /env\["PIPIUI_COMPUTER_CAPABILITY"\]\s*=\s*input\.computerRoutingKey/,
  );
  assert.match(
    subagent,
    /PIPIUI_COMPUTER_EXT && process\.env\.PIPIUI_COMPUTER_CAPABILITY/,
  );
  assert.match(
    assembly,
    /PIPIUI_COMPUTER_DISPLAY_ID/,
    "built-in synchronous provider adaptation keeps its descriptor hint",
  );
});
