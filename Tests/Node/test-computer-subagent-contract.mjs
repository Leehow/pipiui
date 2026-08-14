import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  resolveSubagentToolSelection,
  resolveDesktopGrant,
  isDesktopGrant,
  DESKTOP_GRANT_VALUES,
  DESKTOP_GRANT_CHILD_POLICY,
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
const generalPurposeURL = new URL(
  "../../Sources/PipiUI/PiExt/agents/general-purpose/AGENT.md",
  import.meta.url,
);

test("per-task desktop grant resolution: default none, explicit values, unavailable host", () => {
  assert.deepEqual(DESKTOP_GRANT_VALUES, ["user-requested", "ui-verify"]);

  // Omitted (undefined / unknown values) => no grant, no problem, even with host up.
  assert.deepEqual(resolveDesktopGrant({ desktop: undefined, hostAvailable: true }), {
    granted: false,
    reason: "none",
  });
  const unavailable = resolveDesktopGrant({ desktop: "user-requested", hostAvailable: false });
  assert.equal(unavailable.granted, false);
  assert.equal(unavailable.reason, "unavailable");
  assert.match(unavailable.problem, /Cannot dispatch with desktop:"user-requested"/);
  assert.equal(isDesktopGrant("user-requested"), true);
  assert.equal(isDesktopGrant("ui-verify"), true);
  assert.equal(isDesktopGrant("anything-else"), false);
  assert.equal(isDesktopGrant(undefined), false);

  // Both explicit values + host capability => granted.
  for (const value of DESKTOP_GRANT_VALUES) {
    const grant = resolveDesktopGrant({ desktop: value, hostAvailable: true });
    assert.deepEqual(grant, { granted: true, reason: value });
  }

  // Grant requested but host capability unavailable => explicit failure, never silent.
  const unavailableHost = resolveDesktopGrant({ desktop: "user-requested", hostAvailable: false });
  assert.equal(unavailableHost.granted, false);
  assert.equal(unavailableHost.reason, "unavailable");
  assert.match(unavailableHost.problem, /Cannot dispatch with desktop:"user-requested"/);
  assert.match(unavailableHost.problem, /Computer Use capability is not available/);
});

test("tool allowlist: desktop tools injected only when the host gate passed", () => {
  const staleJSON = JSON.parse(JSON.stringify({
    disabledTools: ["computer", "open_application", "bash"],
  }));
  assert.deepEqual(
    sanitizeDisabledToolNames(staleJSON.disabledTools),
    ["bash"],
  );

  // Global capability alone (hasDesktopCapability true) still injects both
  // desktop tools — the runtime passes `desktopGrant.granted` in here, so this
  // case is only reachable after an explicit per-task grant.
  const granted = resolveSubagentToolSelection({
    declaredTools: ["read", "bash"],
    disabledTools: staleJSON.disabledTools,
    hasDesktopCapability: true,
    allowRecursiveDelegation: true,
  });
  assert.equal(granted.flag, "--tools");
  assert.deepEqual(
    new Set(granted.names),
    new Set(["read", "computer", "open_application"]),
  );

  // No grant => no desktop tools in the allowlist, no matter what the denylist
  // or global state says. A plain coding worker cannot call computer at all.
  const noGrant = resolveSubagentToolSelection({
    declaredTools: ["read", "bash"],
    disabledTools: ["fetch_content"],
    hasDesktopCapability: false,
    allowRecursiveDelegation: true,
  });
  assert.deepEqual(noGrant, { flag: "--tools", names: ["read", "bash"] });

  const unrestricted = resolveSubagentToolSelection({
    declaredTools: undefined,
    disabledTools: staleJSON.disabledTools,
    hasDesktopCapability: true,
    allowRecursiveDelegation: false,
  });
  assert.equal(unrestricted.flag, "--exclude-tools");
  assert.deepEqual(unrestricted.names, ["bash", "subagent"]);

  const legacyNoGrant = resolveSubagentToolSelection({
    declaredTools: undefined,
    disabledTools: [],
    hasDesktopCapability: false,
    allowRecursiveDelegation: true,
  });
  assert.equal(legacyNoGrant.flag, "--exclude-tools");
  assert.ok(legacyNoGrant.names.includes("computer"));
  assert.ok(legacyNoGrant.names.includes("open_application"));
});

test("child policy text: shell is for non-GUI work and cannot replace granted Computer Use", () => {
  const policy = DESKTOP_GRANT_CHILD_POLICY;
  assert.match(policy, /For files, logs, process or file waiting, polling, and build\/test verification, use read\/bash instead of computer/);
  assert.match(policy, /read\/bash for files, logs, process or file waiting, polling, and build\/test verification/);
  assert.match(policy, /Waiting, sleeping, polling logs, compiling, running tests, reading files, and ordinary web research are FORBIDDEN via computer/);
  assert.match(policy, /Never use bash, shell, AppleScript, osascript, `open`, process signals, or synthetic input to operate or replace a requested GUI\/App interaction/);
  assert.match(policy, /When the user requested a visible App\/GUI operation, you MUST use open_application and computer/);
  assert.match(policy, /built-in browser tool for ordinary web work/);
  assert.match(policy, /Chrome, Safari, another external browser, or "my browser"/);
  assert.match(policy, /MUST use exactly that browser/);
  assert.match(policy, /Never substitute the built-in browser tool for a user-named external browser/);
  assert.match(policy, /you may not self-grant, extend, or propagate desktop access/i);
  assert.match(policy, /ui-verify grant: use desktop only for the visual acceptance check/);
});

test("index.ts runtime gate: grant gated extension mount, env, and early failure", async () => {
  const subagent = await readFile(subagentURL, "utf8");

  // The gate resolves before spawn and hard-fails a requested-but-unavailable grant.
  assert.match(subagent, /const desktopGrant = resolveDesktopGrant\(\{/);
  assert.match(subagent, /if \(desktopGrant\.problem\) \{/);
  assert.match(subagent, /hostAvailable:\s*$/m);
  assert.match(subagent, /!!PIPIUI_COMPUTER_EXT && !!process\.env\.PIPIUI_COMPUTER_CAPABILITY/);

  // Extension mount is grant-gated (was: unconditional for dispatched Pi).
  assert.match(subagent, /if \(desktopGrant\.granted && PIPIUI_COMPUTER_EXT\) \{\s*args\.push\("-e", PIPIUI_COMPUTER_EXT\);/);
  // Tool allowlist gate is the resolved grant, not raw capability.
  assert.match(subagent, /hasDesktopCapability: desktopGrant\.granted,/);
  // Capability env is preserved for the dispatched Pi child only under a grant.
  const childEnvStart = subagent.indexOf(
    "const childEnv = options?.computerWorker",
  );
  const childSpawnStart = subagent.indexOf(
    "const proc = spawn(invocation.command",
    childEnvStart,
  );
  assert.ok(childEnvStart >= 0 && childSpawnStart > childEnvStart);
  const childEnvBlock = subagent.slice(childEnvStart, childSpawnStart);
  assert.match(childEnvBlock, /isolatedComputerWorkerChildProcessEnv\(childEnvironmentInput\)/);
  assert.match(childEnvBlock, /pipiuiChildProcessEnv\(childEnvironmentInput, desktopGrant\.granted\)/);
  assert.match(subagent, /env\.ELECTRON_RUN_AS_NODE = "1"/);
  // The child-policy prompt is appended only for granted dispatches.
  assert.match(subagent, /if \(desktopGrant\.granted\) promptParts\.push\(DESKTOP_GRANT_CHILD_POLICY\);/);

  // verify/git helpers still strip the capability by default (preserve=false).
  assert.match(
    subagent,
    /if \(!preserveComputerCapability\)\s*\{\s*delete env\.PIPIUI_COMPUTER_CAPABILITY;/,
  );
  const helperCalls = [...subagent.matchAll(/pipiuiChildProcessEnv\(/g)];
  assert.ok(
    helperCalls.length >= 3,
    "expected helper definition, a non-desktop helper call, and the dispatched Pi call",
  );
});

test("schema: per-task desktop field on single, tasks[], chain — each independent, default omitted", async () => {
  const subagent = await readFile(subagentURL, "utf8");

  const enumDecls = subagent.match(
    /StringEnum\(\["user-requested", "ui-verify"\] as const, \{/g,
  ) ?? [];
  assert.equal(enumDecls.length, 3, "TaskItem, ChainItem and SubagentParams each declare desktop");

  const desktopParamUses = subagent.match(/params\.desktop/g) ?? [];
  const desktopOptionUses = subagent.match(/desktop: params\.desktop/g) ?? [];
  const taskItemUses = subagent.match(/desktop: t\.desktop/g) ?? [];
  const chainUses = subagent.match(/desktop: step\.desktop/g) ?? [];
  assert.equal(desktopParamUses.length, 2, "single mode foreground option + background start call pass desktop");
  assert.equal(desktopOptionUses.length, 1, "single foreground options object carries desktop");
  assert.equal(taskItemUses.length, 2, "tasks[] foreground and background pass desktop (startBackgroundAgent options pass bare desktop)");
  assert.equal(chainUses.length, 1, "each chain step passes its own desktop");

  // Boss-facing rules live in the schema description.
  assert.match(subagent, /Omitted by default — desktop tools are NEVER injected without it/);
  assert.match(subagent, /"user-requested"/);
  assert.match(subagent, /"ui-verify"/);
  assert.match(subagent, /never swap in the built-in browser/);
  assert.match(subagent, /Ordinary web research → built-in browser tool, not desktop/);
  assert.match(subagent, /never inherits another task\\'s grant/);
});

test("no-grant worker cannot reach desktop tools (anti-regression)", async () => {
  const [generalPurpose, assembly] = await Promise.all([
    readFile(generalPurposeURL, "utf8"),
    readFile(spawnAssemblyURL, "utf8"),
  ]);

  // general-purpose.md declares only plain coding tools; a default dispatch
  // with no desktop grant therefore ends up with an allowlist without computer.
  const toolsLine = generalPurpose.split("\n").find((l) => l.startsWith("tools:"));
  assert.ok(toolsLine, "general-purpose.md declares tools");
  assert.doesNotMatch(toolsLine, /\bcomputer\b/);
  assert.doesNotMatch(toolsLine, /\bopen_application\b/);

  // A no-grant dispatch through the pure seam never contains the tools.
  const selection = resolveSubagentToolSelection({
    declaredTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    disabledTools: [],
    hasDesktopCapability: false,
    allowRecursiveDelegation: false,
  });
  assert.equal(selection.names.includes("computer"), false);
  assert.equal(selection.names.includes("open_application"), false);

  // Host-side wiring: main exports env/runtime protocol; tools mount only via grant.
  assert.match(assembly, /env\["PIPIUI_COMPUTER_EXT"\]\s*=\s*p/);
  assert.match(assembly, /env\["PIPIUI_COMPUTER_RUNTIME_PROTOCOL"\]\s*=/);
  assert.match(assembly, /env\["PIPIUI_COMPUTER_CAPABILITY"\]\s*=\s*input\.computerRoutingKey/);
  assert.match(assembly, /computerEnvReady/);
});

test("selected strategy path and runtime capabilities reach nested Pi without duplicate mounting", async () => {
  const [subagent, assembly, chatSession] = await Promise.all([
    readFile(subagentURL, "utf8"),
    readFile(spawnAssemblyURL, "utf8"),
    readFile(chatSessionURL, "utf8"),
  ]);
  // Main session must never -e-mount computer-use; only export PIPIUI_COMPUTER_*.
  const gateStart = assembly.indexOf("// Computer Use:");
  assert.notEqual(gateStart, -1, "missing Computer Use assembly gate comment");
  const computerGate = assembly.slice(gateStart, gateStart + 900);
  assert.doesNotMatch(
    computerGate,
    /args \+= \["-e"/,
    "computer-use assembly gate exports env only",
  );
  assert.match(computerGate, /computerEnvReady/);
  assert.doesNotMatch(
    assembly,
    /paths\.computerUse[\s\S]{0,120}args \+= \["-e", p\]/,
    "main session must not -e-mount computerUse path",
  );
  const nestedMounts = subagent.match(
    /args\.push\("-e", PIPIUI_COMPUTER_EXT\)/g,
  ) ?? [];
  assert.equal(nestedMounts.length, 1, "only the grant-gated mount site remains");
  assert.match(chatSession, /let assembly = PipiSpawnAssembly\.assemble\(/);
  assert.match(
    assembly,
    /PIPIUI_COMPUTER_DISPLAY_ID/,
    "built-in synchronous provider adaptation keeps its descriptor hint",
  );
});
