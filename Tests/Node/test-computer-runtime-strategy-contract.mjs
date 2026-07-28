import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
  assert.match(contractDoc, /does \*\*not\*\* promise an[\s\S]*OpenAI-native/);
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
