import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RESERVED_DESKTOP_TOOL_NAMES } from "../../Sources/PipiUI/PiExt/subagent/desktop-tool-policy.mjs";

const strategyURL = new URL(
  "../../Sources/PipiUI/PiExt/computer-use-strategy.ts",
  import.meta.url,
);
const resolverURL = new URL(
  "../../Sources/PipiUI/ComputerUseStrategy.swift",
  import.meta.url,
);
const settingsURL = new URL(
  "../../Sources/PipiUI/ComputerUseSettings.swift",
  import.meta.url,
);
const appStoreURL = new URL(
  "../../Sources/PipiUI/AppStore.swift",
  import.meta.url,
);
const contractDocURL = new URL(
  "../../docs/computer-runtime-v1.md",
  import.meta.url,
);

test("built-in strategy is resource-owned and external selection cannot fall back", async () => {
  const [strategy, resolver, settings, appStore] = await Promise.all([
    readFile(strategyURL, "utf8"),
    readFile(resolverURL, "utf8"),
    readFile(settingsURL, "utf8"),
    readFile(appStoreURL, "utf8"),
  ]);
  assert.match(strategy, /registerTool/);
  assert.match(strategy, /computer_runtime_capabilities/);
  assert.match(strategy, /protocolVersion: RUNTIME_VERSION/);
  assert.doesNotMatch(resolver, /registerTool|static let source/);
  assert.match(settings, /case \.external:/);
  assert.match(settings, /externalPathMissing/);
  assert.match(settings, /externalPathNotFound/);
  assert.match(appStore, /selectedComputerStrategy\?\.extensionPath/);
  assert.doesNotMatch(
    appStore,
    /selectedComputerStrategy\?\.extensionPath\s*\?\?\s*plugin\.computerUseExtension/,
  );
});

test("custom tools and Anthropic adaptation remain while native OpenAI is not claimed", async () => {
  const [strategy, contractDoc] = await Promise.all([
    readFile(strategyURL, "utf8"),
    readFile(contractDocURL, "utf8"),
  ]);
  assert.match(strategy, /name: "computer"/);
  assert.match(strategy, /name: "open_application"/);
  assert.match(strategy, /type: "computer_20251124"/);
  assert.match(strategy, /computer-use-2025-11-24/);
  assert.doesNotMatch(strategy, /name: "computer_call"/);
  assert.doesNotMatch(strategy, /type: "computer_call"/);
  assert.match(
    contractDoc,
    /does[\s\S]*\*\*not\*\* promise an OpenAI-native/,
  );
});

test("capability tokens have no persisted settings key or documented logging path", async () => {
  const [settings, contractDoc] = await Promise.all([
    readFile(settingsURL, "utf8"),
    readFile(contractDocURL, "utf8"),
  ]);
  assert.doesNotMatch(
    settings,
    /computerCapability|sessionKey|PIPIUI_COMPUTER_CAPABILITY/,
  );
  assert.match(contractDoc, /must not be written[\s\S]*to disk or logs/);
});

test("nested strategy compatibility is limited to the two reserved tool names", async () => {
  const [settings, contractDoc] = await Promise.all([
    readFile(settingsURL, "utf8"),
    readFile(contractDocURL, "utf8"),
  ]);
  assert.deepEqual(
    [...RESERVED_DESKTOP_TOOL_NAMES],
    ["computer", "open_application"],
  );
  assert.match(settings, /requiredNestedStrategyToolNames/);
  assert.match(
    contractDoc,
    /must register tools named exactly `computer` and `open_application`/,
  );
  assert.match(
    contractDoc,
    /arbitrary names are not[\s\S]*automatically added to nested explicit allowlists/,
  );
});

test("runtime docs state the process-level trust and emergency-stop lifecycle", async () => {
  const contractDoc = await readFile(contractDocURL, "utf8");
  assert.match(
    contractDoc,
    /every extension in the same Pi process can read the[\s\S]*process environment/,
  );
  assert.match(
    contractDoc,
    /Emergency stop[\s\S]*does not rotate the `computerRoutingKey`/,
  );
  assert.match(
    contractDoc,
    /Applying an unchanged path deliberately[\s\S]*edit-and-reload loop/,
  );
});

test("runtime docs make generic and unknown error flags directly trustworthy", async () => {
  const contractDoc = await readFile(contractDocURL, "utf8");
  assert.match(
    contractDoc,
    /boolean fields are authoritative Runtime guidance/,
  );
  assert.match(
    contractDoc,
    /Unknown codes fail closed with[\s\S]*`retryable: false` and `requiresObservation: true`/,
  );
  assert.match(
    contractDoc,
    /`runtime_error`[\s\S]*do not retry and observe before[\s\S]*continuing/,
  );
  assert.doesNotMatch(
    contractDoc,
    /false` flags[\s\S]*do not prove/,
  );
});
